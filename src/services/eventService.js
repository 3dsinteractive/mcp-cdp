import crypto from 'node:crypto';
import { getDb, safeJsonParse } from '../db.js';
import { upsertCustomer, linkCustomerIdentity } from './customerService.js';

function genId(prefix = 'evt') {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

export function extractUtmFromUrl(urlStr) {
  if (!urlStr) return {};
  try {
    const parsed = new URL(urlStr, 'https://example.com');
    const sp = parsed.searchParams;
    return {
      utm_source: sp.get('utm_source') || undefined,
      utm_medium: sp.get('utm_medium') || undefined,
      utm_campaign: sp.get('utm_campaign') || undefined,
      utm_term: sp.get('utm_term') || undefined,
      utm_content: sp.get('utm_content') || undefined
    };
  } catch {
    return {};
  }
}

/**
 * Resolve customer_id from customer_id, external_id, email, or linked anonymous_id
 */
export function resolveCustomerId({ customer_id, external_id, email, anonymous_id }) {
  const db = getDb();
  if (customer_id) {
    const c = db.prepare('SELECT id FROM customers WHERE id = ?').get(customer_id);
    if (c) return c.id;
  }
  if (external_id) {
    const c = db.prepare('SELECT id FROM customers WHERE external_id = ?').get(external_id);
    if (c) return c.id;
  }
  if (email) {
    const c = db.prepare('SELECT id FROM customers WHERE email = ?').get(email);
    if (c) return c.id;
  }
  if (anonymous_id) {
    const link = db.prepare(`
      SELECT primary_customer_id FROM customer_links
      WHERE identity_type = 'anonymous_id' AND identity_value = ?
      ORDER BY created_at DESC LIMIT 1
    `).get(anonymous_id);
    if (link) return link.primary_customer_id;
  }
  return null;
}

/**
 * Record a customer behavior event
 */
export function trackEvent(input) {
  const db = getDb();
  const id = input.id || genId('evt');
  const now = input.timestamp || new Date().toISOString();

  const resolvedCustomerId = resolveCustomerId({
    customer_id: input.customer_id,
    external_id: input.external_id,
    email: input.email,
    anonymous_id: input.anonymous_id
  });

  // If both resolvedCustomerId and anonymous_id exist, ensure they are linked
  if (resolvedCustomerId && input.anonymous_id) {
    linkCustomerIdentity({
      primary_customer_id: resolvedCustomerId,
      identity_type: 'anonymous_id',
      identity_value: input.anonymous_id,
      relationship: 'same_person'
    });
  }

  const urlUtms = extractUtmFromUrl(input.page_url);
  const utm_source = input.utm_source || urlUtms.utm_source || null;
  const utm_medium = input.utm_medium || urlUtms.utm_medium || null;
  const utm_campaign = input.utm_campaign || urlUtms.utm_campaign || null;
  const utm_term = input.utm_term || urlUtms.utm_term || null;
  const utm_content = input.utm_content || urlUtms.utm_content || null;

  const revenue = Number(input.revenue ?? input.properties?.revenue ?? input.properties?.amount ?? 0);
  const currency = input.currency || input.properties?.currency || 'THB';

  db.prepare(`
    INSERT INTO events (
      id, customer_id, anonymous_id, session_id, event_name, event_category,
      page_url, page_title, referrer,
      utm_source, utm_medium, utm_campaign, utm_term, utm_content,
      channel, revenue, currency, properties, user_agent, ip_address, timestamp
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    resolvedCustomerId,
    input.anonymous_id ?? null,
    input.session_id ?? null,
    input.event_name,
    input.event_category ?? 'behavior',
    input.page_url ?? null,
    input.page_title ?? null,
    input.referrer ?? null,
    utm_source,
    utm_medium,
    utm_campaign,
    utm_term,
    utm_content,
    input.channel ?? 'web',
    revenue,
    currency,
    JSON.stringify(input.properties || {}),
    input.user_agent ?? null,
    input.ip_address ?? null,
    now
  );

  // Update customer's last_seen_at and purchase stats if linked to a customer
  if (resolvedCustomerId) {
    if (input.event_name === 'purchase' || revenue > 0) {
      db.prepare(`
        UPDATE customers
        SET last_seen_at = ?,
            total_spent = total_spent + ?,
            order_count = order_count + CASE WHEN ? = 'purchase' THEN 1 ELSE 0 END,
            lifecycle_stage = CASE WHEN lifecycle_stage = 'lead' AND ? = 'purchase' THEN 'customer' ELSE lifecycle_stage END,
            updated_at = ?
        WHERE id = ?
      `).run(now, revenue, input.event_name, input.event_name, now, resolvedCustomerId);
    } else {
      db.prepare(`
        UPDATE customers SET last_seen_at = ?, updated_at = ? WHERE id = ?
      `).run(now, now, resolvedCustomerId);
    }
  }

  return formatEventRow(db.prepare('SELECT * FROM events WHERE id = ?').get(id));
}

/**
 * Ingest payload from Web/App Tracking Script (supports identify + track + pageview + UTM)
 */
export function ingestTrackingPayload(payload) {
  let customerId = payload.customer_id || null;

  // If traits / user identification fields are provided in the tracking script call, upsert customer
  if (payload.traits || payload.email || payload.external_id || payload.phone) {
    const traits = payload.traits || {};
    const upsertRes = upsertCustomer({
      id: payload.customer_id,
      external_id: payload.external_id || traits.external_id,
      email: payload.email || traits.email,
      phone: payload.phone || traits.phone,
      first_name: traits.first_name,
      last_name: traits.last_name,
      city: traits.city,
      country: traits.country,
      line_uid: traits.line_uid,
      fb_psid: traits.fb_psid,
      whatsapp_id: traits.whatsapp_id,
      app_push_token: traits.app_push_token,
      web_push_subscription: traits.web_push_subscription,
      custom_attributes: traits.custom_attributes,
      source: 'tracking_script'
    });
    customerId = upsertRes.customer.id;
  }

  // Stitch anonymous_id if available
  let stitchResult = null;
  if (customerId && payload.anonymous_id) {
    stitchResult = linkCustomerIdentity({
      primary_customer_id: customerId,
      identity_type: 'anonymous_id',
      identity_value: payload.anonymous_id,
      relationship: 'same_person',
      metadata: { stitched_via: 'tracking_script', session_id: payload.session_id }
    });
  }

  const eventName = payload.event_name || payload.event || 'page_view';
  const utm = payload.utm || {};

  const recordedEvent = trackEvent({
    customer_id: customerId,
    anonymous_id: payload.anonymous_id,
    session_id: payload.session_id,
    event_name: eventName,
    event_category: payload.event_category || 'web_tracking',
    page_url: payload.page_url || payload.url,
    page_title: payload.page_title || payload.title,
    referrer: payload.referrer,
    utm_source: payload.utm_source || utm.source,
    utm_medium: payload.utm_medium || utm.medium,
    utm_campaign: payload.utm_campaign || utm.campaign,
    utm_term: payload.utm_term || utm.term,
    utm_content: payload.utm_content || utm.content,
    channel: payload.channel || 'web_script',
    revenue: payload.revenue,
    currency: payload.currency,
    properties: payload.properties || {},
    user_agent: payload.user_agent,
    ip_address: payload.ip_address,
    timestamp: payload.timestamp
  });

  return {
    status: 'ingested',
    resolved_customer_id: recordedEvent.customer_id,
    identity_stitch: stitchResult,
    event: recordedEvent
  };
}

/**
 * Generate a Web Tracking Script snippet for embedding on websites
 */
export function generateTrackingScript({ site_id = 'cdp_default', endpoint_hint = 'mcp://cdp/ingest_tracking_payload' } = {}) {
  const script = `<!-- MCP-CDP Web Tracking Script (${site_id}) -->
<script>
(function(w, d) {
  const STORAGE_ANON_KEY = '_cdp_anon_id';
  const STORAGE_USER_KEY = '_cdp_user_id';
  const SESSION_KEY = '_cdp_sess_id';

  function genId(prefix) {
    return prefix + '_' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
  }

  const anonId = localStorage.getItem(STORAGE_ANON_KEY) || (function() {
    const id = genId('anon');
    localStorage.setItem(STORAGE_ANON_KEY, id);
    return id;
  })();

  const sessionId = sessionStorage.getItem(SESSION_KEY) || (function() {
    const id = genId('sess');
    sessionStorage.setItem(SESSION_KEY, id);
    return id;
  })();

  function getUtmParams() {
    const sp = new URLSearchParams(w.location.search);
    return {
      source: sp.get('utm_source'),
      medium: sp.get('utm_medium'),
      campaign: sp.get('utm_campaign'),
      term: sp.get('utm_term'),
      content: sp.get('utm_content')
    };
  }

  w.cdpTracker = {
    siteId: '${site_id}',
    endpoint: '${endpoint_hint}',
    queue: [],
    buildPayload: function(eventName, properties, traits) {
      return {
        anonymous_id: anonId,
        customer_id: localStorage.getItem(STORAGE_USER_KEY) || null,
        session_id: sessionId,
        event_name: eventName,
        event_category: 'web_tracking',
        page_url: w.location.href,
        page_title: d.title,
        referrer: d.referrer || null,
        utm: getUtmParams(),
        properties: properties || {},
        traits: traits || null,
        user_agent: navigator.userAgent,
        timestamp: new Date().toISOString()
      };
    },
    identify: function(userId, traits) {
      if (userId) localStorage.setItem(STORAGE_USER_KEY, userId);
      const payload = this.buildPayload('identify', {}, Object.assign({ external_id: userId }, traits || {}));
      this.queue.push(payload);
      return payload;
    },
    track: function(eventName, properties) {
      const payload = this.buildPayload(eventName, properties);
      this.queue.push(payload);
      return payload;
    },
    page: function(properties) {
      return this.track('page_view', properties);
    }
  };

  // Auto-track page_view on load
  w.cdpTracker.page();
})(window, document);
</script>`;

  return {
    site_id,
    endpoint_hint,
    script_html: script,
    usage_instructions:
      'Use window.cdpTracker.page(), window.cdpTracker.track(eventName, props), or window.cdpTracker.identify(userId, traits) and pass the generated payload to the ingest_tracking_payload MCP tool.'
  };
}

/**
 * List & filter events
 */
export function listEvents(filters = {}) {
  const db = getDb();
  const conds = [];
  const params = [];

  if (filters.customer_id) {
    conds.push('customer_id = ?');
    params.push(filters.customer_id);
  }
  if (filters.anonymous_id) {
    conds.push('anonymous_id = ?');
    params.push(filters.anonymous_id);
  }
  if (filters.event_name) {
    conds.push('event_name = ?');
    params.push(filters.event_name);
  }
  if (filters.event_category) {
    conds.push('event_category = ?');
    params.push(filters.event_category);
  }
  if (filters.url_contains) {
    conds.push('page_url LIKE ?');
    params.push(`%${filters.url_contains}%`);
  }
  if (filters.utm_source) {
    conds.push('utm_source = ?');
    params.push(filters.utm_source);
  }
  if (filters.utm_medium) {
    conds.push('utm_medium = ?');
    params.push(filters.utm_medium);
  }
  if (filters.utm_campaign) {
    conds.push('utm_campaign = ?');
    params.push(filters.utm_campaign);
  }
  if (filters.date_from) {
    conds.push('timestamp >= ?');
    params.push(filters.date_from);
  }
  if (filters.date_to) {
    conds.push('timestamp <= ?');
    params.push(filters.date_to);
  }

  const whereClause = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';
  const limit = Math.min(Math.max(Number(filters.limit) || 50, 1), 500);
  const offset = Math.max(Number(filters.offset) || 0, 0);

  const totalRow = db.prepare(`SELECT COUNT(*) as count FROM events ${whereClause}`).get(...params);
  const rows = db
    .prepare(`SELECT * FROM events ${whereClause} ORDER BY timestamp DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);

  return {
    total: totalRow.count,
    limit,
    offset,
    events: rows.map(formatEventRow)
  };
}

/**
 * Aggregate Event & Tracking Analytics
 */
export function getEventAnalytics({ date_from, date_to } = {}) {
  const db = getDb();
  const conds = [];
  const params = [];

  if (date_from) {
    conds.push('timestamp >= ?');
    params.push(date_from);
  }
  if (date_to) {
    conds.push('timestamp <= ?');
    params.push(date_to);
  }
  const whereClause = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';

  const totals = db.prepare(`
    SELECT
      COUNT(*) as total_events,
      COUNT(DISTINCT customer_id) as unique_identified_customers,
      COUNT(DISTINCT anonymous_id) as unique_anonymous_visitors,
      COUNT(DISTINCT session_id) as unique_sessions,
      SUM(revenue) as total_event_revenue
    FROM events ${whereClause}
  `).get(...params);

  const byEventName = db.prepare(`
    SELECT event_name, COUNT(*) as count, COUNT(DISTINCT customer_id) as unique_customers, SUM(revenue) as revenue
    FROM events ${whereClause}
    GROUP BY event_name
    ORDER BY count DESC
  `).all(...params);

  const topPages = db.prepare(`
    SELECT page_url, COUNT(*) as views, COUNT(DISTINCT COALESCE(customer_id, anonymous_id)) as unique_visitors
    FROM events
    ${whereClause ? `${whereClause} AND page_url IS NOT NULL` : 'WHERE page_url IS NOT NULL'}
    GROUP BY page_url
    ORDER BY views DESC LIMIT 10
  `).all(...params);

  const byUtmAttribution = db.prepare(`
    SELECT utm_source, utm_medium, utm_campaign,
           COUNT(*) as events,
           COUNT(DISTINCT COALESCE(customer_id, anonymous_id)) as visitors,
           SUM(revenue) as revenue
    FROM events
    ${whereClause ? `${whereClause} AND (utm_source IS NOT NULL OR utm_campaign IS NOT NULL)` : 'WHERE (utm_source IS NOT NULL OR utm_campaign IS NOT NULL)'}
    GROUP BY utm_source, utm_medium, utm_campaign
    ORDER BY events DESC LIMIT 15
  `).all(...params);

  return {
    summary: {
      total_events: totals.total_events || 0,
      unique_identified_customers: totals.unique_identified_customers || 0,
      unique_anonymous_visitors: totals.unique_anonymous_visitors || 0,
      unique_sessions: totals.unique_sessions || 0,
      total_event_revenue: Number((totals.total_event_revenue || 0).toFixed(2))
    },
    events_by_name: byEventName,
    top_visited_urls: topPages,
    utm_attribution: byUtmAttribution
  };
}

export function formatEventRow(row) {
  if (!row) return null;
  return {
    ...row,
    properties: safeJsonParse(row.properties, {})
  };
}

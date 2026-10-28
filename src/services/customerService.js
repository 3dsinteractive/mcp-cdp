import crypto from 'node:crypto';
import { getDb, safeJsonParse } from '../db.js';

function genId(prefix = 'cust') {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

export function formatCustomerRow(row) {
  if (!row) return null;
  return {
    ...row,
    tags: safeJsonParse(row.tags, []),
    custom_attributes: safeJsonParse(row.custom_attributes, {}),
    web_push_subscription: safeJsonParse(row.web_push_subscription, null)
  };
}

/**
 * Create or update a customer profile (Upsert by id, external_id, or email)
 */
export function upsertCustomer(input) {
  const db = getDb();
  const now = new Date().toISOString();

  let existing = null;
  if (input.id) {
    existing = db.prepare('SELECT * FROM customers WHERE id = ?').get(input.id);
  }
  if (!existing && input.external_id) {
    existing = db.prepare('SELECT * FROM customers WHERE external_id = ?').get(input.external_id);
  }
  if (!existing && input.email) {
    existing = db.prepare('SELECT * FROM customers WHERE email = ?').get(input.email);
  }
  if (!existing && input.alias) {
    existing = db.prepare('SELECT * FROM customers WHERE alias = ? COLLATE NOCASE').get(input.alias);
  }

  if (existing) {
    const existingTags = safeJsonParse(existing.tags, []);
    const mergedTags = input.tags
      ? Array.from(new Set([...existingTags, ...input.tags]))
      : existingTags;

    const existingCustom = safeJsonParse(existing.custom_attributes, {});
    const mergedCustom = input.custom_attributes
      ? { ...existingCustom, ...input.custom_attributes }
      : existingCustom;

    const updated = {
      alias: input.alias ?? existing.alias,
      external_id: input.external_id ?? existing.external_id,
      email: input.email ?? existing.email,
      phone: input.phone ?? existing.phone,
      first_name: input.first_name ?? existing.first_name,
      last_name: input.last_name ?? existing.last_name,
      gender: input.gender ?? existing.gender,
      birth_date: input.birth_date ?? existing.birth_date,
      city: input.city ?? existing.city,
      country: input.country ?? existing.country,
      language: input.language ?? existing.language,
      line_uid: input.line_uid ?? existing.line_uid,
      fb_psid: input.fb_psid ?? existing.fb_psid,
      whatsapp_id: input.whatsapp_id ?? existing.whatsapp_id,
      app_push_token: input.app_push_token ?? existing.app_push_token,
      web_push_subscription: input.web_push_subscription
        ? (typeof input.web_push_subscription === 'string'
            ? input.web_push_subscription
            : JSON.stringify(input.web_push_subscription))
        : existing.web_push_subscription,
      lifecycle_stage: input.lifecycle_stage ?? existing.lifecycle_stage,
      tier: input.tier ?? existing.tier,
      total_spent: input.total_spent !== undefined ? Number(input.total_spent) : existing.total_spent,
      order_count: input.order_count !== undefined ? Number(input.order_count) : existing.order_count,
      tags: JSON.stringify(mergedTags),
      custom_attributes: JSON.stringify(mergedCustom),
      source: input.source ?? existing.source,
      last_seen_at: input.last_seen_at ?? now,
      updated_at: now
    };

    db.prepare(`
      UPDATE customers SET
        alias = ?, external_id = ?, email = ?, phone = ?, first_name = ?, last_name = ?,
        gender = ?, birth_date = ?, city = ?, country = ?, language = ?,
        line_uid = ?, fb_psid = ?, whatsapp_id = ?, app_push_token = ?, web_push_subscription = ?,
        lifecycle_stage = ?, tier = ?, total_spent = ?, order_count = ?,
        tags = ?, custom_attributes = ?, source = ?, last_seen_at = ?, updated_at = ?
      WHERE id = ?
    `).run(
      updated.alias,
      updated.external_id, updated.email, updated.phone, updated.first_name, updated.last_name,
      updated.gender, updated.birth_date, updated.city, updated.country, updated.language,
      updated.line_uid, updated.fb_psid, updated.whatsapp_id, updated.app_push_token, updated.web_push_subscription,
      updated.lifecycle_stage, updated.tier, updated.total_spent, updated.order_count,
      updated.tags, updated.custom_attributes, updated.source, updated.last_seen_at, updated.updated_at,
      existing.id
    );

    if (input.consents && typeof input.consents === 'object') {
      for (const [consentType, status] of Object.entries(input.consents)) {
        updateCustomerConsent({
          customer_id: existing.id,
          consent_type: consentType,
          status: status ? 'granted' : 'revoked',
          source: input.source || 'upsert'
        });
      }
    }

    return {
      action: 'updated',
      customer: formatCustomerRow(db.prepare('SELECT * FROM customers WHERE id = ?').get(existing.id))
    };
  }

  const id = input.id || genId('cust');
  const tagsJson = JSON.stringify(Array.isArray(input.tags) ? input.tags : []);
  const customJson = JSON.stringify(input.custom_attributes || {});
  const webPushJson = input.web_push_subscription
    ? (typeof input.web_push_subscription === 'string'
        ? input.web_push_subscription
        : JSON.stringify(input.web_push_subscription))
    : null;

  db.prepare(`
    INSERT INTO customers (
      id, alias, external_id, email, phone, first_name, last_name,
      gender, birth_date, city, country, language,
      line_uid, fb_psid, whatsapp_id, app_push_token, web_push_subscription,
      lifecycle_stage, tier, total_spent, order_count,
      tags, custom_attributes, source, first_seen_at, last_seen_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.alias ?? null,
    input.external_id ?? null,
    input.email ?? null,
    input.phone ?? null,
    input.first_name ?? null,
    input.last_name ?? null,
    input.gender ?? null,
    input.birth_date ?? null,
    input.city ?? null,
    input.country ?? 'TH',
    input.language ?? 'th',
    input.line_uid ?? null,
    input.fb_psid ?? null,
    input.whatsapp_id ?? null,
    input.app_push_token ?? null,
    webPushJson,
    input.lifecycle_stage ?? 'lead',
    input.tier ?? 'standard',
    Number(input.total_spent || 0),
    Number(input.order_count || 0),
    tagsJson,
    customJson,
    input.source ?? 'manual',
    input.first_seen_at ?? now,
    input.last_seen_at ?? now,
    now,
    now
  );

  if (input.consents && typeof input.consents === 'object') {
    for (const [consentType, status] of Object.entries(input.consents)) {
      const normalizedStatus =
        status === true || status === 'granted' ? 'granted' : status === 'pending' ? 'pending' : 'revoked';
      updateCustomerConsent({
        customer_id: id,
        consent_type: consentType,
        status: normalizedStatus,
        source: input.source || 'import'
      });
    }
  }

  return {
    action: 'created',
    customer: formatCustomerRow(db.prepare('SELECT * FROM customers WHERE id = ?').get(id))
  };
}

/**
 * List customers with search, filtering, and pagination
 */
export function listCustomers(filters = {}) {
  const db = getDb();
  const conditions = [];
  const params = [];

  if (filters.search) {
    const q = `%${filters.search}%`;
    conditions.push('(alias LIKE ? OR first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR phone LIKE ? OR external_id LIKE ?)');
    params.push(q, q, q, q, q, q);
  }
  if (filters.lifecycle_stage) {
    conditions.push('lifecycle_stage = ?');
    params.push(filters.lifecycle_stage);
  }
  if (filters.tier) {
    conditions.push('tier = ?');
    params.push(filters.tier);
  }
  if (filters.city) {
    conditions.push('city = ?');
    params.push(filters.city);
  }
  if (filters.country) {
    conditions.push('country = ?');
    params.push(filters.country);
  }
  if (filters.tag) {
    conditions.push('tags LIKE ?');
    params.push(`%"${filters.tag}"%`);
  }
  if (filters.min_spent !== undefined) {
    conditions.push('total_spent >= ?');
    params.push(Number(filters.min_spent));
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.min(Math.max(Number(filters.limit) || 50, 1), 500);
  const offset = Math.max(Number(filters.offset) || 0, 0);

  const totalRow = db.prepare(`SELECT COUNT(*) as count FROM customers ${whereClause}`).get(...params);
  const rows = db
    .prepare(`SELECT * FROM customers ${whereClause} ORDER BY updated_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);

  return {
    total: totalRow.count,
    limit,
    offset,
    customers: rows.map(formatCustomerRow)
  };
}

/**
 * Bulk import customers (JSON array or CSV records)
 */
export function importCustomers({ customers = [], source = 'bulk_import' }) {
  let created = 0;
  let updated = 0;
  const errors = [];
  const importedIds = [];

  for (let i = 0; i < customers.length; i++) {
    try {
      const item = customers[i];
      const res = upsertCustomer({ ...item, source: item.source || source });
      if (res.action === 'created') created++;
      else updated++;
      importedIds.push(res.customer.id);

      // If anonymous_id is provided during import, link it automatically
      if (item.anonymous_id) {
        linkCustomerIdentity({
          primary_customer_id: res.customer.id,
          identity_type: 'anonymous_id',
          identity_value: item.anonymous_id,
          relationship: 'same_person'
        });
      }
    } catch (err) {
      errors.push({ index: i, error: err.message });
    }
  }

  return {
    total_processed: customers.length,
    created,
    updated,
    failed: errors.length,
    imported_customer_ids: importedIds,
    errors
  };
}

/**
 * Link customer identities or link two related customer profiles
 */
export function linkCustomerIdentity({
  primary_customer_id,
  linked_customer_id = null,
  identity_type,
  identity_value,
  relationship = 'same_person',
  confidence = 1.0,
  metadata = {}
}) {
  const db = getDb();
  const primary = db.prepare('SELECT * FROM customers WHERE id = ?').get(primary_customer_id);
  if (!primary) {
    throw new Error(`Primary customer '${primary_customer_id}' not found`);
  }

  if (linked_customer_id) {
    const linked = db.prepare('SELECT * FROM customers WHERE id = ?').get(linked_customer_id);
    if (!linked) {
      throw new Error(`Linked customer '${linked_customer_id}' not found`);
    }
  }

  const existingLink = db.prepare(`
    SELECT * FROM customer_links
    WHERE primary_customer_id = ? AND identity_type = ? AND identity_value = ?
  `).get(primary_customer_id, identity_type, identity_value);

  const linkId = existingLink ? existingLink.id : genId('link');
  if (existingLink) {
    db.prepare(`
      UPDATE customer_links
      SET linked_customer_id = ?, relationship = ?, confidence = ?, metadata = ?
      WHERE id = ?
    `).run(linked_customer_id, relationship, confidence, JSON.stringify(metadata), linkId);
  } else {
    db.prepare(`
      INSERT INTO customer_links (
        id, primary_customer_id, linked_customer_id, identity_type, identity_value, relationship, confidence, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      linkId,
      primary_customer_id,
      linked_customer_id,
      identity_type,
      identity_value,
      relationship,
      confidence,
      JSON.stringify(metadata)
    );
  }

  // If linking an anonymous_id, backfill any anonymous events to this primary customer
  let stitchedEvents = 0;
  if (identity_type === 'anonymous_id' && identity_value) {
    const info = db.prepare(`
      UPDATE events SET customer_id = ?
      WHERE anonymous_id = ? AND (customer_id IS NULL OR customer_id = '')
    `).run(primary_customer_id, identity_value);
    stitchedEvents = info.changes || 0;
  }

  return {
    link_id: linkId,
    primary_customer_id,
    linked_customer_id,
    identity_type,
    identity_value,
    relationship,
    confidence,
    stitched_events_count: stitchedEvents
  };
}

/**
 * Get linked customers and identities for a given customer (plus auto-detected matches by shared email/phone)
 */
export function getLinkedCustomers(customer_id) {
  const db = getDb();
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customer_id);
  if (!customer) {
    throw new Error(`Customer '${customer_id}' not found`);
  }

  const explicitLinks = db.prepare(`
    SELECT cl.*, c.first_name as linked_first_name, c.last_name as linked_last_name, c.email as linked_email, c.phone as linked_phone
    FROM customer_links cl
    LEFT JOIN customers c ON (
      (cl.primary_customer_id = ? AND cl.linked_customer_id = c.id) OR
      (cl.linked_customer_id = ? AND cl.primary_customer_id = c.id)
    )
    WHERE cl.primary_customer_id = ? OR cl.linked_customer_id = ?
    ORDER BY cl.created_at DESC
  `).all(customer_id, customer_id, customer_id, customer_id);

  // Also detect potential duplicate / related profiles sharing email, phone, or line_uid
  const potentialMatches = [];
  if (customer.email || customer.phone || customer.line_uid) {
    const conds = [];
    const params = [customer_id];
    if (customer.email) {
      conds.push('email = ?');
      params.push(customer.email);
    }
    if (customer.phone) {
      conds.push('phone = ?');
      params.push(customer.phone);
    }
    if (customer.line_uid) {
      conds.push('line_uid = ?');
      params.push(customer.line_uid);
    }
    if (conds.length > 0) {
      const rows = db.prepare(`
        SELECT id, external_id, first_name, last_name, email, phone, line_uid, lifecycle_stage, tier
        FROM customers
        WHERE id != ? AND (${conds.join(' OR ')})
      `).all(...params);
      for (const r of rows) {
        const matchedOn = [];
        if (customer.email && r.email === customer.email) matchedOn.push('email');
        if (customer.phone && r.phone === customer.phone) matchedOn.push('phone');
        if (customer.line_uid && r.line_uid === customer.line_uid) matchedOn.push('line_uid');
        potentialMatches.push({ ...r, matched_on: matchedOn });
      }
    }
  }

  return {
    customer_id,
    explicit_links: explicitLinks.map((l) => ({
      ...l,
      metadata: safeJsonParse(l.metadata, {})
    })),
    auto_detected_matches: potentialMatches
  };
}

/**
 * Customer Database Overview & Schema Discovery
 */
export function getCustomerDatabaseOverview() {
  const db = getDb();
  const total = db.prepare('SELECT COUNT(*) as count, SUM(total_spent) as total_revenue, AVG(total_spent) as avg_ltv FROM customers').get();
  const byLifecycle = db.prepare('SELECT lifecycle_stage, COUNT(*) as count FROM customers GROUP BY lifecycle_stage').all();
  const byTier = db.prepare('SELECT tier, COUNT(*) as count FROM customers GROUP BY tier').all();
  const bySource = db.prepare('SELECT source, COUNT(*) as count FROM customers GROUP BY source').all();
  const byCity = db.prepare('SELECT city, COUNT(*) as count FROM customers WHERE city IS NOT NULL GROUP BY city ORDER BY count DESC LIMIT 10').all();

  const channelReachability = {
    email: db.prepare("SELECT COUNT(*) as c FROM customers WHERE email IS NOT NULL AND email != ''").get().c,
    sms: db.prepare("SELECT COUNT(*) as c FROM customers WHERE phone IS NOT NULL AND phone != ''").get().c,
    line: db.prepare("SELECT COUNT(*) as c FROM customers WHERE line_uid IS NOT NULL AND line_uid != ''").get().c,
    facebook_messenger: db.prepare("SELECT COUNT(*) as c FROM customers WHERE fb_psid IS NOT NULL AND fb_psid != ''").get().c,
    whatsapp: db.prepare("SELECT COUNT(*) as c FROM customers WHERE whatsapp_id IS NOT NULL AND whatsapp_id != ''").get().c,
    app_push: db.prepare("SELECT COUNT(*) as c FROM customers WHERE app_push_token IS NOT NULL AND app_push_token != ''").get().c,
    web_push: db.prepare("SELECT COUNT(*) as c FROM customers WHERE web_push_subscription IS NOT NULL AND web_push_subscription != ''").get().c
  };

  // Discover custom attributes and tags across customers
  const attrRows = db.prepare('SELECT tags, custom_attributes FROM customers LIMIT 500').all();
  const customKeys = new Set();
  const tagCounts = {};
  for (const r of attrRows) {
    const attrs = safeJsonParse(r.custom_attributes, {});
    Object.keys(attrs).forEach((k) => customKeys.add(k));
    const tags = safeJsonParse(r.tags, []);
    for (const t of tags) {
      tagCounts[t] = (tagCounts[t] || 0) + 1;
    }
  }

  return {
    total_customers: total.count || 0,
    total_revenue: Number((total.total_revenue || 0).toFixed(2)),
    average_ltv: Number((total.avg_ltv || 0).toFixed(2)),
    by_lifecycle_stage: byLifecycle,
    by_tier: byTier,
    by_source: bySource,
    top_cities: byCity,
    channel_reachability: channelReachability,
    discovered_custom_attribute_keys: Array.from(customKeys),
    tag_distribution: tagCounts
  };
}

/**
 * Manage & query customer consents (PDPA/GDPR & Channel Opt-ins)
 */
export function updateCustomerConsent({
  customer_id,
  consent_type,
  status,
  source = 'preference_center',
  ip_address = null,
  version = 'v1.0'
}) {
  const db = getDb();
  const now = new Date().toISOString();

  const existing = db.prepare(`
    SELECT * FROM customer_consents WHERE customer_id = ? AND consent_type = ?
  `).get(customer_id, consent_type);

  const oldStatus = existing ? existing.status : null;

  if (existing) {
    db.prepare(`
      UPDATE customer_consents
      SET status = ?, source = ?, ip_address = ?, version = ?, updated_at = ?
      WHERE id = ?
    `).run(status, source, ip_address, version, now, existing.id);
  } else {
    db.prepare(`
      INSERT INTO customer_consents (id, customer_id, consent_type, status, source, ip_address, version, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(genId('cns'), customer_id, consent_type, status, source, ip_address, version, now);
  }

  // Record audit trail
  db.prepare(`
    INSERT INTO consent_logs (id, customer_id, consent_type, old_status, new_status, source, ip_address, version, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(genId('clog'), customer_id, consent_type, oldStatus, status, source, ip_address, version, now);

  return getCustomerConsents(customer_id);
}

export function getCustomerConsents(customer_id) {
  const db = getDb();
  const consents = db.prepare(`
    SELECT consent_type, status, source, ip_address, version, updated_at
    FROM customer_consents
    WHERE customer_id = ?
    ORDER BY consent_type ASC
  `).all(customer_id);

  const history = db.prepare(`
    SELECT id, consent_type, old_status, new_status, source, ip_address, version, timestamp
    FROM consent_logs
    WHERE customer_id = ?
    ORDER BY timestamp DESC
    LIMIT 50
  `).all(customer_id);

  const summaryMap = {};
  for (const c of consents) {
    summaryMap[c.consent_type] = c.status;
  }

  return {
    customer_id,
    consents_map: summaryMap,
    consents_list: consents,
    audit_history: history
  };
}

/**
 * Customer Timeline (Unified chronological feed of Events, Campaign Interactions, Journey Steps, Consent Logs)
 */
export function getCustomerTimeline(customer_id, { limit = 50, event_type_filter = null } = {}) {
  const db = getDb();
  const items = [];

  // 1. Events
  if (!event_type_filter || event_type_filter === 'event') {
    const events = db.prepare(`
      SELECT * FROM events WHERE customer_id = ? ORDER BY timestamp DESC LIMIT ?
    `).all(customer_id, limit);

    for (const ev of events) {
      items.push({
        timeline_type: 'event',
        timestamp: ev.timestamp,
        title: `Event: ${ev.event_name}`,
        channel: ev.channel,
        details: {
          event_id: ev.id,
          event_name: ev.event_name,
          event_category: ev.event_category,
          page_url: ev.page_url,
          utm_source: ev.utm_source,
          utm_medium: ev.utm_medium,
          utm_campaign: ev.utm_campaign,
          revenue: ev.revenue,
          properties: safeJsonParse(ev.properties, {})
        }
      });
    }
  }

  // 2. Campaign Interactions
  if (!event_type_filter || event_type_filter === 'campaign') {
    const campLogs = db.prepare(`
      SELECT cl.*, c.name as campaign_name
      FROM campaign_logs cl
      LEFT JOIN campaigns c ON cl.campaign_id = c.id
      WHERE cl.customer_id = ?
      ORDER BY cl.sent_at DESC LIMIT ?
    `).all(customer_id, limit);

    for (const log of campLogs) {
      items.push({
        timeline_type: 'campaign',
        timestamp: log.converted_at || log.clicked_at || log.opened_at || log.sent_at,
        title: `Campaign [${log.channel.toUpperCase()}]: ${log.campaign_name || log.campaign_id} (${log.status})`,
        channel: log.channel,
        details: {
          log_id: log.id,
          campaign_id: log.campaign_id,
          campaign_name: log.campaign_name,
          status: log.status,
          sent_at: log.sent_at,
          opened_at: log.opened_at,
          clicked_at: log.clicked_at,
          converted_at: log.converted_at,
          conversion_value: log.conversion_value
        }
      });
    }
  }

  // 3. Journey Steps
  if (!event_type_filter || event_type_filter === 'journey') {
    const jLogs = db.prepare(`
      SELECT jsl.*, j.name as journey_name
      FROM journey_step_logs jsl
      LEFT JOIN journeys j ON jsl.journey_id = j.id
      WHERE jsl.customer_id = ?
      ORDER BY jsl.executed_at DESC LIMIT ?
    `).all(customer_id, limit);

    for (const jl of jLogs) {
      items.push({
        timeline_type: 'journey',
        timestamp: jl.executed_at,
        title: `Journey [${jl.journey_name || jl.journey_id}] Step '${jl.step_id}' (${jl.step_type}) -> ${jl.result_status}`,
        channel: 'journey_orchestrator',
        details: {
          journey_id: jl.journey_id,
          journey_name: jl.journey_name,
          step_id: jl.step_id,
          step_type: jl.step_type,
          action_taken: jl.action_taken,
          result_status: jl.result_status,
          details: safeJsonParse(jl.details, {})
        }
      });
    }
  }

  // 4. Consent Changes
  if (!event_type_filter || event_type_filter === 'consent') {
    const cLogs = db.prepare(`
      SELECT * FROM consent_logs WHERE customer_id = ? ORDER BY timestamp DESC LIMIT ?
    `).all(customer_id, limit);

    for (const cl of cLogs) {
      items.push({
        timeline_type: 'consent',
        timestamp: cl.timestamp,
        title: `Consent '${cl.consent_type}' changed from ${cl.old_status || 'none'} to ${cl.new_status}`,
        channel: cl.source || 'consent',
        details: cl
      });
    }
  }

  items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return {
    customer_id,
    total_items: items.length,
    timeline: items.slice(0, limit)
  };
}

/**
 * Compute Customer Insights (RFM, Engagement Score, Channel Affinity, Behavioral Summary)
 */
export function getCustomerInsights(customer_id) {
  const db = getDb();
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customer_id);
  if (!customer) {
    throw new Error(`Customer '${customer_id}' not found`);
  }

  const eventStats = db.prepare(`
    SELECT
      COUNT(*) as total_events,
      SUM(CASE WHEN event_name = 'page_view' THEN 1 ELSE 0 END) as page_views,
      SUM(CASE WHEN event_name = 'purchase' THEN 1 ELSE 0 END) as purchase_events,
      SUM(revenue) as event_revenue,
      MAX(timestamp) as last_event_at,
      MIN(timestamp) as first_event_at
    FROM events
    WHERE customer_id = ?
  `).get(customer_id);

  const topEvents = db.prepare(`
    SELECT event_name, COUNT(*) as count
    FROM events WHERE customer_id = ?
    GROUP BY event_name ORDER BY count DESC LIMIT 5
  `).all(customer_id);

  const topUrls = db.prepare(`
    SELECT page_url, COUNT(*) as visits
    FROM events WHERE customer_id = ? AND page_url IS NOT NULL AND page_url != ''
    GROUP BY page_url ORDER BY visits DESC LIMIT 5
  `).all(customer_id);

  const topUtms = db.prepare(`
    SELECT utm_source, utm_medium, utm_campaign, COUNT(*) as touches
    FROM events
    WHERE customer_id = ? AND (utm_source IS NOT NULL OR utm_campaign IS NOT NULL)
    GROUP BY utm_source, utm_medium, utm_campaign
    ORDER BY touches DESC LIMIT 5
  `).all(customer_id);

  const campaignStats = db.prepare(`
    SELECT
      COUNT(*) as total_sent,
      SUM(CASE WHEN status IN ('opened', 'clicked', 'converted') OR opened_at IS NOT NULL THEN 1 ELSE 0 END) as opened,
      SUM(CASE WHEN status IN ('clicked', 'converted') OR clicked_at IS NOT NULL THEN 1 ELSE 0 END) as clicked,
      SUM(CASE WHEN status = 'converted' OR converted_at IS NOT NULL THEN 1 ELSE 0 END) as converted,
      SUM(conversion_value) as campaign_conversion_value
    FROM campaign_logs
    WHERE customer_id = ?
  `).get(customer_id);

  const preferredChannelRows = db.prepare(`
    SELECT channel, COUNT(*) as interactions
    FROM campaign_logs
    WHERE customer_id = ? AND (status IN ('opened', 'clicked', 'converted') OR opened_at IS NOT NULL)
    GROUP BY channel ORDER BY interactions DESC
  `).all(customer_id);

  // Calculate RFM & Engagement Score
  const lastActivityStr = eventStats.last_event_at || customer.last_seen_at || customer.created_at;
  const daysSinceLastActivity = Math.max(
    0,
    Math.floor((Date.now() - new Date(lastActivityStr).getTime()) / (1000 * 60 * 60 * 24))
  );

  const totalSpent = Math.max(Number(customer.total_spent || 0), Number(eventStats.event_revenue || 0));
  const totalOrders = Math.max(Number(customer.order_count || 0), Number(eventStats.purchase_events || 0));
  const totalEvents = Number(eventStats.total_events || 0);

  // Recency score (1-5)
  const rScore = daysSinceLastActivity <= 7 ? 5 : daysSinceLastActivity <= 30 ? 4 : daysSinceLastActivity <= 90 ? 3 : daysSinceLastActivity <= 180 ? 2 : 1;
  // Frequency score (1-5)
  const fScore = totalOrders >= 10 ? 5 : totalOrders >= 5 ? 4 : totalOrders >= 2 ? 3 : totalOrders >= 1 ? 2 : 1;
  // Monetary score (1-5)
  const mScore = totalSpent >= 50000 ? 5 : totalSpent >= 15000 ? 4 : totalSpent >= 5000 ? 3 : totalSpent > 0 ? 2 : 1;

  let rfmSegment = 'New / Low Activity';
  const rfmAvg = (rScore + fScore + mScore) / 3;
  if (rScore >= 4 && fScore >= 4 && mScore >= 4) rfmSegment = 'Champions';
  else if (rScore >= 3 && fScore >= 3) rfmSegment = 'Loyal Customers';
  else if (rScore >= 4 && fScore <= 2) rfmSegment = 'Promising / Recent';
  else if (rScore <= 2 && (fScore >= 3 || mScore >= 3)) rfmSegment = 'At Risk / Needs Attention';
  else if (rScore === 1 && fScore === 1) rfmSegment = 'Hibernating';

  const openRate = campaignStats.total_sent > 0 ? Number(((campaignStats.opened / campaignStats.total_sent) * 100).toFixed(1)) : 0;
  const clickRate = campaignStats.total_sent > 0 ? Number(((campaignStats.clicked / campaignStats.total_sent) * 100).toFixed(1)) : 0;

  const engagementScore = Math.min(
    100,
    Math.round(rScore * 10 + Math.min(totalEvents * 2, 25) + Math.min(openRate * 0.25, 25))
  );

  return {
    customer_id,
    rfm: {
      recency_days: daysSinceLastActivity,
      frequency_orders: totalOrders,
      monetary_ltv: totalSpent,
      r_score: rScore,
      f_score: fScore,
      m_score: mScore,
      rfm_score: `${rScore}${fScore}${mScore}`,
      rfm_average: Number(rfmAvg.toFixed(2)),
      rfm_segment: rfmSegment
    },
    engagement: {
      engagement_score: engagementScore,
      total_events: totalEvents,
      page_views: eventStats.page_views || 0,
      first_event_at: eventStats.first_event_at,
      last_event_at: eventStats.last_event_at,
      top_events: topEvents,
      top_visited_urls: topUrls,
      top_utm_sources: topUtms
    },
    campaign_responsiveness: {
      total_campaigns_received: campaignStats.total_sent || 0,
      opened_count: campaignStats.opened || 0,
      clicked_count: campaignStats.clicked || 0,
      converted_count: campaignStats.converted || 0,
      open_rate_percent: openRate,
      click_rate_percent: clickRate,
      campaign_conversion_value: Number((campaignStats.campaign_conversion_value || 0).toFixed(2)),
      preferred_channels: preferredChannelRows.map((r) => r.channel)
    }
  };
}

/**
 * Full 360 Customer Profile (Personal Info + Timeline + Insights + Consents + Linked Profiles)
 */
export function getCustomer360Profile(identifier) {
  const db = getDb();
  let row = db.prepare('SELECT * FROM customers WHERE id = ?').get(identifier);
  if (!row) row = db.prepare('SELECT * FROM customers WHERE external_id = ?').get(identifier);
  if (!row) row = db.prepare('SELECT * FROM customers WHERE email = ?').get(identifier);
  if (!row) row = db.prepare('SELECT * FROM customers WHERE phone = ?').get(identifier);

  if (!row) {
    throw new Error(`Customer not found for identifier '${identifier}'`);
  }

  const profile = formatCustomerRow(row);
  const consents = getCustomerConsents(profile.id);
  const insights = getCustomerInsights(profile.id);
  const timeline = getCustomerTimeline(profile.id, { limit: 25 });
  const linked = getLinkedCustomers(profile.id);

  // Active static segments & journeys
  const segments = db.prepare(`
    SELECT s.id, s.name, s.segment_type, sm.added_at
    FROM segment_members sm
    JOIN segments s ON sm.segment_id = s.id
    WHERE sm.customer_id = ?
  `).all(profile.id);

  const journeys = db.prepare(`
    SELECT je.id as enrollment_id, je.journey_id, j.name as journey_name, je.current_step_id, je.status, je.enrolled_at, je.completed_at, je.converted_at
    FROM journey_enrollments je
    JOIN journeys j ON je.journey_id = j.id
    WHERE je.customer_id = ?
  `).all(profile.id);

  return {
    profile,
    consents: consents.consents_map,
    consent_details: consents.consents_list,
    insights,
    linked_profiles: linked,
    segments,
    journeys,
    recent_timeline: timeline.timeline
  };
}

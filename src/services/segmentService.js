import crypto from 'node:crypto';
import { getDb, safeJsonParse } from '../db.js';
import { formatCustomerRow, getCustomerInsights } from './customerService.js';

function genId(prefix = 'seg') {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

function compareValue(actual, operator, expected) {
  switch (operator) {
    case 'eq':
    case '=':
      return actual == expected;
    case 'neq':
    case '!=':
      return actual != expected;
    case 'gt':
    case '>':
      return Number(actual) > Number(expected);
    case 'gte':
    case '>=':
      return Number(actual) >= Number(expected);
    case 'lt':
    case '<':
      return Number(actual) < Number(expected);
    case 'lte':
    case '<=':
      return Number(actual) <= Number(expected);
    case 'contains':
      if (Array.isArray(actual)) return actual.includes(expected);
      return String(actual ?? '').toLowerCase().includes(String(expected ?? '').toLowerCase());
    case 'in':
      return Array.isArray(expected) && expected.includes(actual);
    case 'exists':
      return expected ? actual !== null && actual !== undefined && actual !== '' : actual === null || actual === undefined || actual === '';
    default:
      return actual == expected;
  }
}

function cutoffIsoFromDays(withinDays) {
  if (!withinDays || Number(withinDays) <= 0) return null;
  const ms = Number(withinDays) * 24 * 60 * 60 * 1000;
  return new Date(Date.now() - ms).toISOString();
}

/**
 * Evaluate whether a single customer matches a segment criteria object
 */
export function evaluateCustomerAgainstCriteria(customer, criteria, db) {
  if (!criteria || Object.keys(criteria).length === 0) {
    return true;
  }

  const matchMode = (criteria.match_mode || 'all').toLowerCase(); // 'all' (AND) or 'any' (OR)
  const checks = [];

  // 1. Customer Attributes conditions
  if (Array.isArray(criteria.customer_attributes) && criteria.customer_attributes.length > 0) {
    for (const cond of criteria.customer_attributes) {
      const field = cond.field;
      const op = cond.operator || 'eq';
      const val = cond.value;

      let actual;
      if (field === 'tags') {
        actual = customer.tags || [];
      } else if (field.startsWith('custom_attributes.')) {
        const key = field.slice('custom_attributes.'.length);
        actual = customer.custom_attributes ? customer.custom_attributes[key] : undefined;
      } else if (customer[field] !== undefined) {
        actual = customer[field];
      } else if (customer.custom_attributes && customer.custom_attributes[field] !== undefined) {
        actual = customer.custom_attributes[field];
      }

      checks.push(compareValue(actual, op, val));
    }
  }

  // 2. Events conditions
  if (Array.isArray(criteria.event_conditions) && criteria.event_conditions.length > 0) {
    for (const cond of criteria.event_conditions) {
      const sqlConds = ['customer_id = ?'];
      const sqlParams = [customer.id];

      if (cond.event_name) {
        sqlConds.push('event_name = ?');
        sqlParams.push(cond.event_name);
      }
      if (cond.event_category) {
        sqlConds.push('event_category = ?');
        sqlParams.push(cond.event_category);
      }
      if (cond.within_days) {
        sqlConds.push('timestamp >= ?');
        sqlParams.push(cutoffIsoFromDays(cond.within_days));
      }
      if (cond.date_from) {
        sqlConds.push('timestamp >= ?');
        sqlParams.push(cond.date_from);
      }
      if (cond.date_to) {
        sqlConds.push('timestamp <= ?');
        sqlParams.push(cond.date_to);
      }

      const rows = db
        .prepare(`SELECT properties, revenue FROM events WHERE ${sqlConds.join(' AND ')}`)
        .all(...sqlParams);

      let matchedRows = rows;
      if (cond.property_filters && typeof cond.property_filters === 'object') {
        matchedRows = rows.filter((r) => {
          const props = safeJsonParse(r.properties, {});
          return Object.entries(cond.property_filters).every(([k, v]) => props[k] == v);
        });
      }

      const count = matchedRows.length;
      const minCount = cond.min_count !== undefined ? Number(cond.min_count) : 1;
      const maxCount = cond.max_count !== undefined ? Number(cond.max_count) : Infinity;
      let ok = count >= minCount && count <= maxCount;

      if (ok && cond.min_revenue !== undefined) {
        const sumRev = matchedRows.reduce((acc, r) => acc + Number(r.revenue || 0), 0);
        ok = sumRev >= Number(cond.min_revenue);
      }
      checks.push(ok);
    }
  }

  // 3. Analytics conditions (LTV, orders, RFM, engagement_score, recency_days)
  if (Array.isArray(criteria.analytics_conditions) && criteria.analytics_conditions.length > 0) {
    const insights = getCustomerInsights(customer.id);
    for (const cond of criteria.analytics_conditions) {
      const metric = cond.metric;
      const op = cond.operator || 'gte';
      const val = cond.value;

      let actual;
      if (metric === 'total_spent' || metric === 'monetary_ltv') actual = insights.rfm.monetary_ltv;
      else if (metric === 'order_count' || metric === 'frequency_orders') actual = insights.rfm.frequency_orders;
      else if (metric === 'recency_days') actual = insights.rfm.recency_days;
      else if (metric === 'rfm_segment') actual = insights.rfm.rfm_segment;
      else if (metric === 'rfm_average') actual = insights.rfm.rfm_average;
      else if (metric === 'engagement_score') actual = insights.engagement.engagement_score;
      else if (metric === 'total_events') actual = insights.engagement.total_events;
      else if (metric === 'page_views') actual = insights.engagement.page_views;
      else if (metric === 'open_rate_percent') actual = insights.campaign_responsiveness.open_rate_percent;
      else if (metric === 'click_rate_percent') actual = insights.campaign_responsiveness.click_rate_percent;

      checks.push(compareValue(actual, op, val));
    }
  }

  // 4. URL Visit conditions
  if (Array.isArray(criteria.url_conditions) && criteria.url_conditions.length > 0) {
    for (const cond of criteria.url_conditions) {
      const sqlConds = ['customer_id = ?', 'page_url LIKE ?'];
      const sqlParams = [customer.id, `%${cond.url_pattern || ''}%`];

      if (cond.within_days) {
        sqlConds.push('timestamp >= ?');
        sqlParams.push(cutoffIsoFromDays(cond.within_days));
      }

      const row = db
        .prepare(`SELECT COUNT(*) as c FROM events WHERE ${sqlConds.join(' AND ')}`)
        .get(...sqlParams);
      const minVisits = cond.min_visits !== undefined ? Number(cond.min_visits) : 1;
      checks.push((row.c || 0) >= minVisits);
    }
  }

  // 5. UTM conditions
  if (Array.isArray(criteria.utm_conditions) && criteria.utm_conditions.length > 0) {
    for (const cond of criteria.utm_conditions) {
      const sqlConds = ['customer_id = ?'];
      const sqlParams = [customer.id];

      if (cond.utm_source) {
        sqlConds.push('utm_source = ?');
        sqlParams.push(cond.utm_source);
      }
      if (cond.utm_medium) {
        sqlConds.push('utm_medium = ?');
        sqlParams.push(cond.utm_medium);
      }
      if (cond.utm_campaign) {
        sqlConds.push('utm_campaign = ?');
        sqlParams.push(cond.utm_campaign);
      }
      if (cond.utm_term) {
        sqlConds.push('utm_term = ?');
        sqlParams.push(cond.utm_term);
      }
      if (cond.utm_content) {
        sqlConds.push('utm_content = ?');
        sqlParams.push(cond.utm_content);
      }
      if (cond.within_days) {
        sqlConds.push('timestamp >= ?');
        sqlParams.push(cutoffIsoFromDays(cond.within_days));
      }

      const row = db
        .prepare(`SELECT COUNT(*) as c FROM events WHERE ${sqlConds.join(' AND ')}`)
        .get(...sqlParams);
      const minTouches = cond.min_touches !== undefined ? Number(cond.min_touches) : 1;
      checks.push((row.c || 0) >= minTouches);
    }
  }

  // 6. Date conditions
  if (criteria.date_conditions && typeof criteria.date_conditions === 'object') {
    const dc = criteria.date_conditions;
    if (dc.created_after) {
      checks.push(new Date(customer.created_at) >= new Date(dc.created_after));
    }
    if (dc.created_before) {
      checks.push(new Date(customer.created_at) <= new Date(dc.created_before));
    }
    if (dc.last_seen_after) {
      checks.push(new Date(customer.last_seen_at) >= new Date(dc.last_seen_after));
    }
    if (dc.last_seen_before) {
      checks.push(new Date(customer.last_seen_at) <= new Date(dc.last_seen_before));
    }
    if (dc.active_within_days) {
      const cutoff = new Date(cutoffIsoFromDays(dc.active_within_days));
      checks.push(new Date(customer.last_seen_at) >= cutoff);
    }
    if (dc.birth_month !== undefined && customer.birth_date) {
      const month = new Date(customer.birth_date).getUTCMonth() + 1;
      checks.push(month === Number(dc.birth_month));
    } else if (dc.birth_month !== undefined && !customer.birth_date) {
      checks.push(false);
    }
  }

  // 7. Campaign Response conditions
  if (Array.isArray(criteria.campaign_response_conditions) && criteria.campaign_response_conditions.length > 0) {
    for (const cond of criteria.campaign_response_conditions) {
      const sqlConds = ['customer_id = ?'];
      const sqlParams = [customer.id];

      if (cond.campaign_id) {
        sqlConds.push('campaign_id = ?');
        sqlParams.push(cond.campaign_id);
      }
      if (cond.channel) {
        sqlConds.push('channel = ?');
        sqlParams.push(cond.channel);
      }
      if (cond.status) {
        if (cond.status === 'opened') {
          sqlConds.push("(status IN ('opened', 'clicked', 'converted') OR opened_at IS NOT NULL)");
        } else if (cond.status === 'clicked') {
          sqlConds.push("(status IN ('clicked', 'converted') OR clicked_at IS NOT NULL)");
        } else if (cond.status === 'converted') {
          sqlConds.push("(status = 'converted' OR converted_at IS NOT NULL)");
        } else {
          sqlConds.push('status = ?');
          sqlParams.push(cond.status);
        }
      }
      if (cond.within_days) {
        sqlConds.push('sent_at >= ?');
        sqlParams.push(cutoffIsoFromDays(cond.within_days));
      }

      const row = db
        .prepare(`SELECT COUNT(*) as c FROM campaign_logs WHERE ${sqlConds.join(' AND ')}`)
        .get(...sqlParams);
      const matched = (row.c || 0) >= 1;
      checks.push(cond.negate ? !matched : matched);
    }
  }

  if (checks.length === 0) return true;
  return matchMode === 'any' ? checks.some(Boolean) : checks.every(Boolean);
}

/**
 * Evaluate criteria across all customers in database
 */
export function findMatchingCustomers(criteria) {
  const db = getDb();
  const allRows = db.prepare('SELECT * FROM customers ORDER BY updated_at DESC').all();
  const customers = allRows.map(formatCustomerRow);
  return customers.filter((c) => evaluateCustomerAgainstCriteria(c, criteria, db));
}

/**
 * Create or update a Segment (Static or Real-Time)
 */
export function createSegment({
  id,
  alias = null,
  name,
  description = '',
  segment_type = 'realtime', // 'static' or 'realtime'
  criteria = {},
  static_customer_ids = null
}) {
  const db = getDb();
  const segId = id || genId('seg');
  const now = new Date().toISOString();
  const normalizedType = segment_type === 'static' ? 'static' : 'realtime';

  const matchingCustomers = findMatchingCustomers(criteria);

  // If static_customer_ids explicitly provided, union with rule matches
  const memberIds = new Set(matchingCustomers.map((c) => c.id));
  if (Array.isArray(static_customer_ids)) {
    static_customer_ids.forEach((cid) => memberIds.add(cid));
  }

  const existing = db.prepare('SELECT * FROM segments WHERE id = ?').get(segId);
  if (existing) {
    db.prepare(`
      UPDATE segments
      SET alias = ?, name = ?, description = ?, segment_type = ?, criteria = ?, cached_count = ?, last_evaluated_at = ?, updated_at = ?
      WHERE id = ?
    `).run(alias ?? existing.alias, name, description, normalizedType, JSON.stringify(criteria), memberIds.size, now, now, segId);
  } else {
    db.prepare(`
      INSERT INTO segments (id, alias, name, description, segment_type, criteria, status, cached_count, last_evaluated_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
    `).run(segId, alias, name, description, normalizedType, JSON.stringify(criteria), memberIds.size, now, now, now);
  }

  // Materialize members in segment_members table (used directly for static segments, and as cache for realtime)
  db.prepare('DELETE FROM segment_members WHERE segment_id = ?').run(segId);
  const insertMember = db.prepare(`
    INSERT OR IGNORE INTO segment_members (segment_id, customer_id, added_at, source)
    VALUES (?, ?, ?, ?)
  `);
  for (const cid of memberIds) {
    insertMember.run(segId, cid, now, normalizedType === 'static' ? 'static_snapshot' : 'realtime_cache');
  }

  return getSegmentDetails(segId);
}

/**
 * Get Segment details and members (evaluates live if segment_type === 'realtime')
 */
export function getSegmentDetails(segment_id, { refresh_static = false } = {}) {
  const db = getDb();
  const seg = db.prepare('SELECT * FROM segments WHERE id = ?').get(segment_id);
  if (!seg) {
    throw new Error(`Segment '${segment_id}' not found`);
  }

  const criteria = safeJsonParse(seg.criteria, {});
  const now = new Date().toISOString();
  let members = [];

  if (seg.segment_type === 'realtime' || refresh_static) {
    members = findMatchingCustomers(criteria);
    db.prepare('UPDATE segments SET cached_count = ?, last_evaluated_at = ? WHERE id = ?').run(
      members.length,
      now,
      segment_id
    );
    db.prepare('DELETE FROM segment_members WHERE segment_id = ?').run(segment_id);
    const ins = db.prepare('INSERT OR IGNORE INTO segment_members (segment_id, customer_id, added_at, source) VALUES (?, ?, ?, ?)');
    for (const m of members) {
      ins.run(segment_id, m.id, now, seg.segment_type === 'static' ? 'static_refresh' : 'realtime_eval');
    }
  } else {
    // Static segment reads its stored snapshot from segment_members
    const rows = db.prepare(`
      SELECT c.*
      FROM segment_members sm
      JOIN customers c ON sm.customer_id = c.id
      WHERE sm.segment_id = ?
      ORDER BY sm.added_at DESC
    `).all(segment_id);
    members = rows.map(formatCustomerRow);
  }

  return {
    id: seg.id,
    alias: seg.alias,
    name: seg.name,
    description: seg.description,
    segment_type: seg.segment_type,
    status: seg.status,
    criteria,
    member_count: members.length,
    last_evaluated_at: seg.segment_type === 'realtime' || refresh_static ? now : seg.last_evaluated_at,
    created_at: seg.created_at,
    members
  };
}

/**
 * Segments Dashboard: Displays both Static and Real-Time Segments with live metrics and breakdown
 */
export function getSegmentsDashboard() {
  const db = getDb();
  const totalCustomers = db.prepare('SELECT COUNT(*) as c FROM customers').get().c || 0;
  const segRows = db.prepare('SELECT * FROM segments ORDER BY created_at DESC').all();

  const staticSegments = [];
  const realtimeSegments = [];

  for (const row of segRows) {
    const details = getSegmentDetails(row.id, { refresh_static: false });
    const summaryItem = {
      id: details.id,
      alias: details.alias,
      name: details.name,
      description: details.description,
      segment_type: details.segment_type,
      member_count: details.member_count,
      share_of_total_customers_percent:
        totalCustomers > 0 ? Number(((details.member_count / totalCustomers) * 100).toFixed(1)) : 0,
      criteria_dimensions_used: Object.keys(details.criteria).filter(
        (k) => k !== 'match_mode' && details.criteria[k] && (!Array.isArray(details.criteria[k]) || details.criteria[k].length > 0)
      ),
      criteria: details.criteria,
      last_evaluated_at: details.last_evaluated_at,
      sample_members: details.members.slice(0, 5).map((m) => ({
        id: m.id,
        name: `${m.first_name || ''} ${m.last_name || ''}`.trim() || m.email || m.id,
        email: m.email,
        tier: m.tier,
        total_spent: m.total_spent
      }))
    };

    if (details.segment_type === 'static') {
      staticSegments.push(summaryItem);
    } else {
      realtimeSegments.push(summaryItem);
    }
  }

  return {
    dashboard_summary: {
      total_customers_in_cdp: totalCustomers,
      total_segments: segRows.length,
      static_segments_count: staticSegments.length,
      realtime_segments_count: realtimeSegments.length,
      generated_at: new Date().toISOString()
    },
    realtime_segments: realtimeSegments,
    static_segments: staticSegments
  };
}

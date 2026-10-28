import { getDb } from './db.js';

const TABLES = {
  customer: 'customers',
  segment: 'segments',
  campaign: 'campaigns',
  journey: 'journeys'
};

export function resolveReference(kind, value, { optional = false } = {}) {
  if (value == null || value === '') return value;
  if (typeof value !== 'string') throw new Error(`${kind} reference must be a string`);
  const ref = value.trim();
  const table = TABLES[kind];
  if (!table) throw new Error(`Unknown reference type: ${kind}`);
  const db = getDb();

  const byId = db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(ref);
  if (byId) return byId.id;

  const condition = kind === 'customer'
    ? `alias = ? COLLATE NOCASE OR external_id = ? COLLATE NOCASE OR email = ? COLLATE NOCASE OR phone = ?
        OR trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')) = ? COLLATE NOCASE`
    : 'alias = ? COLLATE NOCASE OR name = ? COLLATE NOCASE';
  const params = kind === 'customer' ? [ref, ref, ref, ref, ref] : [ref, ref];
  const matches = db.prepare(`
    SELECT id FROM ${table}
    WHERE ${condition}
  `).all(...params);

  if (matches.length > 1) {
    throw new Error(`Ambiguous ${kind} '${ref}'; use a unique alias or ID`);
  }
  if (matches.length === 0) {
    if (optional) return null;
    throw new Error(`${kind} '${ref}' not found`);
  }
  return matches[0].id;
}

function resolveField(args, key, kind) {
  if (args[key]) args[key] = resolveReference(kind, args[key]);
}

function resolveList(args, key, kind) {
  if (Array.isArray(args[key])) args[key] = args[key].map((ref) => resolveReference(kind, ref));
}

function resolveCampaignConditions(criteria) {
  for (const condition of criteria?.campaign_response_conditions || []) {
    if (condition.campaign_id) condition.campaign_id = resolveReference('campaign', condition.campaign_id);
  }
}

function resolveUpsertId(args, kind) {
  if (args.id) {
    args.id = resolveReference(kind, args.id, { optional: true }) || args.id;
  } else if (args.alias || (kind !== 'customer' && args.name)) {
    const existing = args.alias && resolveReference(kind, args.alias, { optional: true });
    args.id = existing || (kind !== 'customer' && args.name
      ? resolveReference(kind, args.name, { optional: true })
      : null) || undefined;
  }
}

export function resolveToolArgs(toolName, input = {}) {
  const args = structuredClone(input);

  if (toolName === 'cdp_upsert_customer') resolveUpsertId(args, 'customer');
  if (toolName === 'cdp_create_segment') {
    resolveUpsertId(args, 'segment');
    resolveList(args, 'static_customer_ids', 'customer');
    resolveCampaignConditions(args.criteria);
  }
  if (toolName === 'cdp_upsert_campaign') {
    resolveUpsertId(args, 'campaign');
    resolveField(args, 'segment_id', 'segment');
  }
  if (toolName === 'cdp_upsert_journey') {
    resolveUpsertId(args, 'journey');
    if (args.trigger_config?.segment_id) {
      args.trigger_config.segment_id = resolveReference('segment', args.trigger_config.segment_id);
    }
    resolveCampaignConditions(args.trigger_config?.criteria);
    resolveCampaignConditions(args.goal_config?.criteria);
    for (const step of args.steps || []) {
      if (step.campaign_id) step.campaign_id = resolveReference('campaign', step.campaign_id);
      resolveCampaignConditions(step.criteria);
    }
  }

  const customerFields = new Set([
    'cdp_get_linked_customers', 'cdp_get_customer_timeline', 'cdp_get_customer_insights',
    'cdp_manage_customer_consent', 'cdp_track_event', 'cdp_ingest_tracking_payload',
    'cdp_list_events', 'cdp_record_campaign_response'
  ]);
  if (customerFields.has(toolName)) resolveField(args, 'customer_id', 'customer');
  if (toolName === 'cdp_get_customer_profile') resolveField(args, 'identifier', 'customer');
  if (toolName === 'cdp_link_customers') {
    resolveField(args, 'primary_customer_id', 'customer');
    resolveField(args, 'linked_customer_id', 'customer');
  }
  if (toolName === 'cdp_execute_campaign' || toolName === 'cdp_run_journey') {
    resolveList(args, 'customer_ids', 'customer');
  }
  if (toolName === 'cdp_get_segment_details') resolveField(args, 'segment_id', 'segment');
  if (toolName === 'cdp_execute_campaign' || toolName === 'cdp_record_campaign_response') {
    resolveField(args, 'campaign_id', 'campaign');
  }
  if (toolName === 'cdp_run_journey' || toolName === 'cdp_get_journey_performance') {
    resolveField(args, 'journey_id', 'journey');
  }
  return args;
}

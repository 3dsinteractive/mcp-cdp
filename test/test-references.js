import assert from 'node:assert/strict';

process.env.CDP_DB_PATH = ':memory:';
const { handleJsonRpcRequest } = await import('../src/index.js');
let nextId = 1;

async function call(name, args) {
  const response = await handleJsonRpcRequest({
    jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name, arguments: args }
  });
  const result = JSON.parse(response.result.content[0].text);
  if (response.result.isError) throw new Error(result.error);
  return result;
}

const customer = await call('cdp_upsert_customer', {
  alias: 'somchai', first_name: 'สมชาย', last_name: 'ใจดี', email: 'alias-somchai@example.com', tier: 'gold'
});
assert.equal(customer.customer.alias, 'somchai');
assert.equal((await call('cdp_get_customer_profile', { identifier: 'somchai' })).profile.id, customer.customer.id);
assert.equal((await call('cdp_list_customers', { search: 'somchai' })).total, 1);

const segment = await call('cdp_create_segment', {
  alias: 'gold-members', name: 'ลูกค้า Gold', segment_type: 'static', criteria: {},
  static_customer_ids: ['somchai']
});
assert.equal(segment.alias, 'gold-members');
assert.equal((await call('cdp_get_segment_details', { segment_id: 'ลูกค้า Gold' })).member_count, 1);

const campaign = await call('cdp_upsert_campaign', {
  alias: 'welcome-email', name: 'อีเมลต้อนรับ', channel: 'email', segment_id: 'gold-members',
  message_config: { subject: 'สวัสดี {{first_name}}' }
});
assert.equal(campaign.segment_id, segment.id);
assert.equal(campaign.alias, 'welcome-email');

const executed = await call('cdp_execute_campaign', { campaign_id: 'อีเมลต้อนรับ', customer_ids: ['somchai'] });
assert.equal(executed.target_count, 1);

const journey = await call('cdp_upsert_journey', {
  alias: 'welcome-flow', name: 'เส้นทางต้อนรับ', trigger_type: 'segment',
  trigger_config: { segment_id: 'gold-members' },
  steps: [{ id: 'send', name: 'ส่งอีเมล', type: 'send_campaign', campaign_id: 'welcome-email' }]
});
assert.equal(journey.alias, 'welcome-flow');
assert.equal(journey.trigger_config.segment_id, segment.id);
assert.equal((await call('cdp_run_journey', { journey_id: 'เส้นทางต้อนรับ', customer_ids: ['somchai'] })).journey_id, journey.id);

await call('cdp_upsert_customer', {
  alias: 'another-somchai', first_name: 'สมชาย', last_name: 'ใจดี', email: 'another@example.com'
});
const ambiguous = await handleJsonRpcRequest({
  jsonrpc: '2.0', id: nextId++, method: 'tools/call',
  params: { name: 'cdp_get_customer_profile', arguments: { identifier: 'สมชาย ใจดี' } }
});
assert.equal(ambiguous.result.isError, true);
assert.match(ambiguous.result.content[0].text, /Ambiguous customer/);

console.log('[PASS] Customer, segment, campaign and journey names/aliases resolve; ambiguous names fail safely');

import assert from 'node:assert/strict';
import { getDb, resetDbInstance } from '../src/db.js';
import { handleJsonRpcRequest } from '../src/index.js';
import { upsertCustomer } from '../src/services/customerService.js';
import { createSegment } from '../src/services/segmentService.js';

resetDbInstance(getDb(':memory:'));
upsertCustomer({ id: 'user_customer', first_name: 'ลูกค้าจริง', email: 'real@example.com', source: 'manual' });
createSegment({ id: 'user_segment', name: 'กลุ่มของผู้ใช้', segment_type: 'static', criteria: { customer_attributes: [{ field: 'source', operator: 'eq', value: 'manual' }] } });

let id = 1;
async function tool(name, args = {}) {
  const response = await handleJsonRpcRequest({
    jsonrpc: '2.0', id: id++, method: 'tools/call', params: { name, arguments: args }
  });
  const result = JSON.parse(response.result.content[0].text);
  assert.equal(response.result.isError, undefined, `${name}: ${JSON.stringify(result)}`);
  return result;
}

const first = await tool('cdp_create_demo');
assert.equal(first.counts.customers, 24);
assert.ok(first.counts.events >= 100);
assert.equal(first.counts.product_purchases, 12);
assert.equal(first.counts.segments, 7);
assert.equal(first.counts.campaigns, 7);
assert.equal(first.counts.journeys, 3);
assert.ok(first.counts.campaign_logs > 20);
assert.ok(first.counts.journey_enrollments > 10);

const productViews = await tool('cdp_list_events', { event_category: 'demo_beauty_clinic', event_name: 'product_view', limit: 100 });
const carts = await tool('cdp_list_events', { event_category: 'demo_beauty_clinic', event_name: 'add_to_cart', limit: 100 });
const purchases = await tool('cdp_list_events', { event_category: 'demo_beauty_clinic', event_name: 'purchase', limit: 100 });
const productPurchases = purchases.events.filter((event) => event.properties.purchase_type === 'product');
assert.equal(productViews.total, 24);
assert.equal(carts.total, 17);
assert.equal(productPurchases.length, 12);
assert.ok(new Set(productPurchases.map((event) => event.properties.sku)).size >= 4);
assert.equal(productPurchases.reduce((total, event) => total + event.revenue, 0), first.counts.product_revenue);
assert.equal(new Set(productPurchases.map((event) => event.properties.order_id)).size, 12);
for (const event of productPurchases) {
  assert.equal(event.revenue, event.properties.quantity * event.properties.unit_price);
  assert.equal(event.properties.items[0].sku, event.properties.sku);
  assert.ok(productViews.events.some((view) => view.customer_id === event.customer_id && view.properties.sku === event.properties.sku));
  assert.ok(carts.events.some((cart) => cart.customer_id === event.customer_id && cart.properties.sku === event.properties.sku));
}
assert.ok(carts.events.some((cart) => cart.customer_id === 'demo_beauty_customer_19' &&
  !productPurchases.some((purchase) => purchase.customer_id === cart.customer_id)));
const firstCustomer = getDb().prepare("SELECT total_spent, order_count FROM customers WHERE id = 'demo_beauty_customer_01'").get();
assert.equal(firstCustomer.total_spent, 92000 + 7900 + 1380);
assert.equal(firstCustomer.order_count, 10);

const segment = await tool('cdp_get_segment_details', { segment_id: 'clinic-no-show' });
assert.equal(segment.member_count, 4);
const campaigns = await tool('cdp_list_campaigns');
assert.equal(new Set(campaigns.campaigns.filter((c) => c.alias?.startsWith('clinic-')).map((c) => c.channel)).size, 7);

const second = await tool('cdp_create_demo');
assert.deepEqual(second.counts, first.counts, 'creating demo twice should replace it without duplicates');

const deleted = await tool('cdp_delete_demo');
assert.equal(deleted.deleted.customers, 24);
assert.equal(deleted.deleted.events, first.counts.events);
assert.equal(getDb().prepare('SELECT COUNT(*) AS count FROM customers').get().count, 1);
assert.equal(getDb().prepare('SELECT id FROM customers').get().id, 'user_customer');
assert.equal(getDb().prepare("SELECT COUNT(*) AS count FROM segments WHERE id = 'user_segment'").get().count, 1);
assert.equal(getDb().prepare("SELECT COUNT(*) AS count FROM events WHERE event_category = 'demo_beauty_clinic'").get().count, 0);
assert.equal(getDb().prepare("SELECT COUNT(*) AS count FROM campaigns WHERE id LIKE 'demo_beauty_%'").get().count, 0);
assert.equal(getDb().prepare("SELECT COUNT(*) AS count FROM journeys WHERE id LIKE 'demo_beauty_%'").get().count, 0);

const repeatedDelete = await tool('cdp_delete_demo');
assert.deepEqual(repeatedDelete.deleted, { customers: 0, events: 0, segments: 0, campaigns: 0, journeys: 0 });

createSegment({ id: 'user_alias_collision', alias: 'clinic-vip', name: 'ชื่อ alias ที่ผู้ใช้ครองอยู่', segment_type: 'static', criteria: {} });
const failedCreate = await handleJsonRpcRequest({
  jsonrpc: '2.0', id: id++, method: 'tools/call', params: { name: 'cdp_create_demo', arguments: {} }
});
assert.equal(failedCreate.result.isError, true);
assert.equal(getDb().prepare("SELECT COUNT(*) AS count FROM customers WHERE source = 'demo_beauty_clinic'").get().count, 0);
assert.equal(getDb().prepare("SELECT COUNT(*) AS count FROM events WHERE event_category = 'demo_beauty_clinic'").get().count, 0);
console.log('[PASS] Beauty clinic demo creates rich data, recreates cleanly, and deletes without touching other customers');

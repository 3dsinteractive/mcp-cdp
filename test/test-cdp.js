import assert from 'node:assert/strict';
import { getDb, resetDbInstance } from '../src/db.js';
import { handleJsonRpcRequest } from '../src/index.js';
import { seedDatabase } from '../src/seed.js';

async function callMcpTool(name, args = {}) {
  const res = await handleJsonRpcRequest({
    jsonrpc: '2.0',
    id: Math.floor(Math.random() * 100000),
    method: 'tools/call',
    params: { name, arguments: args }
  });
  assert.ok(!res.error, `JSON-RPC error on ${name}: ${JSON.stringify(res.error)}`);
  assert.ok(!res.result.isError, `Tool execution error on ${name}: ${res.result.content[0].text}`);
  return JSON.parse(res.result.content[0].text);
}

async function runTests() {
  console.log('--- Running MCP-CDP End-to-End Tests ---');

  // Use in-memory SQLite for isolated tests
  const memDb = getDb(':memory:');
  resetDbInstance(memDb);

  // 1. Test MCP Initialize & Tools List
  const initRes = await handleJsonRpcRequest({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2024-11-05' }
  });
  assert.equal(initRes.result.serverInfo.name, 'mcp-cdp');

  const toolsListRes = await handleJsonRpcRequest({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
    params: {}
  });
  assert.ok(toolsListRes.result.tools.length >= 20, 'Should expose all CDP tools');
  console.log(`[PASS] MCP Protocol initialized (${toolsListRes.result.tools.length} tools registered)`);

  // 2. Seed sample data & test Customer Management
  seedDatabase();

  const custList = await callMcpTool('cdp_list_customers', { limit: 10 });
  assert.equal(custList.total, 3);

  const dbOverview = await callMcpTool('cdp_get_database_overview');
  assert.equal(dbOverview.total_customers, 3);
  assert.ok(dbOverview.total_revenue >= 72500);
  console.log('[PASS] 1. จัดการข้อมูลลูกค้า (List, Import, Link, Database Overview)');

  // 3. Test Customer 360 Profile, Timeline, Insights, and Consent
  const profile360 = await callMcpTool('cdp_get_customer_profile', { identifier: 'somchai@example.com' });
  assert.equal(profile360.profile.id, 'cust_somchai');
  assert.equal(profile360.insights.rfm.rfm_segment, 'Champions');
  assert.ok(profile360.recent_timeline.length >= 3);
  assert.equal(profile360.consents.email, 'granted');

  // Update consent and verify audit log
  const updatedConsent = await callMcpTool('cdp_manage_customer_consent', {
    customer_id: 'cust_somchai',
    consent_type: 'sms',
    status: 'revoked',
    source: 'user_settings'
  });
  assert.equal(updatedConsent.consents_map.sms, 'revoked');
  assert.ok(updatedConsent.audit_history.length >= 2);
  console.log('[PASS] 2. ดู Customer Profile (Profile, Timeline, Insights/RFM, Consents & Audit Log)');

  // 4. Test Events & Tracking Script (with anonymous identity stitching)
  const scriptRes = await callMcpTool('cdp_generate_tracking_script', { site_id: 'shop_th' });
  assert.ok(scriptRes.script_html.includes('w.cdpTracker'));

  // Verify anon_web_visitor_999 was stitched to cust_ananda
  const anandaEvents = await callMcpTool('cdp_list_events', { customer_id: 'cust_ananda' });
  assert.equal(anandaEvents.total, 2, 'Both anonymous page_view and identified add_to_cart should be stitched to cust_ananda');

  const eventAnalytics = await callMcpTool('cdp_get_event_analytics', {});
  assert.ok(eventAnalytics.summary.total_events >= 5);
  assert.ok(eventAnalytics.utm_attribution.length >= 2);
  console.log('[PASS] 3. เก็บและจัดการ Events & Web Tracking Script (UTM, URL, Identity Stitching)');

  // 5. Test Segments (7 Criteria Dimensions + Static & Real-Time Dashboard)
  const segComplex = await callMcpTool('cdp_create_segment', {
    id: 'seg_complex_7dim',
    name: 'Engaged VIPs who clicked Email Campaign',
    segment_type: 'realtime',
    criteria: {
      match_mode: 'all',
      customer_attributes: [{ field: 'tier', operator: 'in', value: ['platinum', 'gold'] }],
      event_conditions: [{ event_name: 'purchase', min_count: 1 }],
      analytics_conditions: [{ metric: 'total_spent', operator: 'gte', value: 20000 }],
      url_conditions: [{ url_pattern: '/vip-lounge', min_visits: 1 }],
      utm_conditions: [{ utm_source: 'line', min_touches: 1 }],
      date_conditions: { birth_month: 10 },
      campaign_response_conditions: [{ campaign_id: 'cmp_email_vip', status: 'clicked' }]
    }
  });
  assert.equal(segComplex.member_count, 1);
  assert.equal(segComplex.members[0].id, 'cust_somchai');

  const segDashboard = await callMcpTool('cdp_get_segments_dashboard');
  assert.ok(segDashboard.realtime_segments.length >= 3);
  assert.ok(segDashboard.static_segments.length >= 1);
  console.log('[PASS] 4. สร้าง Segments & Dashboard (ครบทั้ง 7 เงื่อนไข + แสดงทั้ง Static & Real-Time Segments)');

  // 6. Test Omnichannel Campaigns (All 7 Channels: Email, LINE, FB Messenger, SMS, WhatsApp, App Push, Web Push)
  const allCampaigns = await callMcpTool('cdp_list_campaigns');
  const configuredChannels = new Set(allCampaigns.campaigns.map((c) => c.channel));
  for (const ch of ['email', 'line', 'facebook_messenger', 'sms', 'whatsapp', 'app_push', 'web_push']) {
    assert.ok(configuredChannels.has(ch), `Channel ${ch} should be configured`);
  }

  // Execute SMS campaign on Birthday segment (note: somchai revoked SMS consent above, so he should be skipped_no_consent!)
  const smsExec = await callMcpTool('cdp_execute_campaign', { campaign_id: 'cmp_sms_flash' });
  assert.equal(smsExec.skipped_no_consent, 1, 'Somchai revoked SMS consent so SMS should be skipped');
  assert.equal(smsExec.delivered, 1, 'Ananda has October birthday and granted marketing consent');
  console.log('[PASS] 5. ทำ Campaign หลายช่องทาง (ครบทั้ง 7 ช่องทาง พร้อม Personalization & Consent Check)');

  // 7. Test Customer Journey & Performance Funnel
  const journeyPerf = await callMcpTool('cdp_get_journey_performance', {
    journey_id: 'jrn_vip_onboarding_upsell'
  });
  assert.equal(journeyPerf.summary.total_enrolled, 2); // somchai & suda
  assert.equal(journeyPerf.summary.converted, 1); // somchai made a purchase
  // Verify condition_split branched somchai to Yes (clicked email -> app_push) and suda to No (did not click -> line)
  const splitStep = journeyPerf.step_funnel.find((s) => s.step_id === 'step_3_check_click');
  assert.equal(splitStep.metrics.branched_yes_count, 1);
  assert.equal(splitStep.metrics.branched_no_count, 1);
  console.log('[PASS] 6. สร้าง Customer Journey & ดูผลลัพธ์ของ Journey (Trigger, Condition Split, Multi-Channel Steps, Goal Funnel)');

  console.log('--- ALL TESTS PASSED SUCCESSFULLY ---');
}

runTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});

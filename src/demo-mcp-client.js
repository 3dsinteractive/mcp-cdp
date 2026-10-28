import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverPath = path.join(__dirname, 'index.js');

class McpStdioClient {
  constructor() {
    this.proc = spawn(process.execPath, ['--no-warnings', serverPath], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = '';

    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk) => {
      this.buffer += chunk;
      while (true) {
        const idx = this.buffer.indexOf('\n');
        if (idx === -1) break;
        const line = this.buffer.slice(0, idx).trim();
        this.buffer = this.buffer.slice(idx + 1);
        if (!line) continue;
        const msg = JSON.parse(line);
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve, reject } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) reject(new Error(msg.error.message));
          else resolve(msg.result);
        }
      }
    });
  }

  request(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  async callTool(name, args = {}) {
    const res = await this.request('tools/call', { name, arguments: args });
    const parsed = JSON.parse(res.content[0].text);
    if (res.isError) {
      throw new Error(parsed.error || 'Tool error');
    }
    return parsed;
  }

  close() {
    this.proc.kill();
  }
}

async function runLiveDemo() {
  const client = new McpStdioClient();

  try {
    console.log('================================================================');
    console.log('🚀 ทดลองใช้งาน MCP-CDP Server ผ่าน MCP Protocol (stdio -> SQLite)');
    console.log('================================================================\n');

    // 0. Initialize MCP Session
    const init = await client.request('initialize', { protocolVersion: '2024-11-05' });
    console.log(`✅ เชื่อมต่อ MCP Server สำเร็จ: ${init.serverInfo.name} v${init.serverInfo.version}`);

    // -------------------------------------------------------------------------
    // 1. จัดการข้อมูลลูกค้า (นำเข้าลูกค้าใหม่ + เชื่อมโยงลูกค้า + ดูภาพรวมฐานข้อมูล)
    // -------------------------------------------------------------------------
    console.log('\n----------------------------------------------------------------');
    console.log('1️⃣  [จัดการข้อมูลลูกค้า] นำเข้าข้อมูลลูกค้า เชื่อมโยงลูกค้า และดูฐานข้อมูล');
    console.log('----------------------------------------------------------------');
    const upserted = await client.callTool('cdp_upsert_customer', {
      id: 'cust_pimchanok',
      external_id: 'MEM-2001',
      first_name: 'พิมพ์ชนก',
      last_name: 'วงศ์สว่าง',
      email: 'pimchanok@example.com',
      phone: '0829998877',
      city: 'Bangkok',
      birth_date: '1994-10-28',
      line_uid: 'U_line_pim_99',
      fb_psid: 'FB_psid_pim_99',
      whatsapp_id: '66829998877',
      app_push_token: 'fcm_pim_ios_01',
      web_push_subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/pim' },
      lifecycle_stage: 'vip',
      tier: 'gold',
      total_spent: 28000,
      order_count: 6,
      tags: ['vip', 'skincare_lover'],
      custom_attributes: { favorite_category: 'skincare', branch: 'Siam Paragon' },
      consents: {
        marketing: true,
        email: true,
        line: true,
        sms: true,
        facebook_messenger: true,
        whatsapp: true,
        app_push: true,
        web_push: true
      }
    });
    console.log(`-> บันทึกลูกค้า: ${upserted.customer.first_name} ${upserted.customer.last_name} (${upserted.customer.id}) Tier: ${upserted.customer.tier}`);

    const linkRes = await client.callTool('cdp_link_customers', {
      primary_customer_id: 'cust_pimchanok',
      linked_customer_id: 'cust_suda',
      identity_type: 'referral',
      identity_value: 'REF-SUDA-PIM',
      relationship: 'referral'
    });
    console.log(`-> เชื่อมโยงลูกค้า: ${linkRes.primary_customer_id} <-> ${linkRes.linked_customer_id} (${linkRes.relationship})`);

    const dbOverview = await client.callTool('cdp_get_database_overview');
    console.log(`-> สรุปฐานข้อมูลลูกค้าใน SQLite: ทั้งหมด ${dbOverview.total_customers} คน | รายได้รวม ${dbOverview.total_revenue.toLocaleString()} บาท | LTV เฉลี่ย ${dbOverview.average_ltv.toLocaleString()} บาท`);
    console.log('   ความพร้อมช่องทางติดต่อ:', JSON.stringify(dbOverview.channel_reachability));

    // -------------------------------------------------------------------------
    // 2. เก็บและจัดการ Events & Tracking Script
    // -------------------------------------------------------------------------
    console.log('\n----------------------------------------------------------------');
    console.log('2️⃣  [เก็บและจัดการ Events] จำลองส่งข้อมูลจาก Web Tracking Script พร้อม UTM');
    console.log('----------------------------------------------------------------');
    // ผู้ชมนิรนามเข้ามาดูหน้าโปรโมชันผ่านลิงก์โฆษณา LINE
    await client.callTool('cdp_ingest_tracking_payload', {
      anonymous_id: 'anon_cookie_7788',
      session_id: 'sess_pim_01',
      event_name: 'page_view',
      page_url: 'https://shop.example.com/promotions/gold-serum?utm_source=line&utm_medium=rich_menu&utm_campaign=october_beauty',
      page_title: 'Gold Serum Special Offer'
    });
    // ผู้ชมล็อกอินเป็นคุณพิมพ์ชนกและกดสั่งซื้อ -> ระบบทำ Identity Stitching ผูก Event ก่อนหน้าให้อัตโนมัติ!
    const trackedPurchase = await client.callTool('cdp_ingest_tracking_payload', {
      anonymous_id: 'anon_cookie_7788',
      customer_id: 'cust_pimchanok',
      session_id: 'sess_pim_01',
      event_name: 'purchase',
      page_url: 'https://shop.example.com/checkout/complete?utm_source=line&utm_medium=rich_menu&utm_campaign=october_beauty',
      revenue: 3900,
      properties: { order_id: 'ORD-9910', product: 'Gold Serum Set', category: 'skincare' }
    });
    console.log(`-> รับ Event จาก Tracking Script: ${trackedPurchase.event.event_name} (ยอดซื้อ ${trackedPurchase.event.revenue} บาท)`);
    console.log(`-> ผูก Anonymous ID (${trackedPurchase.identity_stitch.identity_value}) เข้ากับ ${trackedPurchase.resolved_customer_id} สำเร็จ!`);

    // -------------------------------------------------------------------------
    // 3. ดู Customer Profile 360 (ข้อมูลส่วนตัว, Timeline, Insights, Consent)
    // -------------------------------------------------------------------------
    console.log('\n----------------------------------------------------------------');
    console.log('3️⃣  [ดู Customer Profile] ข้อมูลส่วนตัว + Timeline + Insights (RFM) + Consent');
    console.log('----------------------------------------------------------------');
    const profile360 = await client.callTool('cdp_get_customer_profile', {
      identifier: 'pimchanok@example.com'
    });
    console.log(`-> ชื่อลูกค้า: ${profile360.profile.first_name} ${profile360.profile.last_name} | ยอดซื้อสะสมใหม่: ${profile360.profile.total_spent.toLocaleString()} บาท`);
    console.log(`-> RFM Analysis: Segment = "${profile360.insights.rfm.rfm_segment}" (Score: ${profile360.insights.rfm.rfm_score}) | Engagement Score: ${profile360.insights.engagement.engagement_score}/100`);
    console.log(`-> สถานะ Consent:`, JSON.stringify(profile360.consents));
    console.log(`-> Timeline ล่าสุด (${profile360.recent_timeline.length} รายการ):`);
    for (const item of profile360.recent_timeline.slice(0, 3)) {
      console.log(`   - [${item.timeline_type.toUpperCase()}] ${item.title}`);
    }

    // -------------------------------------------------------------------------
    // 4. สร้าง Segments & ดูหน้า Dashboard (Static & Real-Time Segments)
    // -------------------------------------------------------------------------
    console.log('\n----------------------------------------------------------------');
    console.log('4️⃣  [สร้าง Segments & Dashboard] แสดงทั้ง Static และ Real-Time Segments');
    console.log('----------------------------------------------------------------');
    await client.callTool('cdp_create_segment', {
      id: 'seg_realtime_beauty_vips',
      name: 'Beauty VIPs from LINE UTM (Real-Time)',
      description: 'ลูกค้ากลุ่ม Skincare ที่มียอดซื้อ >= 20,000 บาท และเข้าเว็บผ่าน UTM line',
      segment_type: 'realtime',
      criteria: {
        match_mode: 'all',
        customer_attributes: [
          { field: 'custom_attributes.favorite_category', operator: 'eq', value: 'skincare' }
        ],
        analytics_conditions: [{ metric: 'total_spent', operator: 'gte', value: 20000 }],
        utm_conditions: [{ utm_source: 'line', min_touches: 1 }]
      }
    });

    const segDashboard = await client.callTool('cdp_get_segments_dashboard');
    console.log(`-> สรุปหน้า Dashboard: ทั้งหมด ${segDashboard.dashboard_summary.total_segments} Segments (Real-Time: ${segDashboard.dashboard_summary.realtime_segments_count}, Static: ${segDashboard.dashboard_summary.static_segments_count})`);
    console.log('   [Real-Time Segments]:');
    for (const s of segDashboard.realtime_segments) {
      console.log(`   • ${s.name}: ${s.member_count} คน (${s.share_of_total_customers_percent}%) -> สมาชิก: ${s.sample_members.map((m) => m.name).join(', ')}`);
    }
    console.log('   [Static Segments]:');
    for (const s of segDashboard.static_segments) {
      console.log(`   • ${s.name}: ${s.member_count} คน (${s.share_of_total_customers_percent}%) -> สมาชิก: ${s.sample_members.map((m) => m.name).join(', ')}`);
    }

    // -------------------------------------------------------------------------
    // 5. ทำ Campaign หลายช่องทาง (7 ช่องทาง) & ทดสอบส่งจริง
    // -------------------------------------------------------------------------
    console.log('\n----------------------------------------------------------------');
    console.log('5️⃣  [ทำ Campaign หลายช่องทาง] ตั้งค่าและส่ง Campaign ผ่าน 7 ช่องทาง');
    console.log('----------------------------------------------------------------');
    const execLine = await client.callTool('cdp_execute_campaign', {
      campaign_id: 'cmp_line_promo'
    });
    console.log(`-> ส่งแคมเปญ [${execLine.channel.toUpperCase()}] "${execLine.campaign_name}" สำเร็จ ${execLine.delivered}/${execLine.target_count} คน`);
    console.log(`   ตัวอย่างข้อความที่แทนค่าตัวแปรแล้ว: "${execLine.deliveries[0]?.rendered_message?.text}"`);

    // บันทึกว่าคุณพิมพ์ชนกเปิดและคลิกแคมเปญ Email
    await client.callTool('cdp_execute_campaign', {
      campaign_id: 'cmp_email_vip',
      customer_ids: ['cust_pimchanok']
    });
    await client.callTool('cdp_record_campaign_response', {
      campaign_id: 'cmp_email_vip',
      customer_id: 'cust_pimchanok',
      action: 'clicked'
    });

    // -------------------------------------------------------------------------
    // 6. สร้างและรัน Customer Journey พร้อมดูผลลัพธ์ Funnel
    // -------------------------------------------------------------------------
    console.log('\n----------------------------------------------------------------');
    console.log('6️⃣  [สร้าง Customer Journey] รัน Journey และดูผลลัพธ์ Step Funnel');
    console.log('----------------------------------------------------------------');
    const journeyResult = await client.callTool('cdp_run_journey', {
      journey_id: 'jrn_vip_onboarding_upsell',
      advance_waiting: true,
      re_enroll: true
    });
    const perf = await client.callTool('cdp_get_journey_performance', {
      journey_id: 'jrn_vip_onboarding_upsell'
    });
    console.log(`-> ชื่อ Journey: ${perf.name} (Trigger: ${perf.trigger_type})`);
    console.log(`-> สรุปผล Journey: เข้าร่วม ${perf.summary.total_enrolled} คน | จบขั้นตอน ${perf.summary.completed} คน | เกิด Conversion ${perf.summary.converted} คน (${perf.summary.conversion_rate_percent}%) | รายได้จาก Goal ${perf.summary.total_conversion_revenue.toLocaleString()} บาท`);
    console.log('-> Funnel รายขั้นตอน:');
    for (const step of perf.step_funnel) {
      console.log(
        `   [${step.step_id}] ${step.step_name} (${step.step_type}) -> รัน ${step.metrics.executions} ครั้ง (สำเร็จ: ${step.metrics.success_count}, กิ่ง Yes: ${step.metrics.branched_yes_count}, กิ่ง No: ${step.metrics.branched_no_count})`
      );
    }

    console.log('\n================================================================');
    console.log('✨ ทดลองใช้งานครบทุกฟีเจอร์เรียบร้อย! ข้อมูลทั้งหมดถูกบันทึกใน data/cdp.sqlite');
    console.log('================================================================');
  } finally {
    client.close();
  }
}

runLiveDemo().catch((err) => {
  console.error('Demo Error:', err);
  process.exit(1);
});

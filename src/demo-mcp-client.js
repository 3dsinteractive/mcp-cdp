import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.js');
const DEMO_SOURCE = 'demo_beauty_clinic';
const money = (value) => `${new Intl.NumberFormat('th-TH').format(Number(value || 0))} บาท`;

class McpStdioClient {
  constructor() {
    this.proc = spawn(process.execPath, ['--no-warnings', serverPath], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = '';
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk) => this.onData(chunk));
    this.proc.on('error', (error) => this.rejectPending(error));
    this.proc.on('exit', (code) => this.rejectPending(new Error(`MCP server exited (${code})`)));
  }

  onData(chunk) {
    this.buffer += chunk;
    let index;
    while ((index = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      const pending = this.pending.get(message.id);
      if (!pending) continue;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    }
  }

  rejectPending(error) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  request(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  async callTool(name, args = {}) {
    const result = await this.request('tools/call', { name, arguments: args });
    const output = JSON.parse(result.content[0].text);
    if (result.isError) throw new Error(output.error || `Tool ${name} failed`);
    return output;
  }

  close() {
    this.proc.stdin.end();
    this.proc.kill();
  }
}

async function runDemo() {
  const client = new McpStdioClient();
  try {
    const init = await client.request('initialize', { protocolVersion: '2025-11-25' });
    console.log(`MCP-CDP ${init.serverInfo.version} — เดโมคลินิกเสริมความงาม (ข้อมูลสังเคราะห์)`);

    if (process.argv.includes('--delete')) {
      const result = await client.callTool('cdp_delete_demo');
      console.log('ลบชุดข้อมูลเดโมแล้ว:', JSON.stringify(result.deleted, null, 2));
      return;
    }

    const created = await client.callTool('cdp_create_demo');
    console.log('\nสร้างชุดข้อมูลคลินิกตัวอย่าง:');
    console.log(`ลูกค้า ${created.counts.customers} คน | Events ${created.counts.events} | Segments ${created.counts.segments} | Campaigns ${created.counts.campaigns} | Journeys ${created.counts.journeys}`);
    console.log(`บันทึกแคมเปญจำลอง ${created.counts.campaign_logs} รายการ | ผู้เข้า Journey ${created.counts.journey_enrollments} รายการ`);
    console.log('แคมเปญในเดโมเป็นการจำลองและบันทึกใน SQLite ไม่มีการส่งข้อความออกจริง');

    const customersResult = await client.callTool('cdp_list_customers', { search: 'clinic-', limit: 100 });
    const customers = customersResult.customers.filter((customer) => customer.source === DEMO_SOURCE);
    console.log('\nลูกค้าและบริบทการดูแล:');
    for (const customer of customers.sort((a, b) => a.alias.localeCompare(b.alias))) {
      const attributes = customer.custom_attributes;
      console.log(`• ${customer.first_name} ${customer.last_name} (${customer.alias}) — ${customer.tier}, ${attributes.clinic_branch}, สนใจ ${attributes.preferred_treatment}, ยอดสะสม ${money(customer.total_spent)}`);
    }

    const dashboard = await client.callTool('cdp_get_segments_dashboard');
    const segments = [...dashboard.realtime_segments, ...dashboard.static_segments]
      .filter((segment) => segment.alias?.startsWith('clinic-'));
    console.log('\nกลุ่มลูกค้า:');
    for (const segment of segments) {
      console.log(`• ${segment.name} (${segment.alias}) — ${segment.member_count} คน [${segment.segment_type}]`);
    }

    const campaignsResult = await client.callTool('cdp_list_campaigns');
    const campaigns = campaignsResult.campaigns.filter((campaign) => campaign.alias?.startsWith('clinic-'));
    console.log('\nแคมเปญ 7 ช่องทาง:');
    for (const campaign of campaigns) {
      console.log(`• ${campaign.channel}: ${campaign.name} — ประมวลผล ${campaign.metrics.total_processed}, เปิด ${campaign.metrics.opened}, คลิก ${campaign.metrics.clicked}, Conversion ${campaign.metrics.converted}`);
    }

    const events = await client.callTool('cdp_list_events', { event_category: DEMO_SOURCE, limit: 5 });
    console.log(`\nตัวอย่าง Events (${events.total} รายการ):`);
    for (const event of events.events) {
      console.log(`• ${event.event_name} — ${event.customer_id || event.anonymous_id} — ${event.timestamp}`);
    }

    for (const alias of ['pimchanok-vip', 'preeyaporn-missed', 'methavee-lead']) {
      const profile = await client.callTool('cdp_get_customer_profile', { identifier: alias });
      const patient = profile.profile;
      console.log(`\nโปรไฟล์ ${patient.first_name} ${patient.last_name} (${alias}):`);
      console.log(`• สถานะ ${patient.lifecycle_stage} | สมาชิก ${patient.tier} | ยอดสะสม ${money(patient.total_spent)}`);
      console.log(`• ประเด็นที่สนใจ ${patient.custom_attributes.primary_concern} | บริการ ${patient.custom_attributes.preferred_treatment}`);
      console.log(`• กิจกรรมล่าสุด ${profile.recent_timeline.length} รายการ | ความยินยอม LINE: ${profile.consents.line || 'ยังไม่ระบุ'}`);
    }

    const journeysResult = await client.callTool('cdp_list_journeys');
    const journeys = journeysResult.journeys.filter((journey) => journey.alias?.startsWith('clinic-'));
    console.log('\nCustomer Journeys:');
    for (const journey of journeys) {
      console.log(`• ${journey.name} (${journey.alias}) — เข้าร่วม ${journey.summary.total_enrolled}, Conversion ${journey.summary.converted}`);
      for (const step of journey.step_funnel) {
        console.log(`  - ${step.step_name}: ทำงาน ${step.metrics.executions} ครั้ง`);
      }
    }

    console.log('\nรันซ้ำได้เพื่อสร้างชุดข้อมูลใหม่ หรือลบด้วย: npm run demo -- --delete');
  } finally {
    client.close();
  }
}

runDemo().catch((error) => {
  console.error('Demo Error:', error.message);
  process.exitCode = 1;
});

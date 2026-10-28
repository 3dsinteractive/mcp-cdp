import { getDb } from '../db.js';
import { importCustomers } from './customerService.js';
import { trackEvent, ingestTrackingPayload } from './eventService.js';
import { createSegment } from './segmentService.js';
import { upsertCampaign, executeCampaign, recordCampaignResponse } from './campaignService.js';
import { upsertJourney, runJourney } from './journeyService.js';

const PREFIX = 'demo_beauty_';
const SOURCE = 'demo_beauty_clinic';
const CAMPAIGN_PREFIX = `${PREFIX}campaign_`;
const SEGMENT_PREFIX = `${PREFIX}segment_`;
const JOURNEY_PREFIX = `${PREFIX}journey_`;

// Synthetic people and reserved example.com addresses. No real patient data is included.
const PATIENTS = [
  ['พิมพ์ชนก', 'วัฒนกุล', 'pimchanok-vip', 'platinum', 'Siam', 'acne', 'laser', 'line', 92000, 8, 'vip'],
  ['สุดา', 'ศิริสุข', 'suda-glow', 'gold', 'Thonglor', 'aging', 'botox', 'instagram', 58000, 5, 'vip'],
  ['ณิชา', 'พรประเสริฐ', 'nicha-skin', 'gold', 'Siam', 'pigmentation', 'picosecond', 'google', 47000, 4, 'customer'],
  ['กมลชนก', 'ใจดี', 'kamonchanok-care', 'platinum', 'Ari', 'acne', 'facial', 'line', 78000, 7, 'vip'],
  ['ธนภัทร', 'ภักดี', 'thanaphat-laser', 'gold', 'Thonglor', 'body', 'laser', 'facebook', 51000, 5, 'customer'],
  ['ชญานิศ', 'รัตนชัย', 'chayanit-lift', 'silver', 'Siam', 'aging', 'hifu', 'google', 26000, 3, 'customer'],
  ['อรอุมา', 'แสงทอง', 'onuma-facial', 'gold', 'Ari', 'acne', 'facial', 'line', 39000, 4, 'customer'],
  ['ปวริศ', 'กิตติชัย', 'pawarit-skin', 'silver', 'Thonglor', 'pigmentation', 'picosecond', 'instagram', 23000, 2, 'customer'],
  ['ศศิธร', 'บุญช่วย', 'sasithorn-vip', 'platinum', 'Siam', 'aging', 'botox', 'referral', 105000, 9, 'vip'],
  ['พิชญา', 'สุวรรณ', 'pitchaya-laser', 'silver', 'Ari', 'body', 'laser', 'facebook', 18000, 2, 'customer'],
  ['ณัฐกานต์', 'ประยูร', 'nattakan-glow', 'gold', 'Siam', 'pigmentation', 'facial', 'line', 43000, 4, 'customer'],
  ['ปกรณ์', 'มีสุข', 'pakorn-hifu', 'silver', 'Thonglor', 'aging', 'hifu', 'google', 21000, 2, 'customer'],
  ['วรัญญา', 'ศรีสวัสดิ์', 'waranya-acne', 'standard', 'Ari', 'acne', 'facial', 'instagram', 6900, 1, 'customer'],
  ['กุลธิดา', 'เดชดี', 'kunthida-pico', 'standard', 'Siam', 'pigmentation', 'picosecond', 'facebook', 8900, 1, 'customer'],
  ['ปรียาภรณ์', 'สุขสันต์', 'preeyaporn-missed', 'standard', 'Thonglor', 'acne', 'facial', 'line', 0, 0, 'prospect'],
  ['ชุติมา', 'วัฒนะ', 'chutima-missed', 'standard', 'Ari', 'aging', 'botox', 'instagram', 0, 0, 'prospect'],
  ['สิรินทร์', 'จันทร์ดี', 'sirintorn-missed', 'standard', 'Siam', 'pigmentation', 'picosecond', 'facebook', 0, 0, 'prospect'],
  ['ภาคิน', 'รุ่งเรือง', 'phakhin-missed', 'standard', 'Thonglor', 'body', 'laser', 'google', 0, 0, 'prospect'],
  ['อริสา', 'นาคทอง', 'arisa-lead', 'standard', 'Ari', 'acne', 'facial', 'instagram', 0, 0, 'lead'],
  ['เบญจพร', 'อภิรักษ์', 'benjaporn-lead', 'standard', 'Siam', 'aging', 'hifu', 'facebook', 0, 0, 'lead'],
  ['เมธาวี', 'ชัยวัฒน์', 'methavee-lead', 'standard', 'Thonglor', 'acne', 'laser', 'google', 0, 0, 'lead'],
  ['รวิสรา', 'อินทร์แก้ว', 'rawisara-lead', 'standard', 'Ari', 'pigmentation', 'picosecond', 'line', 0, 0, 'lead'],
  ['พัชรินทร์', 'แก้วใส', 'patcharin-lead', 'standard', 'Siam', 'acne', 'facial', 'instagram', 0, 0, 'lead'],
  ['ธัญชนก', 'วิไล', 'thanyachanok-lead', 'standard', 'Thonglor', 'aging', 'botox', 'facebook', 0, 0, 'lead']
];

const customerId = (index) => `${PREFIX}customer_${String(index + 1).padStart(2, '0')}`;
const CUSTOMER_IDS = PATIENTS.map((_, index) => customerId(index));
const segmentId = (key) => `${SEGMENT_PREFIX}${key}`;
const campaignId = (key) => `${CAMPAIGN_PREFIX}${key}`;
const journeyId = (key) => `${JOURNEY_PREFIX}${key}`;
const SEGMENT_IDS = ['vip', 'acne_leads', 'laser_interest', 'post_care', 'no_show', 'high_value', 'birthday'].map(segmentId);
const CAMPAIGN_IDS = ['welcome_email', 'no_show_line', 'reminder_sms', 'laser_messenger', 'aftercare_whatsapp', 'vip_app_push', 'birthday_web_push'].map(campaignId);
const JOURNEY_IDS = ['lead_nurture', 'no_show_recovery', 'post_treatment'].map(journeyId);
const OWNED_DESCRIPTION = `${SOURCE}: synthetic example data`;
const daysAgo = (days) => new Date(Date.now() - days * 86400000).toISOString();

function inClause(items) {
  return items.map(() => '?').join(', ');
}

function assertNoOwnedIdCollisions(db) {
  const customer = db.prepare(`
    SELECT id FROM customers WHERE id IN (${inClause(CUSTOMER_IDS)}) AND coalesce(source, '') <> ? LIMIT 1
  `).get(...CUSTOMER_IDS, SOURCE);
  if (customer) throw new Error(`Demo ID conflicts with existing customer '${customer.id}'`);
  for (const [table, ids] of [
    ['segments', SEGMENT_IDS], ['campaigns', CAMPAIGN_IDS], ['journeys', JOURNEY_IDS]
  ]) {
    const row = db.prepare(`
      SELECT id FROM ${table} WHERE id IN (${inClause(ids)}) AND coalesce(description, '') <> ? LIMIT 1
    `).get(...ids, OWNED_DESCRIPTION);
    if (row) throw new Error(`Demo ID conflicts with existing ${table} record '${row.id}'`);
  }
}

function deleteDemoRows(db) {
  assertNoOwnedIdCollisions(db);
  const placeholders = inClause(CUSTOMER_IDS);
  const events = db.prepare(`
    DELETE FROM events
    WHERE event_category = ? OR customer_id IN (${placeholders}) OR anonymous_id LIKE ?
  `).run(SOURCE, ...CUSTOMER_IDS, `${PREFIX}anon_%`).changes;
  const journeys = db.prepare(`DELETE FROM journeys WHERE id IN (${inClause(JOURNEY_IDS)}) AND description = ?`).run(...JOURNEY_IDS, OWNED_DESCRIPTION).changes;
  const campaigns = db.prepare(`DELETE FROM campaigns WHERE id IN (${inClause(CAMPAIGN_IDS)}) AND description = ?`).run(...CAMPAIGN_IDS, OWNED_DESCRIPTION).changes;
  const segments = db.prepare(`DELETE FROM segments WHERE id IN (${inClause(SEGMENT_IDS)}) AND description = ?`).run(...SEGMENT_IDS, OWNED_DESCRIPTION).changes;
  const customers = db.prepare(`DELETE FROM customers WHERE id IN (${placeholders}) AND source = ?`).run(...CUSTOMER_IDS, SOURCE).changes;
  return { customers, events, segments, campaigns, journeys };
}

export function deleteBeautyClinicDemo() {
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    const deleted = deleteDemoRows(db);
    db.exec('COMMIT');
    return { dataset: SOURCE, deleted };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function buildCustomers() {
  const birthMonth = new Date().getUTCMonth() + 1;
  return PATIENTS.map((person, index) => {
    const [first_name, last_name, alias, tier, branch, concern, treatment, acquisition, spent, visits, stage] = person;
    const month = index < 4 ? birthMonth : (index % 12) + 1;
    return {
      id: customerId(index),
      alias,
      external_id: `DEMO-CLINIC-${String(index + 1).padStart(3, '0')}`,
      first_name,
      last_name,
      email: `${alias}@clinic.example`,
      phone: `000000${String(index + 1).padStart(4, '0')}`,
      city: 'Bangkok',
      country: 'TH',
      birth_date: `${1985 + (index % 15)}-${String(month).padStart(2, '0')}-${String(5 + (index % 20)).padStart(2, '0')}`,
      line_uid: index % 5 === 0 ? null : `demo-line-${alias}`,
      fb_psid: index % 3 === 0 ? `demo-fb-${alias}` : null,
      whatsapp_id: index % 4 === 0 ? `demo-wa-${alias}` : null,
      app_push_token: index % 3 === 0 ? `demo-app-${alias}` : null,
      web_push_subscription: index % 5 === 0 ? { endpoint: `https://push.example/${alias}` } : null,
      lifecycle_stage: stage,
      tier,
      total_spent: spent,
      order_count: visits,
      tags: [SOURCE, concern, treatment, branch.toLowerCase()],
      custom_attributes: {
        clinic_branch: branch,
        primary_concern: concern,
        preferred_treatment: treatment,
        acquisition_source: acquisition,
        preferred_contact_time: index % 2 === 0 ? 'evening' : 'lunchtime',
        assigned_consultant: ['คุณแอน', 'คุณมุก', 'คุณฝน'][index % 3]
      },
      consents: {
        marketing: index % 7 !== 0,
        email: index % 6 !== 0,
        line: index % 5 !== 0,
        sms: index % 4 !== 0,
        facebook_messenger: index % 3 !== 0,
        whatsapp: index % 4 === 0,
        app_push: index % 3 === 0,
        web_push: index % 5 === 0
      },
      first_seen_at: daysAgo(180 - index * 5),
      last_seen_at: daysAgo(index % 20),
      source: SOURCE
    };
  });
}

function addEvents() {
  for (let index = 0; index < PATIENTS.length; index++) {
    const [, , , , branch, concern, treatment, acquisition] = PATIENTS[index];
    const common = {
      customer_id: customerId(index),
      event_category: SOURCE,
      channel: 'web',
      properties: { clinic_branch: branch, treatment, concern }
    };
    const base = `${PREFIX}event_${String(index + 1).padStart(2, '0')}`;
    trackEvent({
      ...common, id: `${base}_page`, event_name: 'page_view',
      page_url: `https://clinic.example/services/${treatment}?utm_source=${acquisition}&utm_medium=organic&utm_campaign=clinic_consultation`,
      page_title: `บริการ ${treatment} | คลินิกตัวอย่าง`,
      timestamp: daysAgo(34 - (index % 8))
    });
    trackEvent({
      ...common, id: `${base}_pricing`, event_name: 'service_view',
      page_url: `https://clinic.example/services/${treatment}/pricing`,
      timestamp: daysAgo(29 - (index % 8))
    });
    if (index < 20) {
      trackEvent({
        ...common, id: `${base}_booked`, event_name: 'consultation_booked',
        channel: 'clinic', timestamp: daysAgo(22 - (index % 6)),
        properties: { ...common.properties, appointment_id: `DEMO-APT-${index + 1}`, consultant: ['คุณแอน', 'คุณมุก', 'คุณฝน'][index % 3] }
      });
    }
    if (index < 14) {
      trackEvent({ ...common, id: `${base}_attended`, event_name: 'appointment_attended', channel: 'clinic', timestamp: daysAgo(15 - (index % 5)) });
      trackEvent({ ...common, id: `${base}_treatment`, event_name: 'treatment_completed', channel: 'clinic', timestamp: daysAgo(13 - (index % 5)) });
    } else if (index < 18) {
      trackEvent({ ...common, id: `${base}_no_show`, event_name: 'appointment_no_show', channel: 'clinic', timestamp: daysAgo(10 - (index % 4)) });
    }
    if (index < 11) {
      const price = [7900, 12500, 15900, 4900, 9900, 18900][index % 6];
      trackEvent({
        ...common, id: `${base}_purchase`, event_name: 'purchase', channel: 'clinic',
        revenue: price, timestamp: daysAgo(11 - (index % 5)),
        properties: { ...common.properties, order_id: `DEMO-RCPT-${index + 1}`, package_name: `${treatment} consultation package` }
      });
    }
    if (index < 9) {
      trackEvent({ ...common, id: `${base}_followup`, event_name: 'followup_due', channel: 'clinic', timestamp: daysAgo(2) });
    }
  }

  // Two anonymous visitors later identify themselves through a consultation form.
  for (const index of [20, 21]) {
    const anonymous_id = `${PREFIX}anon_${index + 1}`;
    ingestTrackingPayload({
      anonymous_id, event_name: 'page_view', event_category: SOURCE,
      page_url: 'https://clinic.example/consultation?utm_source=instagram&utm_medium=social',
      timestamp: daysAgo(4)
    });
    ingestTrackingPayload({
      anonymous_id, customer_id: customerId(index), event_name: 'consultation_form_submitted',
      event_category: SOURCE, page_url: 'https://clinic.example/consultation/thank-you',
      timestamp: daysAgo(3), properties: { clinic_branch: PATIENTS[index][4] }
    });
  }
}

function addSegments() {
  const scoped = { field: 'source', operator: 'eq', value: SOURCE };
  const definitions = [
    ['vip', 'clinic-vip', 'สมาชิก VIP ที่มีประวัติรับบริการ', 'realtime', { customer_attributes: [scoped, { field: 'tier', operator: 'in', value: ['gold', 'platinum'] }] }],
    ['acne_leads', 'clinic-acne-leads', 'ผู้สนใจปรึกษาปัญหาสิว', 'realtime', { customer_attributes: [scoped, { field: 'lifecycle_stage', operator: 'eq', value: 'lead' }, { field: 'custom_attributes.primary_concern', operator: 'eq', value: 'acne' }] }],
    ['laser_interest', 'clinic-laser-interest', 'ผู้เข้าชมบริการเลเซอร์', 'realtime', { customer_attributes: [scoped], url_conditions: [{ url_pattern: '/services/laser', min_visits: 1, within_days: 60 }] }],
    ['post_care', 'clinic-post-care', 'ผู้รับบริการที่ถึงรอบติดตามผล', 'realtime', { customer_attributes: [scoped], event_conditions: [{ event_name: 'followup_due', min_count: 1, within_days: 60 }] }],
    ['no_show', 'clinic-no-show', 'ผู้จองที่ไม่ได้มาตามนัด', 'realtime', { customer_attributes: [scoped], event_conditions: [{ event_name: 'appointment_no_show', min_count: 1, within_days: 60 }] }],
    ['high_value', 'clinic-high-value', 'ลูกค้ามูลค่าสูง', 'realtime', { customer_attributes: [scoped], analytics_conditions: [{ metric: 'total_spent', operator: 'gte', value: 50000 }] }],
    ['birthday', 'clinic-birthday', 'ลูกค้าที่เกิดเดือนนี้', 'static', { customer_attributes: [scoped], date_conditions: { birth_month: new Date().getUTCMonth() + 1 } }]
  ];
  for (const [key, alias, name, segment_type, criteria] of definitions) {
    createSegment({ id: segmentId(key), alias, name, description: OWNED_DESCRIPTION, segment_type, criteria });
  }
}

function addCampaigns() {
  const definitions = [
    ['welcome_email', 'clinic-welcome-email', 'อีเมลชวนปรึกษาปัญหาสิว', 'email', 'acne_leads', { subject: 'คุณ {{first_name}} ปรึกษาปัญหาผิวกับคลินิกได้', text_body: 'ทีมผู้เชี่ยวชาญพร้อมดูแลและประเมินผิวของคุณโดยไม่เสียค่าใช้จ่าย' }],
    ['no_show_line', 'clinic-no-show-line', 'LINE ติดตามผู้พลาดนัด', 'line', 'no_show', { text: 'สวัสดีคุณ {{first_name}} หากต้องการเลื่อนนัดปรึกษา สามารถตอบกลับเพื่อเลือกวันใหม่ได้ค่ะ' }],
    ['reminder_sms', 'clinic-reminder-sms', 'SMS เตือนนัดหมาย', 'sms', 'no_show', { text: 'คุณ {{first_name}} หากต้องการนัดหมายใหม่ กรุณาติดต่อคลินิกตัวอย่าง' }],
    ['laser_messenger', 'clinic-laser-messenger', 'Messenger ให้ข้อมูลเลเซอร์', 'facebook_messenger', 'laser_interest', { text: 'คุณ {{first_name}} สนใจปรึกษาเรื่องเลเซอร์กับทีมคลินิกไหมคะ' }],
    ['aftercare_whatsapp', 'clinic-aftercare-wa', 'WhatsApp ติดตามหลังรับบริการ', 'whatsapp', 'post_care', { body_text: 'สวัสดีคุณ {{first_name}} หลังรับบริการเป็นอย่างไรบ้าง หากมีคำถามทีมคลินิกยินดีช่วยค่ะ' }],
    ['vip_app_push', 'clinic-vip-app', 'App Push นัดดูแลผิว VIP', 'app_push', 'vip', { title: 'ถึงเวลานัดดูแลผิวแล้ว', body: 'คุณ {{first_name}} เลือกเวลาที่สะดวกสำหรับติดตามผลได้ในแอป', deep_link: 'clinicapp://appointments' }],
    ['birthday_web_push', 'clinic-birthday-web', 'Web Push วันเกิด', 'web_push', 'birthday', { title: 'สุขสันต์เดือนเกิดคุณ {{first_name}}', body: 'ดูสิทธิพิเศษสำหรับสมาชิกในเดือนนี้', target_url: 'https://clinic.example/member/birthday' }]
  ];
  for (const [key, alias, name, channel, segmentKey, message_config] of definitions) {
    upsertCampaign({
      id: campaignId(key), alias, name, description: OWNED_DESCRIPTION, channel, segment_id: segmentId(segmentKey),
      message_config, require_consent: true,
      utm_config: { utm_source: 'cdp', utm_medium: channel, utm_campaign: alias }
    });
  }

  executeCampaign({ campaign_id: campaignId('welcome_email') });
  executeCampaign({ campaign_id: campaignId('no_show_line') });
  executeCampaign({ campaign_id: campaignId('vip_app_push') });
  recordCampaignResponse({ campaign_id: campaignId('no_show_line'), customer_id: customerId(14), action: 'clicked' });
  recordCampaignResponse({ campaign_id: campaignId('welcome_email'), customer_id: customerId(20), action: 'converted', conversion_value: 3900 });
}

function addJourneys() {
  const definitions = [
    {
      id: journeyId('lead_nurture'), alias: 'clinic-lead-nurture', name: 'ติดตามผู้สนใจปรึกษาปัญหาสิว',
      trigger_type: 'segment', trigger_config: { segment_id: segmentId('acne_leads') },
      steps: [
        { id: 'welcome', name: 'ส่งอีเมลแนะนำการปรึกษา', type: 'send_campaign', campaign_id: campaignId('welcome_email'), next_step_id: 'wait' },
        { id: 'wait', name: 'รอ 24 ชั่วโมง', type: 'wait', wait_hours: 24, next_step_id: 'booked' },
        { id: 'booked', name: 'ลูกค้าจองคิวแล้วหรือยัง', type: 'condition_split', criteria: { event_conditions: [{ event_name: 'consultation_booked', min_count: 1 }] }, on_true_step_id: 'confirm', on_false_step_id: 'remind' },
        { id: 'confirm', name: 'ติดแท็กจองแล้ว', type: 'update_profile', add_tags: ['consultation_booked'], next_step_id: null },
        { id: 'remind', name: 'ส่งข้อความเตือน', type: 'send_campaign', campaign_id: campaignId('reminder_sms'), next_step_id: null }
      ],
      goal_config: { criteria: { event_conditions: [{ event_name: 'consultation_booked', min_count: 1 }] }, conversion_value: 0 }
    },
    {
      id: journeyId('no_show_recovery'), alias: 'clinic-no-show-recovery', name: 'ติดตามลูกค้าที่พลาดนัด',
      trigger_type: 'segment', trigger_config: { segment_id: segmentId('no_show') },
      steps: [
        { id: 'line', name: 'ส่ง LINE ชวนเลื่อนนัด', type: 'send_campaign', campaign_id: campaignId('no_show_line'), next_step_id: 'wait' },
        { id: 'wait', name: 'รอ 48 ชั่วโมง', type: 'wait', wait_hours: 48, next_step_id: 'clicked' },
        { id: 'clicked', name: 'ลูกค้าคลิกข้อความหรือไม่', type: 'condition_split', criteria: { campaign_response_conditions: [{ campaign_id: campaignId('no_show_line'), status: 'clicked' }] }, on_true_step_id: 'interested', on_false_step_id: 'sms' },
        { id: 'interested', name: 'ติดแท็กขอนัดใหม่', type: 'update_profile', add_tags: ['reschedule_interest'], next_step_id: null },
        { id: 'sms', name: 'ส่ง SMS ติดตาม', type: 'send_campaign', campaign_id: campaignId('reminder_sms'), next_step_id: null }
      ],
      goal_config: { criteria: { campaign_response_conditions: [{ campaign_id: campaignId('no_show_line'), status: 'clicked' }] }, conversion_value: 0 }
    },
    {
      id: journeyId('post_treatment'), alias: 'clinic-post-treatment', name: 'ดูแลหลังรับบริการ',
      trigger_type: 'segment', trigger_config: { segment_id: segmentId('post_care') },
      steps: [
        { id: 'checkin', name: 'สอบถามอาการหลังบริการ', type: 'send_campaign', campaign_id: campaignId('aftercare_whatsapp'), next_step_id: 'wait' },
        { id: 'wait', name: 'รอ 7 วัน', type: 'wait', wait_days: 7, next_step_id: 'purchase' },
        { id: 'purchase', name: 'มีการซื้อบริการเพิ่มหรือไม่', type: 'condition_split', criteria: { event_conditions: [{ event_name: 'purchase', min_count: 1, within_days: 10 }] }, on_true_step_id: 'loyal', on_false_step_id: 'app' },
        { id: 'loyal', name: 'ติดแท็กลูกค้ากลับมา', type: 'update_profile', add_tags: ['returning_patient'], next_step_id: null },
        { id: 'app', name: 'แจ้งเตือนติดตามผลในแอป', type: 'send_campaign', campaign_id: campaignId('vip_app_push'), next_step_id: null }
      ],
      goal_config: { criteria: { event_conditions: [{ event_name: 'purchase', min_count: 1, within_days: 30 }] }, conversion_value: 0 }
    }
  ];
  for (const definition of definitions) {
    upsertJourney({ ...definition, description: OWNED_DESCRIPTION });
    runJourney({ journey_id: definition.id, advance_waiting: true });
  }
}

function countDemoRows(db) {
  const customers = db.prepare('SELECT COUNT(*) AS count FROM customers WHERE source = ? AND id LIKE ?').get(SOURCE, `${PREFIX}customer_%`).count;
  const events = db.prepare('SELECT COUNT(*) AS count FROM events WHERE event_category = ?').get(SOURCE).count;
  const segments = db.prepare(`SELECT COUNT(*) AS count FROM segments WHERE id IN (${inClause(SEGMENT_IDS)})`).get(...SEGMENT_IDS).count;
  const campaigns = db.prepare(`SELECT COUNT(*) AS count FROM campaigns WHERE id IN (${inClause(CAMPAIGN_IDS)})`).get(...CAMPAIGN_IDS).count;
  const journeys = db.prepare(`SELECT COUNT(*) AS count FROM journeys WHERE id IN (${inClause(JOURNEY_IDS)})`).get(...JOURNEY_IDS).count;
  const campaign_logs = db.prepare(`SELECT COUNT(*) AS count FROM campaign_logs WHERE campaign_id IN (${inClause(CAMPAIGN_IDS)})`).get(...CAMPAIGN_IDS).count;
  const journey_enrollments = db.prepare(`SELECT COUNT(*) AS count FROM journey_enrollments WHERE journey_id IN (${inClause(JOURNEY_IDS)})`).get(...JOURNEY_IDS).count;
  return { customers, events, segments, campaigns, journeys, campaign_logs, journey_enrollments };
}

export function createBeautyClinicDemo() {
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    const replaced = deleteDemoRows(db);
    const customers = buildCustomers();
    for (const customer of customers) {
      const collision = db.prepare('SELECT id FROM customers WHERE external_id = ? OR email = ?').get(customer.external_id, customer.email);
      if (collision) throw new Error(`Demo customer address conflicts with existing customer '${collision.id}'`);
    }
    const imported = importCustomers({ customers, source: SOURCE });
    if (imported.failed) throw new Error(`Demo customer import failed: ${JSON.stringify(imported.errors)}`);
    addEvents();
    addSegments();
    addCampaigns();
    addJourneys();
    const counts = countDemoRows(db);
    db.exec('COMMIT');
    return {
      dataset: SOURCE,
      description: 'ชุดข้อมูลจำลองคลินิกเสริมความงามในกรุงเทพฯ (ข้อมูลสังเคราะห์)',
      counts,
      replaced_previous: replaced,
      sample_aliases: {
        customer: 'pimchanok-vip',
        segment: 'clinic-vip',
        campaign: 'clinic-no-show-line',
        journey: 'clinic-no-show-recovery'
      }
    };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

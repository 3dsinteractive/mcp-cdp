import crypto from 'node:crypto';
import { getDb, safeJsonParse } from '../db.js';
import { formatCustomerRow, getCustomerConsents } from './customerService.js';
import { getSegmentDetails } from './segmentService.js';

function genId(prefix = 'cmp') {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

export const SUPPORTED_CHANNELS = [
  'email',
  'line',
  'facebook_messenger',
  'sms',
  'whatsapp',
  'app_push',
  'web_push'
];

export const CHANNEL_TEMPLATE_SCHEMAS = {
  email: {
    required_fields: ['subject'],
    optional_fields: ['preheader', 'sender_name', 'sender_email', 'html_body', 'text_body', 'cta_url', 'reply_to'],
    recipient_field: 'email',
    example: {
      subject: 'สวัสดีคุณ {{first_name}}! รับสิทธิพิเศษระดับ {{tier}}',
      preheader: 'ข้อเสนอพิเศษเฉพาะคุณวันนี้',
      sender_name: 'Brand CRM',
      sender_email: 'noreply@example.com',
      html_body: '<h1>สวัสดีคุณ {{first_name}}</h1><p>คลิกเพื่อรับสิทธิ์ของคุณ</p>',
      text_body: 'สวัสดีคุณ {{first_name}} คลิกเพื่อรับสิทธิ์ของคุณ',
      cta_url: 'https://example.com/promo'
    }
  },
  line: {
    required_fields: ['text'],
    optional_fields: ['message_type', 'alt_text', 'flex_contents', 'quick_replies', 'image_url', 'link_url'],
    recipient_field: 'line_uid',
    example: {
      message_type: 'flex',
      alt_text: 'สิทธิพิเศษสำหรับคุณ {{first_name}}',
      text: 'สวัสดีค่ะคุณ {{first_name}} สมาชิกระดับ {{tier}} รับคูปองส่วนลดทันที!',
      flex_contents: { type: 'bubble', body: { type: 'box', layout: 'vertical', contents: [] } },
      quick_replies: [{ label: 'รับคูปอง', action: 'https://example.com/line-coupon' }]
    }
  },
  facebook_messenger: {
    required_fields: ['text'],
    optional_fields: ['messaging_type', 'tag', 'buttons', 'quick_replies', 'image_url'],
    recipient_field: 'fb_psid',
    example: {
      messaging_type: 'MESSAGE_TAG',
      tag: 'CONFIRMED_EVENT_UPDATE',
      text: 'สวัสดีครับคุณ {{first_name}} มีอัปเดตโปรโมชันใหม่สำหรับคุณ!',
      buttons: [{ type: 'web_url', title: 'ดูรายละเอียด', url: 'https://example.com/fb-offer' }]
    }
  },
  sms: {
    required_fields: ['text'],
    optional_fields: ['sender_id', 'short_link'],
    recipient_field: 'phone',
    example: {
      sender_id: 'BRANDCRM',
      text: 'คุณ {{first_name}} รับส่วนลด 20% สำหรับสมาชิก {{tier}} คลิก https://ex.co/sms'
    }
  },
  whatsapp: {
    required_fields: ['body_text'],
    optional_fields: ['message_type', 'template_name', 'language_code', 'header_text', 'footer_text', 'buttons'],
    recipient_field: 'whatsapp_id',
    example: {
      message_type: 'template',
      template_name: 'vip_promo_th',
      language_code: 'th',
      header_text: 'สิทธิพิเศษสำหรับคุณ {{first_name}}',
      body_text: 'สวัสดีคุณ {{first_name}} คุณได้รับสิทธิ์ส่วนลดพิเศษในฐานะสมาชิก {{tier}}',
      buttons: [{ type: 'url', text: 'ใช้สิทธิ์เลย', url: 'https://example.com/wa' }]
    }
  },
  app_push: {
    required_fields: ['title', 'body'],
    optional_fields: ['subtitle', 'deep_link', 'image_url', 'sound', 'badge', 'custom_data'],
    recipient_field: 'app_push_token',
    example: {
      title: 'ดีลพิเศษสำหรับคุณ {{first_name}}!',
      body: 'เปิดแอปตอนนี้เพื่อรับคูปองส่วนลดระดับ {{tier}}',
      deep_link: 'myapp://promotions/vip',
      sound: 'default',
      badge: 1
    }
  },
  web_push: {
    required_fields: ['title', 'body'],
    optional_fields: ['icon_url', 'image_url', 'target_url', 'actions'],
    recipient_field: 'web_push_subscription',
    example: {
      title: 'กลับมาดูสินค้าที่คุณสนใจสิ คุณ {{first_name}}!',
      body: 'รับส่วนลดเพิ่มทันทีเมื่อสั่งซื้อวันนี้',
      icon_url: 'https://example.com/icon.png',
      target_url: 'https://example.com/cart',
      actions: [{ action: 'open_cart', title: 'ไปที่ตะกร้า' }]
    }
  }
};

/**
 * Interpolate template variables like {{first_name}}, {{tier}}, {{custom_attributes.favorite_category}}
 */
export function renderPersonalization(templateObj, customer, utmConfig = {}) {
  const replaceStr = (str) => {
    if (typeof str !== 'string') return str;
    return str.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, keyPath) => {
      if (keyPath.startsWith('custom_attributes.')) {
        const subKey = keyPath.slice('custom_attributes.'.length);
        return customer.custom_attributes?.[subKey] ?? '';
      }
      if (customer[keyPath] !== undefined && customer[keyPath] !== null) {
        return String(customer[keyPath]);
      }
      if (customer.custom_attributes?.[keyPath] !== undefined) {
        return String(customer.custom_attributes[keyPath]);
      }
      return '';
    });
  };

  const walk = (val) => {
    if (typeof val === 'string') return replaceStr(val);
    if (Array.isArray(val)) return val.map(walk);
    if (val && typeof val === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(val)) {
        out[k] = walk(v);
      }
      return out;
    }
    return val;
  };

  const rendered = walk(templateObj);
  if (utmConfig && Object.keys(utmConfig).length > 0) {
    rendered._tracking_utm = utmConfig;
  }
  return rendered;
}

/**
 * Resolve recipient address for a customer on a given channel
 */
export function getRecipientAddressForChannel(customer, channel) {
  switch (channel) {
    case 'email':
      return customer.email || null;
    case 'line':
      return customer.line_uid || null;
    case 'facebook_messenger':
      return customer.fb_psid || null;
    case 'sms':
      return customer.phone || null;
    case 'whatsapp':
      return customer.whatsapp_id || customer.phone || null;
    case 'app_push':
      return customer.app_push_token || null;
    case 'web_push':
      return customer.web_push_subscription
        ? typeof customer.web_push_subscription === 'string'
          ? customer.web_push_subscription
          : JSON.stringify(customer.web_push_subscription)
        : null;
    default:
      return null;
  }
}

/**
 * Validate message_config for a channel
 */
export function validateChannelMessageConfig(channel, messageConfig = {}) {
  if (!SUPPORTED_CHANNELS.includes(channel)) {
    throw new Error(`Unsupported channel '${channel}'. Supported channels: ${SUPPORTED_CHANNELS.join(', ')}`);
  }
  const schema = CHANNEL_TEMPLATE_SCHEMAS[channel];
  const missing = [];
  for (const reqField of schema.required_fields) {
    if (!messageConfig[reqField] || String(messageConfig[reqField]).trim() === '') {
      missing.push(reqField);
    }
  }
  return {
    valid: missing.length === 0,
    channel,
    missing_required_fields: missing,
    schema
  };
}

/**
 * Create or update a multi-channel Campaign
 */
export function upsertCampaign({
  id,
  alias = null,
  name,
  description = '',
  channel,
  segment_id = null,
  status = 'draft',
  message_config = {},
  utm_config = {},
  require_consent = true,
  scheduled_at = null
}) {
  const validation = validateChannelMessageConfig(channel, message_config);
  if (!validation.valid) {
    throw new Error(
      `Invalid message_config for channel '${channel}'. Missing required fields: ${validation.missing_required_fields.join(', ')}`
    );
  }

  const db = getDb();
  const campId = id || genId('cmp');
  const now = new Date().toISOString();

  const existing = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campId);
  if (existing) {
    db.prepare(`
      UPDATE campaigns
      SET alias = ?, name = ?, description = ?, channel = ?, segment_id = ?, status = ?,
          message_config = ?, utm_config = ?, require_consent = ?, scheduled_at = ?, updated_at = ?
      WHERE id = ?
    `).run(
      alias ?? existing.alias,
      name ?? existing.name,
      description ?? existing.description,
      channel ?? existing.channel,
      segment_id !== undefined ? segment_id : existing.segment_id,
      status ?? existing.status,
      JSON.stringify(message_config),
      JSON.stringify(utm_config),
      require_consent ? 1 : 0,
      scheduled_at ?? existing.scheduled_at,
      now,
      campId
    );
  } else {
    db.prepare(`
      INSERT INTO campaigns (
        id, alias, name, description, channel, segment_id, status,
        message_config, utm_config, require_consent, scheduled_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      campId,
      alias,
      name,
      description,
      channel,
      segment_id,
      status,
      JSON.stringify(message_config),
      JSON.stringify(utm_config),
      require_consent ? 1 : 0,
      scheduled_at,
      now,
      now
    );
  }

  return getCampaignDetails(campId);
}

/**
 * Send a single campaign message to a single customer (used by both Campaign Execution and Journey Steps)
 */
export function sendCampaignToCustomer({
  campaign,
  customer,
  journey_id = null,
  journey_step_id = null
}) {
  const db = getDb();
  const now = new Date().toISOString();
  const channel = campaign.channel;
  const messageConfig = safeJsonParse(campaign.message_config, {});
  const utmConfig = safeJsonParse(campaign.utm_config, {});

  // 1. Check consent if require_consent is enabled
  if (campaign.require_consent) {
    const consents = getCustomerConsents(customer.id).consents_map;
    // Check specific channel consent first, then fallback to 'marketing' consent
    const channelConsent = consents[channel];
    const marketingConsent = consents.marketing;

    if (channelConsent === 'revoked' || (!channelConsent && marketingConsent === 'revoked')) {
      const logId = genId('clog');
      db.prepare(`
        INSERT INTO campaign_logs (
          id, campaign_id, journey_id, journey_step_id, customer_id, channel,
          recipient_address, rendered_message, status, sent_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'skipped_no_consent', ?)
      `).run(logId, campaign.id, journey_id, journey_step_id, customer.id, channel, null, '{}', now);

      return {
        log_id: logId,
        customer_id: customer.id,
        status: 'skipped_no_consent',
        reason: `Customer revoked consent for ${channel} or marketing`
      };
    }
  }

  // 2. Check channel reachability address
  const recipientAddress = getRecipientAddressForChannel(customer, channel);
  if (!recipientAddress) {
    const logId = genId('clog');
    db.prepare(`
      INSERT INTO campaign_logs (
        id, campaign_id, journey_id, journey_step_id, customer_id, channel,
        recipient_address, rendered_message, status, sent_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'failed', ?)
    `).run(
      logId,
      campaign.id,
      journey_id,
      journey_step_id,
      customer.id,
      channel,
      null,
      JSON.stringify({ error: `Missing ${channel} address/token` }),
      now
    );

    return {
      log_id: logId,
      customer_id: customer.id,
      status: 'failed',
      reason: `Customer does not have a valid recipient identifier for channel '${channel}'`
    };
  }

  // 3. Render personalized message
  const renderedMessage = renderPersonalization(messageConfig, customer, utmConfig);
  const logId = genId('clog');

  db.prepare(`
    INSERT INTO campaign_logs (
      id, campaign_id, journey_id, journey_step_id, customer_id, channel,
      recipient_address, rendered_message, status, sent_at, delivered_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'delivered', ?, ?)
  `).run(
    logId,
    campaign.id,
    journey_id,
    journey_step_id,
    customer.id,
    channel,
    recipientAddress,
    JSON.stringify(renderedMessage),
    now,
    now
  );

  return {
    log_id: logId,
    customer_id: customer.id,
    channel,
    recipient_address: recipientAddress,
    status: 'delivered',
    rendered_message: renderedMessage
  };
}

/**
 * Execute a Campaign across its target Segment or an explicit list of customer_ids
 */
export function executeCampaign({ campaign_id, customer_ids = null }) {
  const db = getDb();
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaign_id);
  if (!campaign) {
    throw new Error(`Campaign '${campaign_id}' not found`);
  }

  let targetCustomers = [];
  if (Array.isArray(customer_ids) && customer_ids.length > 0) {
    const placeholders = customer_ids.map(() => '?').join(',');
    const rows = db.prepare(`SELECT * FROM customers WHERE id IN (${placeholders})`).all(...customer_ids);
    targetCustomers = rows.map(formatCustomerRow);
  } else if (campaign.segment_id) {
    const segDetails = getSegmentDetails(campaign.segment_id);
    targetCustomers = segDetails.members;
  } else {
    const rows = db.prepare('SELECT * FROM customers').all();
    targetCustomers = rows.map(formatCustomerRow);
  }

  const results = {
    delivered: 0,
    skipped_no_consent: 0,
    failed: 0,
    deliveries: []
  };

  for (const customer of targetCustomers) {
    const res = sendCampaignToCustomer({ campaign, customer });
    if (res.status === 'delivered') results.delivered++;
    else if (res.status === 'skipped_no_consent') results.skipped_no_consent++;
    else results.failed++;
    results.deliveries.push(res);
  }

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE campaigns SET status = 'completed', executed_at = ?, updated_at = ? WHERE id = ?
  `).run(now, now, campaign_id);

  return {
    campaign_id,
    campaign_name: campaign.name,
    channel: campaign.channel,
    target_count: targetCustomers.length,
    ...results
  };
}

/**
 * Record customer response/interaction with a Campaign (opened, clicked, converted, unsubscribed, bounced)
 */
export function recordCampaignResponse({
  campaign_id,
  customer_id,
  action, // 'opened', 'clicked', 'converted', 'bounced', 'unsubscribed'
  conversion_value = 0,
  metadata = {}
}) {
  const db = getDb();
  const now = new Date().toISOString();

  let log = db.prepare(`
    SELECT * FROM campaign_logs
    WHERE campaign_id = ? AND customer_id = ?
    ORDER BY sent_at DESC LIMIT 1
  `).get(campaign_id, customer_id);

  if (!log) {
    const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaign_id);
    if (!campaign) throw new Error(`Campaign '${campaign_id}' not found`);
    const logId = genId('clog');
    db.prepare(`
      INSERT INTO campaign_logs (
        id, campaign_id, customer_id, channel, status, sent_at, delivered_at
      ) VALUES (?, ?, ?, ?, 'delivered', ?, ?)
    `).run(logId, campaign_id, customer_id, campaign.channel, now, now);
    log = db.prepare('SELECT * FROM campaign_logs WHERE id = ?').get(logId);
  }

  const openedAt = action === 'opened' || action === 'clicked' || action === 'converted' ? log.opened_at || now : log.opened_at;
  const clickedAt = action === 'clicked' || action === 'converted' ? log.clicked_at || now : log.clicked_at;
  const convertedAt = action === 'converted' ? log.converted_at || now : log.converted_at;
  const newVal = action === 'converted' ? Number(conversion_value || 0) : log.conversion_value;

  db.prepare(`
    UPDATE campaign_logs
    SET status = ?,
        opened_at = ?,
        clicked_at = ?,
        converted_at = ?,
        conversion_value = ?,
        interaction_metadata = ?
    WHERE id = ?
  `).run(action, openedAt, clickedAt, convertedAt, newVal, JSON.stringify(metadata), log.id);

  return db.prepare('SELECT * FROM campaign_logs WHERE id = ?').get(log.id);
}

/**
 * Get Campaign Details and Analytics
 */
export function getCampaignDetails(campaign_id) {
  const db = getDb();
  const camp = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaign_id);
  if (!camp) {
    throw new Error(`Campaign '${campaign_id}' not found`);
  }

  const stats = db.prepare(`
    SELECT
      COUNT(*) as total_logs,
      SUM(CASE WHEN status IN ('delivered', 'opened', 'clicked', 'converted') THEN 1 ELSE 0 END) as delivered,
      SUM(CASE WHEN status IN ('opened', 'clicked', 'converted') OR opened_at IS NOT NULL THEN 1 ELSE 0 END) as opened,
      SUM(CASE WHEN status IN ('clicked', 'converted') OR clicked_at IS NOT NULL THEN 1 ELSE 0 END) as clicked,
      SUM(CASE WHEN status = 'converted' OR converted_at IS NOT NULL THEN 1 ELSE 0 END) as converted,
      SUM(CASE WHEN status = 'skipped_no_consent' THEN 1 ELSE 0 END) as skipped_no_consent,
      SUM(CASE WHEN status IN ('failed', 'bounced') THEN 1 ELSE 0 END) as failed_or_bounced,
      SUM(conversion_value) as total_conversion_revenue
    FROM campaign_logs
    WHERE campaign_id = ?
  `).get(campaign_id);

  const delivered = stats.delivered || 0;
  return {
    ...camp,
    require_consent: Boolean(camp.require_consent),
    message_config: safeJsonParse(camp.message_config, {}),
    utm_config: safeJsonParse(camp.utm_config, {}),
    metrics: {
      total_processed: stats.total_logs || 0,
      delivered,
      opened: stats.opened || 0,
      clicked: stats.clicked || 0,
      converted: stats.converted || 0,
      skipped_no_consent: stats.skipped_no_consent || 0,
      failed_or_bounced: stats.failed_or_bounced || 0,
      open_rate_percent: delivered > 0 ? Number(((stats.opened / delivered) * 100).toFixed(1)) : 0,
      click_rate_percent: delivered > 0 ? Number(((stats.clicked / delivered) * 100).toFixed(1)) : 0,
      conversion_rate_percent: delivered > 0 ? Number(((stats.converted / delivered) * 100).toFixed(1)) : 0,
      total_conversion_revenue: Number((stats.total_conversion_revenue || 0).toFixed(2))
    }
  };
}

export function listCampaigns({ channel = null, status = null } = {}) {
  const db = getDb();
  const conds = [];
  const params = [];
  if (channel) {
    conds.push('channel = ?');
    params.push(channel);
  }
  if (status) {
    conds.push('status = ?');
    params.push(status);
  }
  const whereClause = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT id FROM campaigns ${whereClause} ORDER BY created_at DESC`).all(...params);
  return {
    supported_channels: SUPPORTED_CHANNELS,
    total: rows.length,
    campaigns: rows.map((r) => getCampaignDetails(r.id))
  };
}

import { getDb } from './db.js';
import { importCustomers, linkCustomerIdentity, updateCustomerConsent } from './services/customerService.js';
import { trackEvent, ingestTrackingPayload } from './services/eventService.js';
import { createSegment } from './services/segmentService.js';
import { upsertCampaign, executeCampaign, recordCampaignResponse } from './services/campaignService.js';
import { upsertJourney, runJourney } from './services/journeyService.js';

export function seedDatabase() {
  getDb();

  // 1. Import Sample Customers
  const importRes = importCustomers({
    source: 'crm_initial_seed',
    customers: [
      {
        id: 'cust_somchai',
        external_id: 'MEM-1001',
        first_name: 'สมชาย',
        last_name: 'ใจดี',
        email: 'somchai@example.com',
        phone: '0812345678',
        gender: 'male',
        birth_date: '1990-10-15',
        city: 'Bangkok',
        country: 'TH',
        line_uid: 'U_line_somchai_01',
        fb_psid: 'FB_psid_somchai_01',
        whatsapp_id: '66812345678',
        app_push_token: 'fcm_token_somchai_ios',
        web_push_subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/somchai' },
        lifecycle_stage: 'vip',
        tier: 'platinum',
        total_spent: 54000,
        order_count: 11,
        tags: ['vip', 'tech_lover', 'early_adopter'],
        custom_attributes: { favorite_category: 'gadgets', company: 'TechCo Thailand' },
        consents: {
          marketing: true,
          analytics: true,
          email: true,
          line: true,
          sms: true,
          facebook_messenger: true,
          whatsapp: true,
          app_push: true,
          web_push: true
        }
      },
      {
        id: 'cust_suda',
        external_id: 'MEM-1002',
        first_name: 'สุดา',
        last_name: 'รักสวย',
        email: 'suda@example.com',
        phone: '0898765432',
        gender: 'female',
        birth_date: '1995-04-20',
        city: 'Chiang Mai',
        country: 'TH',
        line_uid: 'U_line_suda_02',
        fb_psid: 'FB_psid_suda_02',
        whatsapp_id: '66898765432',
        app_push_token: 'fcm_token_suda_android',
        web_push_subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/suda' },
        lifecycle_stage: 'customer',
        tier: 'gold',
        total_spent: 18500,
        order_count: 5,
        tags: ['beauty', 'line_shopper'],
        custom_attributes: { favorite_category: 'skincare', skin_type: 'sensitive' },
        consents: {
          marketing: true,
          analytics: true,
          email: true,
          line: true,
          sms: false,
          whatsapp: true,
          app_push: true,
          web_push: true
        }
      },
      {
        id: 'cust_ananda',
        external_id: 'MEM-1003',
        first_name: 'อนันดา',
        last_name: 'สายช้อป',
        email: 'ananda@example.com',
        phone: '0861112233',
        gender: 'male',
        birth_date: '1998-10-05',
        city: 'Bangkok',
        country: 'TH',
        line_uid: 'U_line_ananda_03',
        fb_psid: 'FB_psid_ananda_03',
        lifecycle_stage: 'lead',
        tier: 'standard',
        total_spent: 0,
        order_count: 0,
        tags: ['cart_abandoner', 'promo_seeker'],
        custom_attributes: { favorite_category: 'fashion' },
        consents: {
          marketing: true,
          email: true,
          line: true,
          facebook_messenger: true
        }
      }
    ]
  });

  // 2. Link Customers & Anonymous Identities
  linkCustomerIdentity({
    primary_customer_id: 'cust_somchai',
    linked_customer_id: 'cust_suda',
    identity_type: 'household',
    identity_value: 'HH-BKK-099',
    relationship: 'household',
    metadata: { note: 'Family member account link' }
  });

  // 3. Ingest Tracking Script Events & Behavioral Events
  ingestTrackingPayload({
    anonymous_id: 'anon_web_visitor_999',
    session_id: 'sess_101',
    event_name: 'page_view',
    page_url: 'https://shop.example.com/promotions/october-sale?utm_source=facebook&utm_medium=cpc&utm_campaign=oct_mega_sale',
    page_title: 'October Mega Sale',
    referrer: 'https://facebook.com',
    properties: { device: 'mobile' }
  });

  // Stitch anon_web_visitor_999 to cust_ananda when he logs in / fills lead form
  ingestTrackingPayload({
    anonymous_id: 'anon_web_visitor_999',
    customer_id: 'cust_ananda',
    session_id: 'sess_101',
    event_name: 'add_to_cart',
    page_url: 'https://shop.example.com/products/sneakers-pro?utm_source=facebook&utm_medium=cpc&utm_campaign=oct_mega_sale',
    properties: { product_id: 'SKU-900', category: 'fashion', price: 3200 }
  });

  trackEvent({
    customer_id: 'cust_somchai',
    event_name: 'page_view',
    page_url: 'https://shop.example.com/vip-lounge?utm_source=line&utm_medium=oa_richmenu&utm_campaign=vip_exclusive',
    channel: 'web'
  });

  trackEvent({
    customer_id: 'cust_somchai',
    event_name: 'purchase',
    page_url: 'https://shop.example.com/checkout/success',
    utm_source: 'line',
    utm_medium: 'oa_richmenu',
    utm_campaign: 'vip_exclusive',
    revenue: 4500,
    properties: { order_id: 'ORD-2026-881', category: 'gadgets' }
  });

  trackEvent({
    customer_id: 'cust_suda',
    event_name: 'product_view',
    page_url: 'https://shop.example.com/skincare/serum-gold?utm_source=google&utm_medium=organic&utm_campaign=seo_beauty',
    properties: { product_id: 'SKU-201', category: 'skincare' }
  });

  // 4. Create Static & Real-Time Segments
  createSegment({
    id: 'seg_realtime_high_value',
    name: 'VIP & Gold High Spenders (Real-Time)',
    description: 'ลูกค้าที่มียอดซื้อสะสมตั้งแต่ 15,000 บาทขึ้นไป และเข้าชมเว็บภายใน 30 วัน',
    segment_type: 'realtime',
    criteria: {
      match_mode: 'all',
      analytics_conditions: [{ metric: 'total_spent', operator: 'gte', value: 15000 }],
      date_conditions: { active_within_days: 30 }
    }
  });

  createSegment({
    id: 'seg_realtime_fb_utm_cart',
    name: 'Facebook Campaign Cart Abandoners (Real-Time)',
    description: 'ลูกค้าที่มาจาก UTM facebook และกด add_to_cart',
    segment_type: 'realtime',
    criteria: {
      match_mode: 'all',
      utm_conditions: [{ utm_source: 'facebook', min_touches: 1 }],
      event_conditions: [{ event_name: 'add_to_cart', min_count: 1 }]
    }
  });

  createSegment({
    id: 'seg_static_october_birthday',
    name: 'October Birthday Snapshot (Static)',
    description: 'กลุ่มลูกค้าที่เกิดในเดือนตุลาคม (Static Snapshot สำหรับส่งคูปองวันเกิด)',
    segment_type: 'static',
    criteria: {
      match_mode: 'all',
      date_conditions: { birth_month: 10 }
    }
  });

  // 5. Create Campaigns across all 7 Channels
  upsertCampaign({
    id: 'cmp_email_vip',
    name: 'VIP Exclusive Email Offer',
    channel: 'email',
    segment_id: 'seg_realtime_high_value',
    message_config: {
      subject: 'สิทธิพิเศษเฉพาะคุณ {{first_name}} สมาชิกระดับ {{tier}}',
      sender_name: 'CDP Store Thailand',
      sender_email: 'vip@shop.example.com',
      html_body: '<h2>สวัสดีคุณ {{first_name}}</h2><p>รับส่วนลด 1,000 บาทสำหรับหมวด {{custom_attributes.favorite_category}}</p>',
      text_body: 'สวัสดีคุณ {{first_name}} รับส่วนลด 1,000 บาท'
    },
    utm_config: { utm_source: 'cdp', utm_medium: 'email', utm_campaign: 'vip_oct' }
  });

  upsertCampaign({
    id: 'cmp_line_promo',
    name: 'LINE OA Flex Coupon',
    channel: 'line',
    segment_id: 'seg_realtime_high_value',
    message_config: {
      message_type: 'flex',
      alt_text: 'คูปองส่วนลดสำหรับคุณ {{first_name}}',
      text: 'สวัสดีค่ะคุณ {{first_name}} กดรับคูปอง LINE พิเศษสำหรับสมาชิก {{tier}} ได้เลย!'
    }
  });

  upsertCampaign({
    id: 'cmp_fb_retarget',
    name: 'Facebook Messenger Cart Reminder',
    channel: 'facebook_messenger',
    segment_id: 'seg_realtime_fb_utm_cart',
    message_config: {
      messaging_type: 'MESSAGE_TAG',
      tag: 'POST_PURCHASE_UPDATE',
      text: 'คุณ {{first_name}} ลืมสินค้าไว้ในตะกร้าหรือเปล่า? รับโค้ดส่งฟรีวันนี้!'
    }
  });

  upsertCampaign({
    id: 'cmp_sms_flash',
    name: 'SMS Flash Sale Alert',
    channel: 'sms',
    segment_id: 'seg_static_october_birthday',
    message_config: {
      sender_id: 'SHOPCRM',
      text: 'สุขสันต์เดือนเกิดคุณ {{first_name}}! รับส่วนลด 25% ใช้โค้ด BDAY10'
    }
  });

  upsertCampaign({
    id: 'cmp_whatsapp_vip',
    name: 'WhatsApp Personal Concierge',
    channel: 'whatsapp',
    segment_id: 'seg_realtime_high_value',
    message_config: {
      message_type: 'template',
      template_name: 'vip_concierge_th',
      language_code: 'th',
      body_text: 'สวัสดีคุณ {{first_name}} ผู้ช่วยส่วนตัวสำหรับสมาชิก {{tier}} พร้อมดูแลคุณแล้ว'
    }
  });

  upsertCampaign({
    id: 'cmp_app_push_deal',
    name: 'App Push Exclusive Drop',
    channel: 'app_push',
    segment_id: 'seg_realtime_high_value',
    message_config: {
      title: 'สินค้าใหม่มาแล้ว คุณ {{first_name}}!',
      body: 'เปิดแอปเพื่อดูคอลเลกชัน {{custom_attributes.favorite_category}} ก่อนใคร',
      deep_link: 'shopapp://collections/new'
    }
  });

  upsertCampaign({
    id: 'cmp_web_push_nudge',
    name: 'Web Push Price Drop Alert',
    channel: 'web_push',
    segment_id: 'seg_realtime_high_value',
    message_config: {
      title: 'ลดราคาพิเศษสำหรับคุณ {{first_name}}',
      body: 'คลิกเพื่อดูข้อเสนอสุดพิเศษบนเว็บไซต์',
      target_url: 'https://shop.example.com/deals'
    }
  });

  // Execute Email & LINE campaigns and record responses
  executeCampaign({ campaign_id: 'cmp_email_vip' });
  recordCampaignResponse({
    campaign_id: 'cmp_email_vip',
    customer_id: 'cust_somchai',
    action: 'clicked'
  });

  // 6. Create & Run a Multi-Step Customer Journey
  upsertJourney({
    id: 'jrn_vip_onboarding_upsell',
    name: 'VIP Omnichannel Upsell Journey',
    description: 'ส่ง Email ก่อน -> รอ 2 วัน -> เช็กว่าคลิก Email หรือไม่ -> ถ้าคลิกส่ง App Push / ถ้าไม่คลิกส่ง LINE OA',
    status: 'active',
    trigger_type: 'segment',
    trigger_config: { segment_id: 'seg_realtime_high_value' },
    steps: [
      {
        id: 'step_1_email',
        name: 'Send VIP Email',
        type: 'send_campaign',
        campaign_id: 'cmp_email_vip',
        next_step_id: 'step_2_wait'
      },
      {
        id: 'step_2_wait',
        name: 'Wait 48 Hours',
        type: 'wait',
        wait_hours: 48,
        next_step_id: 'step_3_check_click'
      },
      {
        id: 'step_3_check_click',
        name: 'Check if Customer Clicked VIP Email',
        type: 'condition_split',
        criteria: {
          campaign_response_conditions: [
            { campaign_id: 'cmp_email_vip', status: 'clicked' }
          ]
        },
        on_true_step_id: 'step_4a_app_push',
        on_false_step_id: 'step_4b_line_followup'
      },
      {
        id: 'step_4a_app_push',
        name: 'Send App Push Exclusive Drop (Engaged Branch)',
        type: 'send_campaign',
        campaign_id: 'cmp_app_push_deal',
        next_step_id: 'step_5_tag_engaged'
      },
      {
        id: 'step_4b_line_followup',
        name: 'Send LINE Flex Coupon (Re-engagement Branch)',
        type: 'send_campaign',
        campaign_id: 'cmp_line_promo',
        next_step_id: null
      },
      {
        id: 'step_5_tag_engaged',
        name: 'Tag Customer as Omni-Engaged',
        type: 'update_profile',
        add_tags: ['journey_omni_engaged'],
        next_step_id: null
      }
    ],
    goal_config: {
      criteria: {
        event_conditions: [{ event_name: 'purchase', min_count: 1 }]
      },
      conversion_value: 4500
    }
  });

  const journeyRun = runJourney({
    journey_id: 'jrn_vip_onboarding_upsell',
    advance_waiting: true
  });

  return {
    imported_customers: importRes.total_processed,
    journey_run: journeyRun.performance_summary
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const res = seedDatabase();
  console.log('Seed completed successfully:', JSON.stringify(res, null, 2));
}

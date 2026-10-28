import {
  upsertCustomer,
  listCustomers,
  importCustomers,
  linkCustomerIdentity,
  getLinkedCustomers,
  getCustomerDatabaseOverview,
  getCustomer360Profile,
  getCustomerTimeline,
  getCustomerInsights,
  getCustomerConsents,
  updateCustomerConsent
} from './services/customerService.js';

import {
  trackEvent,
  ingestTrackingPayload,
  generateTrackingScript,
  listEvents,
  getEventAnalytics
} from './services/eventService.js';

import {
  createSegment,
  getSegmentDetails,
  getSegmentsDashboard
} from './services/segmentService.js';

import {
  SUPPORTED_CHANNELS,
  CHANNEL_TEMPLATE_SCHEMAS,
  upsertCampaign,
  executeCampaign,
  recordCampaignResponse,
  getCampaignDetails,
  listCampaigns
} from './services/campaignService.js';

import {
  upsertJourney,
  runJourney,
  getJourneyPerformance,
  listJourneys
} from './services/journeyService.js';
import { resolveToolArgs } from './references.js';
import { createBeautyClinicDemo, deleteBeautyClinicDemo } from './services/demoService.js';

export const TOOLS = [
  // ============================================================================
  // 1. จัดการข้อมูลลูกค้า (Customer Management)
  // ============================================================================
  {
    name: 'cdp_list_customers',
    description:
      'ดูรายชื่อลูกค้า (List & search customers) พร้อมตัวกรองตามคำค้นหา, lifecycle_stage, tier, city, country, tag และยอดซื้อขั้นต่ำ',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'ค้นหาจากชื่อ, นามสกุล, alias, อีเมล, เบอร์โทร หรือ external_id' },
        lifecycle_stage: { type: 'string', description: 'เช่น lead, prospect, customer, vip, churned' },
        tier: { type: 'string', description: 'เช่น standard, silver, gold, platinum' },
        city: { type: 'string' },
        country: { type: 'string' },
        tag: { type: 'string', description: 'กรองลูกค้าที่มี tag นี้' },
        min_spent: { type: 'number', description: 'ยอดซื้อสะสมขั้นต่ำ' },
        limit: { type: 'number', default: 50 },
        offset: { type: 'number', default: 0 }
      }
    },
    handler: (args) => listCustomers(args)
  },
  {
    name: 'cdp_upsert_customer',
    description:
      'สร้างหรืออัปเดตข้อมูลลูกค้า (Upsert Customer Profile) รองรับการตั้งค่าข้อมูลส่วนตัว ช่องทางติดต่อทั้ง 7 ช่องทาง (Email, Phone/SMS, LINE UID, Facebook PSID, WhatsApp ID, App Push Token, Web Push) รวมถึง Tags, Custom Attributes และ Consents',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        alias: { type: 'string', description: 'ชื่อเรียกสั้น ๆ ที่ไม่ซ้ำ เช่น somchai-vip' },
        external_id: { type: 'string' },
        email: { type: 'string' },
        phone: { type: 'string' },
        first_name: { type: 'string' },
        last_name: { type: 'string' },
        gender: { type: 'string' },
        birth_date: { type: 'string', description: 'YYYY-MM-DD' },
        city: { type: 'string' },
        country: { type: 'string' },
        language: { type: 'string' },
        line_uid: { type: 'string' },
        fb_psid: { type: 'string' },
        whatsapp_id: { type: 'string' },
        app_push_token: { type: 'string' },
        web_push_subscription: { type: 'object' },
        lifecycle_stage: { type: 'string' },
        tier: { type: 'string' },
        total_spent: { type: 'number' },
        order_count: { type: 'number' },
        tags: { type: 'array', items: { type: 'string' } },
        custom_attributes: { type: 'object' },
        consents: {
          type: 'object',
          description: 'เช่น {"marketing": true, "email": true, "line": true, "sms": false}'
        },
        source: { type: 'string' }
      }
    },
    handler: (args) => upsertCustomer(args)
  },
  {
    name: 'cdp_import_customers',
    description:
      'นำเข้าข้อมูลลูกค้าจำนวนมาก (Bulk Import Customers) รองรับการ Upsert อัตโนมัติด้วย external_id หรือ email และการผูก anonymous_id เข้ากับโปรไฟล์ลูกค้า',
    inputSchema: {
      type: 'object',
      required: ['customers'],
      properties: {
        source: { type: 'string', default: 'bulk_import' },
        customers: {
          type: 'array',
          description: 'รายการออบเจ็กต์ข้อมูลลูกค้าที่ต้องการนำเข้า',
          items: { type: 'object' }
        }
      }
    },
    handler: (args) => importCustomers(args)
  },
  {
    name: 'cdp_link_customers',
    description:
      'เชื่อมโยงข้อมูลลูกค้า (Link Customer Identities / Profiles) ใช้ผูก anonymous_id, device_id กับลูกค้าหลัก หรือเชื่อมโยงโปรไฟล์ลูกค้า 2 รายการเข้าด้วยกัน (เช่น same_person, household, b2b_account, referral)',
    inputSchema: {
      type: 'object',
      required: ['primary_customer_id', 'identity_type', 'identity_value'],
      properties: {
        primary_customer_id: { type: 'string', description: 'ID, ชื่อเต็ม, อีเมล หรือ alias ของลูกค้าหลัก' },
        linked_customer_id: { type: 'string', description: 'ID, ชื่อเต็ม, อีเมล หรือ alias ของลูกค้าที่ต้องการเชื่อมโยง (ถ้ามี)' },
        identity_type: {
          type: 'string',
          description: 'เช่น anonymous_id, device_id, cookie_id, secondary_email, customer_profile'
        },
        identity_value: { type: 'string', description: 'ค่าของ Identity หรือรหัสอ้างอิง' },
        relationship: {
          type: 'string',
          default: 'same_person',
          description: 'เช่น same_person, household, b2b_account, referral'
        },
        confidence: { type: 'number', default: 1.0 },
        metadata: { type: 'object' }
      }
    },
    handler: (args) => linkCustomerIdentity(args)
  },
  {
    name: 'cdp_get_linked_customers',
    description:
      'ดูข้อมูลลูกค้าและ Identity ที่เชื่อมโยงกันทั้งหมด พร้อมระบบตรวจจับโปรไฟล์ที่น่าจะเป็นคนเดียวกันอัตโนมัติ (Shared Email / Phone / LINE UID)',
    inputSchema: {
      type: 'object',
      required: ['customer_id'],
      properties: {
        customer_id: { type: 'string', description: 'ID, ชื่อเต็ม, อีเมล หรือ alias ของลูกค้า' }
      }
    },
    handler: (args) => getLinkedCustomers(args.customer_id)
  },
  {
    name: 'cdp_get_database_overview',
    description:
      'ดูภาพรวมฐานข้อมูลลูกค้า (Customer Database Overview) แสดงจำนวนลูกค้าทั้งหมด, รายได้รวม, LTV เฉลี่ย, จำนวนลูกค้าแยกตาม Lifecycle/Tier/เมือง, จำนวนลูกค้าที่ติดต่อได้ในทั้ง 7 ช่องทาง และ Custom Attributes ทั้งหมด',
    inputSchema: {
      type: 'object',
      properties: {}
    },
    handler: () => getCustomerDatabaseOverview()
  },

  // ============================================================================
  // 2. ดู Customer Profile (Customer 360, Timeline, Insights, Consent)
  // ============================================================================
  {
    name: 'cdp_get_customer_profile',
    description:
      'ดู Customer 360 Profile ครบวงจร (ข้อมูลส่วนตัว, Timeline กิจกรรม, Insights/RFM, สถานะ Consent, ลูกค้าที่เชื่อมโยงกัน, Segments และ Journeys) ค้นหาได้ด้วย id, external_id, email หรือเบอร์โทร',
    inputSchema: {
      type: 'object',
      required: ['identifier'],
      properties: {
        identifier: { type: 'string', description: 'Customer ID, ชื่อเต็ม, alias, external_id, email หรือ phone' }
      }
    },
    handler: (args) => getCustomer360Profile(args.identifier)
  },
  {
    name: 'cdp_get_customer_timeline',
    description:
      'ดู Timeline กิจกรรมของลูกค้าตามลำดับเวลา (รวม Events พฤติกรรม, การเข้าชมเว็บ, การรับ/เปิด/คลิก Campaign, ขั้นตอนใน Journey และประวัติการเปลี่ยนสถานะ Consent)',
    inputSchema: {
      type: 'object',
      required: ['customer_id'],
      properties: {
        customer_id: { type: 'string', description: 'ID, ชื่อเต็ม, อีเมล หรือ alias ของลูกค้า' },
        event_type_filter: {
          type: 'string',
          enum: ['event', 'campaign', 'journey', 'consent'],
          description: 'กรองเฉพาะประเภทกิจกรรม (ไม่ระบุ = แสดงทั้งหมด)'
        },
        limit: { type: 'number', default: 50 }
      }
    },
    handler: (args) =>
      getCustomerTimeline(args.customer_id, {
        limit: args.limit,
        event_type_filter: args.event_type_filter
      })
  },
  {
    name: 'cdp_get_customer_insights',
    description:
      'ดู Insights เชิงลึกของลูกค้า (วิเคราะห์ RFM Score & Segment, Engagement Score 0-100, พฤติกรรมการเข้าชม URL/UTM ยอดนิยม, อัตราการตอบสนองต่อ Campaign และช่องทางที่ลูกค้าชื่นชอบ)',
    inputSchema: {
      type: 'object',
      required: ['customer_id'],
      properties: {
        customer_id: { type: 'string', description: 'ID, ชื่อเต็ม, อีเมล หรือ alias ของลูกค้า' }
      }
    },
    handler: (args) => getCustomerInsights(args.customer_id)
  },
  {
    name: 'cdp_manage_customer_consent',
    description:
      'ดูหรืออัปเดตสถานะ Consent ของลูกค้า (PDPA/GDPR และรายช่องทาง เช่น marketing, analytics, profiling, email, line, sms, facebook_messenger, whatsapp, app_push, web_push) พร้อมบันทึก Audit Log',
    inputSchema: {
      type: 'object',
      required: ['customer_id'],
      properties: {
        customer_id: { type: 'string', description: 'ID, ชื่อเต็ม, อีเมล หรือ alias ของลูกค้า' },
        consent_type: {
          type: 'string',
          description:
            'ถ้าระบุ consent_type และ status จะเป็นการอัปเดตค่า Consent; ถ้าไม่ระบุจะแสดงสถานะและประวัติ Consent ทั้งหมดของลูกค้า'
        },
        status: {
          type: 'string',
          enum: ['granted', 'revoked', 'pending']
        },
        source: { type: 'string', default: 'mcp_api' },
        ip_address: { type: 'string' },
        version: { type: 'string', default: 'v1.0' }
      }
    },
    handler: (args) => {
      if (args.consent_type && args.status) {
        return updateCustomerConsent(args);
      }
      return getCustomerConsents(args.customer_id);
    }
  },

  // ============================================================================
  // 3. เก็บและจัดการ Events & Tracking Script
  // ============================================================================
  {
    name: 'cdp_track_event',
    description:
      'บันทึกข้อมูลพฤติกรรมลูกค้า (Track Event) เช่น page_view, product_view, add_to_cart, purchase, form_submit พร้อมแยกค่า UTM จาก URL อัตโนมัติและอัปเดตยอดใช้จ่ายของลูกค้าเมื่อเป็น event purchase',
    inputSchema: {
      type: 'object',
      required: ['event_name'],
      properties: {
        customer_id: { type: 'string', description: 'ID, ชื่อเต็ม, อีเมล หรือ alias ของลูกค้า' },
        external_id: { type: 'string' },
        email: { type: 'string' },
        anonymous_id: { type: 'string' },
        session_id: { type: 'string' },
        event_name: { type: 'string', description: 'เช่น page_view, product_view, add_to_cart, purchase' },
        event_category: { type: 'string', default: 'behavior' },
        page_url: { type: 'string' },
        page_title: { type: 'string' },
        referrer: { type: 'string' },
        utm_source: { type: 'string' },
        utm_medium: { type: 'string' },
        utm_campaign: { type: 'string' },
        utm_term: { type: 'string' },
        utm_content: { type: 'string' },
        channel: { type: 'string', default: 'web' },
        revenue: { type: 'number', default: 0 },
        currency: { type: 'string', default: 'THB' },
        properties: { type: 'object' },
        timestamp: { type: 'string', description: 'ISO8601 timestamp (optional)' }
      }
    },
    handler: (args) => trackEvent(args)
  },
  {
    name: 'cdp_ingest_tracking_payload',
    description:
      'รับข้อมูลดิบจาก Tracking Script บนหน้าเว็บหรือแอป รองรับการส่ง traits เพื่อระบุตัวตนลูกค้าและทำ Identity Stitching ผูกเหตุการณ์ของ anonymous_id ก่อนหน้าเข้ากับโปรไฟล์ลูกค้าโดยอัตโนมัติ',
    inputSchema: {
      type: 'object',
      properties: {
        anonymous_id: { type: 'string' },
        customer_id: { type: 'string', description: 'ID, ชื่อเต็ม, อีเมล หรือ alias ของลูกค้า' },
        external_id: { type: 'string' },
        email: { type: 'string' },
        phone: { type: 'string' },
        session_id: { type: 'string' },
        event_name: { type: 'string', default: 'page_view' },
        page_url: { type: 'string' },
        page_title: { type: 'string' },
        referrer: { type: 'string' },
        utm: {
          type: 'object',
          properties: {
            source: { type: 'string' },
            medium: { type: 'string' },
            campaign: { type: 'string' },
            term: { type: 'string' },
            content: { type: 'string' }
          }
        },
        traits: {
          type: 'object',
          description: 'ข้อมูลโปรไฟล์ลูกค้าที่ได้จากฟอร์มหรือการล็อกอิน เช่น first_name, email, phone, line_uid'
        },
        properties: { type: 'object' },
        revenue: { type: 'number' },
        user_agent: { type: 'string' },
        ip_address: { type: 'string' },
        timestamp: { type: 'string' }
      }
    },
    handler: (args) => ingestTrackingPayload(args)
  },
  {
    name: 'cdp_generate_tracking_script',
    description: 'สร้างโค้ด JavaScript Tracking Script สำหรับติดตั้งบนเว็บไซต์เพื่อเก็บข้อมูลพฤติกรรม URL และ UTM',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', default: 'cdp_web_main' },
        endpoint_hint: { type: 'string', default: 'mcp://cdp/cdp_ingest_tracking_payload' }
      }
    },
    handler: (args) => generateTrackingScript(args)
  },
  {
    name: 'cdp_list_events',
    description: 'ค้นหาและดูรายการ Events ตามลูกค้า, anonymous_id, ชื่อ Event, URL, UTM หรือช่วงวันที่',
    inputSchema: {
      type: 'object',
      properties: {
        customer_id: { type: 'string', description: 'ID, ชื่อเต็ม, อีเมล หรือ alias ของลูกค้า' },
        anonymous_id: { type: 'string' },
        event_name: { type: 'string' },
        event_category: { type: 'string' },
        url_contains: { type: 'string' },
        utm_source: { type: 'string' },
        utm_medium: { type: 'string' },
        utm_campaign: { type: 'string' },
        date_from: { type: 'string' },
        date_to: { type: 'string' },
        limit: { type: 'number', default: 50 },
        offset: { type: 'number', default: 0 }
      }
    },
    handler: (args) => listEvents(args)
  },
  {
    name: 'cdp_get_event_analytics',
    description: 'ดูสรุปผลวิเคราะห์ Events ทั้งหมด แยกตามชื่อ Event, หน้า URL ที่เข้าชมมากที่สุด และแหล่งที่มา UTM Attribution',
    inputSchema: {
      type: 'object',
      properties: {
        date_from: { type: 'string' },
        date_to: { type: 'string' }
      }
    },
    handler: (args) => getEventAnalytics(args)
  },

  // ============================================================================
  // 4. สร้าง Segments & Dashboard (Static & Real-Time Segments)
  // ============================================================================
  {
    name: 'cdp_create_segment',
    description:
      'สร้างหรือแก้ไข Segment (รองรับทั้งแบบ static และ realtime) โดยแบ่งกลุ่มด้วยข้อมูลลูกค้า (customer_attributes), พฤติกรรม (event_conditions), Analytics/RFM (analytics_conditions), การเข้าชม URL (url_conditions), UTM (utm_conditions), วันที่ (date_conditions) และการตอบสนองต่อ Campaign (campaign_response_conditions)',
    inputSchema: {
      type: 'object',
      required: ['name', 'segment_type', 'criteria'],
      properties: {
        id: { type: 'string' },
        alias: { type: 'string', description: 'ชื่อเรียกสั้น ๆ ของกลุ่มที่ไม่ซ้ำ เช่น vip-gold' },
        name: { type: 'string' },
        description: { type: 'string' },
        segment_type: {
          type: 'string',
          enum: ['static', 'realtime'],
          description: 'static = เก็บรายชื่อคงที่ตามเวลาที่สร้าง/รีเฟรช, realtime = คำนวณสมาชิกตามเงื่อนไขแบบสดทุกครั้ง'
        },
        criteria: {
          type: 'object',
          properties: {
            match_mode: { type: 'string', enum: ['all', 'any'], default: 'all' },
            customer_attributes: {
              type: 'array',
              description: 'เช่น [{"field": "tier", "operator": "eq", "value": "gold"}, {"field": "tags", "operator": "contains", "value": "tech_lover"}]',
              items: { type: 'object' }
            },
            event_conditions: {
              type: 'array',
              description: 'เช่น [{"event_name": "add_to_cart", "min_count": 1, "within_days": 30, "property_filters": {"category": "electronics"}}]',
              items: { type: 'object' }
            },
            analytics_conditions: {
              type: 'array',
              description: 'เช่น [{"metric": "total_spent", "operator": "gte", "value": 10000}, {"metric": "rfm_segment", "operator": "eq", "value": "Champions"}]',
              items: { type: 'object' }
            },
            url_conditions: {
              type: 'array',
              description: 'เช่น [{"url_pattern": "/pricing", "min_visits": 2, "within_days": 14}]',
              items: { type: 'object' }
            },
            utm_conditions: {
              type: 'array',
              description: 'เช่น [{"utm_source": "facebook", "utm_campaign": "summer_sale", "min_touches": 1}]',
              items: { type: 'object' }
            },
            date_conditions: {
              type: 'object',
              description: 'เช่น {"created_after": "2026-01-01", "active_within_days": 30, "birth_month": 10}'
            },
            campaign_response_conditions: {
              type: 'array',
              description: 'เช่น [{"campaign_id": "welcome-email", "channel": "email", "status": "clicked", "negate": false}] โดย campaign_id ใช้ชื่อหรือ alias ได้',
              items: { type: 'object' }
            }
          }
        },
        static_customer_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'ลูกค้าที่ต้องการเพิ่มเข้า Static Segment ใช้ ID, alias, อีเมล หรือชื่อเต็มได้'
        }
      }
    },
    handler: (args) => createSegment(args)
  },
  {
    name: 'cdp_get_segment_details',
    description: 'ดูรายละเอียดและรายชื่อลูกค้าใน Segment (สามารถสั่ง refresh_static = true เพื่ออัปเดตข้อมูล Static Segment ได้)',
    inputSchema: {
      type: 'object',
      required: ['segment_id'],
      properties: {
        segment_id: { type: 'string', description: 'ID, ชื่อ หรือ alias ของกลุ่ม' },
        refresh_static: { type: 'boolean', default: false }
      }
    },
    handler: (args) => getSegmentDetails(args.segment_id, { refresh_static: args.refresh_static })
  },
  {
    name: 'cdp_get_segments_dashboard',
    description:
      'ดูหน้า Dashboard ของ Segments ทั้งหมด แสดงแยกทั้งกลุ่ม Real-Time Segments และ Static Segments พร้อมจำนวนสมาชิก สัดส่วนเทียบฐานลูกค้า และตัวอย่างลูกค้าในแต่ละกลุ่ม',
    inputSchema: {
      type: 'object',
      properties: {}
    },
    handler: () => getSegmentsDashboard()
  },

  // ============================================================================
  // 5. ทำ Campaign หลายช่องทาง (Omnichannel Campaigns - 7 Channels)
  // ============================================================================
  {
    name: 'cdp_get_channel_templates_schema',
    description:
      'ดูรูปแบบการตั้งค่าข้อความ (Message Config Schema & Examples) สำหรับทั้ง 7 ช่องทาง: Email, LINE, Facebook Messenger, SMS, WhatsApp, App Push และ Web Push',
    inputSchema: {
      type: 'object',
      properties: {
        channel: {
          type: 'string',
          enum: SUPPORTED_CHANNELS,
          description: 'ระบุช่องทางที่ต้องการดู หรือเว้นว่างเพื่อดูทั้ง 7 ช่องทาง'
        }
      }
    },
    handler: (args) => {
      if (args.channel) {
        return {
          channel: args.channel,
          schema: CHANNEL_TEMPLATE_SCHEMAS[args.channel]
        };
      }
      return {
        supported_channels: SUPPORTED_CHANNELS,
        schemas: CHANNEL_TEMPLATE_SCHEMAS
      };
    }
  },
  {
    name: 'cdp_upsert_campaign',
    description:
      'สร้างหรือตั้งค่าข้อความ Campaign สำหรับช่องทาง Email, LINE, Facebook Messenger, SMS, WhatsApp, App Push หรือ Web Push รองรับตัวแปร Personalization เช่น {{first_name}}, {{tier}}',
    inputSchema: {
      type: 'object',
      required: ['name', 'channel', 'message_config'],
      properties: {
        id: { type: 'string' },
        alias: { type: 'string', description: 'ชื่อเรียกสั้น ๆ ของแคมเปญที่ไม่ซ้ำ เช่น welcome-email' },
        name: { type: 'string' },
        description: { type: 'string' },
        channel: {
          type: 'string',
          enum: SUPPORTED_CHANNELS,
          description: 'ช่องทาง: email, line, facebook_messenger, sms, whatsapp, app_push, web_push'
        },
        segment_id: { type: 'string', description: 'ID, ชื่อ หรือ alias ของกลุ่มเป้าหมาย' },
        status: { type: 'string', enum: ['draft', 'scheduled', 'running', 'completed', 'paused'], default: 'draft' },
        message_config: {
          type: 'object',
          description: 'ออบเจ็กต์ตั้งค่าข้อความตามช่องทาง (เช่น subject/html_body สำหรับ email, text/flex_contents สำหรับ line, title/body/deep_link สำหรับ app_push)'
        },
        utm_config: {
          type: 'object',
          description: 'เช่น {"utm_source": "cdp", "utm_medium": "line", "utm_campaign": "vip_oct"}'
        },
        require_consent: { type: 'boolean', default: true },
        scheduled_at: { type: 'string' }
      }
    },
    handler: (args) => upsertCampaign(args)
  },
  {
    name: 'cdp_execute_campaign',
    description:
      'ประมวลผล Campaign สำหรับลูกค้าใน Segment ที่ผูกไว้ หรือระบุ customer_ids เป็นชื่อ อีเมล หรือ alias โดยระบบจะแทนค่าตัวแปร Personalization ตรวจสอบ Consent และบันทึกผลลง SQLite',
    inputSchema: {
      type: 'object',
      required: ['campaign_id'],
      properties: {
        campaign_id: { type: 'string', description: 'ID, ชื่อ หรือ alias ของแคมเปญ' },
        customer_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'ถ้าระบุจะประมวลผลเฉพาะลูกค้ากลุ่มนี้แทน Segment ที่ผูกไว้ ใช้ ID, ชื่อเต็ม, อีเมล หรือ alias ได้'
        }
      }
    },
    handler: (args) => executeCampaign(args)
  },
  {
    name: 'cdp_record_campaign_response',
    description:
      'บันทึกการตอบสนองของลูกค้าต่อ Campaign (opened, clicked, converted, bounced, unsubscribed) เพื่อนำไปใช้ทำ Segment และเงื่อนไขใน Customer Journey ต่อ',
    inputSchema: {
      type: 'object',
      required: ['campaign_id', 'customer_id', 'action'],
      properties: {
        campaign_id: { type: 'string', description: 'ID, ชื่อ หรือ alias ของแคมเปญ' },
        customer_id: { type: 'string', description: 'ID, ชื่อเต็ม, อีเมล หรือ alias ของลูกค้า' },
        action: {
          type: 'string',
          enum: ['opened', 'clicked', 'converted', 'bounced', 'unsubscribed']
        },
        conversion_value: { type: 'number', default: 0 },
        metadata: { type: 'object' }
      }
    },
    handler: (args) => recordCampaignResponse(args)
  },
  {
    name: 'cdp_list_campaigns',
    description: 'ดูรายการ Campaigns ทั้งหมดพร้อมสถิติการส่ง การเปิดอ่าน การคลิก และยอดขาย Conversion',
    inputSchema: {
      type: 'object',
      properties: {
        channel: { type: 'string', enum: SUPPORTED_CHANNELS },
        status: { type: 'string' }
      }
    },
    handler: (args) => listCampaigns(args)
  },

  // ============================================================================
  // 6. สร้าง Customer Journey (Journey Orchestration & Performance)
  // ============================================================================
  {
    name: 'cdp_upsert_journey',
    description:
      'สร้างหรืออัปเดต Customer Journey กำหนดเงื่อนไขเริ่มต้น (trigger_type: segment, event, behavior) และขั้นตอนการทำงาน (steps: send_campaign, wait, condition_split, update_profile, goal_check)',
    inputSchema: {
      type: 'object',
      required: ['name', 'trigger_type', 'trigger_config', 'steps'],
      properties: {
        id: { type: 'string' },
        alias: { type: 'string', description: 'ชื่อเรียกสั้น ๆ ของ Journey ที่ไม่ซ้ำ เช่น welcome-flow' },
        name: { type: 'string' },
        description: { type: 'string' },
        status: { type: 'string', enum: ['draft', 'active', 'paused', 'archived'], default: 'active' },
        trigger_type: {
          type: 'string',
          enum: ['segment', 'event', 'behavior'],
          description: 'จุดเริ่มต้นของ Journey: ตาม Segment, ตาม Event หรือตามเงื่อนไขพฤติกรรม'
        },
        trigger_config: {
          type: 'object',
          description: 'เช่น {"segment_id": "vip-gold"} โดยใช้ชื่อหรือ alias ของกลุ่มได้ หรือ {"event_name": "add_to_cart", "within_days": 7}'
        },
        steps: {
          type: 'array',
          description:
            'ลำดับขั้นตอนของ Journey แต่ละ step มี id, name, type (send_campaign | wait | condition_split | update_profile | goal_check), next_step_id หรือ on_true_step_id / on_false_step_id',
          items: { type: 'object' }
        },
        goal_config: {
          type: 'object',
          description: 'เงื่อนไขความสำเร็จของ Journey เช่น {"criteria": {"event_conditions": [{"event_name": "purchase"}]}, "conversion_value": 2500}'
        }
      }
    },
    handler: (args) => upsertJourney(args)
  },
  {
    name: 'cdp_run_journey',
    description:
      'สั่งรัน Customer Journey เพื่อดึงลูกค้าที่เข้าเงื่อนไข Trigger เข้าสู่ขั้นตอนการส่ง Campaign การแยกกิ่งตามเงื่อนไข (Condition Split) และการวัดผล Goal',
    inputSchema: {
      type: 'object',
      required: ['journey_id'],
      properties: {
        journey_id: { type: 'string', description: 'ID, ชื่อ หรือ alias ของ Journey' },
        customer_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'ระบุลูกค้าที่ต้องการทดสอบรันใน Journey ด้วย ID, ชื่อเต็ม, อีเมล หรือ alias (หากไม่ระบุจะค้นหาจาก trigger_config อัตโนมัติ)'
        },
        advance_waiting: {
          type: 'boolean',
          default: true,
          description: 'ให้ข้ามผ่านขั้นตอน wait ทันทีเพื่อดูผลลัพธ์ตลอดสายหรือไม่ (true = รันผ่าน wait ทันที, false = หยุดรอที่ขั้นตอน wait)'
        },
        re_enroll: {
          type: 'boolean',
          default: false,
          description: 'อนุญาตให้ลูกค้าที่เคยเข้า Journey นี้แล้วเข้ามาเริ่มใหม่ได้หรือไม่'
        }
      }
    },
    handler: (args) => runJourney(args)
  },
  {
    name: 'cdp_get_journey_performance',
    description:
      'ดูผลลัพธ์ของ Customer Journey แบบครบถ้วน (จำนวนผู้เข้าร่วม, Funnel รายขั้นตอน, จำนวนคนแยกตามกิ่งเงื่อนไข Yes/No, สถิติของแต่ละ Campaign ใน Journey และอัตราการเกิด Conversion)',
    inputSchema: {
      type: 'object',
      required: ['journey_id'],
      properties: {
        journey_id: { type: 'string', description: 'ID, ชื่อ หรือ alias ของ Journey' }
      }
    },
    handler: (args) => getJourneyPerformance(args.journey_id)
  },
  {
    name: 'cdp_list_journeys',
    description: 'ดูรายการ Customer Journeys ทั้งหมดพร้อมสรุปผลการทำงาน',
    inputSchema: {
      type: 'object',
      properties: {}
    },
    handler: () => listJourneys()
  },
  {
    name: 'cdp_create_demo',
    description: 'สร้างหรือสร้างใหม่ชุดข้อมูลสังเคราะห์คลินิกเสริมความงาม: ลูกค้า 24 คน, Events การรับบริการและซื้อสินค้าสกินแคร์, Segments, Campaigns 7 ช่องทาง และ Journeys โดยไม่แก้ข้อมูลอื่น',
    inputSchema: { type: 'object', properties: {} },
    handler: () => createBeautyClinicDemo()
  },
  {
    name: 'cdp_delete_demo',
    description: 'ลบเฉพาะชุดข้อมูลสังเคราะห์คลินิกเสริมความงามที่สร้างโดย cdp_create_demo รวมข้อมูลที่เกี่ยวข้อง โดยไม่ reset ฐานข้อมูลทั้งหมด',
    inputSchema: { type: 'object', properties: {} },
    handler: () => deleteBeautyClinicDemo()
  }
];

export const TOOL_MAP = new Map(TOOLS.map((t) => [t.name, {
  ...t,
  handler: (args) => t.handler(resolveToolArgs(t.name, args))
}]));

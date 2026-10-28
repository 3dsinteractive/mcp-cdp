# แผนพัฒนาการส่ง Campaign จริงผ่าน 7 Channels

> สถานะ: เอกสารออกแบบสำหรับงานในอนาคต ยังไม่มีการส่งข้อความจริงหรือการอ่าน env ด้านล่างในโค้ดปัจจุบัน

## เป้าหมายและขอบเขต

- รองรับ `email`, `line`, `facebook_messenger`, `sms`, `whatsapp`, `app_push` และ `web_push` โดยตั้งค่าแต่ละช่องทางแยกกันและไม่บังคับให้ตั้งค่าครบเพื่อเริ่ม server
- คงการใช้งานเดิมในโหมดจำลองเป็นค่าเริ่มต้น การตั้งค่า credential เพียงอย่างเดียวต้องไม่ทำให้ข้อความถูกส่งจริง
- ส่งจริงเฉพาะ channel ที่มีการตั้งค่าครบ เปิดใช้งานโดยชัดเจน และผ่านการตรวจสอบกลุ่มเป้าหมายกับ consent
- แสดงสถานะตามหลักฐานจาก provider แยกการรับคำขอส่งออกจากการส่งถึงผู้รับ
- ป้องกันการส่งซ้ำเมื่อมี retry, timeout หรือผู้ใช้สั่งงานเดิมอีกครั้ง

## สถานะของระบบปัจจุบัน

- `src/services/campaignService.js` เลือกผู้รับจาก `customer_ids`, Segment หรือทุกคนหากไม่ระบุทั้งสองอย่าง จากนั้นตรวจ consent และข้อมูลติดต่อ แทนค่าข้อความ และเขียน `campaign_logs` โดยยังไม่เรียก provider
- การเขียน log ปัจจุบันใช้สถานะ `delivered` และ `delivered_at` ทันทีเมื่อมีข้อมูลผู้รับ ทั้งที่เป็นเพียงผลการจำลอง จึงต้องแก้ความหมายของสถานะและรายงานก่อนเปิดส่งจริง
- `cdp_record_campaign_response` สามารถสร้าง log สถานะ `delivered` เองหากยังไม่มี log ต้องปรับไม่ให้สร้างหลักฐานการส่งที่ไม่ได้เกิดขึ้น
- `cdp_create_demo` รัน Campaign และ Journey ขณะสร้างชุดข้อมูล ต้องบังคับให้เดโมใช้โหมดจำลองเสมอ แม้เปิด live delivery ไว้
- HTTP MCP ยังไม่มีการยืนยันตัวตน การเปิดการส่งจริงต้องมีการควบคุมสิทธิ์ที่ endpoint หรือชั้น gateway ก่อนใช้งานผ่านเครือข่าย

## แบบการตั้งค่า

แยกข้อมูลสามประเภท:

1. **การเชื่อมต่อ channel:** provider, บัญชีผู้ส่ง, สถานะพร้อมใช้งาน, ข้อจำกัดการส่ง และชื่ออ้างอิง เช่น `clinic-email` หรือ `clinic-line`
2. **ความลับ:** password, token, private key อยู่ใน secret ของระบบ deploy หรือไฟล์ secret ที่ mount เข้า container ไม่อยู่ใน SQLite, `message_config`, prompt หรือ log
3. **Campaign:** กลุ่มเป้าหมาย, `channel`, การเชื่อมต่อที่เลือก, ข้อความ, consent และตารางเวลา หากยังไม่รองรับหลายบัญชี ให้ใช้การเชื่อมต่อเริ่มต้นหนึ่งรายการต่อ channel

### ชุด env ที่เสนอ

ชื่อต่อไปนี้เป็นสัญญาที่เสนอให้พัฒนา **ยังใช้กับ server ปัจจุบันไม่ได้** ค่าว่างทุก channel ต้องไม่ทำให้ server เริ่มไม่สำเร็จ ตัวอย่างนี้เลือก Twilio สำหรับ SMS, Meta Cloud API สำหรับ WhatsApp, FCM สำหรับ App Push และ VAPID สำหรับ Web Push; หากเปลี่ยน provider ให้เปลี่ยนชื่อและข้อกำหนดของกลุ่มนั้นตามจริง

```dotenv
# ค่าเริ่มต้นและสวิตช์รวม: simulate | live
CDP_SEND_MODE=simulate

# Email / SMTP
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=
SMTP_REPLY_TO=

# LINE Messaging API
LINE_CHANNEL_ACCESS_TOKEN=

# Facebook Messenger
MESSENGER_PAGE_ID=
MESSENGER_PAGE_ACCESS_TOKEN=

# SMS / Twilio
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_SMS_FROM=

# WhatsApp Cloud API
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=

# App Push / Firebase Cloud Messaging
FCM_PROJECT_ID=
GOOGLE_APPLICATION_CREDENTIALS=

# Web Push / VAPID
WEB_PUSH_VAPID_SUBJECT=
WEB_PUSH_VAPID_PUBLIC_KEY=
WEB_PUSH_VAPID_PRIVATE_KEY=
```

ข้อกำหนดการอ่านค่า:

- ค่าเริ่มต้นของ `CDP_SEND_MODE` คือ `simulate` หากเป็นค่าอื่นที่ไม่รู้จักให้เริ่ม server ไม่สำเร็จ; การตั้ง credential ไม่เปลี่ยนโหมดเอง
- ในโหมด `simulate` ไม่ติดต่อ provider แม้มี credential พร้อม
- ในโหมด `live` ให้ตรวจชุดค่าของ channel ที่กำลังจะส่งก่อนเริ่มงาน หากขาดค่าใดให้แจ้ง `channel_not_configured` และไม่สร้าง log ว่าส่งสำเร็จ; channel อื่นยังทำงานได้
- ค่า `SMTP_PORT=587` ใช้ STARTTLS และต้องบังคับ TLS ก่อนยืนยันตัวตน; พอร์ต `465` ใช้ TLS ตั้งแต่เริ่มเชื่อมต่อ ห้ามปิดการตรวจใบรับรองเพื่อแก้ปัญหาการตั้งค่า
- `GOOGLE_APPLICATION_CREDENTIALS` เป็น **พาธไปยังไฟล์ credential** ที่ mount อย่างปลอดภัย ไม่ใช่เนื้อหา JSON ใน env
- หากมีหลายบัญชีต่อ channel ให้เพิ่ม `connection_id` ใน Campaign และเก็บชื่อ env/secret reference ในตาราง connection โดยไม่เก็บค่า secret จริงในฐานข้อมูล

## การไหลของการส่ง

1. ตรวจ Campaign และเลือกกลุ่มเป้าหมาย ทำ preview จำนวนคนก่อนเรียกส่งจริง โดยเฉพาะ Campaign ที่ไม่มี `segment_id` หรือ `customer_ids` เพราะโค้ดปัจจุบันจะเลือกทุกคน
2. ตรวจ consent และข้อมูลปลายทางของแต่ละรายก่อนสร้างงานส่ง บันทึกเหตุผลที่ข้าม เช่น `skipped_no_consent`, `missing_recipient`
3. สร้าง delivery record ด้วย key ที่ไม่ซ้ำ เช่น `execution_id + campaign_id + customer_id + channel` เพื่อกันการส่งซ้ำจาก retry
4. เรนเดอร์ข้อความและส่งผ่าน adapter ของ provider แต่ละ channel; จำกัดอัตราและจำนวน retry ตามข้อกำหนด provider โดย retry เฉพาะข้อผิดพลาดชั่วคราว
5. บันทึก `provider_message_id`, เวลาที่ provider รับคำขอ, รหัสผิดพลาด และสถานะจริง; รับ callback ที่ตรวจลายเซ็นแล้วเพื่ออัปเดตสถานะเมื่อ provider รองรับ
6. สรุปผลจาก delivery records โดยแยก `simulated`, `queued`, `sent`, `delivered`, `failed`, `bounced` และ `skipped` อย่านับ `accepted` หรือ `sent` เป็น `delivered`

การเรียก provider สำเร็จหมายถึง provider รับคำขอเท่านั้น ผลส่งถึงปลายทางอาจมาในภายหลัง หรือบาง provider อาจไม่มีหลักฐานถึงขั้น `delivered` ให้รายงานสถานะสูงสุดที่ยืนยันได้ ไม่เดาแทน provider

## ข้อตกลงราย Channel

| Channel | ข้อมูลปลายทางในโปรไฟล์ปัจจุบัน | สิ่งที่ adapter ต้องตรวจเพิ่ม |
| --- | --- | --- |
| Email | `email` | SMTP/TLS, ผู้ส่งที่ provider ยอมรับ, ผลรับคำขอและ bounce หากมี callback |
| LINE | `line_uid` | สิทธิ์ของ LINE Official Account, token, รูปแบบข้อความ และผลจาก Messaging API |
| Messenger | `fb_psid` | Page ID, Page token, สิทธิ์/ข้อกำหนดการส่งของ Meta และรูปแบบข้อความ |
| SMS | `phone` | รูปแบบเบอร์สำหรับ provider, หมายเลขผู้ส่งหรือ Messaging Service, callback สถานะ |
| WhatsApp | `whatsapp_id` หรือ `phone` | Phone Number ID, token, template/ข้อกำหนดบทสนทนาของ provider และ callback สถานะ |
| App Push | `app_push_token` | Firebase project และ credential, token ที่หมดอายุ, ผล API ที่ไม่เท่ากับการเปิดอ่าน |
| Web Push | `web_push_subscription` | โครงสร้าง subscription, VAPID key, endpoint ที่หมดอายุ และผลจาก push service |

`message_config` ที่มีอยู่เป็นเพียง schema ภายใน ไม่รับประกันว่า payload ส่งตรงกับ provider ทุกกรณี adapter ต้องแปลงและตรวจตาม API จริง โดยเฉพาะ Messenger และ WhatsApp ห้ามตีความตัวอย่าง template ใน repo ว่าได้รับอนุญาตให้ส่งทุกชนิด

## ข้อมูลและความเข้ากันได้ย้อนหลัง

- เพิ่มการย้าย schema สำหรับฐานข้อมูล SQLite เดิม ไม่พึ่งเฉพาะ `CREATE TABLE IF NOT EXISTS` เช่น เพิ่ม `execution_id`, `mode`, `connection_id`, `provider_message_id`, `provider_status`, `error_code`, `attempt_count`, `accepted_at` และ timestamps ของสถานะ
- แยกผลการส่งออกจากการตอบสนองของลูกค้า (`opened`, `clicked`, `converted`, `unsubscribed`) เพื่อไม่ให้ response เขียนทับหลักฐานการส่ง
- ระบุ log เก่าที่ถูกบันทึกเป็น `delivered` ว่าเป็น **legacy simulation** ในรายงานหรือ migration; อย่านับรวมเป็น delivered จริง
- อัปเดตสถิติใน `cdp_list_campaigns`, Customer Timeline, Segment และ Journey ให้ใช้ความหมายสถานะใหม่อย่างสอดคล้องกัน
- การส่งจาก Journey ต้องผ่านตัวส่งและกติกาเดียวกับ Campaign; การรันเดโมและ tests ต้องกำหนด `simulate` เสมอ

## ความปลอดภัยและการปฏิบัติงาน

- เก็บ secret ในระบบจัดการ secret ของ deploy; สำหรับ Docker ให้ mount เป็น secret หรือใช้ช่องทางส่ง env ที่ไม่ฝังใน image และไม่ commit `.env`
- ห้ามคืนค่า credential ผ่าน MCP tools, error หรือ logs; ปิดบังที่อยู่ผู้รับตามความเหมาะสม
- ก่อนเปิด `live` บน HTTP ให้เพิ่มการยืนยันตัวตนและกำหนดสิทธิ์เฉพาะการสั่งส่งจริง รวมถึงบันทึกผู้สั่ง, Campaign, จำนวนผู้รับ และเวลา
- ให้มีคำสั่งตรวจความพร้อมของ channel และส่งข้อความทดสอบไปยังผู้รับที่กำหนด โดยไม่ต้องเริ่ม Campaign ทั้งกลุ่ม
- ตรวจลายเซ็น callback และรองรับ callback ซ้ำหรือมาถึงไม่ตามลำดับ; อัปเดตสถานะเฉพาะรายการที่สัมพันธ์กับ `provider_message_id`
- ให้มีสวิตช์หยุดการส่งจริงทันที และจำกัดจำนวนผู้รับต่อการสั่งหนึ่งครั้งในระยะแรก

## ลำดับงานพัฒนา

1. ปรับโมเดลสถานะและ migration รวมทั้งแยก simulated logs ออกจาก delivered จริง
2. เพิ่มตัวอ่าน env และการตรวจความพร้อมของแต่ละ channel โดยยังคง `simulate` เป็นค่าเริ่มต้น
3. ทำ Email SMTP adapter และการทดสอบการเชื่อมต่อ/ส่งหาผู้รับทดสอบก่อน
4. เพิ่มระบบ execution, idempotency, queue/retry และ preview กลุ่มเป้าหมายก่อนเปิด live
5. เพิ่ม adapter ของ channel อื่นทีละรายการ พร้อม callback ตามความสามารถของ provider
6. ปรับ MCP tools, README, PROMPTS และ metrics ให้แสดงโหมดและสถานะจริงอย่างชัดเจน

## เกณฑ์ยอมรับ

- ไม่มี env ของ channel ใด: server และ demo ทำงานเหมือนเดิมในโหมดจำลอง และไม่มี outbound request ไป provider
- ตั้ง env บาง channel: channel ที่ไม่ครบยังไม่ส่งจริง; คำขอ live ที่ใช้ channel นั้นได้ error ที่บอกค่าที่ขาดโดยไม่เผยความลับ
- Credential พร้อมแต่ยังอยู่ใน `simulate`: ไม่มีการส่งจริง และ log แสดง `simulated`
- `live` ที่ผ่านการยืนยันสิทธิ์: ส่งได้เฉพาะผู้รับใน preview ที่ผ่าน consent; retry หรือ callback ซ้ำไม่สร้างข้อความซ้ำ
- สถานะ `delivered` ปรากฏเฉพาะเมื่อมีหลักฐานจาก provider; error, timeout และ callback ที่มาผิดลำดับไม่ทำให้รายงานเกินจริง
- `cdp_create_demo` ไม่ส่งออกจริงทุกกรณี และการทดสอบใช้ fake provider หรือฐานข้อมูลชั่วคราว

## เอกสารผู้ให้บริการสำหรับพัฒนา adapter

- [Nodemailer SMTP transport](https://nodemailer.com/smtp)
- [LINE Messaging API: Send messages](https://developers.line.biz/en/docs/messaging-api/sending-messages/)
- [Twilio: Message resource และสถานะ](https://www.twilio.com/docs/messaging/api/message-resource)
- [Meta WhatsApp Cloud API (เอกสาร Meta บน Postman)](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api)
- [Firebase Cloud Messaging: Server environment](https://firebase.google.com/docs/cloud-messaging/server-environment)
- [MDN: Web Push application server key](https://developer.mozilla.org/en-US/docs/Web/API/PushSubscriptionOptions/applicationServerKey)

ก่อนทำ adapter ของ Messenger หรือ WhatsApp ให้ตรวจเอกสาร API และข้อกำหนดบัญชีของ Meta รุ่นที่ใช้อยู่จริงอีกครั้ง

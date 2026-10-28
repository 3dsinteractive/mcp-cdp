# MCP-CDP: Headless Customer Data Platform (MCP + SQLite + Node.js)

ระบบ **Headless Customer Data Platform (CDP)** ที่ทำงานผ่าน **Model Context Protocol (MCP)** อย่างเดียวโดยไม่มี GUI และบันทึกข้อมูลทั้งหมดลงใน **SQLite** (`data/cdp.sqlite`) พัฒนาด้วย **Node.js** (ใช้ `node:sqlite` ในตัวของ Node.js 22+ โดยไม่ต้องพึ่งพา External Dependencies)

---

## การตั้งค่าใช้งานกับ MCP Client (Claude Desktop / Antigravity / Cursor)

ตัวอย่างคำสั่งภาษาไทยสำหรับผู้ใช้งานอยู่ใน [PROMPTS.md](PROMPTS.md)
ลูกค้า กลุ่มลูกค้า แคมเปญ และ Journey รองรับการอ้างอิงด้วย ID, ชื่อ หรือ alias โดยชื่อที่ซ้ำกันต้องใช้ alias ที่ไม่ซ้ำ
ตัวอย่างไฟล์ลูกค้าสำหรับนำเข้าอยู่ใน [examples/customers.csv](examples/customers.csv) โดย MCP tool รับข้อมูลเป็น JSON จึงต้องแปลง CSV ก่อนนำเข้า

### ใช้งานผ่าน Streamable HTTP

HTTP endpoint อยู่ที่ `/mcp` สำหรับการรันบนเครื่องโดยตรง:

```bash
npm start
```

เมื่อเริ่มเซิร์ฟเวอร์ หากยังไม่มีไฟล์ SQLite ระบบจะสร้างไฟล์ โฟลเดอร์ และตารางให้เองที่ `data/cdp.sqlite` หรือพาธที่ตั้งใน `CDP_DB_PATH` ฐานข้อมูลที่สร้างใหม่จะยังไม่มีข้อมูลลูกค้า หากต้องการข้อมูลตัวอย่างให้รัน `npm run seed`

เปิด `http://127.0.0.1:3000/health` ใน browser เพื่อตรวจว่า server ทำงานอยู่ ส่วน `/mcp` เป็น endpoint สำหรับ MCP client ที่ส่ง HTTP POST ไม่ใช่หน้าเว็บ การเปิด `/mcp` ใน browser จะได้ HTTP `405`

ค่าเริ่มต้นรับที่ `127.0.0.1:3000` ปรับได้ด้วย `HOST` และ `PORT` เมื่อต้องการรันผ่าน Docker:

```bash
docker build -t mcp-cdp .
docker run -d --name mcp-cdp --restart unless-stopped \
  -p 127.0.0.1:3000:3000 \
  --mount type=volume,source=mcp-cdp-data,target=/app/data \
  mcp-cdp
```

ตั้งค่า MCP client ที่รองรับ Streamable HTTP ด้วย URL `http://127.0.0.1:3000/mcp` ตัวอย่างรูปแบบทั่วไป (ชื่อ field อาจต่างกันตาม client):

```json
{
  "mcpServers": {
    "mcp-cdp": {
      "url": "http://127.0.0.1:3000/mcp"
    }
  }
}
```

ทดสอบ endpoint ที่รันบนเครื่องโดยตรง:

```bash
curl -i http://127.0.0.1:3000/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"curl","version":"1.0.0"}}}'
```

HTTP mode ตอบ POST เป็น JSON โดยตรงและไม่เปิด GET/SSE stream (GET ตอบ `405`) รองรับหลาย client โดยไม่สร้าง session บน server คำขอที่มี `Origin` จะถูกปฏิเสธ เว้นแต่กำหนด `MCP_ALLOWED_ORIGINS` เป็นรายการ origin ที่อนุญาตคั่นด้วย comma

### ใช้งาน Docker ผ่าน stdio บนเครื่องเดียวกับ MCP client

สร้าง image ก่อนหนึ่งครั้ง:

```bash
docker build -t mcp-cdp .
```

เพิ่มการตั้งค่า MCP client ดังนี้ (`stdio` ต้องมี `-i` และไม่ใช้ `-t` โดยสั่งรัน `src/index.js` แทนคำสั่ง HTTP เริ่มต้นของ image):

```json
{
  "mcpServers": {
    "mcp-cdp": {
      "command": "docker",
      "args": [
        "run", "--rm", "-i",
        "--mount", "type=volume,source=mcp-cdp-data,target=/app/data",
        "mcp-cdp", "node", "--no-warnings", "src/index.js"
      ]
    }
  }
}
```

ข้อมูล SQLite จะอยู่ใน Docker volume `mcp-cdp-data` และคงอยู่หลังปิด container หากต้องการใช้ไฟล์ `data/cdp.sqlite` ที่มีอยู่ในเครื่องแทน volume ให้เปลี่ยน `--mount` เป็น `type=bind,source=/absolute/path/to/mcp-cdp/data,target=/app/data` (ตรวจสอบสิทธิ์เขียนของโฟลเดอร์ด้วย)

ทดสอบการตอบกลับ MCP ด้วยคำสั่ง:

```bash
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05"}}' | docker run --rm -i --mount type=volume,source=mcp-cdp-data,target=/app/data mcp-cdp node --no-warnings src/index.js
```

### Build และเผยแพร่ image ไป Docker Hub

สคริปต์ [docker-build.sh](docker-build.sh) รับชื่อ image, tag และชื่อผู้ใช้ Docker Hub เป็นอาร์กิวเมนต์ รับ token ทาง stdin แล้วใช้ `docker buildx build --push`:

```bash
printf '%s\n' "$DOCKER_HUB_TOKEN" | ./docker-build.sh yourname/mcp-cdp 1.0.0 yourname
```

ค่าเริ่มต้น build สำหรับ `linux/amd64` หากต้องการหลายสถาปัตยกรรมให้กำหนด `PLATFORMS` เช่น `PLATFORMS=linux/amd64,linux/arm64` ก่อนเรียกสคริปต์ สคริปต์นี้จะเผยแพร่ image ไปยัง Docker Hub เมื่อรันสำเร็จ

### ใช้งานผ่าน Node.js โดยตรง

เพิ่มการตั้งค่าลงในไฟล์ `mcp_config.json` หรือ `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "mcp-cdp": {
      "command": "node",
      "args": [
        "--no-warnings",
        "/absolute/path/to/mcp-cdp/src/index.js"
      ],
      "env": {
        "CDP_DB_PATH": "/absolute/path/to/mcp-cdp/data/cdp.sqlite"
      }
    }
  }
}
```

---

## รายการ MCP Tools ทั้ง 6 โมดูล (27 Tools)

### 1. จัดการข้อมูลลูกค้า (Customer Management)
- `cdp_list_customers` — ดูรายชื่อลูกค้า ค้นหาและกรองตาม `lifecycle_stage`, `tier`, `city`, `tag`, `min_spent`
- `cdp_upsert_customer` — สร้างหรือแก้ไขข้อมูลลูกค้า รองรับช่องทางติดต่อทั้ง 7 ช่องทาง, `tags`, `custom_attributes`, และ `consents`
- `cdp_import_customers` — นำเข้าข้อมูลลูกค้าจำนวนมาก (Bulk Import) พร้อมผูก `anonymous_id` อัตโนมัติ
- `cdp_link_customers` — เชื่อมโยงข้อมูลลูกค้า (Identity Stitching / ผูก `anonymous_id`, `device_id` หรือเชื่อมความสัมพันธ์ระหว่างลูกค้า เช่น `same_person`, `household`, `b2b_account`)
- `cdp_get_linked_customers` — ดูลูกค้าที่เชื่อมโยงกัน พร้อมตรวจจับโปรไฟล์ซ้ำอัตโนมัติ (Shared Email / Phone / LINE UID)
- `cdp_get_database_overview` — ดูภาพรวมฐานข้อมูลลูกค้า รายได้รวม LTV เฉลี่ย และจำนวนลูกค้าที่ติดต่อได้ในแต่ละช่องทาง

### 2. ดู Customer Profile (Customer 360)
- `cdp_get_customer_profile` — ดู Customer 360 Profile ครบวงจร (ข้อมูลส่วนตัว, Timeline, Insights/RFM, Consents, Linked Profiles, Segments, Journeys)
- `cdp_get_customer_timeline` — ดู Timeline กิจกรรมของลูกค้าตามลำดับเวลา (Events, Campaign Logs, Journey Steps, Consent Logs)
- `cdp_get_customer_insights` — วิเคราะห์คะแนน **RFM (Recency, Frequency, Monetary)**, กลุ่ม RFM Segment (`Champions`, `Loyal Customers`, `At Risk`), **Engagement Score (0-100)**, URL และ UTM ยอดนิยม
- `cdp_manage_customer_consent` — ดูและอัปเดตสถานะ Consent (PDPA/GDPR และรายช่องทาง) พร้อมบันทึก Audit Log (`consent_logs`)

### 3. เก็บและจัดการ Events & Web Tracking Script
- `cdp_track_event` — บันทึกพฤติกรรมลูกค้า (`page_view`, `product_view`, `add_to_cart`, `purchase`) พร้อมแยก UTM จาก URL และอัปเดตยอดซื้ออัตโนมัติ
- `cdp_ingest_tracking_payload` — รับข้อมูลจาก Web/App Tracking Script พร้อมทำ **Identity Stitching** ย้อนหลังให้ `anonymous_id` ทันทีเมื่อลูกค้าระบุตัวตน
- `cdp_generate_tracking_script` — สร้างโค้ด JavaScript Tracking Script (`window.cdpTracker`) สำหรับนำไปติดเว็บไซต์
- `cdp_list_events` — ค้นหาและกรอง Events ตามลูกค้า, `anonymous_id`, ชื่อ Event, URL, UTM, วันที่
- `cdp_get_event_analytics` — ดูสถิติ Events, หน้า URL ยอดนิยม และรายงาน UTM Attribution

### 4. สร้าง Segments & Dashboard (Static & Real-Time)
- `cdp_create_segment` — สร้างหรือแก้ไข Segment ทั้งแบบ **`static`** และ **`realtime`** รองรับเงื่อนไขครบทั้ง 7 มิติ:
  1. `customer_attributes` (ข้อมูลลูกค้า / Tags / Custom Attributes)
  2. `event_conditions` (พฤติกรรมและจำนวนครั้งที่เกิด Event)
  3. `analytics_conditions` (ยอดซื้อ LTV, จำนวนออเดอร์, RFM Segment, Engagement Score)
  4. `url_conditions` (การเข้าชมหน้า URL)
  5. `utm_conditions` (`utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`)
  6. `date_conditions` (วันที่สมัคร, วันที่เข้าใช้งานล่าสุด, เดือนเกิด)
  7. `campaign_response_conditions` (การตอบสนองต่อ Campaign เช่น เปิดอ่าน, คลิก, ซื้อสินค้า)
- `cdp_get_segment_details` — ดูรายชื่อสมาชิกใน Segment และสั่งรีเฟรช Static Segment
- `cdp_get_segments_dashboard` — ดูหน้า Dashboard แสดงภาพรวมทั้ง **Static Segments** และ **Real-Time Segments**

### 5. ทำ Campaign หลายช่องทาง (Omnichannel Campaigns - 7 ช่องทาง)
- `cdp_get_channel_templates_schema` — ดูโครงสร้างการตั้งค่าข้อความและตัวอย่างของทั้ง 7 ช่องทาง:
  - `email`, `line`, `facebook_messenger`, `sms`, `whatsapp`, `app_push`, `web_push`
- `cdp_upsert_campaign` — ตั้งค่าข้อความ Campaign พร้อมระบบตัวแปร Personalization (`{{first_name}}`, `{{tier}}`, `{{custom_attributes.xxx}}`)
- `cdp_execute_campaign` — ส่ง Campaign ไปยัง Segment หรือรายชื่อลูกค้า พร้อมตรวจสอบสถานะ Consent อัตโนมัติ
- `cdp_record_campaign_response` — บันทึกการตอบสนอง (`opened`, `clicked`, `converted`, `bounced`, `unsubscribed`)
- `cdp_list_campaigns` — ดูรายการ Campaigns และสถิติ Open Rate, Click Rate, Conversion Rate

### 6. สร้าง Customer Journey (Journey Orchestration & Funnel)
- `cdp_upsert_journey` — สร้าง Customer Journey กำหนด Trigger (`segment`, `event`, `behavior`) และลำดับขั้นตอน (`send_campaign`, `wait`, `condition_split`, `update_profile`, `goal_check`)
- `cdp_run_journey` — สั่งรันประมวลผล Customer Journey
- `cdp_get_journey_performance` — ดูผลลัพธ์ของ Journey (Funnel รายขั้นตอน, จำนวนคนแยกตามกิ่ง Yes/No, สถิติ Campaign ใน Journey และอัตรา Conversion)
- `cdp_list_journeys` — ดูรายการ Customer Journeys ทั้งหมด

---

## คำสั่งทดสอบและเตรียมข้อมูลตัวอย่าง

```bash
# รันชุดทดสอบ End-to-End ครบทุกฟีเจอร์
npm test

# เติมข้อมูลตัวอย่างลงใน data/cdp.sqlite
npm run seed

# ล้างข้อมูลทุกตารางใน SQLite แต่คงโครงสร้างตารางไว้
npm run reset

# รัน MCP Server (stdio)
npm run start:stdio
```

`npm run reset` จะลบข้อมูลลูกค้า Events กลุ่ม แคมเปญ Journey และประวัติทั้งหมด แต่คงโครงสร้างตารางไว้ ควรหยุด MCP server ก่อนรัน หากตั้ง `CDP_DB_PATH` คำสั่ง reset จะใช้ไฟล์นั้นด้วย และสามารถเติมข้อมูลตัวอย่างใหม่ด้วย `npm run seed`

หากข้อมูลอยู่ใน Docker volume `mcp-cdp-data` ให้หยุด container ที่ใช้ฐานข้อมูลก่อน แล้วรัน:

```bash
docker run --rm --mount type=volume,source=mcp-cdp-data,target=/app/data \
  mcp-cdp node --no-warnings src/reset.js
```

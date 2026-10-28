#!/usr/bin/env node
import { getDb } from './db.js';
import { TOOLS, TOOL_MAP } from './tools.js';
import { getCustomerDatabaseOverview } from './services/customerService.js';
import { getSegmentsDashboard } from './services/segmentService.js';
import { CHANNEL_TEMPLATE_SCHEMAS, listCampaigns } from './services/campaignService.js';
import { listJourneys } from './services/journeyService.js';

const SERVER_INFO = {
  name: 'mcp-cdp',
  version: '1.0.0'
};

const RESOURCES = [
  {
    uri: 'cdp://database/overview',
    name: 'Customer Database Overview',
    description: 'ภาพรวมฐานข้อมูลลูกค้า สถิติรายได้ LTV และช่องทางที่ติดต่อได้',
    mimeType: 'application/json'
  },
  {
    uri: 'cdp://segments/dashboard',
    name: 'Segments Dashboard (Static & Real-Time)',
    description: 'หน้า Dashboard แสดงข้อมูลทั้ง Static Segments และ Real-Time Segments',
    mimeType: 'application/json'
  },
  {
    uri: 'cdp://campaigns/channel-schemas',
    name: 'Omnichannel Message Schemas (7 Channels)',
    description: 'โครงสร้างและตัวอย่างการตั้งค่าข้อความสำหรับ Email, LINE, Facebook Messenger, SMS, WhatsApp, App Push, Web Push',
    mimeType: 'application/json'
  },
  {
    uri: 'cdp://journeys/overview',
    name: 'Customer Journeys Performance Overview',
    description: 'สรุปผลการทำงานของ Customer Journeys ทั้งหมด',
    mimeType: 'application/json'
  }
];

export async function handleJsonRpcRequest(message) {
  if (!message || typeof message !== 'object') {
    return null;
  }

  const { id, method, params } = message;

  // Notifications (no id) do not require a response
  if (id === undefined || id === null) {
    return null;
  }

  try {
    switch (method) {
      case 'initialize': {
        const clientProtocol = params?.protocolVersion || '2024-11-05';
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: clientProtocol,
            capabilities: {
              tools: { listChanged: false },
              resources: { subscribe: false, listChanged: false }
            },
            serverInfo: SERVER_INFO
          }
        };
      }

      case 'ping': {
        return {
          jsonrpc: '2.0',
          id,
          result: {}
        };
      }

      case 'tools/list': {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            tools: TOOLS.map((t) => ({
              name: t.name,
              description: t.description,
              inputSchema: t.inputSchema
            }))
          }
        };
      }

      case 'tools/call': {
        const toolName = params?.name;
        const toolArgs = params?.arguments || {};
        const tool = TOOL_MAP.get(toolName);

        if (!tool) {
          return {
            jsonrpc: '2.0',
            id,
            result: {
              isError: true,
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({ error: `Unknown tool '${toolName}'` })
                }
              ]
            }
          };
        }

        try {
          const output = await tool.handler(toolArgs);
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(output, null, 2)
                }
              ]
            }
          };
        } catch (toolErr) {
          return {
            jsonrpc: '2.0',
            id,
            result: {
              isError: true,
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      error: toolErr.message || String(toolErr)
                    },
                    null,
                    2
                  )
                }
              ]
            }
          };
        }
      }

      case 'resources/list': {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            resources: RESOURCES
          }
        };
      }

      case 'resources/read': {
        const uri = params?.uri;
        let data;
        if (uri === 'cdp://database/overview') {
          data = getCustomerDatabaseOverview();
        } else if (uri === 'cdp://segments/dashboard') {
          data = getSegmentsDashboard();
        } else if (uri === 'cdp://campaigns/channel-schemas') {
          data = { schemas: CHANNEL_TEMPLATE_SCHEMAS, campaigns: listCampaigns() };
        } else if (uri === 'cdp://journeys/overview') {
          data = listJourneys();
        } else {
          throw new Error(`Resource not found: ${uri}`);
        }

        return {
          jsonrpc: '2.0',
          id,
          result: {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify(data, null, 2)
              }
            ]
          }
        };
      }

      default: {
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32601,
            message: `Method not found: ${method}`
          }
        };
      }
    }
  } catch (err) {
    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32603,
        message: err.message || 'Internal JSON-RPC error'
      }
    };
  }
}

function sendResponse(responseObj) {
  if (!responseObj) return;
  process.stdout.write(JSON.stringify(responseObj) + '\n');
}

export function startStdioServer() {
  getDb();
  let buffer = '';

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', async (chunk) => {
    buffer += chunk;

    while (true) {
      // Check if Content-Length header framing is used
      if (buffer.startsWith('Content-Length:')) {
        const headerEnd = buffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) break;
        const headerPart = buffer.slice(0, headerEnd);
        const match = headerPart.match(/Content-Length:\s*(\d+)/i);
        if (!match) break;
        const contentLength = parseInt(match[1], 10);
        const bodyStart = headerEnd + 4;
        if (buffer.length < bodyStart + contentLength) break;

        const jsonPayload = buffer.slice(bodyStart, bodyStart + contentLength);
        buffer = buffer.slice(bodyStart + contentLength);
        try {
          const parsed = JSON.parse(jsonPayload);
          const res = await handleJsonRpcRequest(parsed);
          sendResponse(res);
        } catch (err) {
          sendResponse({
            jsonrpc: '2.0',
            id: null,
            error: { code: -32700, message: `Parse error: ${err.message}` }
          });
        }
        continue;
      }

      // Standard MCP newline-delimited JSON-RPC
      const newlineIdx = buffer.indexOf('\n');
      if (newlineIdx === -1) break;

      const line = buffer.slice(0, newlineIdx).trim();
      buffer = buffer.slice(newlineIdx + 1);
      if (!line) continue;

      try {
        const parsed = JSON.parse(line);
        const res = await handleJsonRpcRequest(parsed);
        sendResponse(res);
      } catch (err) {
        sendResponse({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: `Parse error: ${err.message}` }
        });
      }
    }
  });
}

// Start server if invoked directly
if (import.meta.url === `file://${process.argv[1]}`) {
  process.stderr.write(
    `[mcp-cdp] Headless CDP MCP Server started on stdio (SQLite DB: ${process.env.CDP_DB_PATH || 'data/cdp.sqlite'})\n` +
    `[mcp-cdp] Waiting for JSON-RPC 2.0 requests on stdin... (Run "npm run demo" in another terminal to test MCP client calls)\n`
  );
  startStdioServer();
}

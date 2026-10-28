import { createServer } from 'node:http';
import { getDb } from './db.js';
import { handleJsonRpcRequest } from './index.js';

const MAX_BODY_BYTES = 1024 * 1024;
const DEFAULT_PORT = 3000;
const SUPPORTED_VERSIONS = new Set(['2025-03-26', '2025-06-18', '2025-11-25']);
const LATEST_VERSION = '2025-11-25';

function sendJson(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(body));
}

function sendRpcError(res, status, code, message, id = null) {
  sendJson(res, status, { jsonrpc: '2.0', id, error: { code, message } });
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error('Request body too large');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function createHttpMcpServer({ allowedOrigins = [] } = {}) {
  getDb();
  const origins = new Set(allowedOrigins);

  return createServer(async (req, res) => {
    if (req.headers.origin && !origins.has(req.headers.origin)) {
      sendRpcError(res, 403, -32000, 'Origin is not allowed');
      return;
    }
    if (req.url === '/health' && req.method === 'GET') {
      sendJson(res, 200, { status: 'ok' });
      return;
    }
    if (req.url !== '/mcp') {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }

    if (req.method === 'GET' || req.method === 'DELETE') {
      res.writeHead(405, { Allow: 'POST' });
      res.end();
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { Allow: 'POST' });
      res.end();
      return;
    }

    const version = req.headers['mcp-protocol-version'];
    if (version && !SUPPORTED_VERSIONS.has(version)) {
      sendRpcError(res, 400, -32600, 'Unsupported MCP-Protocol-Version');
      return;
    }
    if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) {
      sendRpcError(res, 415, -32600, 'Content-Type must be application/json');
      return;
    }
    const accept = req.headers.accept || '';
    if (!accept.includes('application/json') || !accept.includes('text/event-stream')) {
      sendRpcError(res, 406, -32600, 'Accept must include application/json and text/event-stream');
      return;
    }

    let message;
    try {
      message = JSON.parse(await readBody(req));
    } catch (error) {
      sendRpcError(res, error.status || 400, error.status ? -32600 : -32700, error.message);
      return;
    }

    if (!message || Array.isArray(message) || typeof message !== 'object' || message.jsonrpc !== '2.0') {
      sendRpcError(res, 400, -32600, 'Invalid JSON-RPC message');
      return;
    }
    if (message.method !== undefined && typeof message.method !== 'string') {
      sendRpcError(res, 400, -32600, 'Invalid JSON-RPC method');
      return;
    }
    if (message.id !== undefined && message.id !== null &&
        typeof message.id !== 'string' && typeof message.id !== 'number') {
      sendRpcError(res, 400, -32600, 'Invalid JSON-RPC id');
      return;
    }
    if (message.method === undefined && message.id === undefined) {
      sendRpcError(res, 400, -32600, 'Invalid JSON-RPC message');
      return;
    }
    if (message.method === undefined) {
      if (message.result === undefined && message.error === undefined) {
        sendRpcError(res, 400, -32600, 'Invalid JSON-RPC response');
        return;
      }
      res.writeHead(202);
      res.end();
      return;
    }

    try {
      const response = await handleJsonRpcRequest(message);
      if (!response) {
        res.writeHead(202);
        res.end();
        return;
      }
      if (message.method === 'initialize') {
        response.result.protocolVersion = SUPPORTED_VERSIONS.has(message.params?.protocolVersion)
          ? message.params.protocolVersion
          : LATEST_VERSION;
      }
      sendJson(res, 200, response);
    } catch (error) {
      sendRpcError(res, 500, -32603, error.message || 'Internal error', message.id ?? null);
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT || DEFAULT_PORT);
  const host = process.env.HOST || '127.0.0.1';
  const allowedOrigins = (process.env.MCP_ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const server = createHttpMcpServer({ allowedOrigins });
  server.listen(port, host, () => {
    process.stderr.write(`[mcp-cdp] Streamable HTTP listening on http://${host}:${port}/mcp\n`);
  });
}

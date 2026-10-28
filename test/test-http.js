import assert from 'node:assert/strict';

process.env.CDP_DB_PATH = ':memory:';
const { createHttpMcpServer } = await import('../src/http.js');
const server = createHttpMcpServer();
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/mcp`;

async function post(message, extraHeaders = {}) {
  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...extraHeaders
    },
    body: JSON.stringify(message)
  });
}

try {
  const health = await fetch(`http://127.0.0.1:${server.address().port}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok' });

  const badOrigin = await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { Origin: 'https://evil.example' });
  assert.equal(badOrigin.status, 403);

  const init = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } });
  assert.equal(init.status, 200);
  assert.equal(init.headers.get('content-type').split(';')[0], 'application/json');
  assert.equal((await init.json()).result.protocolVersion, '2025-11-25');

  const notification = await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.equal(notification.status, 202);
  assert.equal(await notification.text(), '');

  const tools = await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, { 'MCP-Protocol-Version': '2025-11-25' });
  assert.equal(tools.status, 200);
  assert.ok((await tools.json()).result.tools.length >= 20);

  const overview = await post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'cdp_get_database_overview', arguments: {} } });
  assert.equal(overview.status, 200);
  assert.equal(JSON.parse((await overview.json()).result.content[0].text).total_customers, 0);

  const get = await fetch(url, { headers: { Accept: 'text/event-stream' } });
  assert.equal(get.status, 405);

  const badVersion = await post({ jsonrpc: '2.0', id: 4, method: 'ping' }, { 'MCP-Protocol-Version': 'invalid' });
  assert.equal(badVersion.status, 400);

  console.log('[PASS] Streamable HTTP without token: initialize, notification, tools, Origin and version checks');
} finally {
  await new Promise((resolve) => server.close(resolve));
}

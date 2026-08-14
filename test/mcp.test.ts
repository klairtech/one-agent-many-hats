/**
 * MCP is exercised against a real server: a tiny stdio server written for the test, so
 * the handshake, framing, tools/list and tools/call are proven rather than assumed.
 */

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { McpManager, mcpToolName, parseMcpToolName } from '../src/mcp/index.js';
import { parseSseForResponse, renderMcpResult } from '../src/mcp/client.js';
import { matchesGlob } from '../src/engine/compose.js';
import { cleanup, tempHome } from './helpers.js';

const SERVER = `
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let i;
  while ((i = buffer.indexOf('\\n')) !== -1) {
    const line = buffer.slice(0, i).trim();
    buffer = buffer.slice(i + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.method === 'initialize') {
      reply(msg.id, { protocolVersion: '2025-06-18', serverInfo: { name: 'probe', version: '9.9' }, capabilities: { tools: {} } });
    } else if (msg.method === 'tools/list') {
      reply(msg.id, { tools: [
        { name: 'echo', description: 'Echo text back.', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }, annotations: { readOnlyHint: true } },
        { name: 'wipe', description: 'Pretends to delete things.', inputSchema: { type: 'object', properties: {} } }
      ] });
    } else if (msg.method === 'tools/call') {
      const name = msg.params.name;
      if (name === 'echo') reply(msg.id, { content: [{ type: 'text', text: 'echo: ' + msg.params.arguments.text }] });
      else reply(msg.id, { content: [{ type: 'text', text: 'nope' }], isError: true });
    }
  }
});
function reply(id, result) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n'); }
`;

async function withServer(): Promise<{ file: string; dir: string }> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'hats-mcp-'));
  const file = path.join(dir, 'server.mjs');
  await fsp.writeFile(file, SERVER, 'utf8');
  return { file, dir };
}

test('connects to a real stdio MCP server and exposes its tools', async () => {
  const home = await tempHome();
  const { file, dir } = await withServer();
  const manager = new McpManager({ probe: { command: process.execPath, args: [file] } });

  const connections = await manager.connectAll();
  assert.equal(connections.length, 1);
  assert.equal(connections[0]?.ok, true, connections[0]?.error);
  assert.equal(connections[0]?.toolCount, 2);
  assert.equal(connections[0]?.protocolVersion, '2025-06-18');
  assert.equal(connections[0]?.serverVersion, '9.9');

  const names = manager.handlers.map((h) => h.spec.name);
  assert.deepEqual(names, ['mcp__probe__echo', 'mcp__probe__wipe']);

  await manager.close();
  await cleanup(home, dir);
});

test('a tool the server does not mark read-only is treated as mutating', async () => {
  const home = await tempHome();
  const { file, dir } = await withServer();
  const manager = new McpManager({ probe: { command: process.execPath, args: [file] } });
  await manager.connectAll();

  const echo = manager.handlers.find((h) => h.spec.name === 'mcp__probe__echo');
  const wipe = manager.handlers.find((h) => h.spec.name === 'mcp__probe__wipe');

  assert.equal(echo?.spec.mutating, false, 'readOnlyHint should be honoured');
  assert.equal(echo?.spec.minProfile, 'read-only');
  // No annotation means unknown, and unknown means treated as capable of change.
  assert.equal(wipe?.spec.mutating, true);
  assert.equal(wipe?.spec.minProfile, 'assisted');

  await manager.close();
  await cleanup(home, dir);
});

test('calls a real MCP tool through a handler and surfaces server errors', async () => {
  const home = await tempHome();
  const { file, dir } = await withServer();
  const manager = new McpManager({ probe: { command: process.execPath, args: [file] } });
  await manager.connectAll();

  const ctx = { config: { limits: { maxToolOutputChars: 4000 } } } as never;
  const echo = manager.handlers.find((h) => h.spec.name === 'mcp__probe__echo');
  const ok = await echo!.run({ text: 'hello' }, ctx);
  assert.match(ok.summary, /echo: hello/);
  assert.ok(!ok.failed);

  const wipe = manager.handlers.find((h) => h.spec.name === 'mcp__probe__wipe');
  const bad = await wipe!.run({}, ctx);
  assert.equal(bad.failed, true, 'isError must reach the loop as a failed observation');

  await manager.close();
  await cleanup(home, dir);
});

test('a server that cannot start degrades the session instead of failing it', async () => {
  const home = await tempHome();
  const manager = new McpManager({
    broken: { command: path.join(os.tmpdir(), 'definitely-not-a-real-binary-xyz') },
  });
  const connections = await manager.connectAll();
  assert.equal(connections[0]?.ok, false);
  assert.ok(connections[0]?.error);
  assert.equal(manager.handlers.length, 0);
  await manager.close();
  await cleanup(home);
});

test('tool names round-trip and cannot shadow a built-in', () => {
  assert.equal(mcpToolName('playwright', 'browser_click'), 'mcp__playwright__browser_click');
  assert.deepEqual(parseMcpToolName('mcp__playwright__browser_click'), {
    server: 'playwright',
    tool: 'browser_click',
  });
  assert.equal(parseMcpToolName('read_file'), null);
});

test('skills can allowlist MCP tools by pattern', () => {
  assert.equal(matchesGlob('mcp__playwright__click', 'mcp__*'), true);
  assert.equal(matchesGlob('mcp__playwright__click', 'mcp__playwright__*'), true);
  assert.equal(matchesGlob('mcp__files__read', 'mcp__playwright__*'), false);
  assert.equal(matchesGlob('read_file', 'mcp__*'), false);
});

test('MCP content blocks flatten into a readable observation', () => {
  const rendered = renderMcpResult({
    content: [
      { type: 'text', text: 'line one' },
      { type: 'resource', resource: { uri: 'file:///a.txt', text: 'contents' } },
      { type: 'image', mimeType: 'image/png' },
    ],
  });
  assert.match(rendered.text, /line one/);
  assert.match(rendered.text, /file:\/\/\/a\.txt/);
  assert.match(rendered.text, /image/);
});

test('an SSE-framed reply is parsed', () => {
  const parsed = parseSseForResponse('event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n\n');
  assert.deepEqual(parsed?.result, { ok: true });
});

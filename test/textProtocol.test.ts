import assert from 'node:assert/strict';
import test from 'node:test';

import { parseTextToolCalls, renderToolsForPrompt } from '../src/providers/textProtocol.js';
import { toTextProtocolRequest } from '../src/providers/base.js';

test('parses the documented fence', () => {
  const parsed = parseTextToolCalls(
    'I will look.\n\n```hats:tool\n{"name": "read_file", "args": {"path": "a.ts"}}\n```',
  );
  assert.equal(parsed.toolCalls.length, 1);
  assert.equal(parsed.toolCalls[0]?.name, 'read_file');
  assert.deepEqual(parsed.toolCalls[0]?.args, { path: 'a.ts' });
  assert.equal(parsed.text, 'I will look.');
});

test('tolerates the shapes small models actually emit', () => {
  const jsonFence = parseTextToolCalls('```json\n{"tool":"list_dir","arguments":{"path":"."}}\n```');
  assert.equal(jsonFence.toolCalls[0]?.name, 'list_dir');

  const bare = parseTextToolCalls('Sure: {"name": "list_dir", "args": {"path": "src"}}');
  assert.equal(bare.toolCalls[0]?.name, 'list_dir');

  const stringArgs = parseTextToolCalls(
    '```hats:tool\n{"name":"read_file","arguments":"{\\"path\\":\\"a.ts\\"}"}\n```',
  );
  assert.deepEqual(stringArgs.toolCalls[0]?.args, { path: 'a.ts' });
});

test('prose with no call is left alone', () => {
  const parsed = parseTextToolCalls('There are three files. No action needed.');
  assert.equal(parsed.toolCalls.length, 0);
  assert.match(parsed.text, /three files/);
});

test('the rendered catalogue names every tool and its arguments', () => {
  const rendered = renderToolsForPrompt([
    {
      name: 'read_file',
      description: 'Read a file.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'the path' } },
        required: ['path'],
      },
    },
  ]);
  assert.match(rendered, /read_file/);
  assert.match(rendered, /path: string/);
  assert.match(rendered, /hats:tool/);
});

test('degrading mid-run keeps the conversation coherent', () => {
  const rewritten = toTextProtocolRequest({
    model: 'm',
    system: 'base',
    messages: [
      { role: 'user', content: 'count files' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'c1', name: 'list_dir', args: { path: '.' } }],
      },
      { role: 'tool', content: '3 files', toolCallId: 'c1', name: 'list_dir' },
    ],
    tools: [
      { name: 'list_dir', description: 'List a directory.', parameters: { type: 'object', properties: {} } },
    ],
  });

  assert.equal(rewritten.tools.length, 0, 'tools move into the prompt');
  assert.match(rewritten.system, /list_dir/);
  assert.equal(rewritten.messages[1]?.role, 'assistant');
  assert.match(rewritten.messages[1]?.content ?? '', /hats:tool/);
  assert.equal(rewritten.messages[2]?.role, 'user', 'observations become user turns');
  assert.match(rewritten.messages[2]?.content ?? '', /3 files/);
});

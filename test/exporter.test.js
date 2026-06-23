// test/exporter.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toMarkdown } from '../src/exporter.js';

const messages = [
  { uuid: 'u1', role: 'user', type: 'user', ts: '2026-06-23T00:00:00Z', isMeta: false, isSidechain: false,
    blocks: [{ kind: 'text', text: 'hello' }] },
  { uuid: 'a1', role: 'assistant', type: 'assistant', ts: '2026-06-23T00:00:01Z', isMeta: false, isSidechain: false,
    blocks: [
      { kind: 'thinking', text: 'secret' },
      { kind: 'text', text: 'hi there' },
      { kind: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }
    ]},
  { uuid: 'u2', role: 'user', type: 'user', ts: null, isMeta: false, isSidechain: false,
    blocks: [{ kind: 'tool_result', toolUseId: 't1', text: 'file.txt' }] }
];

test('renders whole conversation with role headers', () => {
  const md = toMarkdown(messages);
  assert.match(md, /## User/);
  assert.match(md, /## Assistant/);
  assert.match(md, /hello/);
  assert.match(md, /hi there/);
  assert.match(md, /Bash/);
  assert.match(md, /ls/);
});

test('selection by uuids exports only chosen messages', () => {
  const md = toMarkdown(messages, ['u1']);
  assert.match(md, /hello/);
  assert.doesNotMatch(md, /hi there/);
});

test('thinking blocks are excluded from export', () => {
  const md = toMarkdown(messages);
  assert.doesNotMatch(md, /secret/);
});

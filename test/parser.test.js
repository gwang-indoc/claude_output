// test/parser.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLine, NOISE_TYPES } from '../src/parser.js';

test('parses user message with string content', () => {
  const line = JSON.stringify({
    type: 'user', uuid: 'u1', timestamp: '2026-06-23T00:00:00Z',
    isMeta: false, isSidechain: false,
    message: { role: 'user', content: 'hello world' }
  });
  const m = parseLine(line);
  assert.equal(m.role, 'user');
  assert.equal(m.uuid, 'u1');
  assert.equal(m.ts, '2026-06-23T00:00:00Z');
  assert.deepEqual(m.blocks, [{ kind: 'text', text: 'hello world' }]);
});

test('parses assistant message with text, thinking, tool_use blocks', () => {
  const line = JSON.stringify({
    type: 'assistant', uuid: 'a1', timestamp: '2026-06-23T00:00:01Z',
    message: { role: 'assistant', content: [
      { type: 'thinking', thinking: 'hmm' },
      { type: 'text', text: 'answer' },
      { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }
    ]}
  });
  const m = parseLine(line);
  assert.equal(m.role, 'assistant');
  assert.deepEqual(m.blocks, [
    { kind: 'thinking', text: 'hmm' },
    { kind: 'text', text: 'answer' },
    { kind: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }
  ]);
});

test('parses tool_result inside user content (string and array forms)', () => {
  const strForm = JSON.stringify({
    type: 'user', uuid: 'u2',
    message: { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 't1', content: 'done' }
    ]}
  });
  assert.deepEqual(parseLine(strForm).blocks, [
    { kind: 'tool_result', toolUseId: 't1', text: 'done' }
  ]);

  const arrForm = JSON.stringify({
    type: 'user', uuid: 'u3',
    message: { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 't2',
        content: [{ type: 'text', text: 'line1' }, { type: 'text', text: 'line2' }] }
    ]}
  });
  assert.deepEqual(parseLine(arrForm).blocks, [
    { kind: 'tool_result', toolUseId: 't2', text: 'line1\nline2' }
  ]);
});

test('parses attachment', () => {
  const line = JSON.stringify({
    type: 'attachment', uuid: 'at1',
    attachment: { type: 'hook_success', hookName: 'SessionStart', content: 'hi' }
  });
  assert.deepEqual(parseLine(line).blocks, [
    { kind: 'attachment', attType: 'hook_success', name: 'SessionStart', text: 'hi' }
  ]);
});

test('returns null for noise and blank lines', () => {
  for (const t of NOISE_TYPES) {
    assert.equal(parseLine(JSON.stringify({ type: t })), null);
  }
  assert.equal(parseLine('   '), null);
});

test('returns null for malformed JSON (never throws)', () => {
  assert.equal(parseLine('{not json'), null);
});

test('unknown type yields fallback text block, not dropped', () => {
  const line = JSON.stringify({ type: 'mystery', uuid: 'x1', foo: 1 });
  const m = parseLine(line);
  assert.equal(m.type, 'mystery');
  assert.equal(m.blocks.length, 1);
  assert.equal(m.blocks[0].kind, 'text');
});

// test/watcher.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Watcher } from '../src/watcher.js';

function waitFor(emitter, event, predicate, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout waiting for ' + event)), timeoutMs);
    emitter.on(event, payload => {
      if (predicate(payload)) { clearTimeout(timer); resolve(payload); }
    });
  });
}

test('emits append events for newly written complete lines', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'csm-watch-'));
  const file = path.join(dir, 's.jsonl');
  await fs.writeFile(file, ''); // start empty
  const w = new Watcher();
  const got = waitFor(w, 'append', p => p.sessionId === 's' && p.messages.length > 0);
  await w.watch('s', file, 0);
  const line = JSON.stringify({ type: 'user', uuid: 'u1', message: { role: 'user', content: 'hi' } }) + '\n';
  await fs.appendFile(file, line);
  const payload = await got;
  assert.equal(payload.messages[0].blocks[0].text, 'hi');
  w.unwatch('s');
});

test('buffers a partial line until its newline arrives', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'csm-watch-'));
  const file = path.join(dir, 's.jsonl');
  await fs.writeFile(file, '');
  const w = new Watcher();
  await w.watch('s', file, 0);
  const full = JSON.stringify({ type: 'user', uuid: 'u9', message: { role: 'user', content: 'done' } }) + '\n';
  const half = full.slice(0, 20);
  const rest = full.slice(20);
  await fs.appendFile(file, half);          // partial — should NOT emit yet
  const got = waitFor(w, 'append', p => p.messages.some(m => m.uuid === 'u9'));
  await fs.appendFile(file, rest);          // completes the line
  const payload = await got;
  assert.ok(payload.messages.some(m => m.uuid === 'u9'));
  w.unwatch('s');
});

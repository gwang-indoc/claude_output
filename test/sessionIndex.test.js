// test/sessionIndex.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildIndex } from '../src/sessionIndex.js';

async function makeFixture() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'csm-idx-'));
  const projA = path.join(base, '-Users-gwang-foo');
  const projB = path.join(base, '-Users-gwang-bar');
  await fs.mkdir(projA, { recursive: true });
  await fs.mkdir(projB, { recursive: true });
  await fs.writeFile(path.join(projA, 'aaaaaaaa-1111-2222-3333-444444444444.jsonl'), 'x');
  await fs.writeFile(path.join(projB, 'bbbbbbbb-1111-2222-3333-444444444444.jsonl'), 'y');
  return base;
}

test('groups sessions by project and decodes cwd', async () => {
  const base = await makeFixture();
  const now = Date.now();
  const index = await buildIndex(base, now);
  const projects = index.map(p => p.projectPath).sort();
  assert.deepEqual(projects, ['/Users/gwang/bar', '/Users/gwang/foo']);
  const foo = index.find(p => p.projectPath === '/Users/gwang/foo');
  assert.equal(foo.sessions.length, 1);
  assert.match(foo.sessions[0].id, /^aaaaaaaa/);
});

test('marks live when mtime within 10s, sorts projects by recent activity', async () => {
  const base = await makeFixture();
  const fooFile = path.join(base, '-Users-gwang-foo', 'aaaaaaaa-1111-2222-3333-444444444444.jsonl');
  const old = new Date(Date.now() - 60_000);
  await fs.utimes(fooFile, old, old);   // foo is stale
  const now = Date.now();
  const index = await buildIndex(base, now);
  const foo = index.find(p => p.projectPath === '/Users/gwang/foo');
  const bar = index.find(p => p.projectPath === '/Users/gwang/bar');
  assert.equal(foo.sessions[0].live, false);
  assert.equal(bar.sessions[0].live, true);
  // bar (recent) should sort before foo (stale)
  assert.equal(index[0].projectPath, '/Users/gwang/bar');
});

test('missing base dir returns empty array', async () => {
  const index = await buildIndex('/no/such/dir/xyz', Date.now());
  assert.deepEqual(index, []);
});

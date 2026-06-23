# Claude Code Session Monitor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local Node.js web app that tails Claude Code session transcript files and streams their input/output to a browser in near-realtime as a readable chat view, with Markdown export.

**Architecture:** A Node backend (Express + `ws`) scans `~/.claude/projects/`, parses append-only JSONL transcripts into normalized messages, and pushes history + live appends to a vanilla browser frontend over WebSocket. The frontend renders multiple sessions as chat panels and exports selected/whole sessions to Markdown.

**Tech Stack:** Node.js (built-in `node:test` for tests, `fs.watch` for tailing), Express, `ws`, `marked` + `highlight.js` (served from `node_modules`), vanilla HTML/CSS/JS.

---

## File Structure

- `package.json` — deps, scripts, `"type": "module"`
- `.gitignore` — `node_modules`
- `src/parser.js` — JSONL line → normalized message object
- `src/sessionIndex.js` — scan project dirs, group/sort sessions, live flag
- `src/exporter.js` — messages → Markdown string
- `src/watcher.js` — per-session file tail (byte offset + partial-line buffer)
- `src/paths.js` — shared constants (base dir) + session-file resolution/validation
- `src/server.js` — Express HTTP endpoints + static serve + WebSocket handler
- `public/index.html` — sidebar + panels shell, loads vendor libs
- `public/style.css` — chat layout + sidebar styling
- `public/render.js` — message object → HTML (markdown, highlight, collapsible tools)
- `public/app.js` — WS manager, panels, sidebar, selection, export
- `test/parser.test.js`, `test/sessionIndex.test.js`, `test/exporter.test.js`, `test/watcher.test.js`

**Normalized message shape (used across all tasks — keep identical):**

```js
// message
{
  uuid: string,
  role: 'user' | 'assistant' | 'system',
  type: string,            // original transcript "type"
  ts: string | null,       // ISO timestamp or null
  isMeta: boolean,
  isSidechain: boolean,
  blocks: Block[]
}
// Block is one of:
{ kind: 'text', text: string }
{ kind: 'thinking', text: string }
{ kind: 'tool_use', id: string, name: string, input: object }
{ kind: 'tool_result', toolUseId: string, text: string }
{ kind: 'attachment', attType: string, name: string, text: string }
```

---

## Task 0: Project scaffold

**Files:**
- Create: `package.json`
- Create: `.gitignore`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "claude-session-monitor",
  "version": "0.1.0",
  "type": "module",
  "description": "Browser-based near-realtime viewer for Claude Code CLI sessions",
  "scripts": {
    "start": "node src/server.js",
    "test": "node --test"
  },
  "dependencies": {
    "express": "^4.21.2",
    "ws": "^8.18.0",
    "marked": "^14.1.3",
    "highlight.js": "^11.10.0"
  }
}
```

- [ ] **Step 2: Create `.gitignore`**

```
node_modules
```

- [ ] **Step 3: Install dependencies**

Run: `npm install`
Expected: `node_modules/` created, no errors, `express`/`ws`/`marked`/`highlight.js` present.

- [ ] **Step 4: Verify test runner works**

Run: `npm test`
Expected: exits 0 with "tests 0" (no test files yet) — confirms `node --test` runs.

- [ ] **Step 5: Commit**

```bash
git add package.json .gitignore package-lock.json
git commit -m "chore: scaffold session monitor project"
```

---

## Task 1: Parser

**Files:**
- Create: `src/parser.js`
- Test: `test/parser.test.js`

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/parser.test.js`
Expected: FAIL — cannot import `parseLine` from `../src/parser.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/parser.js

// Transcript types we intentionally do not display.
export const NOISE_TYPES = new Set([
  'mode', 'permission-mode', 'file-history-snapshot', 'last-prompt'
]);

function flattenToolResultContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map(b => (typeof b === 'string' ? b : (b.text ?? '')))
      .join('\n');
  }
  return '';
}

function blocksFromContent(content) {
  if (typeof content === 'string') {
    return [{ kind: 'text', text: content }];
  }
  if (!Array.isArray(content)) return [];
  const blocks = [];
  for (const b of content) {
    switch (b.type) {
      case 'text':
        blocks.push({ kind: 'text', text: b.text ?? '' });
        break;
      case 'thinking':
        blocks.push({ kind: 'thinking', text: b.thinking ?? '' });
        break;
      case 'tool_use':
        blocks.push({ kind: 'tool_use', id: b.id ?? '', name: b.name ?? '', input: b.input ?? {} });
        break;
      case 'tool_result':
        blocks.push({ kind: 'tool_result', toolUseId: b.tool_use_id ?? '', text: flattenToolResultContent(b.content) });
        break;
      default:
        blocks.push({ kind: 'text', text: JSON.stringify(b) });
    }
  }
  return blocks;
}

export function parseLine(line) {
  if (!line || !line.trim()) return null;
  let obj;
  try {
    obj = JSON.parse(line);
  } catch {
    return null;
  }
  const type = obj.type;
  if (!type || NOISE_TYPES.has(type)) return null;

  const base = {
    uuid: obj.uuid ?? '',
    role: 'system',
    type,
    ts: obj.timestamp ?? null,
    isMeta: Boolean(obj.isMeta),
    isSidechain: Boolean(obj.isSidechain)
  };

  if (type === 'user' || type === 'assistant') {
    return { ...base, role: type, blocks: blocksFromContent(obj.message?.content) };
  }
  if (type === 'attachment') {
    const a = obj.attachment ?? {};
    return { ...base, role: 'system', blocks: [{
      kind: 'attachment',
      attType: a.type ?? '',
      name: a.hookName ?? a.toolName ?? '',
      text: typeof a.content === 'string' ? a.content : JSON.stringify(a.content ?? '')
    }]};
  }
  // Unknown/other (e.g. 'system') — fallback so nothing is silently dropped.
  return { ...base, blocks: [{ kind: 'text', text: typeof obj.content === 'string' ? obj.content : JSON.stringify(obj) }] };
}

// Parse a whole file's text into messages (drops nulls).
export function parseAll(text) {
  return text.split('\n').map(parseLine).filter(Boolean);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/parser.test.js`
Expected: PASS — all parser tests green.

- [ ] **Step 5: Commit**

```bash
git add src/parser.js test/parser.test.js
git commit -m "feat: add JSONL transcript parser"
```

---

## Task 2: Path resolution helper

**Files:**
- Create: `src/paths.js`

(No dedicated test — exercised by sessionIndex and server tests. Pure helpers, small.)

- [ ] **Step 1: Write implementation**

```js
// src/paths.js
import os from 'node:os';
import path from 'node:path';

export const BASE_DIR = path.join(os.homedir(), '.claude', 'projects');

// Decode an encoded project dir name back to its original cwd path.
// Claude Code replaces path separators with '-', e.g. "-Users-gwang-foo".
export function decodeCwd(dirName) {
  return dirName.replace(/-/g, '/');
}

// A session id is a uuid; validate to prevent path traversal.
const ID_RE = /^[0-9a-fA-F-]{36}$/;
export function isValidSessionId(id) {
  return typeof id === 'string' && ID_RE.test(id);
}
```

- [ ] **Step 2: Sanity check it loads**

Run: `node -e "import('./src/paths.js').then(m=>console.log(m.BASE_DIR, m.isValidSessionId('2681ac41-b487-41e9-8bb2-730168db8975')))"`
Expected: prints the base dir path and `true`.

- [ ] **Step 3: Commit**

```bash
git add src/paths.js
git commit -m "feat: add path resolution and session-id validation helpers"
```

---

## Task 3: Session index

**Files:**
- Create: `src/sessionIndex.js`
- Test: `test/sessionIndex.test.js`

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/sessionIndex.test.js`
Expected: FAIL — cannot import `buildIndex`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/sessionIndex.js
import fs from 'node:fs/promises';
import path from 'node:path';
import { BASE_DIR, decodeCwd } from './paths.js';

const LIVE_WINDOW_MS = 10_000;

// Build the grouped, sorted session index. `baseDir` and `now` are injectable for tests.
export async function buildIndex(baseDir = BASE_DIR, now = Date.now()) {
  let dirents;
  try {
    dirents = await fs.readdir(baseDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const projects = [];
  for (const d of dirents) {
    if (!d.isDirectory()) continue;
    const projectDir = path.join(baseDir, d.name);
    let files;
    try {
      files = await fs.readdir(projectDir);
    } catch {
      continue;
    }
    const sessions = [];
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const filePath = path.join(projectDir, f);
      let st;
      try {
        st = await fs.stat(filePath);
      } catch {
        continue;
      }
      const mtime = st.mtimeMs;
      sessions.push({
        id: f.replace(/\.jsonl$/, ''),
        file: filePath,
        mtime,
        sizeBytes: st.size,
        live: now - mtime < LIVE_WINDOW_MS
      });
    }
    if (sessions.length === 0) continue;
    sessions.sort((a, b) => b.mtime - a.mtime);
    projects.push({
      projectDir: d.name,
      projectPath: decodeCwd(d.name),
      latestMtime: sessions[0].mtime,
      sessions
    });
  }
  projects.sort((a, b) => b.latestMtime - a.latestMtime);
  return projects;
}

// Find a session's file path by id across all projects (or null if unknown).
export async function resolveSessionFile(id, baseDir = BASE_DIR) {
  const index = await buildIndex(baseDir);
  for (const p of index) {
    const s = p.sessions.find(s => s.id === id);
    if (s) return s.file;
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/sessionIndex.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sessionIndex.js test/sessionIndex.test.js
git commit -m "feat: add session index (grouping, sorting, live flag)"
```

---

## Task 4: Exporter

**Files:**
- Create: `src/exporter.js`
- Test: `test/exporter.test.js`

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/exporter.test.js`
Expected: FAIL — cannot import `toMarkdown`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/exporter.js
const ROLE_HEADERS = { user: '## User', assistant: '## Assistant', system: '## System' };

function blockToMarkdown(block) {
  switch (block.kind) {
    case 'text':
      return block.text;
    case 'thinking':
      return null; // omit private reasoning from exports
    case 'tool_use':
      return `**Tool call: ${block.name}**\n\n\`\`\`json\n${JSON.stringify(block.input, null, 2)}\n\`\`\``;
    case 'tool_result':
      return `**Tool result:**\n\n\`\`\`\n${block.text}\n\`\`\``;
    case 'attachment':
      return `**Attachment (${block.attType}${block.name ? ': ' + block.name : ''}):**\n\n${block.text}`;
    default:
      return null;
  }
}

export function toMarkdown(messages, uuids = null) {
  const selected = uuids ? messages.filter(m => uuids.includes(m.uuid)) : messages;
  const parts = [];
  for (const m of selected) {
    const header = ROLE_HEADERS[m.role] ?? '## Message';
    const ts = m.ts ? ` _(${m.ts})_` : '';
    const body = m.blocks.map(blockToMarkdown).filter(b => b != null).join('\n\n');
    if (!body.trim()) continue;
    parts.push(`${header}${ts}\n\n${body}`);
  }
  return parts.join('\n\n---\n\n') + '\n';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/exporter.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/exporter.js test/exporter.test.js
git commit -m "feat: add Markdown exporter"
```

---

## Task 5: Watcher

**Files:**
- Create: `src/watcher.js`
- Test: `test/watcher.test.js`

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/watcher.test.js`
Expected: FAIL — cannot import `Watcher`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/watcher.js
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { parseLine } from './parser.js';

// Tails session files. Tracks per-session byte offset + partial-line buffer.
// Events: 'append' {sessionId, messages}, 'error' {sessionId, error}.
export class Watcher extends EventEmitter {
  constructor() {
    super();
    this.subs = new Map(); // sessionId -> { file, offset, buffer, fsWatcher, reading, pending }
  }

  async watch(sessionId, file, startOffset = 0) {
    this.unwatch(sessionId);
    const sub = { file, offset: startOffset, buffer: '', fsWatcher: null, reading: false, pending: false };
    this.subs.set(sessionId, sub);
    try {
      sub.fsWatcher = fs.watch(file, () => this._read(sessionId));
    } catch (error) {
      this.emit('error', { sessionId, error });
      return;
    }
    // Read anything already past startOffset (in case file grew between stat and watch).
    await this._read(sessionId);
  }

  unwatch(sessionId) {
    const sub = this.subs.get(sessionId);
    if (!sub) return;
    if (sub.fsWatcher) sub.fsWatcher.close();
    this.subs.delete(sessionId);
  }

  async _read(sessionId) {
    const sub = this.subs.get(sessionId);
    if (!sub) return;
    // Coalesce overlapping reads triggered by rapid fs.watch events.
    if (sub.reading) { sub.pending = true; return; }
    sub.reading = true;
    try {
      let st;
      try {
        st = await fsp.stat(sub.file);
      } catch (error) {
        this.emit('error', { sessionId, error });
        return;
      }
      if (st.size < sub.offset) sub.offset = 0; // file truncated/rotated
      if (st.size > sub.offset) {
        const stream = fs.createReadStream(sub.file, { start: sub.offset, end: st.size - 1, encoding: 'utf8' });
        let chunk = '';
        for await (const part of stream) chunk += part;
        sub.offset = st.size;
        sub.buffer += chunk;
        const newlineIdx = sub.buffer.lastIndexOf('\n');
        if (newlineIdx >= 0) {
          const complete = sub.buffer.slice(0, newlineIdx);
          sub.buffer = sub.buffer.slice(newlineIdx + 1);
          const messages = complete.split('\n').map(parseLine).filter(Boolean);
          if (messages.length > 0) this.emit('append', { sessionId, messages });
        }
      }
    } finally {
      sub.reading = false;
      if (sub.pending) { sub.pending = false; this._read(sessionId); }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/watcher.test.js`
Expected: PASS — both append and partial-line buffering tests green.

- [ ] **Step 5: Commit**

```bash
git add src/watcher.js test/watcher.test.js
git commit -m "feat: add file watcher with byte-offset tailing and partial-line buffering"
```

---

## Task 6: Backend server (HTTP + WebSocket)

**Files:**
- Create: `src/server.js`

(Verified manually in Step 4 — full automated HTTP/WS test is deferred to the integration step to keep this task bite-sized.)

- [ ] **Step 1: Write implementation**

```js
// src/server.js
import express from 'express';
import { WebSocketServer } from 'ws';
import http from 'node:http';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildIndex, resolveSessionFile } from './sessionIndex.js';
import { parseAll } from './parser.js';
import { toMarkdown } from './exporter.js';
import { Watcher } from './watcher.js';
import { isValidSessionId } from './paths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = process.env.PORT || 4567;
const HOST = '127.0.0.1'; // localhost only

const app = express();
app.use(express.json());
app.use(express.static(path.join(ROOT, 'public')));
// Serve vendored frontend libs.
app.use('/vendor/marked', express.static(path.join(ROOT, 'node_modules/marked/lib')));
app.use('/vendor/highlight', express.static(path.join(ROOT, 'node_modules/highlight.js/styles')));
app.use('/vendor/highlight-es', express.static(path.join(ROOT, 'node_modules/highlight.js/es')));

app.get('/api/sessions', async (req, res) => {
  res.json(await buildIndex());
});

app.get('/api/session/:id', async (req, res) => {
  const { id } = req.params;
  if (!isValidSessionId(id)) return res.status(400).json({ error: 'invalid session id' });
  const file = await resolveSessionFile(id);
  if (!file) return res.status(404).json({ error: 'session not found' });
  const text = await fsp.readFile(file, 'utf8');
  res.json({ id, messages: parseAll(text) });
});

app.post('/api/export', async (req, res) => {
  const { sessionId, uuids } = req.body || {};
  if (!isValidSessionId(sessionId)) return res.status(400).json({ error: 'invalid session id' });
  const file = await resolveSessionFile(sessionId);
  if (!file) return res.status(404).json({ error: 'session not found' });
  const text = await fsp.readFile(file, 'utf8');
  const md = toMarkdown(parseAll(text), Array.isArray(uuids) ? uuids : null);
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${sessionId}.md"`);
  res.send(md);
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  const watcher = new Watcher();
  const subscriptions = new Set();

  const onAppend = ({ sessionId, messages }) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'append', sessionId, messages }));
  };
  const onError = ({ sessionId, error }) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'error', sessionId, error: String(error) }));
  };
  watcher.on('append', onAppend);
  watcher.on('error', onError);

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.subscribe && isValidSessionId(msg.subscribe)) {
      const id = msg.subscribe;
      if (subscriptions.has(id)) return;
      const file = await resolveSessionFile(id);
      if (!file) { ws.send(JSON.stringify({ type: 'error', sessionId: id, error: 'not found' })); return; }
      const text = await fsp.readFile(file, 'utf8');
      ws.send(JSON.stringify({ type: 'history', sessionId: id, messages: parseAll(text) }));
      const { size } = await fsp.stat(file);
      subscriptions.add(id);
      await watcher.watch(id, file, size); // tail only new content past history
    }

    if (msg.unsubscribe && subscriptions.has(msg.unsubscribe)) {
      watcher.unwatch(msg.unsubscribe);
      subscriptions.delete(msg.unsubscribe);
    }
  });

  ws.on('close', () => {
    for (const id of subscriptions) watcher.unwatch(id);
    subscriptions.clear();
    watcher.removeAllListeners();
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Claude Session Monitor: http://${HOST}:${PORT}`);
});
```

- [ ] **Step 2: Start the server**

Run: `npm start`
Expected: prints `Claude Session Monitor: http://127.0.0.1:4567`.

- [ ] **Step 3: Verify endpoints (in a second terminal)**

Run: `curl -s http://127.0.0.1:4567/api/sessions | head -c 200`
Expected: JSON array of projects with `sessions` arrays. Then stop the server (Ctrl-C).

- [ ] **Step 4: Commit**

```bash
git add src/server.js
git commit -m "feat: add HTTP + WebSocket backend server"
```

---

## Task 7: Frontend renderer

**Files:**
- Create: `public/render.js`

(Browser module — verified visually in the integration task.)

- [ ] **Step 1: Write implementation**

```js
// public/render.js
import { marked } from '/vendor/marked/marked.esm.js';
import hljs from '/vendor/highlight-es/highlight.js';

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function highlight(code) {
  try { return hljs.highlightAuto(code).value; } catch { return escapeHtml(code); }
}

function renderMarkdown(text) {
  // marked output; code blocks highlighted via walkTokens-free post-pass is overkill —
  // rely on <pre><code> then highlight below in renderBlock.
  return marked.parse(text ?? '');
}

function renderBlock(block) {
  switch (block.kind) {
    case 'text':
      return `<div class="block text">${renderMarkdown(block.text)}</div>`;
    case 'thinking':
      return `<details class="block thinking"><summary>thinking</summary>${renderMarkdown(block.text)}</details>`;
    case 'tool_use':
      return `<details class="block tool-use"><summary>Tool: ${escapeHtml(block.name)}</summary>` +
        `<pre><code>${highlight(JSON.stringify(block.input, null, 2))}</code></pre></details>`;
    case 'tool_result':
      return `<details class="block tool-result"><summary>Tool result</summary>` +
        `<pre><code>${highlight(block.text)}</code></pre></details>`;
    case 'attachment':
      return `<details class="block attachment"><summary>Attachment: ${escapeHtml(block.attType)} ${escapeHtml(block.name)}</summary>` +
        `<pre>${escapeHtml(block.text)}</pre></details>`;
    default:
      return '';
  }
}

// Render one message to a DOM element. `onSelectToggle` is called with (uuid, checked).
export function renderMessage(msg, onSelectToggle) {
  const el = document.createElement('div');
  el.className = `message role-${msg.role}`;
  el.dataset.uuid = msg.uuid;

  const header = document.createElement('div');
  header.className = 'msg-header';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.className = 'msg-select';
  cb.addEventListener('change', () => onSelectToggle(msg.uuid, cb.checked));
  header.appendChild(cb);
  const label = document.createElement('span');
  label.className = 'role-label';
  label.textContent = msg.role + (msg.ts ? ` · ${new Date(msg.ts).toLocaleTimeString()}` : '');
  header.appendChild(label);
  el.appendChild(header);

  const body = document.createElement('div');
  body.className = 'msg-body';
  body.innerHTML = msg.blocks.map(renderBlock).join('');
  el.appendChild(body);
  return el;
}
```

- [ ] **Step 2: Verify the file parses**

`node --check` cannot resolve browser `import` URLs, so check for balanced structure instead:
Run: `grep -c "case '" public/render.js`
Expected: `5` (one case per block kind). Confirm the file saved without stray tokens.

- [ ] **Step 3: Commit**

```bash
git add public/render.js
git commit -m "feat: add frontend message renderer"
```

---

## Task 8: Frontend app (sidebar, panels, WS, export)

**Files:**
- Create: `public/app.js`

- [ ] **Step 1: Write implementation**

```js
// public/app.js
import { renderMessage } from './render.js';

const sidebar = document.getElementById('sidebar');
const panels = document.getElementById('panels');
const openPanels = new Map(); // sessionId -> { el, body, selected:Set, atBottom:boolean }

let ws;
function connect() {
  ws = new WebSocket(`ws://${location.host}/ws`);
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'history') setHistory(msg.sessionId, msg.messages);
    else if (msg.type === 'append') appendMessages(msg.sessionId, msg.messages);
    else if (msg.type === 'error') console.warn('session error', msg.sessionId, msg.error);
  });
  ws.addEventListener('close', () => setTimeout(reconnect, 1000));
}
function reconnect() {
  connect();
  ws.addEventListener('open', () => {
    for (const id of openPanels.keys()) ws.send(JSON.stringify({ subscribe: id }));
  });
}

async function loadSessions() {
  const res = await fetch('/api/sessions');
  const projects = await res.json();
  sidebar.innerHTML = '';
  for (const p of projects) {
    const group = document.createElement('div');
    group.className = 'project-group';
    group.innerHTML = `<div class="project-name">${p.projectPath}</div>`;
    for (const s of p.sessions) {
      const item = document.createElement('div');
      item.className = 'session-item';
      item.textContent = s.id.slice(0, 8);
      if (s.live) {
        const badge = document.createElement('span');
        badge.className = 'live-badge';
        badge.textContent = 'live';
        item.appendChild(badge);
      }
      item.addEventListener('click', () => openSession(s.id));
      group.appendChild(item);
    }
    sidebar.appendChild(group);
  }
}

function openSession(id) {
  if (openPanels.has(id)) {
    openPanels.get(id).el.scrollIntoView();
    return;
  }
  const el = document.createElement('div');
  el.className = 'panel';
  el.innerHTML = `
    <div class="panel-header">
      <span class="panel-title">${id.slice(0, 8)}</span>
      <button class="btn-export-all">Export all</button>
      <button class="btn-export-sel">Export selected</button>
      <button class="btn-close">×</button>
    </div>
    <div class="panel-body"></div>`;
  const body = el.querySelector('.panel-body');
  const state = { el, body, selected: new Set(), atBottom: true };
  body.addEventListener('scroll', () => {
    state.atBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 40;
  });
  el.querySelector('.btn-close').addEventListener('click', () => closeSession(id));
  el.querySelector('.btn-export-all').addEventListener('click', () => exportSession(id, null));
  el.querySelector('.btn-export-sel').addEventListener('click', () =>
    exportSession(id, [...state.selected]));
  openPanels.set(id, state);
  panels.appendChild(el);
  ws.send(JSON.stringify({ subscribe: id }));
}

function closeSession(id) {
  const state = openPanels.get(id);
  if (!state) return;
  ws.send(JSON.stringify({ unsubscribe: id }));
  state.el.remove();
  openPanels.delete(id);
}

function makeToggle(state) {
  return (uuid, checked) => {
    if (checked) state.selected.add(uuid); else state.selected.delete(uuid);
  };
}

function setHistory(id, messages) {
  const state = openPanels.get(id);
  if (!state) return;
  state.body.innerHTML = '';
  for (const m of messages) state.body.appendChild(renderMessage(m, makeToggle(state)));
  state.body.scrollTop = state.body.scrollHeight;
}

function appendMessages(id, messages) {
  const state = openPanels.get(id);
  if (!state) return;
  for (const m of messages) state.body.appendChild(renderMessage(m, makeToggle(state)));
  if (state.atBottom) state.body.scrollTop = state.body.scrollHeight;
}

async function exportSession(id, uuids) {
  const res = await fetch('/api/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: id, uuids })
  });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `${id}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

connect();
ws.addEventListener('open', loadSessions);
setInterval(loadSessions, 5000); // refresh live badges
```

- [ ] **Step 2: Sanity check no obvious syntax issue**

Run: `node --check public/app.js` (Node will flag pure syntax errors even with browser globals/imports left unresolved at parse time)
Expected: For ESM with imports, `--check` may error on import resolution; if so, instead run `grep -c "function " public/app.js` and confirm a positive count. Move on once the file is saved.

- [ ] **Step 3: Commit**

```bash
git add public/app.js
git commit -m "feat: add frontend app (sidebar, panels, WS, export)"
```

---

## Task 9: HTML shell + styles

**Files:**
- Create: `public/index.html`
- Create: `public/style.css`

- [ ] **Step 1: Create `public/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Claude Session Monitor</title>
  <link rel="stylesheet" href="/vendor/highlight/github-dark.css">
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <div id="layout">
    <aside id="sidebar"></aside>
    <main id="panels"></main>
  </div>
  <script type="module" src="/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `public/style.css`**

```css
* { box-sizing: border-box; }
body { margin: 0; font-family: -apple-system, system-ui, sans-serif; background: #1e1e1e; color: #ddd; }
#layout { display: flex; height: 100vh; }
#sidebar { width: 260px; flex: none; overflow-y: auto; border-right: 1px solid #333; padding: 8px; }
#panels { flex: 1; display: flex; gap: 8px; overflow-x: auto; padding: 8px; }

.project-group { margin-bottom: 12px; }
.project-name { font-size: 11px; color: #888; word-break: break-all; margin-bottom: 4px; }
.session-item { padding: 6px 8px; border-radius: 4px; cursor: pointer; font-family: monospace; font-size: 13px; display: flex; justify-content: space-between; align-items: center; }
.session-item:hover { background: #2a2a2a; }
.live-badge { background: #2ea043; color: #fff; font-size: 10px; padding: 1px 6px; border-radius: 8px; }

.panel { width: 480px; flex: none; display: flex; flex-direction: column; border: 1px solid #333; border-radius: 6px; overflow: hidden; }
.panel-header { display: flex; align-items: center; gap: 6px; padding: 6px 8px; background: #252525; border-bottom: 1px solid #333; }
.panel-title { font-family: monospace; flex: 1; }
.panel-header button { background: #333; color: #ddd; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 12px; }
.panel-header button:hover { background: #444; }
.panel-body { flex: 1; overflow-y: auto; padding: 8px; }

.message { margin-bottom: 12px; padding: 8px; border-radius: 6px; }
.message.role-user { background: #20303f; }
.message.role-assistant { background: #232323; }
.message.role-system { background: #2a2620; }
.msg-header { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
.role-label { font-size: 11px; color: #999; text-transform: uppercase; }
.msg-body pre { background: #111; padding: 8px; border-radius: 4px; overflow-x: auto; }
.block.thinking, .block.tool-use, .block.tool-result, .block.attachment { margin: 6px 0; }
details > summary { cursor: pointer; color: #6cb6ff; font-size: 12px; }
```

- [ ] **Step 3: Start and open in browser**

Run: `npm start`
Then open `http://127.0.0.1:4567` in a browser.
Expected: sidebar lists projects/sessions; clicking one opens a panel showing the conversation.

- [ ] **Step 4: Commit**

```bash
git add public/index.html public/style.css
git commit -m "feat: add HTML shell and styles"
```

---

## Task 10: Integration verification (manual)

**Files:** none (verification only)

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: all parser/sessionIndex/exporter/watcher tests PASS.

- [ ] **Step 2: Realtime end-to-end check**

1. Run `npm start`; open `http://127.0.0.1:4567`.
2. In a separate terminal, start a real Claude Code session in any project.
3. In the browser sidebar, find that session (should show a `live` badge) and open it.
4. Type a prompt in the CLI; within ~1s the user message appears in the panel.
5. As Claude responds, assistant text and tool calls/results appear near-realtime.

Expected: input and output both appear without manual refresh; auto-scroll stays at bottom.

- [ ] **Step 3: Multi-session check**

Open a second session panel; confirm both update independently.

- [ ] **Step 4: Export check**

Click "Export all" → a `.md` downloads with the conversation. Select a few message checkboxes, click "Export selected" → `.md` contains only those messages. Confirm thinking blocks are absent from exports.

- [ ] **Step 5: Reconnect check**

Stop the server (Ctrl-C), restart `npm start`. The browser should auto-reconnect within ~1s and re-subscribe open panels (history reloads).

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "docs: session monitor complete and verified" --allow-empty
```

---

## Self-Review Notes

- **Spec coverage:** all sessions grouped+sorted+live (Task 3), chat HTML render with markdown/highlight/collapsible tools (Tasks 7,9), vanilla stack (Tasks 7-9), multi-session panels (Task 8), realtime tail (Tasks 5-6), export whole+selected (Tasks 4,6,8), localhost-only + id validation (Tasks 2,6), error handling: malformed lines/partial lines/truncation/WS reconnect (Tasks 1,5,6,8). ✓
- **Placeholder scan:** none — all code steps contain full implementations.
- **Type consistency:** message/Block shapes identical across parser, exporter, watcher, render; `buildIndex`/`resolveSessionFile`/`Watcher.watch`/`unwatch` names consistent between server and their modules. ✓

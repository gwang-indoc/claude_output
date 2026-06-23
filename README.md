# Claude Code Session Monitor

A local web app that shows Claude Code CLI session content — your input and Claude's
output — in a browser in near-realtime, rendered as a readable chat. Browse all
sessions across all projects, open several at once, and export any session to Markdown.

## How it works

Claude Code writes every session as an append-only JSONL transcript at
`~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`. This app tails those files and
pushes new lines to the browser over a WebSocket. No hooks, no process instrumentation.

```
~/.claude/projects/*/*.jsonl  →  Node backend (Express + ws)  →  browser (vanilla JS)
        tail + parse                history + live append            chat panels
```

It reflects what is written to the transcript — not a per-keystroke/per-token mirror.
Your prompt appears after you submit it; assistant text appears as Claude Code flushes
it to disk (near-realtime, ~1s, possibly chunked). It is read-only.

## Requirements

- Node.js 18+ (developed on Node 25)
- An existing `~/.claude/projects/` directory (created by using Claude Code)

## Install

```bash
npm install
```

## Run

```bash
npm start
```

Then open http://127.0.0.1:4567

The server binds to localhost only. Set a different port with `PORT=5000 npm start`.

## Usage

- **Sidebar** lists every session grouped by project, sorted by most recent activity.
  A green **live** badge marks sessions written to in the last 10 seconds.
- **Click a session** to open it as a chat panel. Open as many as you like — each
  updates independently.
- Messages render as chat bubbles: user prompts, assistant text (Markdown + syntax
  highlighting), and collapsible tool calls / results.
- **Export all** downloads the whole session as Markdown. Tick the per-message
  checkboxes and use **Export selected** for a subset. (Thinking blocks are omitted
  from exports.)

### See it live

1. `npm start` and open the page.
2. Start a Claude Code session in any project from your terminal.
3. Find that session in the sidebar (it shows a `live` badge) and open it.
4. Type a prompt in the CLI — within ~1s it appears in the browser, followed by
   Claude's response as it streams to disk.

## Project layout

```
src/
  parser.js        JSONL line → normalized message {uuid, role, type, ts, blocks[]}
  sessionIndex.js  scan project dirs, group/sort sessions, live flag
  exporter.js      messages → Markdown
  watcher.js       per-session byte-offset file tail with partial-line buffering
  paths.js         base dir + session-id validation
  server.js        Express HTTP endpoints + WebSocket handler
public/
  index.html       sidebar + panels shell
  style.css        chat layout
  render.js        message → HTML (marked + highlight.js, collapsible tool I/O)
  app.js           WebSocket manager, panels, sidebar, selection, export
test/              node:test unit tests for the backend modules
```

## API

- `GET /api/sessions` — grouped, sorted session index with live flags
- `GET /api/session/:id` — full parsed history for one session
- `POST /api/export` — body `{ sessionId, uuids? }` → Markdown download (omit `uuids`
  for the whole session)
- `WS /ws` — `{subscribe|unsubscribe, sessionId}`; server pushes `history`, `append`,
  `error` messages

## Tests

```bash
npm test
```

Covers the parser, session index, exporter, and watcher (including the
history→tail offset handoff).

## Security & scope

- Binds to `127.0.0.1` only; no authentication.
- Read-only — it never writes to transcripts or injects input.
- Session ids are validated; file access cannot escape `~/.claude/projects/`.

## Known limitations

- Syntax highlighting is served from a self-contained highlight.js bundle covering the
  common languages; uncommon languages fall back to unhighlighted code.
- The project label in the sidebar is derived from the encoded directory name, which is
  lossy for paths containing `_`, `.`, or `-` (display only — session loading is
  unaffected).

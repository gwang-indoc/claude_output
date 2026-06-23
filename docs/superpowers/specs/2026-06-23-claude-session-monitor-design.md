# Claude Code Session Monitor — Design

**Date:** 2026-06-23
**Status:** Approved (pending spec review)

## Summary

A local Node.js web application that displays Claude Code CLI session content
(input and output) in a web browser in near-realtime. It reads Claude Code's
session transcript files, streams new content to the browser as sessions run,
renders it as a readable chat view, and can export sessions (whole or selected
messages) to Markdown.

## Goal & Non-goals

**Goal:** When a user runs Claude Code in the terminal, they can open a browser
panel for that session and watch their input and Claude's output appear in
near-realtime, formatted readably.

**Non-goals:**
- Not a live per-keystroke / per-token mirror. It reflects what is written to the
  transcript file. User prompts appear after submission; assistant text appears as
  Claude Code flushes it to disk (near-realtime, possibly chunked).
- Not a terminal/TUI mirror. It captures transcript *content*, not raw terminal
  rendering, colors, or cursor state.
- Read-only. No injecting input back into sessions.
- No authentication. Localhost-only binding is the security boundary.

## Data Source

Claude Code writes each session as an append-only JSONL file at:

```
~/.claude/projects/<encoded-cwd>/<session-id>.jsonl
```

- `<encoded-cwd>` is the working directory path with `/` replaced by `-`
  (e.g. `/Users/gwang/foo` → `-Users-gwang-foo`).
- Each line is a JSON object. Observed `type` values include:
  `user`, `assistant`, `attachment`, `tool` (tool calls/results within
  assistant/user entries), `file-history-snapshot`, `mode`, `permission-mode`,
  `last-prompt`, `system`.
- Relevant for display: `user` (input), `assistant` (output), tool calls/results,
  `attachment`.
- Ignored as noise: `mode`, `permission-mode`, `file-history-snapshot`,
  `last-prompt`.
- The file grows as the session runs — appended in near-realtime. Monitoring =
  tail the file and push new lines to the browser. No hooks or process
  instrumentation needed.

## Architecture

```
~/.claude/projects/*/*.jsonl   (data source, append-only)
            │ fs.watch + tail (byte-offset)
            ▼
   ┌──────────────────┐
   │  Node backend     │  Express (HTTP) + ws (WebSocket)
   │  - session index  │  scans dirs, groups by project
   │  - file watcher   │  detects appended bytes, parses JSONL
   │  - parser/mapper  │  JSONL → normalized message objects
   │  - exporter       │  messages → Markdown
   └──────────────────┘
            │ WebSocket (per-session subscribe)
            ▼
   ┌──────────────────┐
   │ Browser (vanilla) │  session list sidebar + chat panels
   │  - multi-panel    │  multiple sessions open at once
   │  - markdown render │  user/assistant/tool bubbles
   │  - export + select │
   └──────────────────┘
```

**Stack:** Node + Express + `ws` backend; vanilla HTML/JS/CSS frontend;
`marked` for markdown rendering, `highlight.js` for code syntax highlighting.
Localhost bind only.

## Components

### Backend

- **`server.js`** — Express + ws bootstrap, localhost bind, serves static
  frontend from `public/`, wires HTTP endpoints and WS handler.
- **`sessionIndex.js`** — scans `~/.claude/projects/`, decodes each dir name back
  to its cwd path, lists `.jsonl` files per project, sorts by mtime (recent
  first), groups by project. Marks a session "live" when mtime is within the last
  10 seconds.
- **`watcher.js`** — per-subscribed-file tail. Tracks a byte offset per file; on
  `fs.watch` change, reads bytes from offset to new EOF, splits into complete
  lines, buffers any partial trailing line until its newline arrives, emits new
  raw lines. Maintains `Map<sessionId, {offset, buffer, subscribers}>`.
- **`parser.js`** — JSONL line → normalized message object:
  `{uuid, role, type, text, toolName, toolInput, toolResult, ts}`. Handles
  `user`/`assistant`/`attachment` and embedded tool calls/results; skips noise
  types; unknown types map to a minimal fallback (never silently dropped).
- **`exporter.js`** — takes a message list (or a subset by uuid) → Markdown
  string.

### Frontend (`public/`)

- **`index.html`** — sidebar (project groups → sessions, with live badge) plus a
  main area holding one or more open session panels.
- **`app.js`** — WebSocket manager (single connection, multiple
  subscriptions keyed by sessionId), panel/tab management, message rendering
  dispatch, selection checkboxes, export trigger, auto-reconnect.
- **`render.js`** — message object → HTML. Markdown via `marked`, code syntax
  highlighting via `highlight.js`. User/assistant/tool styled as distinct bubbles.
  Tool input/result rendered collapsible.
- **`style.css`** — chat layout, readable typography, sidebar/panel structure.

### Endpoints

- `GET /api/sessions` → grouped, sorted session index with live flags.
- `GET /api/session/:id` → full parsed history (used for initial panel load if
  not loaded via WS).
- `WS /ws` → messages: client sends `{subscribe, sessionId}` /
  `{unsubscribe, sessionId}`; server sends `{type:history, messages[]}`,
  `{type:append, messages[]}`, `{type:error, ...}`.
- `POST /api/export` → body `{sessionId, uuids?}` (omit `uuids` = whole session)
  → returns Markdown as a file download.

## Data Flow

**Initial load:** browser `GET /api/sessions` → render sidebar. User clicks a
session → WS `subscribe {sessionId}` → backend reads full file, parses, sends
`{type:history, messages[]}` → frontend renders a new panel.

**Live tail:** on subscribe, watcher records current file size as the offset.
`fs.watch` fires on append → read bytes offset→EOF → split complete lines (hold
partial trailing line in buffer until newline) → parse → push
`{type:append, messages[]}` → frontend appends to the panel, auto-scrolling only
if the user is already at the bottom.

**Live badge:** sidebar refreshes session index every ~5s to update mtime/live
state.

**Multi-session:** one WS connection carries many subscriptions keyed by
sessionId. Backend keeps per-session offset and subscriber set.

**Export:** user clicks export on a panel → optionally selects messages via
checkboxes → `POST /api/export` → backend builds Markdown → browser downloads
`.md`.

## Error Handling

- File deleted/rotated mid-watch → emit `{type:error}`, close that subscription
  cleanly.
- Malformed JSONL line → skip, log server-side, continue the stream (never crash).
- Partial trailing line (file mid-write) → hold in buffer until newline arrives.
- Unknown message type → render minimal fallback; never silently drop.
- WebSocket drop → frontend auto-reconnects, re-subscribes, re-syncs from offset 0.
- Path safety → `sessionId` validated against the known index; no arbitrary file
  reads outside `~/.claude/projects/`.

## Testing

- **`parser.js`** — unit tests over real JSONL fixture lines
  (user/assistant/tool/attachment/noise/unknown).
- **`exporter.js`** — message list (whole and subset) → expected Markdown.
- **`sessionIndex.js`** — temp-dir fixture; verify grouping, sort order, live flag.
- **`watcher.js`** — write to a temp file incrementally; assert append events and
  partial-line buffering.
- **Manual** — run against live `~/.claude/projects`; open multiple sessions; run
  a real Claude Code session and confirm near-realtime updates; export whole and
  selected.

## Open Decisions (resolved)

- Scope: all sessions across all projects, browsable list, multiple open at once.
- Render: chat view, HTML, markdown + code highlighting, collapsible tool I/O.
- Stack: vanilla frontend, minimal Node backend.
- Session list: all sessions grouped by project, sorted by recent activity, live
  badge.
- Export: whole session and optional message selection.
- Realtime approach: transcript tailing (accepted over per-token streaming).
- Network/security: localhost-only, read-only, no auth.

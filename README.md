<div align="center">

# 🔭 Claude Code Session Monitor

**Watch your Claude Code CLI sessions live in the browser.**

Your input and Claude's output — streamed in near-realtime, rendered as a readable chat.
Browse every session across every project, open several side by side, and export any of them to Markdown.

<br>

![Node](https://img.shields.io/badge/Node.js-18%2B-3c873a?logo=node.js&logoColor=white)
![Stack](https://img.shields.io/badge/stack-Express%20%2B%20ws%20%2B%20vanilla%20JS-blue)
![Tests](https://img.shields.io/badge/tests-16%20passing-success)
![Bind](https://img.shields.io/badge/bind-localhost%20only-orange)
![License](https://img.shields.io/badge/license-MIT-lightgrey)

</div>

---

## ✨ Features

| | |
|---|---|
| 🗂️ **All sessions** | Every session grouped by project, sorted by most recent activity |
| 🟢 **Live badge** | Highlights sessions written to in the last 10 seconds |
| 💬 **Readable chat** | User / assistant / tool bubbles, Markdown + syntax highlighting |
| 🔽 **Collapsible tools** | Tool calls and results fold away until you want them |
| 🪟 **Multi-session** | Open many panels at once — each updates independently |
| 📤 **Markdown export** | Export a whole session, or tick checkboxes to export a subset |
| 🔒 **Read-only & local** | Localhost-only bind, never writes back to your sessions |

---

## ⚡ Quick start

```bash
npm install
npm start
```

Then open **http://127.0.0.1:4567** 🚀

> Use a different port with `PORT=5000 npm start`.

---

## 🧠 How it works

Claude Code writes every session as an append-only JSONL transcript at
`~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`. This app tails those files and
pushes new lines to the browser over a WebSocket — **no hooks, no process instrumentation.**

```
  ~/.claude/projects/*/*.jsonl  ──►  Node backend (Express + ws)  ──►  browser (vanilla JS)
         tail + parse                  history + live append              chat panels
```

> [!NOTE]
> It reflects what is **written to the transcript** — not a per-keystroke / per-token mirror.
> Your prompt appears after you submit it; assistant text appears as Claude Code flushes it to
> disk (~1s, possibly chunked). It is strictly read-only.

---

## 🎬 See it live

1. `npm start` and open the page.
2. Start a Claude Code session in any project from your terminal.
3. Find that session in the sidebar — it shows a 🟢 **live** badge — and open it.
4. Type a prompt in the CLI. Within ~1s it appears in the browser, followed by Claude's
   response as it streams to disk.

---

## 📦 Requirements

- **Node.js 18+** (developed on Node 25)
- An existing `~/.claude/projects/` directory (created the first time you use Claude Code)

---

## 📖 Usage

- **Sidebar** — every session, grouped by project, newest first. 🟢 = live.
- **Click a session** → opens a chat panel. Open as many as you like.
- **Bubbles** — user prompts, assistant text (Markdown + highlighted code), and
  collapsible tool calls / results.
- **Export all** → downloads the whole session as Markdown.
- **Export selected** → tick per-message checkboxes for a subset.
  *(Thinking blocks are omitted from exports.)*

---

## 🗺️ Project layout

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

---

## 🔌 API

| Method | Route | Description |
|--------|-------|-------------|
| `GET`  | `/api/sessions` | Grouped, sorted session index with live flags |
| `GET`  | `/api/session/:id` | Full parsed history for one session |
| `POST` | `/api/export` | Body `{ sessionId, uuids? }` → Markdown download (omit `uuids` for the whole session) |
| `WS`   | `/ws` | `{subscribe\|unsubscribe, sessionId}`; server pushes `history`, `append`, `error` |

---

## 🧪 Tests

```bash
npm test
```

Covers the parser, session index, exporter, and watcher — including the
history → tail offset handoff. **16 passing.**

---

## 🔐 Security & scope

- 🏠 Binds to `127.0.0.1` only; no authentication.
- 👀 Read-only — never writes to transcripts or injects input.
- 🛡️ Session ids are validated; file access cannot escape `~/.claude/projects/`.

---

## ⚠️ Known limitations

- Syntax highlighting ships as a self-contained highlight.js bundle covering the common
  languages; uncommon languages fall back to plain code.
- The sidebar project label is derived from the encoded directory name, which is lossy
  for paths containing `_`, `.`, or `-` *(display only — session loading is unaffected).*

---

<div align="center">

Built for people who live in the terminal but like a window into it. 🪟

</div>

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

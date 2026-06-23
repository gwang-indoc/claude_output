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

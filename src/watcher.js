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

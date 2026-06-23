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

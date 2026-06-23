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

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

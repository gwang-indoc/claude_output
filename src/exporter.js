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

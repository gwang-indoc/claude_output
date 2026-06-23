// public/render.js
import { marked } from '/vendor/marked/marked.esm.js';
import hljs from '/vendor/highlight-es/highlight.js';

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function highlight(code) {
  try { return hljs.highlightAuto(code).value; } catch { return escapeHtml(code); }
}

function renderMarkdown(text) {
  // marked output; code blocks highlighted via walkTokens-free post-pass is overkill —
  // rely on <pre><code> then highlight below in renderBlock.
  return marked.parse(text ?? '');
}

function renderBlock(block) {
  switch (block.kind) {
    case 'text':
      return `<div class="block text">${renderMarkdown(block.text)}</div>`;
    case 'thinking':
      return `<details class="block thinking"><summary>thinking</summary>${renderMarkdown(block.text)}</details>`;
    case 'tool_use':
      return `<details class="block tool-use"><summary>Tool: ${escapeHtml(block.name)}</summary>` +
        `<pre><code>${highlight(JSON.stringify(block.input, null, 2))}</code></pre></details>`;
    case 'tool_result':
      return `<details class="block tool-result"><summary>Tool result</summary>` +
        `<pre><code>${highlight(block.text)}</code></pre></details>`;
    case 'attachment':
      return `<details class="block attachment"><summary>Attachment: ${escapeHtml(block.attType)} ${escapeHtml(block.name)}</summary>` +
        `<pre>${escapeHtml(block.text)}</pre></details>`;
    default:
      return '';
  }
}

// Render one message to a DOM element. `onSelectToggle` is called with (uuid, checked).
export function renderMessage(msg, onSelectToggle) {
  const el = document.createElement('div');
  el.className = `message role-${msg.role}`;
  el.dataset.uuid = msg.uuid;

  const header = document.createElement('div');
  header.className = 'msg-header';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.className = 'msg-select';
  cb.addEventListener('change', () => onSelectToggle(msg.uuid, cb.checked));
  header.appendChild(cb);
  const label = document.createElement('span');
  label.className = 'role-label';
  label.textContent = msg.role + (msg.ts ? ` · ${new Date(msg.ts).toLocaleTimeString()}` : '');
  header.appendChild(label);
  el.appendChild(header);

  const body = document.createElement('div');
  body.className = 'msg-body';
  body.innerHTML = msg.blocks.map(renderBlock).join('');
  el.appendChild(body);
  return el;
}

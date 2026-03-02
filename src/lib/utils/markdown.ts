/**
 * Lightweight markdown renderer for AI chat messages.
 * Escapes HTML first (XSS prevention), then transforms markdown syntax.
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function renderMarkdown(text: string): string {
  // Escape HTML first
  let html = escapeHtml(text);

  // Code blocks (``` ... ```)
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_match, _lang, code) => {
    return `<pre><code>${code.trim()}</code></pre>`;
  });

  // Inline code (`...`)
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Bold (**...**)
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // Italic (*...*)
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  // Links [text](url)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  // Process lines for headings and lists
  const lines = html.split('\n');
  const result: string[] = [];
  let inUl = false;
  let inOl = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Headings: ## and ###
    const h2Match = line.match(/^## (.+)/);
    const h3Match = line.match(/^### (.+)/);

    if (h2Match) {
      if (inUl) { result.push('</ul>'); inUl = false; }
      if (inOl) { result.push('</ol>'); inOl = false; }
      result.push(`<div class="md-h2">${h2Match[1]}</div>`);
      continue;
    }
    if (h3Match) {
      if (inUl) { result.push('</ul>'); inUl = false; }
      if (inOl) { result.push('</ol>'); inOl = false; }
      result.push(`<div class="md-h3">${h3Match[1]}</div>`);
      continue;
    }

    const ulMatch = line.match(/^[\s]*[-*]\s+(.*)/);
    const olMatch = line.match(/^[\s]*\d+\.\s+(.*)/);

    if (ulMatch) {
      if (!inUl) {
        if (inOl) { result.push('</ol>'); inOl = false; }
        result.push('<ul>');
        inUl = true;
      }
      result.push(`<li>${ulMatch[1]}</li>`);
    } else if (olMatch) {
      if (!inOl) {
        if (inUl) { result.push('</ul>'); inUl = false; }
        result.push('<ol>');
        inOl = true;
      }
      result.push(`<li>${olMatch[1]}</li>`);
    } else {
      if (inUl) { result.push('</ul>'); inUl = false; }
      if (inOl) { result.push('</ol>'); inOl = false; }
      result.push(line);
    }
  }

  if (inUl) result.push('</ul>');
  if (inOl) result.push('</ol>');

  html = result.join('\n');

  // Convert remaining newlines to <br> (but not inside <pre>)
  // Split by <pre>...</pre>, only convert newlines outside
  const parts = html.split(/(<pre><code>[\s\S]*?<\/code><\/pre>)/);
  html = parts
    .map((part) => {
      if (part.startsWith('<pre><code>')) return part;
      return part.replace(/\n/g, '<br>');
    })
    .join('');

  return html;
}

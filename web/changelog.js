// ===== 更新日志独立页（changelog.html）=====
// 渲染根目录 update_log.md（构建时由 sync-src.mjs 同步到 public）为极简 Markdown HTML。
import './style.css';

// HTML 转义，杜绝注入
function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
// 行内标记：**粗体**
function mdInline(s) {
  return escapeHtml(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}
// 极简 Markdown：仅支持 update_log.md 用到的 # / ## / ### / 有序列表 / 无序列表 / 粗体 / 分隔线
export function renderChangelog(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  let html = '';
  let listType = null; // null | 'ol' | 'ul'
  const closeList = () => { if (listType) { html += `</${listType}>`; listType = null; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^#{1,6}\s+/.test(line)) {
      closeList();
      const m = line.match(/^(#{1,6})\s+(.*)$/);
      const level = m[1].length;
      const tag = level === 1 ? 'h1' : level === 2 ? 'h2' : 'h3';
      html += `<${tag}>${mdInline(m[2])}</${tag}>`;
    } else if (/^\s*-{3,}\s*$/.test(line)) {
      closeList();
      html += '<hr>';
    } else if (/^\d+\.\s+/.test(line)) {
      if (listType !== 'ol') { closeList(); listType = 'ol'; html += '<ol>'; }
      html += `<li>${mdInline(line.replace(/^\d+\.\s+/, ''))}</li>`;
    } else if (/^[-*]\s+/.test(line)) {
      if (listType !== 'ul') { closeList(); listType = 'ul'; html += '<ul>'; }
      html += `<li>${mdInline(line.replace(/^[-*]\s+/, ''))}</li>`;
    } else if (line.trim() === '') {
      closeList();
    } else {
      closeList();
      html += `<p>${mdInline(line)}</p>`;
    }
  }
  closeList();
  return html;
}

function initChangelogPage() {
  const content = document.getElementById('changelogContent');
  if (!content) return;
  fetch('./update_log.md')
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
    .then(md => { content.innerHTML = renderChangelog(md); })
    .catch(() => {
      content.innerHTML = '<p class="cl-error">更新日志加载失败，请检查网络或稍后重试</p>';
    });
}
initChangelogPage();
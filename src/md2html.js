/* md2html.js —— 预览用的轻量 Markdown 渲染（与 lib/md2tex.js 的块规则保持一致） */
(function () {
  'use strict';

  function escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function tex2html(tex, display) {
    try {
      return window.katex.renderToString(tex, {
        displayMode: !!display,
        throwOnError: false,
        errorColor: '#d64545',
        strict: false,
        output: 'htmlAndMathml'
      });
    } catch (e) {
      return '<span class="math-error" title="' + escHtml(e.message) + '">' + escHtml(tex) + '</span>';
    }
  }

  const PH = '\u0001';

  function renderInline(text) {
    const stash = [];
    const keep = (html) => {
      stash.push(html);
      return PH + (stash.length - 1) + PH;
    };

    let s = String(text);
    s = s.replace(/`([^`]+)`/g, (_, c) => keep('<code>' + escHtml(c) + '</code>'));
    s = s.replace(/\$\$([\s\S]+?)\$\$/g, (_, m) => keep(tex2html(m, true)));
    s = s.replace(/\\\(([\s\S]+?)\\\)/g, (_, m) => keep(tex2html(m, false)));
    s = s.replace(/(?<!\$)\$([^$\n]+?)\$(?!\$)/g, (_, m) => keep(tex2html(m, false)));

    s = escHtml(s);
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');

    return s.replace(new RegExp(PH + '(\\d+)' + PH, 'g'), (_, i) => stash[Number(i)]);
  }

  const RE = {
    heading: /^(#{1,4})\s+(.*)$/,
    fence: /^```([A-Za-z0-9_+-]*)\s*$/,
    displayOpen: /^\s*\$\$/,
    ul: /^\s{0,3}[-*+]\s+(.*)$/,
    ol: /^\s{0,3}(\d+)[.)]\s+(.*)$/,
    hr: /^\s*(-{3,}|\*{3,}|_{3,})\s*$/,
    tableSep: /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/,
    quote: /^\s*>\s?(.*)$/
  };

  function splitRow(line) {
    let s = line.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|')) s = s.slice(0, -1);
    return s.split('|').map((c) => c.trim());
  }

  function render(md) {
    const lines = String(md).replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let i = 0;
    let para = [];
    let listType = null;

    const flushPara = () => {
      if (!para.length) return;
      out.push('<p>' + para.map(renderInline).join('<br>') + '</p>');
      para = [];
    };
    const closeList = () => {
      if (listType) { out.push('</' + listType + '>'); listType = null; }
    };
    const openList = (t) => {
      if (listType === t) return;
      closeList();
      out.push('<' + t + '>');
      listType = t;
    };

    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();

      if (!trimmed) { flushPara(); closeList(); i++; continue; }

      const fence = trimmed.match(RE.fence);
      if (fence) {
        flushPara(); closeList();
        const lang = (fence[1] || '').toLowerCase();
        i++;
        const buf = [];
        while (i < lines.length && lines[i].trim() !== '```') { buf.push(lines[i]); i++; }
        i++;
        if (lang === 'tikz') {
          out.push(
            '<div class="tikz-block"><div class="tikz-head">TikZ 图 · 导出 PDF 时渲染</div>' +
            '<pre>' + escHtml(buf.join('\n')) + '</pre></div>'
          );
        } else {
          out.push('<pre class="code-block">' + escHtml(buf.join('\n')) + '</pre>');
        }
        continue;
      }

      if (RE.displayOpen.test(trimmed)) {
        flushPara(); closeList();
        const buf = [];
        if (/^\s*\$\$[\s\S]*\$\$\s*$/.test(trimmed) && trimmed.length > 4) {
          buf.push(trimmed.replace(/^\s*\$\$/, '').replace(/\$\$\s*$/, ''));
          i++;
        } else {
          buf.push(line.replace(/^\s*\$\$/, ''));
          i++;
          while (i < lines.length && !/\$\$\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
          if (i < lines.length) { buf.push(lines[i].replace(/\$\$\s*$/, '')); i++; }
        }
        out.push('<div class="math-display">' + tex2html(buf.join('\n').trim(), true) + '</div>');
        continue;
      }

      const h = trimmed.match(RE.heading);
      if (h) {
        flushPara(); closeList();
        const lv = h[1].length;
        out.push('<h' + lv + '>' + renderInline(h[2]) + '</h' + lv + '>');
        i++;
        continue;
      }

      if (RE.hr.test(trimmed)) {
        flushPara(); closeList();
        out.push('<hr>');
        i++;
        continue;
      }

      if (trimmed.includes('|') && i + 1 < lines.length && RE.tableSep.test(lines[i + 1])) {
        flushPara(); closeList();
        const header = splitRow(trimmed);
        const cols = header.length;
        i += 2;
        let html = '<table class="md-table"><thead><tr>';
        html += header.map((c) => '<th>' + renderInline(c) + '</th>').join('');
        html += '</tr></thead><tbody>';
        while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
          const cells = splitRow(lines[i]);
          html += '<tr>';
          for (let k = 0; k < cols; k++) html += '<td>' + renderInline(cells[k] || '') + '</td>';
          html += '</tr>';
          i++;
        }
        html += '</tbody></table>';
        out.push(html);
        continue;
      }

      const ul = line.match(RE.ul);
      if (ul) { flushPara(); openList('ul'); out.push('<li>' + renderInline(ul[1]) + '</li>'); i++; continue; }

      const ol = line.match(RE.ol);
      if (ol) { flushPara(); openList('ol'); out.push('<li>' + renderInline(ol[2]) + '</li>'); i++; continue; }

      const q = line.match(RE.quote);
      if (q) { flushPara(); closeList(); out.push('<blockquote>' + renderInline(q[1]) + '</blockquote>'); i++; continue; }

      closeList();
      para.push(trimmed);
      i++;
    }

    flushPara();
    closeList();
    return out.join('\n');
  }

  window.MDRender = { render: render, escHtml: escHtml };
})();

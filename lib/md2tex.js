'use strict';
/**
 * md2tex.js —— 把「Markdown 超集」转成 LaTeX 正文
 *
 * 支持的块级语法：
 *   # ## ### ####      → \section / \subsection / \subsubsection
 *   $$ ... $$          → \[ ... \]
 *   ```tikz ... ```    → tikzpicture
 *   ``` ... ```        → verbatim
 *   - item / 1. item   → itemize / enumerate
 *   | a | b | 表格     → tabular
 *   ---                → 分隔线
 *
 * 行内语法：
 *   $...$  \(...\)     → 数学
 *   **粗体**  *斜体*  `代码`
 *
 * 语义选择：段落里的单个换行会保留为换行（\\ ），因为推导过程经常一行一步。
 */

const ESCAPES = {
  '\\': '\\textbackslash{}',
  '{': '\\{',
  '}': '\\}',
  '$': '\\$',
  '&': '\\&',
  '#': '\\#',
  '^': '\\textasciicircum{}',
  '_': '\\_',
  '%': '\\%',
  '~': '\\textasciitilde{}'
};

function escapeTex(s) {
  return String(s).replace(/[\\{}$&#^_%~]/g, (c) => ESCAPES[c]);
}

const PH = '\u0001'; // 占位符定界符

/** 行内：先摘出代码与数学，转义剩余文本，处理粗斜体，最后还原 */
function inlineToTex(text) {
  const stash = [];
  const keep = (tex) => {
    stash.push(tex);
    return PH + (stash.length - 1) + PH;
  };

  let s = String(text);

  // 1. 行内代码
  s = s.replace(/`([^`]+)`/g, (_, c) => keep('\\texttt{' + escapeTex(c) + '}'));

  // 2. 数学（$$..$$ → \[..\]；\(..\) 与 $..$ → $..$）
  s = s.replace(/\$\$([\s\S]+?)\$\$/g, (_, m) => keep('\\[' + m + '\\]'));
  s = s.replace(/\\\(([\s\S]+?)\\\)/g, (_, m) => keep('$' + m + '$'));
  s = s.replace(/(?<!\$)\$([^$\n]+?)\$(?!\$)/g, (_, m) => keep('$' + m + '$'));

  // 3. 转义普通文本
  s = escapeTex(s);

  // 4. 强调
  s = s.replace(/\*\*([^*]+)\*\*/g, (_, m) => '\\textbf{' + m + '}');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, (_, pre, m) => pre + '\\textit{' + m + '}');

  // 5. 还原
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

function mdToTexBody(md) {
  const lines = String(md).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;

  let para = [];
  let listType = null;

  const flushPara = () => {
    if (!para.length) return;
    const body = para.map((l) => inlineToTex(l)).join(' \\\\\n');
    out.push(body + '\\par');
    para = [];
  };

  const closeList = () => {
    if (listType) {
      out.push('\\end{' + listType + '}');
      listType = null;
    }
  };

  const openList = (t) => {
    if (listType === t) return;
    closeList();
    out.push('\\begin{' + t + '}');
    listType = t;
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // 空行
    if (!trimmed) {
      flushPara();
      closeList();
      i++;
      continue;
    }

    // 代码围栏
    const fence = trimmed.match(RE.fence);
    if (fence) {
      flushPara();
      closeList();
      const lang = (fence[1] || '').toLowerCase();
      i++;
      const buf = [];
      while (i < lines.length && lines[i].trim() !== '```') {
        buf.push(lines[i]);
        i++;
      }
      i++; // 跳过收尾 ```
      const content = buf.join('\n');
      if (lang === 'tikz') {
        out.push(
          '\\begin{center}\n\\begin{tikzpicture}[>=Stealth, thick, node distance=1.5cm]\n' +
            content +
            '\n\\end{tikzpicture}\n\\end{center}'
        );
      } else if (lang === 'latex' || lang === 'tex') {
        out.push(content);
      } else {
        out.push('\\begin{verbatim}\n' + content + '\n\\end{verbatim}');
      }
      continue;
    }

    // 行间数学
    if (RE.displayOpen.test(trimmed)) {
      flushPara();
      closeList();
      const buf = [];
      if (/^\s*\$\$[\s\S]*\$\$\s*$/.test(trimmed) && trimmed.length > 4) {
        buf.push(trimmed.replace(/^\s*\$\$/, '').replace(/\$\$\s*$/, ''));
        i++;
      } else {
        buf.push(line.replace(/^\s*\$\$/, ''));
        i++;
        while (i < lines.length && !/\$\$\s*$/.test(lines[i])) {
          buf.push(lines[i]);
          i++;
        }
        if (i < lines.length) {
          buf.push(lines[i].replace(/\$\$\s*$/, ''));
          i++;
        }
      }
      // 行间公式里不能出现空行（空行会截断段落），全部剔除
      out.push('\\[\n' + buf.filter((l) => l.trim() !== '').join('\n') + '\n\\]');
      continue;
    }

    // 标题
    const h = trimmed.match(RE.heading);
    if (h) {
      flushPara();
      closeList();
      const level = h[1].length;
      const cmd = level === 1 ? 'section' : level === 2 ? 'subsection' : level === 3 ? 'subsubsection' : 'paragraph';
      out.push('\\' + cmd + '*' + '{' + inlineToTex(h[2]) + '}');
      i++;
      continue;
    }

    // 分隔线
    if (RE.hr.test(trimmed)) {
      flushPara();
      closeList();
      out.push('\\par\\noindent\\rule{\\linewidth}{0.5pt}\\par');
      i++;
      continue;
    }

    // 表格
    if (trimmed.includes('|') && i + 1 < lines.length && RE.tableSep.test(lines[i + 1])) {
      flushPara();
      closeList();
      const header = splitRow(trimmed);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      const cols = header.length;
      const spec = '|' + 'c|'.repeat(cols);
      const body = [
        '\\begin{center}',
        '\\begin{tabular}{' + spec + '}',
        '\\hline',
        header.map((c) => inlineToTex(c)).join(' & ') + ' \\\\',
        '\\hline'
      ];
      for (const r of rows) {
        const cells = [];
        for (let k = 0; k < cols; k++) cells.push(inlineToTex(r[k] || ''));
        body.push(cells.join(' & ') + ' \\\\');
        body.push('\\hline');
      }
      body.push('\\end{tabular}', '\\end{center}');
      out.push(body.join('\n'));
      continue;
    }

    // 列表
    const ul = line.match(RE.ul);
    if (ul) {
      flushPara();
      openList('itemize');
      out.push('  \\item ' + inlineToTex(ul[1]));
      i++;
      continue;
    }
    const ol = line.match(RE.ol);
    if (ol) {
      flushPara();
      openList('enumerate');
      out.push('  \\item ' + inlineToTex(ol[2]));
      i++;
      continue;
    }

    // 引用（降级为一段）
    const q = line.match(RE.quote);
    if (q) {
      flushPara();
      closeList();
      out.push('\\begin{quote}' + inlineToTex(q[1]) + '\\end{quote}');
      i++;
      continue;
    }

    // 普通段落
    closeList();
    para.push(trimmed.replace(/\s+$/, ''));
    i++;
  }

  flushPara();
  closeList();

  return out.join('\n\n');
}

/** 生成完整 .tex 文档 */
function buildTex(md, meta = {}) {
  const m = {
    name: meta.name || '',
    studentId: meta.studentId || '',
    course: meta.course || '离散数学',
    assignment: meta.assignment || '',
    title: meta.title || ''
  };

  const title = m.assignment ? m.course + ' 第 ' + m.assignment + ' 次作业' : m.course + ' 作业';
  const headParts = [];
  if (m.name) headParts.push('姓名：' + m.name);
  if (m.studentId) headParts.push('学号：' + m.studentId);

  const preamble = [
    '% !TEX program = xelatex',
    '\\documentclass[11pt,a4paper]{ctexart}',
    '\\usepackage[top=2.2cm,bottom=2.2cm,left=2.2cm,right=2.2cm]{geometry}',
    '\\usepackage{amsmath,amssymb,amsthm,mathtools}',
    '\\usepackage{graphicx,array,booktabs}',
    '\\usepackage{enumitem}',
    '\\usepackage{fancyhdr}',
    '\\usepackage{xcolor}',
    '\\usepackage{tikz}',
    '\\usetikzlibrary{arrows.meta,positioning,shapes.geometric,shapes.misc,fit,backgrounds,calc,decorations.markings}',
    '\\setlist[itemize]{nosep,leftmargin=1.8em,label=\\textbullet}',
    '\\setlist[enumerate]{nosep,leftmargin=2.1em}',
    '\\linespread{1.4}',
    '\\setlength{\\parindent}{0pt}',
    '\\setlength{\\parskip}{0.45em}',
    '\\allowdisplaybreaks',
    '\\pagestyle{fancy}',
    '\\fancyhf{}',
    '\\fancyhead[L]{\\small ' + headParts.map((p) => escapeTex(p)).join('\\quad ') + '}',
    '\\fancyhead[R]{\\small ' + escapeTex(title) + '}',
    '\\fancyfoot[C]{\\small\\thepage}',
    '\\renewcommand{\\headrulewidth}{0.4pt}',
    '\\begin{document}',
    '\\begin{center}',
    '{\\LARGE\\bfseries ' + escapeTex(m.title || title) + '}',
    '\\end{center}',
    '\\vspace{0.2em}'
  ].join('\n');

  const body = mdToTexBody(md);
  return preamble + '\n\n' + body + '\n\n\\end{document}\n';
}

module.exports = { buildTex, mdToTexBody, inlineToTex, escapeTex };

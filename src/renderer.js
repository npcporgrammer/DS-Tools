/* renderer.js —— 界面逻辑 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const editor = $('editor');
  const page = $('page');
  const pageWrap = $('pageWrap');
  const previewScroll = $('previewScroll');
  const paletteEl = $('palette');
  const fileListEl = $('fileList');
  const splitter = $('splitter');
  const editorPane = document.querySelector('.editor-pane');
  const toastWrap = $('toastWrap');
  const statPos = $('statPos');
  const statCount = $('statCount');
  const statState = $('statState');
  const docNameEl = $('docName');
  const zoomRange = $('zoomRange');
  const zoomText = $('zoomText');

  const META_KEYS = ['metaName', 'metaStudent', 'metaCourse', 'metaAssign'];
  const C = '\u0002'; // 插入时的光标落点标记

  let currentName = null;   // Projects 里的文件名
  let files = [];
  let dirty = false;
  let busy = false;
  let saveTimer = null;
  let listTimer = null;

  /* ============================ 初始文档 ============================ */
  const DEFAULT_DOC = [
    '# 一、集合与关系',
    '',
    '这是一段正文，行内公式写成 $x \\in A$，会自动排版成数学体。',
    '',
    '设 $A$ 是有限集合且 $|A| = n$，则 $|\\mathcal{P}(A)| = 2^{n}$。',
    '',
    '## 1.1 独立公式',
    '',
    '$$',
    '\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}, \\qquad',
    '\\forall a,b \\in A:\\ aRb \\iff [a] = [b]',
    '$$',
    '',
    '## 1.2 真值表',
    '',
    '| $p$ | $q$ | $p \\land q$ | $p \\to q$ |',
    '|---|---|---|---|',
    '| T | T | T | T |',
    '| T | F | F | F |',
    '| F | T | F | T |',
    '| F | F | F | T |',
    '',
    '## 1.3 图',
    '',
    '图用三个反引号加 tikz 写，导出 PDF 时才真正渲染：',
    '',
    '```tikz',
    '\\node[circle,draw] (a) at (0,0) {$v_1$};',
    '\\node[circle,draw] (b) at (2.4,0) {$v_2$};',
    '\\node[circle,draw] (c) at (1.2,1.9) {$v_3$};',
    '\\draw[->] (a) -- (b);',
    '\\draw[->] (b) -- (c);',
    '\\draw[->] (c) -- (a);',
    '```',
    '',
    '## 1.4 列表',
    '',
    '- 证明第一点：$A \\subseteq B$。',
    '- 证明第二点：$B \\subseteq A$。',
    '',
    '1. 任取 $x \\in A$。',
    '2. 由定义得 $x \\in B$。',
    ''
  ].join('\n');

  /* ============================ 撤销栈 ============================ */
  const U = { stack: [], index: 0, lastTypeAt: 0, LIMIT: 300 };

  function snapshot() {
    return { v: editor.value, s: editor.selectionStart, e: editor.selectionEnd };
  }

  function historyReset() {
    U.stack = [snapshot()];
    U.index = 0;
    U.lastTypeAt = 0;
    syncHistoryButtons();
  }

  function historyRecord(kind) {
    const st = snapshot();
    const now = Date.now();
    const atTop = U.index === U.stack.length - 1;

    if (kind === 'type' && atTop && U.index > 0 && now - U.lastTypeAt < 700) {
      U.stack[U.index] = st;
      U.lastTypeAt = now;
      return;
    }

    U.stack.length = U.index + 1;
    U.stack.push(st);
    if (U.stack.length > U.LIMIT) U.stack.shift();
    U.index = U.stack.length - 1;
    U.lastTypeAt = kind === 'type' ? now : 0;
    syncHistoryButtons();
  }

  function applySnapshot(st) {
    editor.value = st.v;
    editor.setSelectionRange(st.s, st.e);
    renderPreview();
    updateStatus();
    markDirty();
  }

  function doUndo() {
    if (U.index <= 0) return;
    U.index--;
    applySnapshot(U.stack[U.index]);
    U.lastTypeAt = 0;
    syncHistoryButtons();
    toast('已撤回一步', null, 1100);
  }

  function doRedo() {
    if (U.index >= U.stack.length - 1) return;
    U.index++;
    applySnapshot(U.stack[U.index]);
    U.lastTypeAt = 0;
    syncHistoryButtons();
    toast('已重做', null, 1100);
  }

  function syncHistoryButtons() {
    const canUndo = U.index > 0;
    const canRedo = U.index < U.stack.length - 1;
    document.querySelectorAll('[data-act="undo"]').forEach((b) => { b.disabled = !canUndo; });
    document.querySelectorAll('[data-act="redo"]').forEach((b) => { b.disabled = !canRedo; });
  }

  /* ============================ 符号面板 ============================ */

  const PALETTE = [
    {
      title: '常用',
      items: [
        ['∈', '\\in', '属于'], ['∉', '\\notin', '不属于'], ['⊆', '\\subseteq', '子集'],
        ['∪', '\\cup', '并'], ['∩', '\\cap', '交'], ['∅', '\\varnothing', '空集'],
        ['∀', '\\forall', '全称量词'], ['∃', '\\exists', '存在量词'], ['→', '\\to', '映射/蕴含'],
        ['⇒', '\\Rightarrow', '推出'], ['∧', '\\land', '合取'], ['∨', '\\lor', '析取']
      ]
    },
    {
      title: '逻辑',
      items: [
        ['¬', '\\neg', '否定'], ['⊕', '\\oplus', '异或'], ['↔', '\\leftrightarrow', '双条件'],
        ['⇔', '\\Leftrightarrow', '等价'], ['⊤', '\\top', '永真'], ['⊥', '\\bot', '永假'],
        ['⊢', '\\vdash', '可证'], ['⊨', '\\models', '蕴含'], ['≡', '\\equiv', '恒等'],
        ['∴', '\\therefore', '所以'], ['∵', '\\because', '因为'], ['□', '\\square', '证毕']
      ]
    },
    {
      title: '集合',
      items: [
        ['⊂', '\\subset', '真子集'], ['⊊', '\\subsetneq', '真包含于'], ['⊇', '\\supseteq', '包含'],
        ['⊃', '\\supset', '真包含'], ['∖', '\\setminus', '差集'], ['△', '\\triangle', '对称差'],
        ['×', '\\times', '笛卡尔积'], ['℘', '\\mathcal{P}', '幂集'], ['|A|', '|A|', '基数'],
        ['∅', '\\emptyset', '空集']
      ]
    },
    {
      title: '关系',
      items: [
        ['≤', '\\le', '小于等于'], ['≥', '\\ge', '大于等于'], ['≠', '\\neq', '不等'],
        ['≈', '\\approx', '近似'], ['≼', '\\preccurlyeq', '前序'], ['≺', '\\prec', '严格前序'],
        ['≻', '\\succ', '后继'], ['∣', '\\mid', '整除/限制'], ['∤', '\\nmid', '不整除'],
        ['∘', '\\circ', '复合'], ['∼', '\\sim', '等价关系'], ['R⁻¹', 'R^{-1}', '逆关系']
      ]
    },
    {
      title: '数论 / 组合',
      items: [
        ['∑', '\\sum', '求和'], ['∏', '\\prod', '求积'], ['⌊', '\\lfloor ' + C + '\\rfloor', '下取整'],
        ['⌈', '\\lceil ' + C + '\\rceil', '上取整'], ['√', '\\sqrt{' + C + '}', '根号'], ['∞', '\\infty', '无穷'],
        ['n!', 'n!', '阶乘'], ['C', '\\binom{n}{k}', '组合数'], ['gcd', '\\gcd', '最大公因数'],
        ['mod', '\\pmod{n}', '模']
      ]
    },
    {
      title: '图论',
      items: [
        ['χ', '\\chi', '色数'], ['δ', '\\delta', '最小度'], ['Δ', '\\Delta', '最大度'],
        ['κ', '\\kappa', '连通度'], ['deg', '\\deg', '度'], ['Kₙ', 'K_{n}', '完全图'],
        ['Cₙ', 'C_{n}', '圈'], ['Pₙ', 'P_{n}', '路'], ['Wₙ', 'W_{n}', '轮'],
        ['G', 'G', '图']
      ]
    },
    {
      title: '希腊字母',
      items: [
        ['α', '\\alpha', 'alpha'], ['β', '\\beta', 'beta'], ['γ', '\\gamma', 'gamma'],
        ['δ', '\\delta', 'delta'], ['ε', '\\varepsilon', 'epsilon'], ['θ', '\\theta', 'theta'],
        ['λ', '\\lambda', 'lambda'], ['μ', '\\mu', 'mu'], ['π', '\\pi', 'pi'],
        ['ρ', '\\rho', 'rho'], ['σ', '\\sigma', 'sigma'], ['τ', '\\tau', 'tau'],
        ['φ', '\\varphi', 'phi'], ['ψ', '\\psi', 'psi'], ['ω', '\\omega', 'omega'],
        ['Γ', '\\Gamma', 'Gamma'], ['Δ', '\\Delta', 'Delta'], ['Σ', '\\Sigma', 'Sigma'],
        ['Π', '\\Pi', 'Pi'], ['Ω', '\\Omega', 'Omega']
      ]
    },
    {
      title: '箭头',
      items: [
        ['→', '\\to', '右箭头'], ['←', '\\gets', '左箭头'], ['↔', '\\leftrightarrow', '双向'],
        ['⇒', '\\Rightarrow', '推出'], ['⇐', '\\Leftarrow', '反向推出'], ['⇔', '\\Leftrightarrow', '当且仅当'],
        ['↦', '\\mapsto', '映射到'], ['⟶', '\\longrightarrow', '长箭头'], ['⟹', '\\Longrightarrow', '长推出'],
        ['⟺', '\\iff', '长等价']
      ]
    },
    {
      title: '结构',
      items: [
        ['分式', '\\frac{' + C + '}{}', 'frac', { wide: true }],
        ['根号', '\\sqrt{' + C + '}', 'sqrt', { wide: true }],
        ['上标', '^{' + C + '}', '上标', { wide: true }],
        ['下标', '_{' + C + '}', '下标', { wide: true }],
        ['求和', '\\sum_{i=1}^{n} ' + C, 'sum', { wide: true }],
        ['矩阵', '\\begin{pmatrix} a_{11} & a_{12} \\\\ a_{21} & a_{22} \\end{pmatrix}', 'pmatrix', { wide: true, wrap: false }],
        ['分段', '\\begin{cases} ' + C + ' & x > 0 \\\\ 0 & x \\le 0 \\end{cases}', 'cases', { wide: true, wrap: false }],
        ['极限', '\\lim_{n \\to \\infty} ' + C, 'lim', { wide: true }]
      ]
    },
    {
      title: '块',
      items: [
        ['真值表', '| $p$ | $q$ | ' + C + ' |\n|---|---|---|\n| T | T |  |\n| T | F |  |\n| F | T |  |\n| F | F |  |', '真值表模板', { wide: true, wrap: false }],
        ['证明', '**证明**\n\n' + C + '\n\n$\\square$', '证明框架', { wide: true, wrap: false }],
        ['公式块', '$$\n' + C + '\n$$', '独立公式', { wide: true, wrap: false }]
      ]
    }
  ];

  const SNIPPETS = {
    frac: ['\\frac{' + C + '}{}', true],
    sqrt: ['\\sqrt{' + C + '}', true],
    sum: ['\\sum_{i=1}^{n} ' + C, true],
    matrix: ['\\begin{pmatrix} a_{11} & a_{12} \\\\ a_{21} & a_{22} \\end{pmatrix}', false],
    cases: ['\\begin{cases} ' + C + ' & x > 0 \\\\ 0 & x \\le 0 \\end{cases}', false],
    truthtable: ['| $p$ | $q$ | ' + C + ' |\n|---|---|---|\n| T | T |  |\n| T | F |  |\n| F | T |  |\n| F | F |  |', false],
    proof: ['**证明**\n\n' + C + '\n\n$\\square$', false],
    block: ['$$\n' + C + '\n$$', false],
    tikz: ['```tikz\n\\node[circle,draw] (a) at (0,0) {$v_1$};\n\\node[circle,draw] (b) at (2.4,0) {$v_2$};\n\\node[circle,draw] (c) at (1.2,1.9) {$v_3$};\n\\draw[->] (a) -- (b);\n\\draw[->] (b) -- (c);\n\\draw[->] (c) -- (a);\n```', false]
  };

  function buildPalette() {
    const frag = document.createDocumentFragment();
    for (const sec of PALETTE) {
      const box = document.createElement('div');
      box.className = 'pal-section';

      const title = document.createElement('div');
      title.className = 'pal-title';
      title.textContent = sec.title;
      box.appendChild(title);

      const grid = document.createElement('div');
      grid.className = 'pal-grid';
      for (const [glyph, tex, tip, opts] of sec.items) {
        const b = document.createElement('button');
        b.className = 'pal-btn' + (opts && opts.wide ? ' wide' : '');
        b.textContent = glyph;
        b.title = tip + '\n' + tex.split(C).join('│');
        b.addEventListener('click', () => insertSnippet(tex, opts || {}));
        grid.appendChild(b);
      }
      box.appendChild(grid);
      frag.appendChild(box);
    }
    paletteEl.appendChild(frag);
  }

  /* ============================ 插入逻辑 ============================ */
  function mathState(text, pos) {
    let count = 0;
    for (let i = 0; i < pos; i++) {
      if (text[i] === '\\') { i++; continue; }
      if (text[i] === '$') count++;
    }
    return { inMath: count % 2 === 1 };
  }

  function insertText(text, caretIndex, kind) {
    const s = editor.selectionStart;
    const e = editor.selectionEnd;
    const val = editor.value;
    editor.value = val.slice(0, s) + text + val.slice(e);
    const pos = s + (caretIndex == null ? text.length : caretIndex);
    editor.setSelectionRange(pos, pos);
    editor.focus();
    historyRecord(kind || 'op');
    schedulePreview();
    updateStatus();
    markDirty();
  }

  function insertSnippet(raw, opts) {
    let body = raw;
    let caret = body.indexOf(C);
    if (caret >= 0) {
      body = body.slice(0, caret) + body.slice(caret + 1);
    } else {
      caret = body.length;
    }

    if (opts.wrap !== false) {
      const { inMath } = mathState(editor.value, editor.selectionStart);
      if (!inMath) {
        body = '$' + body + '$';
        caret += 1;
      }
    }
    insertText(body, caret, 'op');
  }

  function wrapSelection(display) {
    const s = editor.selectionStart;
    const e = editor.selectionEnd;
    const val = editor.value;
    const sel = val.slice(s, e) || 'x';
    const wrapped = display ? '$$\n' + sel + '\n$$' : '$' + sel + '$';
    editor.value = val.slice(0, s) + wrapped + val.slice(e);
    const caret = s + (display ? 3 : 1) + sel.length;
    editor.setSelectionRange(caret, caret);
    editor.focus();
    historyRecord('op');
    schedulePreview();
    updateStatus();
    markDirty();
  }

  /* ============================ 预览渲染 ============================ */
  function meta() {
    return {
      name: $('metaName').value.trim(),
      studentId: $('metaStudent').value.trim(),
      course: $('metaCourse').value.trim() || '离散数学',
      assignment: $('metaAssign').value.trim(),
      title: ''
    };
  }

  function docTitle() {
    const m = meta();
    return m.assignment ? m.course + ' 第 ' + m.assignment + ' 次作业' : m.course + ' 作业';
  }

  function renderPreview() {
    const m = meta();
    const heads = [];
    if (m.name) heads.push('姓名：' + m.name);
    if (m.studentId) heads.push('学号：' + m.studentId);

    const runhead =
      '<div class="page-runhead"><span>' + MDRender.escHtml(heads.join('　')) +
      '</span><span>' + MDRender.escHtml(docTitle()) + '</span></div>';

    const title = '<div class="page-title">' + MDRender.escHtml(docTitle()) + '</div>';
    const body = '<div class="page-body">' + MDRender.render(editor.value) + '</div>';

    page.innerHTML = runhead + title + body;
    fitPage();
  }

  const PAGE_W = 793.7007874; // 210mm @96dpi
  let zoomMode = 'fit';
  let manualZoom = 1;

  function fitScale() {
    const avail = previewScroll.clientWidth - 36;
    return Math.max(0.3, Math.min(1.8, avail / PAGE_W));
  }

  function fitPage() {
    const scale = zoomMode === 'fit' ? fitScale() : manualZoom;
    const w = Math.round(PAGE_W * scale) + 'px';
    const h = Math.round(page.offsetHeight * scale) + 'px';

    if (pageWrap.style.width !== w) pageWrap.style.width = w;
    if (pageWrap.style.height !== h) pageWrap.style.height = h;
    const tf = 'scale(' + scale + ')';
    if (page.style.transform !== tf) page.style.transform = tf;

    const pct = Math.round(scale * 100);
    if (zoomRange.value !== String(pct)) zoomRange.value = String(Math.min(180, Math.max(40, pct)));
    zoomText.textContent = pct + '%';
  }

  function setZoom(v) {
    zoomMode = 'manual';
    manualZoom = Math.max(0.4, Math.min(1.8, v));
    fitPage();
  }

  function setFit() { zoomMode = 'fit'; fitPage(); }

  let previewTimer = null;
  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(renderPreview, 90);
  }

  /* ============================ 状态栏 ============================ */
  function updateStatus() {
    const pos = editor.selectionStart;
    const upto = editor.value.slice(0, pos);
    const line = upto.split('\n').length;
    const col = pos - upto.lastIndexOf('\n');
    statPos.textContent = '第 ' + line + ' 行，第 ' + col + ' 列';
    statCount.textContent = editor.value.replace(/\s/g, '').length + ' 字';
  }

  function setState(text, kind) {
    statState.textContent = text;
    statState.className = 'state ' + (kind || '');
  }

  function updateTitle() {
    docNameEl.textContent = (currentName || '未命名.md') + (dirty ? ' *' : '');
  }

  function markDirty() {
    dirty = true;
    updateTitle();
    scheduleSave();
  }

  /* ============================ 提示条 ============================ */
  function toast(html, kind, ms) {
    const el = document.createElement('div');
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.innerHTML = html;
    toastWrap.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity .22s, transform .22s';
      el.style.opacity = '0';
      el.style.transform = 'translateY(6px)';
      setTimeout(() => el.remove(), 240);
    }, ms || 2400);
  }

  /* ============================ 文件 ============================ */
  function fmtTime(ms) {
    const d = new Date(ms);
    const now = new Date();
    const hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    if (d.toDateString() === now.toDateString()) return hm;

    const y = new Date(now);
    y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return '昨天 ' + hm;

    return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }

  function fmtSize(n) {
    if (n < 1024) return n + ' B';
    return (n / 1024).toFixed(1) + ' KB';
  }

  function renderFileList() {
    fileListEl.innerHTML = '';
    if (!files.length) {
      const empty = document.createElement('div');
      empty.className = 'file-empty';
      empty.textContent = '还没有作业，点上面的 ＋ 新建';
      fileListEl.appendChild(empty);
      return;
    }

    for (const f of files) {
      const item = document.createElement('div');
      item.className = 'file-item' + (f.name === currentName ? ' is-active' : '');
      item.dataset.file = f.name;
      item.title = f.name;

      const name = document.createElement('span');
      name.className = 'file-name';
      name.textContent = f.name.replace(/\.md$/i, '');

      const m = document.createElement('span');
      m.className = 'file-meta';
      m.textContent = fmtTime(f.mtime) + ' · ' + fmtSize(f.size);

      const del = document.createElement('button');
      del.className = 'file-del';
      del.dataset.del = f.name;
      del.title = '删除这个作业';
      del.textContent = '×';

      item.appendChild(name);
      item.appendChild(m);
      item.appendChild(del);
      fileListEl.appendChild(item);
    }
  }

  async function refreshFiles() {
    try {
      files = await window.api.listDocs();
    } catch (_) { files = []; }
    renderFileList();
  }

  function scheduleListRefresh() {
    clearTimeout(listTimer);
    listTimer = setTimeout(refreshFiles, 400);
  }

  async function saveDoc(silent) {
    if (!currentName) return false;
    const r = await window.api.writeDoc({ name: currentName, content: editor.value });
    if (!r || !r.ok) {
      setState('保存失败', 'err');
      if (!silent) toast('保存失败：' + ((r && r.error) || '未知错误'), 'error', 4000);
      return false;
    }
    dirty = false;
    updateTitle();
    scheduleListRefresh();
    if (!silent) {
      setState('已保存');
      toast('已保存', 'ok', 1200);
    }
    return true;
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { if (dirty) saveDoc(true); }, 1200);
  }

  async function openDoc(name) {
    if (dirty) await saveDoc(true);
    const r = await window.api.readDoc(name);
    if (!r) { toast('打开失败：' + name, 'error'); return; }

    currentName = r.name;
    localStorage.setItem('dmath.last', r.name);
    editor.value = r.content;
    dirty = false;

    historyReset();
    loadMeta();
    renderPreview();
    updateStatus();
    updateTitle();
    renderFileList();
    setState('就绪');
    editor.focus();
    editor.setSelectionRange(0, 0);
    editor.scrollTop = 0;
  }

  function showPrompt(title, value) {
    return new Promise((resolve) => {
      const modal = $('promptModal');
      const input = $('promptInput');
      const ok = $('promptOk');
      const cancel = $('promptCancel');

      $('promptTitle').textContent = title;
      input.value = value || '';
      modal.hidden = false;
      setTimeout(() => { input.focus(); input.select(); }, 30);

      const done = (v) => {
        modal.hidden = true;
        window.removeEventListener('keydown', onKey, true);
        ok.removeEventListener('click', onOk);
        cancel.removeEventListener('click', onCancel);
        resolve(v);
      };
      const onOk = () => done(input.value.trim() || null);
      const onCancel = () => done(null);
      const onKey = (e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); onOk(); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel(); }
      };

      window.addEventListener('keydown', onKey, true);
      ok.addEventListener('click', onOk);
      cancel.addEventListener('click', onCancel);
    });
  }

  function showConfirm(text) {
    return new Promise((resolve) => {
      const modal = $('confirmModal');
      const ok = $('confirmOk');
      const cancel = $('confirmCancel');

      $('confirmText').innerHTML = text;
      modal.hidden = false;
      setTimeout(() => ok.focus(), 30);

      const done = (v) => {
        modal.hidden = true;
        window.removeEventListener('keydown', onKey, true);
        ok.removeEventListener('click', onOk);
        cancel.removeEventListener('click', onCancel);
        resolve(v);
      };
      const onOk = () => done(true);
      const onCancel = () => done(false);
      const onKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel(); }
      };

      window.addEventListener('keydown', onKey, true);
      ok.addEventListener('click', onOk);
      cancel.addEventListener('click', onCancel);
    });
  }

  async function deleteDoc(name) {
    if (!name) return;
    const ok = await showConfirm('确定删除 <b>' + MDRender.escHtml(name) + '</b> 吗？<br>文件会从 Projects 里永久删除，无法撤销。');
    if (!ok) return;

    const r = await window.api.removeDoc(name);
    if (!r || !r.ok) {
      toast('<div class="toast-title">删除失败</div>', 'error', 5000);
      return;
    }

    await refreshFiles();

    if (name === currentName) {
      if (files.length) {
        await openDoc(files[0].name);
      } else {
        const c = await window.api.createDoc({ name: '离散数学作业.md', content: DEFAULT_DOC });
        await refreshFiles();
        if (c && c.ok) await openDoc(c.name);
      }
    }
    toast('已删除 ' + name, 'ok', 1600);
  }

  async function newDoc() {
    const name = await showPrompt('新建作业', defaultNewName());
    if (!name) return;
    if (dirty) await saveDoc(true);
    const r = await window.api.createDoc({ name, content: DEFAULT_DOC });
    if (!r || !r.ok) { toast('新建失败', 'error'); return; }
    await refreshFiles();
    await openDoc(r.name);
    toast('已新建 ' + r.name, 'ok', 1600);
  }

  async function openDocDialog() {
    await window.api.openDocsFolder();
  }

  async function exportDoc() {
    if (busy) return;
    if (dirty) await saveDoc(true);

    busy = true;
    const btns = document.querySelectorAll('[data-act="export"]');
    btns.forEach((b) => { b.disabled = true; });
    setState('正在编译…', 'busy');

    try {
      const r = await window.api.exportPdf({ content: editor.value, meta: meta(), name: currentName });

      if (r.ok) {
        setState('导出成功');
        toast('PDF 已导出到「导出」文件夹<br><span style="opacity:.7;font-size:11.5px">' +
          MDRender.escHtml(r.pdfPath) + '</span>', 'ok', 3600);
        window.api.openPath(r.pdfPath);
      } else {
        setState('编译失败', 'err');
        let html = '<div class="toast-title">' + MDRender.escHtml(r.error || '导出失败') + '</div>';
        if (r.errors && r.errors.length) {
          for (const e of r.errors) {
            html += '<div class="err-item">' +
              (e.line ? '<span class="ln">第 ' + e.line + ' 行 </span>' : '') +
              MDRender.escHtml(e.msg) + '</div>';
          }
        }
        if (r.logTail) html += '<pre>' + MDRender.escHtml(r.logTail) + '</pre>';
        toast(html, 'error', 9000);
      }
    } catch (err) {
      setState('导出出错', 'err');
      toast('<div class="toast-title">导出出错</div><div class="err-item">' +
        MDRender.escHtml(String(err && err.message ? err.message : err)) + '</div>', 'error', 8000);
    } finally {
      busy = false;
      btns.forEach((b) => { b.disabled = false; });
    }
  }

  /* ---------------------------- 元信息 ---------------------------- */
  function metaKey() { return 'dmath.meta.' + (currentName || 'default'); }

  function loadMeta() {
    try {
      const m = JSON.parse(localStorage.getItem(metaKey()) || 'null');
      if (m) {
        $('metaName').value = m.name || '';
        $('metaStudent').value = m.studentId || '';
        $('metaCourse').value = m.course || '离散数学';
        $('metaAssign').value = m.assignment || '';
      } else {
        $('metaCourse').value = '离散数学';
      }
    } catch (_) {}
  }

  function storeMeta() {
    try { localStorage.setItem(metaKey(), JSON.stringify(meta())); } catch (_) {}
  }

  /* ============================ 事件绑定 ============================ */
  editor.addEventListener('input', () => {
    historyRecord('type');
    schedulePreview();
    updateStatus();
    markDirty();
  });

  editor.addEventListener('keyup', updateStatus);
  editor.addEventListener('click', updateStatus);
  editor.addEventListener('select', updateStatus);

  editor.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      insertText('  ', null, 'type');
    }
  });

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act],[data-snippet],[data-wrap],[data-toggle],[data-zoom]');
    if (!el || el.disabled) return;

    if (el.dataset.act === 'undo') return doUndo();
    if (el.dataset.act === 'redo') return doRedo();
    if (el.dataset.act === 'new') return newDoc();
    if (el.dataset.act === 'open') return openDocDialog();
    if (el.dataset.act === 'save') return saveDoc(false);
    if (el.dataset.act === 'export') return exportDoc();
    if (el.dataset.act === 'help') { $('helpModal').hidden = false; return; }

    if (el.dataset.snippet) {
      const [tex, wrap] = SNIPPETS[el.dataset.snippet] || [];
      if (tex) insertSnippet(tex, { wrap });
      return;
    }

    if (el.dataset.wrap) { wrapSelection(el.dataset.wrap === 'block'); return; }

    if (el.dataset.toggle) {
      const kind = el.dataset.toggle;
      if (kind === 'ai') { toggleAiPane(); return; }
      document.body.classList.toggle(kind === 'sidebar' ? 'hide-sidebar' : 'hide-preview');
      requestAnimationFrame(fitPage);
      return;
    }

    if (el.dataset.zoom) {
      if (el.dataset.zoom === 'fit') setFit();
      else setZoom(parseFloat(el.dataset.zoom));
    }
  });

  fileListEl.addEventListener('click', (e) => {
    // 删除按钮
    const delBtn = e.target.closest('[data-del]');
    if (delBtn) {
      e.stopPropagation();
      deleteDoc(delBtn.dataset.del);
      return;
    }
    const item = e.target.closest('.file-item');
    if (!item) return;
    const name = item.dataset.file;
    if (name && name !== currentName) openDoc(name);
  });

  $('btnNewFile').addEventListener('click', newDoc);

  async function openFolderBtn(fn, label) {
    let r;
    try {
      r = await fn();
    } catch (err) {
      toast('<div class="toast-title">调用失败</div><div class="err-item">' +
        MDRender.escHtml(String(err && err.message ? err.message : err)) + '</div>', 'error', 8000);
      return;
    }
    if (r && r.ok) {
      toast('已打开' + label, 'ok', 1800);
    } else {
      toast('<div class="toast-title">打不开' + label + '</div><div class="err-item">' +
        MDRender.escHtml((r && r.error) || '未知原因') + '</div>', 'error', 8000);
    }
  }

  $('btnDocsFolder').addEventListener('click', () => openFolderBtn(window.api.openDocsFolder, ' Projects 文件夹'));
  $('btnExportsFolder').addEventListener('click', () => openFolderBtn(window.api.openExportsFolder, '导出文件夹'));

  document.querySelectorAll('.tab').forEach((t) => {
    t.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('is-active', x === t));
      document.querySelectorAll('.panel').forEach((p) => {
        p.classList.toggle('is-active', p.dataset.panel === t.dataset.tab);
      });
    });
  });

  zoomRange.addEventListener('input', () => setZoom(parseInt(zoomRange.value, 10) / 100));
  $('zoomIn').addEventListener('click', () => {
    setZoom((zoomMode === 'fit' ? fitScale() : manualZoom) + 0.1);
  });
  $('zoomOut').addEventListener('click', () => {
    setZoom((zoomMode === 'fit' ? fitScale() : manualZoom) - 0.1);
  });

  META_KEYS.forEach((id) => {
    const el = $(id);
    el.addEventListener('input', () => { renderPreview(); storeMeta(); });
  });

  // 分栏拖拽（宽屏左右，竖屏上下）
  const panesEl = $('panes');
  let dragging = false;

  function isStacked() {
    return getComputedStyle(panesEl).flexDirection === 'column';
  }

  splitter.addEventListener('mousedown', (e) => {
    e.preventDefault();
    dragging = true;
    splitter.classList.add('dragging');
    document.body.style.cursor = isStacked() ? 'row-resize' : 'col-resize';
    document.body.style.userSelect = 'none';
  });

  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const r = panesEl.getBoundingClientRect();
    const min = 220;

    if (isStacked()) {
      let h = e.clientY - r.top;
      h = Math.max(min, Math.min(r.height - min, h));
      editorPane.style.flex = '0 0 ' + h + 'px';
    } else {
      let w = e.clientX - r.left;
      w = Math.max(min, Math.min(r.width - min, w));
      editorPane.style.flex = '0 0 ' + w + 'px';
    }
    fitPage();
  });

  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    splitter.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    fitPage();
  });

  let lastStacked = isStacked();
  window.addEventListener('resize', () => {
    const now = isStacked();
    if (now !== lastStacked) {
      lastStacked = now;
      editorPane.style.flex = '';
      setTimeout(fitPage, 60);
    }
  });

    // 快捷键（可配置）
  window.addEventListener('keydown', (e) => {
    // 正在录制新组合
    if (recording) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        recording.btn.classList.remove('recording');
        recording = null;
        renderKeyList();
        return;
      }
      const combo = comboFromEvent(e);
      if (!combo) return;
      const dup = SHORTCUT_ACTIONS.find((a) => a.id !== recording.id && keyOf(a.id).toLowerCase() === combo.toLowerCase());
      if (dup) toast('这个组合已被「' + dup.label + '」占用', 'error', 2600);
      keyMap[recording.id] = combo;
      saveKeys();
      recording = null;
      renderKeyList();
      return;
    }

    if (!$('keyModal').hidden) return;
    if (!$('promptModal').hidden) return;
    if (!$('aiCfgModal').hidden) return;

    const tag = (e.target && e.target.tagName) || '';
    const inField = tag === 'INPUT';

    // 输入框里的原生撤销不抢
    if (inField && (e.ctrlKey || e.metaKey) && ['z', 'y'].includes(e.key.toLowerCase())) return;

    const hit = matchShortcut(e);
    if (hit) {
      e.preventDefault();
      hit.run();
      return;
    }

    if (e.key === 'Escape') $('helpModal').hidden = true;
  });
  $('helpClose').addEventListener('click', () => { $('helpModal').hidden = true; });
  $('helpModal').addEventListener('click', (e) => {
    if (e.target === $('helpModal')) $('helpModal').hidden = true;
  });

  const ro = new ResizeObserver(() => {
    clearTimeout(fitPage._t);
    fitPage._t = setTimeout(fitPage, 40);
  });
  ro.observe(previewScroll);

  /* ============================ AI 助手 ============================ */
  const aiPane = $('aiPane');
  const aiMsgs = $('aiMsgs');
  const aiInput = $('aiInput');
  const aiSendBtn = $('aiSend');
  const aiStopBtn = $('aiStop');

  let aiHistory = [];
  let aiBusy = false;
  let aiCtx = '';
  let aiCur = null;

  const AI_SYSTEM = [
    '你是「离散数学作业板」内置的助教。',
    '回答用简体中文，数学公式一律用 LaTeX：行内 $...$，独立公式 $$...$$。',
    '结论要能直接粘进作业：简洁、分步骤、给出理由，不要客套话。',
    '涉及集合、关系、图论、组合、数理逻辑时使用标准符号与术语。',
    '',
    '【修改文档】当用户要求你修改当前文档时，不要直接输出整篇新文档，而是拆成若干处独立的改动，每处用下面的格式：',
    '===EDIT===',
    '说明：一句话说明这处改什么',
    '---OLD---',
    '要被替换掉的原文（必须与文档中一字不差，包含换行）',
    '---END---',
    '---NEW---',
    '替换后的新内容',
    '---END---',
    '',
    '规则：',
    '1. OLD 必须能在文档里精确找到；找不到就说明原因，不要硬猜。',
    '2. 一处改动只做一件事，多处就写多个 EDIT 块。',
    '3. 想追加内容时，OLD 留空即可。',
    '4. EDIT 块之外可以写简短说明，但不要重复贴旧内容。',
    '5. 用户没有要求改文档时，不要输出 EDIT 块。'
  ].join('\n');

  function aiEmptyHint() {
    if (aiMsgs.children.length) return;
    const d = document.createElement('div');
    d.className = 'ai-empty';
    d.innerHTML = '<b>可以这样问：</b><br>' +
      '· 这道题的思路是什么<br>' +
      '· 把我这一段证明改严谨<br>' +
      '· 用 LaTeX 写一个真值表<br><br>' +
      '在编辑器里选中文字再提问，会自动带上选中内容。';
    aiMsgs.appendChild(d);
  }

  function aiScrollBottom() {
    aiMsgs.scrollTop = aiMsgs.scrollHeight;
  }

  function toggleAiPane(force) {
    const show = force === undefined ? aiPane.hidden : force;
    aiPane.hidden = !show;
    if (show) {
      aiEmptyHint();
      aiInput.focus();
    }
    requestAnimationFrame(() => { fitPage(); });
  }

  function aiAppendUser(text) {
    const wrap = document.createElement('div');
    wrap.className = 'ai-msg user';
    const role = document.createElement('div');
    role.className = 'ai-role';
    role.textContent = '我';
    const b = document.createElement('div');
    b.className = 'ai-bubble';
    b.textContent = text;
    wrap.appendChild(role);
    wrap.appendChild(b);
    aiMsgs.appendChild(wrap);
    aiScrollBottom();
  }

  function aiCreateAssistant() {
    const wrap = document.createElement('div');
    wrap.className = 'ai-msg assistant';

    const role = document.createElement('div');
    role.className = 'ai-role';
    role.textContent = 'AI';

    const think = document.createElement('details');
    think.className = 'ai-think';
    think.hidden = true;
    think.open = true;
    const sum = document.createElement('summary');
    sum.textContent = '思考过程';
    const thinkBody = document.createElement('div');
    thinkBody.className = 'think-body';
    think.appendChild(sum);
    think.appendChild(thinkBody);

    const bubble = document.createElement('div');
    bubble.className = 'ai-bubble';
    bubble.textContent = '…';

    wrap.appendChild(role);
    wrap.appendChild(think);
    wrap.appendChild(bubble);
    aiMsgs.appendChild(wrap);
    aiScrollBottom();

    return { wrap, think, sum, thinkBody, bubble, text: '', reason: '', tools: null };
  }

  function aiFinalize(cur) {
    if (!cur) return;
    renderAssistantBody(cur);
    if (cur.reason) {
      cur.sum.textContent = '思考过程 · ' + cur.reason.length + ' 字';
    }
    if (!cur.tools) {
      const tools = document.createElement('div');
      tools.className = 'ai-tools';
      const ins = document.createElement('button');
      ins.className = 'stat-btn';
      ins.textContent = '插入到光标处';
      ins.addEventListener('click', () => {
        insertText(cur.plain.trim() + '\n', null, 'op');
        toast('已插入', 'ok', 1400);
      });
      const cp = document.createElement('button');
      cp.className = 'stat-btn';
      cp.textContent = '复制';
      cp.addEventListener('click', () => {
        navigator.clipboard.writeText(cur.plain).then(() => toast('已复制', 'ok', 1200));
      });
      tools.appendChild(ins);
      tools.appendChild(cp);
      cur.wrap.appendChild(tools);
      cur.tools = tools;
    }
    aiScrollBottom();
  }
function aiSetBusy(v) {
    aiBusy = v;
    aiSendBtn.disabled = v;
    aiStopBtn.hidden = !v;
  }

  window.api.ai.onEvent((ev) => {
    const cur = aiCur;
    if (!cur) return;

    if (ev.type === 'reason' && ev.text) {
      cur.reason += ev.text;
      cur.think.hidden = false;
      cur.thinkBody.textContent = cur.reason;
      aiScrollBottom();
      return;
    }
    if (ev.type === 'content' && ev.text) {
      cur.text += ev.text;
      cur.bubble.textContent = cur.text;
      aiScrollBottom();
      return;
    }
    if (ev.type === 'done') {
      aiFinalize(cur);
      if (cur.text) aiHistory.push({ role: 'assistant', content: cur.text });
      aiSetBusy(false);
      aiCur = null;
      return;
    }
    if (ev.type === 'error') {
      cur.bubble.textContent = cur.text || '（出错了）';
      const err = document.createElement('div');
      err.className = 'err-item';
      err.style.color = 'var(--red)';
      err.textContent = ev.error || '请求失败';
      cur.wrap.appendChild(err);
      aiSetBusy(false);
      aiCur = null;
    }
  });

  async function aiSend() {
    if (aiBusy) return;
    const q = aiInput.value.trim();
    if (!q) return;

    const cfg = await window.api.ai.getConfig();
    if (!cfg.hasKey) {
      toast('先配置 API Key', 'error', 2200);
      aiOpenConfig();
      return;
    }

    aiInput.value = '';
    aiAppendUser(q);

    const parts = [];
    if ($('aiUseDoc').checked) {
      const doc = (editor.value || '').trim();
      if (doc) {
        const cut = doc.length > 6000;
        parts.push('【当前文档】' + (currentName || '未命名') + '\n' +
          (cut ? doc.slice(0, 6000) + '\n……（超出 6000 字，已截断）' : doc));
      }
    }
    if (aiCtx) parts.push('【选中的内容】\n' + aiCtx);
    parts.push('【问题】\n' + q);
    const content = parts.join('\n\n');

    aiHistory.push({ role: 'user', content });
    if (aiHistory.length > 20) aiHistory = aiHistory.slice(-20);

    aiCur = aiCreateAssistant();
    aiSetBusy(true);
    aiScrollBottom();

    const messages = [{ role: 'system', content: AI_SYSTEM }].concat(aiHistory);
    try {
      const r = await window.api.ai.chat({ messages });
      if (!r.ok && aiCur) {
        // 主进程也会发 error 事件；这里兜底
        aiSetBusy(false);
      }
    } catch (err) {
      if (aiCur) {
        aiCur.bubble.textContent = '请求失败：' + String(err && err.message ? err.message : err);
        aiSetBusy(false);
        aiCur = null;
      }
    }
  }

  function aiStop() {
    window.api.ai.abort();
    aiSetBusy(false);
    aiCur = null;
  }

  /* ---- 接口配置 ---- */

  function aiPresetApply() {
    const v = $('aiPreset').value;
    if (v === 'custom') return;
    const [base, model] = v.split('|');
    $('aiBaseURL').value = base;
    $('aiModel').value = model;
  }

  async function aiOpenConfig() {
    let c = { baseURL: '', model: '', hasKey: false, keyTail: '', vision: {} };
    try { c = await window.api.ai.getConfig(); } catch (_) {}
    const v = c.vision || {};

    $('aiBaseURL').value = c.baseURL || '';
    $('aiModel').value = c.model || '';

    const keyEl = $('aiKey');
    keyEl.value = '';
    keyEl.placeholder = c.hasKey ? ('已保存（尾号 ' + c.keyTail + '），留空不修改') : 'sk-...';

    const preset = $('aiPreset');
    const hit = Array.from(preset.options).find((o) => o.value === (c.baseURL + '|' + c.model));
    preset.value = hit ? hit.value : 'custom';

    $('aiVBaseURL').value = v.baseURL || '';
    $('aiVModel').value = v.model || '';
    const vKey = $('aiVKey');
    vKey.value = '';
    vKey.placeholder = v.hasKey ? ('已保存（尾号 ' + v.keyTail + '），留空不修改') : 'sk-...';

    const vpreset = $('aiVPreset');
    const vhit = Array.from(vpreset.options).find((o) => o.value === (v.baseURL + '|' + v.model));
    vpreset.value = vhit ? vhit.value : 'custom';

    $('aiCfgModal').hidden = false;
  }

  async function aiSaveConfig() {
    const patch = {
      baseURL: $('aiBaseURL').value.trim(),
      model: $('aiModel').value.trim(),
      apiKey: $('aiKey').value.trim(),
      vision: {
        baseURL: $('aiVBaseURL').value.trim(),
        model: $('aiVModel').value.trim(),
        apiKey: $('aiVKey').value.trim()
      }
    };
    if (!patch.baseURL || !patch.model) { toast('文本模型的 Base URL 和模型都要填', 'error', 2400); return; }
    const r = await window.api.ai.setConfig(patch);
    if (r && r.ok) {
      $('aiCfgModal').hidden = true;
      toast('已保存接口配置', 'ok', 1800);
    } else {
      toast('保存失败：' + ((r && r.error) || '未知错误'), 'error', 4000);
    }
  }

  async function aiProbe(vision) {
    const btn = vision ? $('aiVCfgTest') : $('aiCfgTest');
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = '测试中…';
    await window.api.ai.setConfig({
      baseURL: $('aiBaseURL').value.trim(),
      model: $('aiModel').value.trim(),
      apiKey: $('aiKey').value.trim(),
      vision: {
        baseURL: $('aiVBaseURL').value.trim(),
        model: $('aiVModel').value.trim(),
        apiKey: $('aiVKey').value.trim()
      }
    });
    const r = await window.api.ai.probe({ vision: !!vision });
    btn.disabled = false;
    btn.textContent = label;
    if (r.ok) toast((vision ? '视觉模型' : '文本模型') + '连接正常：' + r.model, 'ok', 2400);
    else toast('连接失败：' + r.error, 'error', 6000);
  }

  $('aiCfgTest').addEventListener('click', () => aiProbe(false));
  $('aiVCfgTest').addEventListener('click', () => aiProbe(true));
  $('aiVPreset').addEventListener('change', () => {
    const v = $('aiVPreset').value;
    if (v === 'custom') return;
    const [base, model] = v.split('|');
    $('aiVBaseURL').value = base;
    $('aiVModel').value = model;
  });

  $('aiSend').addEventListener('click', aiSend);
  $('aiStop').addEventListener('click', aiStop);
  $('aiClose').addEventListener('click', () => toggleAiPane(false));
  $('aiSettings').addEventListener('click', aiOpenConfig);
  $('aiClear').addEventListener('click', () => {
    aiHistory = [];
    aiMsgs.innerHTML = '';
    aiEmptyHint();
  });
  $('aiCtxClear').addEventListener('click', () => {
    aiCtx = '';
    $('aiCtx').hidden = true;
  });

  aiInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      aiSend();
    }
  });

  $('aiPreset').addEventListener('change', aiPresetApply);
  $('aiCfgSave').addEventListener('click', aiSaveConfig);
  $('aiCfgClose').addEventListener('click', () => { $('aiCfgModal').hidden = true; });
  $('aiCfgModal').addEventListener('click', (e) => {
    if (e.target === $('aiCfgModal')) $('aiCfgModal').hidden = true;
  });

  /* ---- 设置页 —— */
  function defaultNewName() {
    const m = meta();
    let t = m.assignment
      ? m.course + '第' + m.assignment + '次作业'
      : (m.course ? m.course + '作业' : '未命名');
    t = String(t).replace(/\s+/g, '').replace(/[\\/:*?"<>|]/g, '_');
    return (t || '未命名') + '.md';
  }

  $('btnShortcuts').addEventListener('click', openKeyModal);
  $('btnAiCfg').addEventListener('click', aiOpenConfig);
  $('btnExportsFolder2').addEventListener('click', () => window.api.openExportsFolder());

  $('keyClose').addEventListener('click', () => { $('keyModal').hidden = true; });
  $('keyDone').addEventListener('click', () => { $('keyModal').hidden = true; });
  $('keyModal').addEventListener('click', (e) => {
    if (e.target === $('keyModal')) $('keyModal').hidden = true;
  });
  $('keyReset').addEventListener('click', () => {
    keyMap = {};
    saveKeys();
    renderKeyList();
    toast('已恢复默认快捷键', 'ok', 1600);
  });

  // 编辑器选中内容 → 引用到提问里
  editor.addEventListener('mouseup', () => {
    const sel = editor.value.slice(editor.selectionStart, editor.selectionEnd).trim();
    if (!sel || sel.length < 4) return;
    aiCtx = sel.length > 4000 ? sel.slice(0, 4000) : sel;
    $('aiCtxText').textContent = '引用选中内容：' + sel.replace(/\s+/g, ' ').slice(0, 40) + '…';
    $('aiCtx').hidden = false;
  });

  /* ============================ AI 改动 / 图库 ============================ */

  /* ---- 解析 EDIT 块 ---- */
  const EDIT_RE = /===EDIT===([\s\S]*?)---OLD---([\s\S]*?)---END---([\s\S]*?)---NEW---([\s\S]*?)---END---/g;

  function parseEdits(text) {
    const segs = [];
    let last = 0;
    let m;
    EDIT_RE.lastIndex = 0;
    while ((m = EDIT_RE.exec(text)) !== null) {
      const before = text.slice(last, m.index);
      if (before.trim()) segs.push({ type: 'text', text: before });
      const why = (m[1].match(/说明[:：]\s*([^\n]*)/) || [])[1] || '修改';
      segs.push({ type: 'edit', why: why.trim(), old: m[2], new: m[4] });
      last = EDIT_RE.lastIndex;
    }
    const tail = text.slice(last);
    if (tail.trim()) segs.push({ type: 'text', text: tail });
    return segs;
  }

  /** 在编辑器里把 oldRaw 换成 newRaw；找不到就返回错误 */
  function applyEditText(oldRaw, newRaw, force) {
    const v = editor.value;
    const isAppend = !String(oldRaw).trim();

    if (!isAppend && !force) {
      const used = String(oldRaw).trim();
      // 疑似截断守卫：替换后反而短了一大截
      if (used.length > 200 && String(newRaw).length < used.length * 0.5) {
        return { ok: false, error: '改动后内容明显变短，疑似被截断，已拦下' };
      }
    }

    if (isAppend) {
      const sep = v.trim() ? '\n\n' : '';
      historyRecord('ai');
      editor.value = v.replace(/\s+$/, '') + sep + String(newRaw).trim() + '\n';
      editor.setSelectionRange(editor.value.length, editor.value.length);
      schedulePreview(); updateStatus(); markDirty();
      return { ok: true, appended: true };
    }

    const cands = [];
    const push = (s) => { if (s && !cands.includes(s)) cands.push(s); };
    push(oldRaw);
    push(String(oldRaw).replace(/^\n+/, '').replace(/\n+$/, ''));
    push(String(oldRaw).replace(/\r\n/g, '\n'));
    push(String(oldRaw).replace(/\r\n/g, '\n').replace(/^\n+/, '').replace(/\n+$/, ''));

    let at = -1;
    let used = '';
    for (const c of cands) {
      at = v.indexOf(c);
      if (at >= 0) { used = c; break; }
    }
    if (at < 0) return { ok: false, error: '文档里找不到这段原文（可能刚被改过）' };

    historyRecord('ai');
    editor.value = v.slice(0, at) + newRaw + v.slice(at + used.length);
    const caret = at + String(newRaw).length;
    editor.setSelectionRange(caret, caret);
    schedulePreview(); updateStatus(); markDirty();
    return { ok: true };
  }

  function makeDiffBlock(oldText, newText) {
    const box = document.createElement('div');
    box.className = 'edit-diff';
    const clip = (s, n) => {
      const lines = String(s).split('\n');
      if (lines.length <= n) return { text: lines.join('\n'), more: 0 };
      return { text: lines.slice(0, n).join('\n'), more: lines.length - n };
    };
    if (String(oldText).trim()) {
      const c = clip(oldText, 10);
      const d = document.createElement('span');
      d.className = 'diff-del';
      d.textContent = c.text + (c.more ? '\n… 还有 ' + c.more + ' 行' : '');
      box.appendChild(d);
    }
    const c2 = clip(newText, 10);
    const a = document.createElement('span');
    a.className = 'diff-add';
    a.textContent = c2.text + (c2.more ? '\n… 还有 ' + c2.more + ' 行' : '');
    box.appendChild(a);
    return box;
  }

  function makeEditCard(seg) {
    const card = document.createElement('div');
    card.className = 'edit-card';

    const head = document.createElement('div');
    head.className = 'edit-head';
    const badge = document.createElement('span');
    badge.className = 'edit-badge';
    badge.textContent = String(seg.old).trim() ? '改动' : '追加';
    const why = document.createElement('span');
    why.className = 'edit-why';
    why.textContent = seg.why || '修改';
    head.appendChild(badge);
    head.appendChild(why);
    card.appendChild(head);
    card.appendChild(makeDiffBlock(seg.old, seg.new));

    const actions = document.createElement('div');
    actions.className = 'edit-actions';

    const finish = (okText, cls) => {
      const st = document.createElement('div');
      st.className = 'edit-state ' + (cls || '');
      st.textContent = okText;
      card.replaceChild(st, actions);
    };

    const ok = document.createElement('button');
    ok.className = 'btn-primary';
    ok.textContent = '同意';
    ok.addEventListener('click', () => {
      const r = applyEditText(seg.old, seg.new);
      if (r.ok) {
        finish(r.appended ? '已追加到末尾（Ctrl+Z 可撤回）' : '已应用到文档（Ctrl+Z 可撤回）', 'ok');
        toast('已应用改动', 'ok', 1400);
      } else {
        finish('没应用：' + r.error, 'no');
      }
    });

    const no = document.createElement('button');
    no.className = 'stat-btn';
    no.textContent = '拒绝';
    no.addEventListener('click', () => finish('已拒绝这处改动', 'no'));

    actions.appendChild(ok);
    actions.appendChild(no);
    card.appendChild(actions);

    // 完全读写模式：直接应用
    if ($('aiRw').checked) {
      const r = applyEditText(seg.old, seg.new);
      if (r.ok) {
        finish('已自动应用（完全读写模式，Ctrl+Z 可撤回）', 'ok');
      } else {
        finish('自动应用失败，请手动处理：' + r.error, 'no');
      }
    }

    return card;
  }

  /** 渲染 AI 回复：普通文字走 Markdown，EDIT 块渲染成改动卡片 */
  function renderAssistantBody(cur) {
    const text = cur.text || '';
    const segs = parseEdits(text);
    cur.plain = segs.filter((s) => s.type === 'text').map((s) => s.text).join('\n').trim();

    if (!segs.length) {
      cur.bubble.innerHTML = MDRender.render(text || '（没有返回内容）');
      return;
    }

    cur.bubble.innerHTML = '';
    for (const s of segs) {
      if (s.type === 'text') {
        const d = document.createElement('div');
        d.innerHTML = MDRender.render(s.text);
        cur.bubble.appendChild(d);
      } else {
        cur.bubble.appendChild(makeEditCard(s));
      }
    }
  }

  /* ---- 完全读写开关（默认关闭，记在本机） ---- */
  const RW_STORE = 'dmath.aiRw';
  function loadRw() {
    try { $('aiRw').checked = localStorage.getItem(RW_STORE) === '1'; } catch (_) {}
  }
  $('aiRw').addEventListener('change', () => {
    try { localStorage.setItem(RW_STORE, $('aiRw').checked ? '1' : '0'); } catch (_) {}
    if ($('aiRw').checked) toast('已开启完全读写：AI 会直接改文件', 'error', 3200);
  });

  /* ============================ 图库 ============================ */
  const GAL_SEL = new Set();

  function galSelectedPaths() {
    return Array.from(GAL_SEL);
  }

  async function openGallery() {
    $('galleryModal').hidden = false;
    await renderGallery();
  }

  async function renderGallery() {
    const grid = $('galGrid');
    grid.innerHTML = '';
    let items = [];
    try { items = await window.api.gallery.list(); } catch (_) { items = []; }

    const cards = [];
    for (const it of items) {
      for (const img of it.images) cards.push({ it, img });
    }

    $('galEmpty').hidden = cards.length > 0;
    $('galCount').textContent = cards.length ? cards.length + ' 张' : '';

    for (const { it, img } of cards) {
      const cell = document.createElement('div');
      cell.className = 'gal-item' + (GAL_SEL.has(img.file) ? ' is-checked' : '');
      cell.title = img.name + '\n' + (it.source || '');

      const pic = document.createElement('img');
      pic.src = img.thumb;
      cell.appendChild(pic);

      const tick = document.createElement('span');
      tick.className = 'gal-tick';
      cell.appendChild(tick);

      if (it.kind === 'pdf') {
        const badge = document.createElement('span');
        badge.className = 'gal-badge';
        badge.textContent = 'PDF';
        cell.appendChild(badge);
      }

      const meta = document.createElement('div');
      meta.className = 'gal-meta';
      meta.textContent = (it.source || img.name) + '  ·  ' + Math.round(img.size / 1024) + ' KB';
      cell.appendChild(meta);

      cell.addEventListener('click', () => {
        if (GAL_SEL.has(img.file)) { GAL_SEL.delete(img.file); cell.classList.remove('is-checked'); }
        else { GAL_SEL.add(img.file); cell.classList.add('is-checked'); }
        updateGalButtons();
      });

      grid.appendChild(cell);
    }
    updateGalButtons();
  }

  function updateGalButtons() {
    const n = GAL_SEL.size;
    $('galRecognize').disabled = n === 0;
    $('galRecognize').textContent = n ? '识别选中（' + n + '）' : '识别选中';
    $('galDelete').disabled = n === 0;
  }

  async function galUpload() {
    const r = await window.api.gallery.import({ fromDialog: true });
    if (r.canceled) return;
    if (r.failed && r.failed.length) {
      toast('有 ' + r.failed.length + ' 个文件导入失败：' + r.failed[0].error, 'error', 5000);
    } else if (r.added) {
      toast('已添加 ' + r.added + ' 个素材', 'ok', 1800);
    }
    await renderGallery();
  }

  async function galDelete() {
    if (!GAL_SEL.size) return;
    const items = await window.api.gallery.list();
    const ids = new Set();
    for (const it of items) {
      for (const img of it.images) if (GAL_SEL.has(img.file)) ids.add(it.id);
    }
    const okc = await showConfirm('删除素材', '确定删除选中的 ' + ids.size + ' 个素材？（整组一起删，不影响文档）');
    if (!okc) return;
    for (const id of ids) await window.api.gallery.remove(id);
    GAL_SEL.clear();
    await renderGallery();
    toast('已删除', 'ok', 1400);
  }

  async function galRecognize() {
    const files = galSelectedPaths();
    if (!files.length) return;

    const cfg = await window.api.ai.getConfig();
    if (!cfg.vision.hasKey) {
      toast('还没配置视觉模型', 'error', 2600);
      aiOpenConfig();
      return;
    }

    const names = files.map((f) => f.split(/[\\/]/).pop());
    aiAppendUser('识图：' + files.length + ' 张（' + names.slice(0, 3).join('、') + (names.length > 3 ? '…' : '') + '）');
    aiCur = aiCreateAssistant();
    aiCur.bubble.textContent = '正在识别图片…';
    aiSetBusy(true);
    toggleAiPane(true);

    try {
      const r = await window.api.ai.ocr({ images: files });
      if (!r.ok && aiCur) {
        aiCur.bubble.textContent = '识图失败：' + (r.error || '未知错误');
        aiSetBusy(false);
        aiCur = null;
      }
    } catch (e) {
      if (aiCur) {
        aiCur.bubble.textContent = '识图失败：' + String(e && e.message ? e.message : e);
        aiSetBusy(false);
        aiCur = null;
      }
    }
  }

  $('btnGallery').addEventListener('click', openGallery);
  $('btnGallery2').addEventListener('click', openGallery);
  $('galClose').addEventListener('click', () => { $('galleryModal').hidden = true; });
  $('galUpload').addEventListener('click', galUpload);
  $('galOpenFolder').addEventListener('click', () => window.api.gallery.openFolder());
  $('galDelete').addEventListener('click', galDelete);
  $('galRecognize').addEventListener('click', galRecognize);
  $('galleryModal').addEventListener('click', (e) => {
    if (e.target === $('galleryModal')) $('galleryModal').hidden = true;
  });

  // 拖拽导入
  const galBody = document.querySelector('#galleryModal .modal-body');
  if (galBody) {
    galBody.addEventListener('dragover', (e) => { e.preventDefault(); galBody.style.background = '#eef3fa'; });
    galBody.addEventListener('dragleave', () => { galBody.style.background = ''; });
    galBody.addEventListener('drop', async (e) => {
      e.preventDefault();
      galBody.style.background = '';
      const paths = Array.from(e.dataTransfer.files || []).map((f) => f.path).filter(Boolean);
      if (!paths.length) return;
      const r = await window.api.gallery.import({ paths });
      if (r.added) toast('已添加 ' + r.added + ' 个素材', 'ok', 1600);
      if (r.failed && r.failed.length) toast('导入失败：' + r.failed[0].error, 'error', 5000);
      await renderGallery();
    });
  }

  loadRw();

  /* ============================ 快捷键体系 ============================ */
  const SHORTCUT_ACTIONS = [
    { id: 'new', label: '新建作业', def: 'Ctrl+N', run: () => newDoc() },
    { id: 'openFolder', label: '打开 Projects 文件夹', def: 'Ctrl+O', run: () => openDocDialog() },
    { id: 'save', label: '保存', def: 'Ctrl+S', run: () => saveDoc(false) },
    { id: 'export', label: '导出 PDF', def: 'Ctrl+E', run: () => exportDoc() },
    { id: 'undo', label: '撤回', def: 'Ctrl+Z', run: () => doUndo() },
    { id: 'redo', label: '重做', def: 'Ctrl+Y', run: () => doRedo() },
    { id: 'ai', label: '打开 / 关闭 AI 助手', def: 'Ctrl+Shift+A', run: () => toggleAiPane() },
    { id: 'sidebar', label: '显示 / 隐藏符号面板', def: 'Ctrl+Shift+B', run: () => { document.body.classList.toggle('hide-sidebar'); requestAnimationFrame(fitPage); } },
    { id: 'preview', label: '显示 / 隐藏预览窗格', def: 'Ctrl+Shift+P', run: () => { document.body.classList.toggle('hide-preview'); requestAnimationFrame(fitPage); } },
    { id: 'fit', label: '预览：适应宽度', def: 'Ctrl+0', run: () => setFit() },
    { id: 'exports', label: '打开导出文件夹', def: 'Ctrl+Shift+E', run: () => window.api.openExportsFolder() }
  ];

  const KEY_STORE = 'dmath.keys';
  let keyMap = {};
  let recording = null;

  function loadKeys() {
    try { keyMap = JSON.parse(localStorage.getItem(KEY_STORE) || '{}') || {}; } catch (_) { keyMap = {}; }
  }
  function saveKeys() {
    try { localStorage.setItem(KEY_STORE, JSON.stringify(keyMap)); } catch (_) {}
  }
  function keyOf(id) {
    const hit = SHORTCUT_ACTIONS.find((a) => a.id === id);
    return keyMap[id] || (hit ? hit.def : '');
  }

  /** 把 keydown 事件规范成 "Ctrl+Shift+A" 这样的串；只按修饰键返回 null */
  function comboFromEvent(e) {
    const mods = [];
    if (e.ctrlKey || e.metaKey) mods.push('Ctrl');
    if (e.altKey) mods.push('Alt');
    if (e.shiftKey) mods.push('Shift');

    let k = e.key;
    if (['Control', 'Shift', 'Alt', 'Meta', 'CapsLock'].includes(k)) return null;
    if (k === ' ') k = 'Space';
    else if (k === 'Escape') k = 'Esc';
    else if (k.length === 1) k = k.toUpperCase();
    else if (k.startsWith('Arrow')) k = k.slice(5);

    mods.push(k);
    return mods.join('+');
  }

  function matchShortcut(e) {
    const combo = comboFromEvent(e);
    if (!combo) return null;
    const lower = combo.toLowerCase();
    return SHORTCUT_ACTIONS.find((a) => keyOf(a.id).toLowerCase() === lower) || null;
  }

  function renderKeyList() {
    const list = $('keyList');
    list.innerHTML = '';
    for (const a of SHORTCUT_ACTIONS) {
      const row = document.createElement('div');
      row.className = 'key-row';

      const name = document.createElement('span');
      name.className = 'key-name';
      name.textContent = a.label;

      const btn = document.createElement('button');
      btn.className = 'key-combo';
      btn.textContent = keyOf(a.id);
      btn.dataset.key = a.id;
      btn.addEventListener('click', () => {
        if (recording) {
          recording.btn.classList.remove('recording');
          recording.btn.textContent = keyOf(recording.id);
        }
        recording = { id: a.id, btn };
        btn.classList.add('recording');
        btn.textContent = '按下新组合…';
      });

      row.appendChild(name);
      row.appendChild(btn);
      list.appendChild(row);
    }
  }

  function openKeyModal() {
    recording = null;
    renderKeyList();
    $('keyModal').hidden = false;
  }

  /* ============================ Ctrl+滚轮缩放 ============================ */
  window.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    if (!$('keyModal').hidden || !$('aiCfgModal').hidden || !$('helpModal').hidden) return;
    e.preventDefault();
    const cur = zoomMode === 'fit' ? fitScale() : manualZoom;
    setZoom(cur + (e.deltaY > 0 ? -0.05 : 0.05));
  }, { passive: false });

  /* 读取本机快捷键配置（放在 keyMap 定义之后，避免 TDZ） */
  loadKeys();

  /* ============================ 启动 ============================ */
  window.addEventListener('error', (e) => {
    try {
      toast('<div class="toast-title">界面出错</div><div class="err-item">' +
        MDRender.escHtml(String(e.message || e.error)) + '</div>', 'error', 6000);
    } catch (_) {}
  });

  async function init() {
    buildPalette();
    await refreshFiles();

    const last = localStorage.getItem('dmath.last');
    let target = null;
    if (last && files.some((f) => f.name === last)) target = last;
    else if (files.length) target = files[0].name;

    if (target) {
      await openDoc(target);
    } else {
      const r = await window.api.createDoc({ name: '离散数学作业.md', content: DEFAULT_DOC });
      if (r && r.ok) {
        await refreshFiles();
        await openDoc(r.name);
      } else {
        currentName = null;
        editor.value = DEFAULT_DOC;
        historyReset();
        renderPreview();
        updateStatus();
        updateTitle();
      }
    }

    setState('就绪');
  }

  init();
})();

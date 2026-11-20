'use strict';

const electron = require('electron');
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = electron;
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

/* ------------------------------------------------------------------
 * 启动自愈
 *
 * 1) 若环境里带 ELECTRON_RUN_AS_NODE=1，electron 会退化成纯 Node 模式，
 *    拿不到 app 对象。检测到就删掉该变量重启自己。
 * 2) 本机装过会向 Chromium 进程注入 DLL 的安全软件，会触发 Chromium 的
 *    RendererCodeIntegrity 校验（异常码 0x80000003）导致进程直接崩。
 *    这两个开关必须作为真实命令行参数传入，appendSwitch 对 sandbox 太晚，
 *    所以同样重启自己。应用只加载本地文件、不联网，风险可控。
 * ------------------------------------------------------------------ */
const CHILD_ENV = 'DMATH_BOOTSTRAPPED';
const NEEDED_FLAGS = ['--no-sandbox', '--disable-features=RendererCodeIntegrity'];

function relaunch() {
  const env = Object.assign({}, process.env);
  delete env.ELECTRON_RUN_AS_NODE;
  env[CHILD_ENV] = '1';
  try {
    spawn(process.execPath, process.argv.slice(1).concat(NEEDED_FLAGS), {
      detached: true,
      stdio: 'ignore',
      env
    }).unref();
  } catch (_) {}
}

if (!app) {
  relaunch();
  process.exit(0);
}

// 启动器会预先设好 DMATH_BOOTSTRAPPED，避免多起一次进程
if (!process.env[CHILD_ENV]) {
  relaunch();
  app.exit(0);
}

const { buildTex } = require('./lib/md2tex');

let win = null;

/* ----------------------------- 窗口 ----------------------------- */
function createWindow() {
  win = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 1080,
    minHeight: 680,
    backgroundColor: '#fffefb',
    title: '离散作业板',
    icon: path.join(__dirname, 'src', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });

  win.loadFile(path.join(__dirname, 'src', 'index.html'));

  if (process.env.DMATH_SELFTEST) {
    win.webContents.once('did-finish-load', () => { runSelfTest(); });
  }

  win.on('closed', () => { win = null; });
}

/* --------------------------- 快捷键 --------------------------- */
// 菜单栏已移除（改用功能区），这里用 F12 提供开发者工具入口。
app.on('browser-window-created', (_e, w) => {
  w.webContents.on('before-input-event', (ev, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') {
      w.webContents.toggleDevTools();
      ev.preventDefault();
    }
  });
});

/* ------------------------- 文档目录管理 ------------------------- */
/* 打包后 exe 在 <根>/dist 下，所以数据根目录取它的上一级：
   <根>/Projects 存作业，<根>/导出 存 PDF。这样重新打包不会动到作业。 */
const EXE_DIR = path.dirname(app.getPath('exe'));
const APP_ROOT = path.basename(EXE_DIR).toLowerCase() === 'dist' ? path.dirname(EXE_DIR) : EXE_DIR;
const DOCS_DIR = path.join(APP_ROOT, 'Projects');
const EXPORT_DIR = path.join(APP_ROOT, '导出');
const WORK_DIR = path.join(APP_ROOT, '.cache');

function ensureDirs() {
  for (const d of [DOCS_DIR, EXPORT_DIR, WORK_DIR]) {
    try { fs.mkdirSync(d, { recursive: true }); } catch (_) {}
  }
}

/** 去掉路径成分，只允许留在 Projects 里 */
function safeName(name) {
  return path.basename(String(name || '')).replace(/[\\/:*?"<>|]/g, '_').trim();
}

function uniqueName(base) {
  const clean = safeName(base) || '未命名';
  const stem = clean.replace(/\.(md|markdown|txt)$/i, '');
  const ext = '.md';
  let name = stem + ext;
  let i = 2;
  while (fs.existsSync(path.join(DOCS_DIR, name))) {
    name = stem + '-' + i + ext;
    i++;
  }
  return name;
}

ipcMain.handle('docs:root', async () => {
  ensureDirs();
  return { root: APP_ROOT, docs: DOCS_DIR, exports: EXPORT_DIR };
});

ipcMain.handle('docs:list', async () => {
  ensureDirs();
  let names = [];
  try { names = fs.readdirSync(DOCS_DIR); } catch (_) { return []; }
  return names
    .filter((f) => /\.(md|markdown|txt)$/i.test(f))
    .map((f) => {
      let st = null;
      try { st = fs.statSync(path.join(DOCS_DIR, f)); } catch (_) {}
      return { name: f, mtime: st ? st.mtimeMs : 0, size: st ? st.size : 0 };
    })
    .sort((a, b) => b.mtime - a.mtime);
});

ipcMain.handle('docs:read', async (_e, name) => {
  const n = safeName(name);
  const p = path.join(DOCS_DIR, n);
  if (!n || !fs.existsSync(p)) return null;
  return { name: n, content: fs.readFileSync(p, 'utf8') };
});

/* 覆盖前留底：同一文档 5 分钟内最多存一份；最多保留最近 30 份 */
function backupBeforeWrite(name, nextContent) {
  try {
    const src = path.join(DOCS_DIR, name);
    if (!fs.existsSync(src)) return;
    const prev = fs.readFileSync(src, 'utf8');
    if (prev === nextContent) return;

    const dir = path.join(DOCS_DIR, '.history', name.replace(/\.md$/i, ''));
    fs.mkdirSync(dir, { recursive: true });

    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
    const last = files.length ? fs.statSync(path.join(dir, files[files.length - 1])).mtimeMs : 0;
    if (Date.now() - last > 5 * 60 * 1000) {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      fs.copyFileSync(src, path.join(dir, ts + '.md'));
      const all = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
      for (const f of all.slice(0, Math.max(0, all.length - 30))) {
        try { fs.unlinkSync(path.join(dir, f)); } catch (_) {}
      }
    }
  } catch (_) {}
}

ipcMain.handle('docs:write', async (_e, { name, content }) => {
  ensureDirs();
  const n = safeName(name);
  if (!n) return { ok: false, error: '文件名为空' };
  backupBeforeWrite(n, content);
  fs.writeFileSync(path.join(DOCS_DIR, n), content, 'utf8');
  return { ok: true, name: n };
});

ipcMain.handle('docs:create', async (_e, { name, content }) => {
  ensureDirs();
  const n = uniqueName(name || '未命名.md');
  fs.writeFileSync(path.join(DOCS_DIR, n), content || '', 'utf8');
  return { ok: true, name: n };
});

ipcMain.handle('docs:rename', async (_e, { from, to }) => {
  ensureDirs();
  const a = safeName(from);
  const b = uniqueName(to || a);
  const pa = path.join(DOCS_DIR, a);
  if (!a || !fs.existsSync(pa)) return { ok: false, error: '原文件不存在' };
  fs.renameSync(pa, path.join(DOCS_DIR, b));
  return { ok: true, name: b };
});

ipcMain.handle('docs:remove', async (_e, name) => {
  const n = safeName(name);
  const p = path.join(DOCS_DIR, n);
  if (!n || !fs.existsSync(p)) return { ok: false };
  fs.unlinkSync(p);
  return { ok: true };
});

/* 打开文件夹 / 文件。
   注意：shell.openPath 走的是 ShellExecute，在受限的进程令牌下会"返回成功但什么也不做"
   （或者弹「Windows 无法访问指定设备」），所以 Windows 上优先直接拉起 explorer.exe。 */
function launchExplorer(target) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok, err) => { if (!done) { done = true; resolve({ ok, err: err || '' }); } };
    try {
      const p = spawn('explorer.exe', [target], { detached: true, stdio: 'ignore' });
      p.on('error', (e) => finish(false, String(e && e.message)));
      p.unref();
      setTimeout(() => finish(true), 400);
    } catch (e) {
      finish(false, String(e && e.message));
    }
  });
}

/* 用 Shell.Application COM 打开目录。
   实测：受限进程令牌下 explorer.exe 和 ShellExecute 都可能"静默不干活"，
   而 COM 自动化仍然有效，所以它排第一。 */
function runPowerShell(script) {
  return new Promise((resolve) => {
    let out = '';
    let done = false;
    const finish = (r) => { if (!done) { done = true; resolve(r); } };

    let child;
    try {
      child = spawn('powershell.exe',
        ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script],
        { windowsHide: true });
    } catch (e) {
      return finish({ ok: false, error: String(e && e.message) });
    }

    const timer = setTimeout(() => {
      try { child.kill(); } catch (_) {}
      finish({ ok: false, error: 'powershell 超时' });
    }, 15000);

    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { out += d.toString(); });
    child.on('error', (e) => { clearTimeout(timer); finish({ ok: false, error: String(e && e.message) }); });
    child.on('close', (code) => { clearTimeout(timer); finish({ ok: code === 0, error: out.trim() }); });
  });
}

function psQuote(s) { return String(s).replace(/'/g, "''"); }

function comExplore(dir) {
  const script = "$ErrorActionPreference='Stop'; " +
    "(New-Object -ComObject Shell.Application).Explore('" + psQuote(dir) + "')";
  return runPowerShell(script);
}

async function openFolder(dir) {
  ensureDirs();
  if (!fs.existsSync(dir)) return { ok: false, error: '目录不存在：' + dir };

  if (process.platform === 'win32') {
    const com = await comExplore(dir);
    if (com.ok) return { ok: true, via: 'com' };

    const r = await launchExplorer(dir);
    if (r.ok) return { ok: true, via: 'explorer' };

    return { ok: false, error: (com.error || 'COM 方式失败') + ' / ' + (r.err || ''), dir };
  }

  let shellErr = '';
  try { shellErr = await shell.openPath(dir); } catch (e) { shellErr = String(e && e.message); }
  if (!shellErr) return { ok: true, via: 'shell' };
  return { ok: false, error: shellErr, dir };
}

ipcMain.handle('docs:openFolder', () => openFolder(DOCS_DIR));
ipcMain.handle('exports:openFolder', () => openFolder(EXPORT_DIR));

// 排障用：打开任意路径并回报真实错误
ipcMain.handle('shell:openPathRaw', async (_e, p) => {
  const target = String(p || '');
  const r = await launchExplorer(target);
  let err = '';
  try { err = await shell.openPath(target); } catch (e) { err = String(e && e.message); }
  return { path: target, exists: fs.existsSync(target), explorerOk: r.ok, explorerErr: r.err, shellError: err };
});

/* --------------------------- 导出 PDF --------------------------- */
function runXelatex(cwd, texName) {
  return new Promise((resolve) => {
    let out = '';
    let done = false;
    const finish = (r) => { if (!done) { done = true; resolve(r); } };

    const child = spawn('xelatex', [
      '-interaction=nonstopmode',
      '-halt-on-error',
      '-file-line-error',
      texName
    ], {
      cwd,
      windowsHide: true,
      // 子进程的临时目录也指到应用自己的缓存目录：
      // 有些环境（受限账户、杀软）会挡住 %TEMP%，xelatex 写临时文件失败会中途退出。
      env: Object.assign({}, process.env, { TEMP: cwd, TMP: cwd, TMPDIR: cwd })
    });

    const timer = setTimeout(() => {
      try { child.kill(); } catch (_) {}
      finish({ code: -2, out, timeout: true });
    }, 120000);

    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { out += d.toString(); });
    child.on('error', (err) => { clearTimeout(timer); finish({ code: -1, out, spawnError: err }); });
    child.on('close', (code) => { clearTimeout(timer); finish({ code, out }); });
  });
}

/** 从 .log 里挑出真正的报错，翻译成人话 */
function extractErrors(logText) {
  const lines = String(logText).split(/\r?\n/);
  const errs = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const m = l.match(/^([^:\r\n]*?):(\d+):\s*(.*)$/);
    if (m) { errs.push({ line: Number(m[2]), msg: m[3].trim() }); continue; }
    if (/^! /.test(l)) errs.push({ line: 0, msg: l.replace(/^!\s*/, '').trim() });
  }
  const seen = new Set();
  return errs.filter((e) => !seen.has(e.msg) && seen.add(e.msg)).slice(0, 8).map((e) => {
    let msg = e.msg;
    if (/Undefined control sequence/.test(msg)) msg = '有未定义的 LaTeX 命令（检查拼写，或该宏包未安装）';
    const miss = msg.match(/File `([^']+)' not found/);
    if (miss) msg = '找不到文件：' + miss[1];
    if (/Missing \$ inserted/.test(msg)) msg = '数学公式缺少配对的 $（检查这一段）';
    if (/Missing \} inserted|Extra \}/.test(msg)) msg = '花括号不配对（检查 { 与 }）';
    return { line: e.line, msg };
  });
}

async function compileToPdf(content, meta, targetPdf) {
  // 在临时目录里编译：避开中文路径与残留 aux 文件
  // 不用系统临时目录：某些机器的 Temp 有写入限制，改用应用自己的缓存目录
  const workdir = fs.mkdtempSync(path.join(WORK_DIR, 'build-'));
  const texName = 'homework.tex';
  const tex = buildTex(content, meta || {});
  fs.writeFileSync(path.join(workdir, texName), tex, 'utf8');

  try {
    let r = await runXelatex(workdir, texName);
    if (r.spawnError) {
      return {
        ok: false,
        error: '找不到 xelatex。请确认已安装 MiKTeX 或 TeX Live，并且 xelatex 在 PATH 中。'
      };
    }
    if (r.timeout) return { ok: false, error: '编译超时（超过 2 分钟），可能有等待交互的宏包。' };

    const logPath = path.join(workdir, 'homework.log');
    let logText = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';

    if (r.code === 0 && /Rerun to get|Rerun LaTeX|undefined references/i.test(logText)) {
      r = await runXelatex(workdir, texName);
      if (fs.existsSync(logPath)) logText = fs.readFileSync(logPath, 'utf8');
    }

    const pdfTmp = path.join(workdir, 'homework.pdf');
    if (r.code !== 0 || !fs.existsSync(pdfTmp)) {
      const errors = extractErrors(logText || r.out || '');
      const tail = (logText || r.out || '').split(/\r?\n/).filter((l) => l.trim()).slice(-10).join('\n');
      return {
        ok: false,
        error: 'LaTeX 编译失败' + (errors.length ? '' : '（未能定位具体行，见下方日志）'),
        errors,
        logTail: errors.length ? '' : tail,
        workdir: workdir
      };
    }

    fs.mkdirSync(path.dirname(targetPdf), { recursive: true });
    fs.copyFileSync(pdfTmp, targetPdf);
    return { ok: true, pdfPath: targetPdf };
  } finally {
    if (!process.env.DMATH_KEEP_BUILD) {
      try { fs.rmSync(workdir, { recursive: true, force: true }); } catch (_) {}
    }
  }
}

ipcMain.handle('pdf:export', async (_e, { content, meta, name }) => {
  ensureDirs();
  const m = meta || {};
  let base = name ? safeName(name).replace(/\.(md|markdown|txt)$/i, '') : '';
  if (!base) {
    base = (m.assignment ? (m.course || '离散数学') + '第' + m.assignment + '次作业' : '离散数学作业')
      .replace(/[\\/:*?"<>|]/g, '_');
  }
  const targetPdf = path.join(EXPORT_DIR, base + '.pdf');
  return compileToPdf(content, meta, targetPdf);
});

/* ----------------------------- 其它 ----------------------------- */
// 打开文件（例如导出后的 PDF），同样绕开 ShellExecute
ipcMain.handle('shell:open', async (_e, target) => {
  if (!target) return { ok: false, error: '空路径' };
  if (!fs.existsSync(target)) return { ok: false, error: '文件不存在：' + target };

  if (process.platform === 'win32') {
    const r = await launchExplorer(target);
    if (r.ok) return { ok: true, via: 'explorer' };
  }

  let err = '';
  try { err = await shell.openPath(target); } catch (e) { err = String(e && e.message); }
  return err ? { ok: false, error: err } : { ok: true, via: 'shell' };
});

ipcMain.handle('shell:showItem', async (_e, target) => {
  if (target && fs.existsSync(target)) shell.showItemInFolder(target);
  return true;
});

/* ----------------------------- AI 助手 ----------------------------- */
/* 两套配置：文本模型（问答/改稿）与视觉模型（识图），各自独立 Key。 */
const AI_CONFIG = path.join(APP_ROOT, 'ai-config.json');
let aiReq = null;   // 当前进行中的请求，用于「停止」

function encKey(key) {
  try {
    if (electron.safeStorage && electron.safeStorage.isEncryptionAvailable()) {
      return { keyEnc: electron.safeStorage.encryptString(key).toString('base64') };
    }
  } catch (_) {}
  return { apiKey: key };
}

function decKey(obj) {
  if (!obj) return '';
  if (obj.keyEnc) {
    try { return electron.safeStorage.decryptString(Buffer.from(obj.keyEnc, 'base64')); } catch (_) { return ''; }
  }
  return obj.apiKey || '';
}

function readRawConfig() {
  try { return JSON.parse(fs.readFileSync(AI_CONFIG, 'utf8')) || {}; } catch (_) { return {}; }
}

function readAiConfig() {
  const c = readRawConfig();
  const v = c.vision || {};
  return {
    baseURL: c.baseURL || 'https://api.deepseek.com',
    model: c.model || 'deepseek-chat',
    temperature: typeof c.temperature === 'number' ? c.temperature : 0.3,
    apiKey: decKey(c),
    vision: {
      baseURL: v.baseURL || '',
      model: v.model || '',
      apiKey: decKey(v)
    }
  };
}

function writeAiConfig(patch) {
  const raw = readRawConfig();
  const next = Object.assign({}, raw);
  const p = patch || {};

  if (p.baseURL !== undefined) next.baseURL = String(p.baseURL || '').trim();
  if (p.model !== undefined) next.model = String(p.model || '').trim();
  if (typeof p.temperature === 'number') next.temperature = p.temperature;
  if (p.apiKey) {
    delete next.apiKey; delete next.keyEnc;
    Object.assign(next, encKey(p.apiKey.trim()));
  }

  if (p.vision) {
    const v = Object.assign({}, raw.vision || {});
    if (p.vision.baseURL !== undefined) v.baseURL = String(p.vision.baseURL || '').trim();
    if (p.vision.model !== undefined) v.model = String(p.vision.model || '').trim();
    if (p.vision.apiKey) {
      delete v.apiKey; delete v.keyEnc;
      Object.assign(v, encKey(p.vision.apiKey.trim()));
    }
    next.vision = v;
  }

  fs.writeFileSync(AI_CONFIG, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

ipcMain.handle('ai:getConfig', () => {
  const c = readAiConfig();
  return {
    baseURL: c.baseURL,
    model: c.model,
    temperature: c.temperature,
    hasKey: !!c.apiKey,
    keyTail: c.apiKey ? c.apiKey.slice(-4) : '',
    vision: {
      baseURL: c.vision.baseURL,
      model: c.vision.model,
      hasKey: !!c.vision.apiKey,
      keyTail: c.vision.apiKey ? c.vision.apiKey.slice(-4) : ''
    }
  };
});

ipcMain.handle('ai:setConfig', (_e, patch) => {
  try {
    writeAiConfig(patch || {});
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e && e.message) };
  }
});

/** 极简 SSE 解析：边收边推 delta，支持 reasoning_content 与图片消息 */
function streamChat({ baseURL, apiKey, model, temperature, messages }, onEvent) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (r) => { if (!settled) { settled = true; resolve(r); } };

    let url;
    try {
      url = new URL(String(baseURL || '').replace(/\/+$/, '') + '/chat/completions');
    } catch (e) {
      return done({ ok: false, error: '接口地址不合法：' + baseURL });
    }

    const payload = JSON.stringify({ model, messages, stream: true, temperature });
    const mod = url.protocol === 'http:' ? require('http') : require('https');

    const req = mod.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'http:' ? 80 : 443),
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
        'Accept': 'text/event-stream',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      if (res.statusCode !== 200) {
        let body = '';
        res.on('data', (d) => { body += d.toString(); });
        res.on('end', () => done({ ok: false, error: 'HTTP ' + res.statusCode + '：' + body.slice(0, 400) }));
        return;
      }

      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buf += chunk;
        let idx;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).replace(/\r$/, '');
          buf = buf.slice(idx + 1);
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') { done({ ok: true }); return; }
          if (!data) continue;
          let j;
          try { j = JSON.parse(data); } catch (_) { continue; }
          const choice = (j.choices && j.choices[0]) || {};
          const d = choice.delta || {};
          if (d.reasoning_content) onEvent({ type: 'reason', text: d.reasoning_content });
          if (d.content) onEvent({ type: 'content', text: d.content });
          if (j.usage) onEvent({ type: 'usage', usage: j.usage });
        }
      });
      res.on('end', () => done({ ok: true }));
      res.on('error', (e) => done({ ok: false, error: '读取流失败：' + e.message }));
    });

    req.on('error', (e) => done({ ok: false, error: '请求失败：' + e.message }));
    req.setTimeout(300000, () => req.destroy(new Error('超时（300s）')));

    aiReq = req;
    req.write(payload);
    req.end();
  });
}

ipcMain.handle('ai:chat', async (_e, { messages }) => {
  const c = readAiConfig();
  if (!c.apiKey) return { ok: false, error: '还没填 API Key，点右上角齿轮配置一下' };
  if (!Array.isArray(messages) || !messages.length) return { ok: false, error: '消息为空' };

  const send = (payload) => { if (win && !win.isDestroyed()) win.webContents.send('ai:event', payload); };

  send({ type: 'start' });
  const r = await streamChat(Object.assign({}, c, { messages }), send);
  aiReq = null;
  send({ type: r.ok ? 'done' : 'error', error: r.error || '' });
  return r;
});

/* ---- 识图：走独立的视觉模型 ---- */

const OCR_PROMPT = [
  '把这张图片里的全部内容完整转写成 Markdown + LaTeX，供「离散数学作业板」编辑器使用。',
  '',
  '要求：',
  '1. 数学公式一律 LaTeX：行内 $...$，独立公式 $$...$$；向量/集合/关系/逻辑符号用标准命令（\\varnothing \\subseteq \\langle \\rangle \\circ \\land \\lor \\forall \\exists \\mathbb 等）。',
  '2. 表格用 Markdown 表格；矩阵、方程组、分段函数用对应 LaTeX 环境。',
  '3. 保留原题号、题干文字、选项、证明结构。',
  '4. 不要输出任何解释说明，不要用 ``` 包裹整篇；直接给内容本身。',
  '5. 实在看不清的字符写成 ⟨?⟩，不要猜。'
].join('\n');

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
};

function imageToPart(file) {
  const ext = path.extname(file).toLowerCase();
  const mime = MIME[ext] || 'image/png';
  const b64 = fs.readFileSync(file).toString('base64');
  return { type: 'image_url', image_url: { url: 'data:' + mime + ';base64,' + b64 } };
}

ipcMain.handle('ai:ocr', async (_e, { images }) => {
  const c = readAiConfig();
  if (!c.vision.apiKey || !c.vision.baseURL || !c.vision.model) {
    return { ok: false, error: '还没配置视觉模型（设置 → AI 接口 → 视觉模型）' };
  }
  const files = (images || []).filter((p) => p && fs.existsSync(p));
  if (!files.length) return { ok: false, error: '没有可识别的图片' };

  const send = (p2) => { if (win && !win.isDestroyed()) win.webContents.send('ai:event', p2); };
  const content = [{ type: 'text', text: OCR_PROMPT }];
  for (const f of files) content.push(imageToPart(f));

  const messages = [{ role: 'user', content }];
  send({ type: 'start' });
  const r = await streamChat({
    baseURL: c.vision.baseURL,
    apiKey: c.vision.apiKey,
    model: c.vision.model,
    temperature: 0.1,
    messages
  }, send);
  aiReq = null;
  send({ type: r.ok ? 'done' : 'error', error: r.error || '' });
  return r;
});

ipcMain.handle('ai:probe', async (_e, { vision } = {}) => {
  const c = readAiConfig();
  const cfg = vision ? c.vision : c;
  if (!cfg.apiKey) return { ok: false, error: vision ? '还没填视觉模型的 Key' : '还没填 API Key' };
  if (!cfg.baseURL || !cfg.model) return { ok: false, error: 'Base URL / 模型没填完整' };

  return new Promise((resolve) => {
    let settled = false;
    const done = (r) => { if (!settled) { settled = true; resolve(r); } };
    let url;
    try {
      url = new URL(String(cfg.baseURL).replace(/\/+$/, '') + '/chat/completions');
    } catch (e) {
      return done({ ok: false, error: 'Base URL 不合法' });
    }

    const payload = JSON.stringify({
      model: cfg.model,
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 1,
      stream: false
    });
    const mod = url.protocol === 'http:' ? require('http') : require('https');
    const req = mod.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'http:' ? 80 : 443),
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + cfg.apiKey,
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d.toString(); });
      res.on('end', () => {
        if (res.statusCode === 200) done({ ok: true, model: cfg.model });
        else done({ ok: false, error: 'HTTP ' + res.statusCode + '：' + body.slice(0, 300) });
      });
    });
    req.on('error', (e) => done({ ok: false, error: e.message }));
    req.setTimeout(20000, () => req.destroy(new Error('超时')));
    req.write(payload);
    req.end();
  });
});

ipcMain.handle('ai:abort', () => {
  if (aiReq) {
    try { aiReq.destroy(new Error('用户中断')); } catch (_) {}
    aiReq = null;
    return { ok: true };
  }
  return { ok: false };
});

/* ----------------------------- 图库 ----------------------------- */
const GALLERY_DIR = path.join(APP_ROOT, '图库');

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

function stamp() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' +
    p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

function findPdftoppm() {
  const cands = [
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'MiKTeX', 'miktex', 'bin', 'x64', 'pdftoppm.exe'),
    'C:\\Program Files\\MiKTeX\\miktex\\bin\\x64\\pdftoppm.exe'
  ];
  for (const c of cands) { if (fs.existsSync(c)) return c; }
  return 'pdftoppm';   // 退回到 PATH
}

function runPdftoppm(pdfPath, outPrefix) {
  return new Promise((resolve) => {
    const exe = findPdftoppm();
    const child = spawn(exe, ['-png', '-r', '150', pdfPath, outPrefix], {
      windowsHide: true,
      env: Object.assign({}, process.env, {
        TEMP: WORK_DIR, TMP: WORK_DIR, TMPDIR: WORK_DIR
      })
    });
    let err = '';
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('error', (e) => resolve({ ok: false, error: 'PDF 转图片失败：' + e.message }));
    child.on('close', (code) => {
      if (code === 0) resolve({ ok: true });
      else resolve({ ok: false, error: 'pdftoppm 退出码 ' + code + '：' + err.slice(0, 200) });
    });
  });
}

function makeThumb(srcPath, thumbPath) {
  try {
    const img = electron.nativeImage.createFromPath(srcPath);
    if (img.isEmpty()) return;
    const w = img.getSize().width;
    const t = w > 260 ? img.resize({ width: 260, quality: 'good' }) : img;
    fs.writeFileSync(thumbPath, t.toPNG());
  } catch (_) {}
}

async function importOne(srcPath) {
  const ext = path.extname(srcPath).toLowerCase();
  const id = stamp() + '-' + Math.random().toString(36).slice(2, 6);
  const dir = path.join(GALLERY_DIR, id);
  ensureDir(dir);

  const meta = {
    id,
    source: path.basename(srcPath),
    created: Date.now(),
    kind: ext === '.pdf' ? 'pdf' : 'image',
    files: []
  };

  if (ext === '.pdf') {
    const r = await runPdftoppm(srcPath, path.join(dir, 'page'));
    if (!r.ok) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} return r; }
    meta.files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.png')).sort((a, b) => {
      const na = parseInt((a.match(/(\d+)/) || [])[1] || '0', 10);
      const nb = parseInt((b.match(/(\d+)/) || [])[1] || '0', 10);
      return na - nb;
    });
  } else {
    const keep = MIME[ext] ? ext : '.png';
    let target = path.join(dir, 'image' + keep);
    if (!MIME[ext]) {
      // WebP/BMP 之类统一转 PNG，保证各家视觉模型都吃
      try {
        const img = electron.nativeImage.createFromPath(srcPath);
        if (img.isEmpty()) return { ok: false, error: '无法读取这张图片：' + path.basename(srcPath) };
        fs.writeFileSync(target, img.toPNG());
      } catch (e) {
        return { ok: false, error: '图片转换失败：' + e.message };
      }
    } else {
      fs.copyFileSync(srcPath, target);
    }
    meta.files = [path.basename(target)];
  }

  for (const f of meta.files) {
    makeThumb(path.join(dir, f), path.join(dir, f.replace(/\.[^.]+$/, '') + '.thumb.png'));
  }

  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');
  return { ok: true, id };
}

ipcMain.handle('gallery:import', async (_e, { fromDialog, paths: given } = {}) => {
  let paths = Array.isArray(given) ? given.slice() : [];
  if (fromDialog) {
    const r = await dialog.showOpenDialog(win, {
      title: '添加图片或 PDF 到图库',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '图片与 PDF', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'pdf'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    });
    if (r.canceled) return { ok: false, canceled: true };
    paths = r.filePaths;
  }
  if (!paths.length) return { ok: true, added: 0 };

  ensureDir(GALLERY_DIR);
  const results = [];
  for (const p of paths) {
    try {
      const r = await importOne(p);
      results.push(Object.assign({ file: path.basename(p) }, r));
    } catch (e) {
      results.push({ file: path.basename(p), ok: false, error: String(e && e.message) });
    }
  }
  const failed = results.filter((r) => !r.ok && !r.canceled);
  return { ok: true, added: results.filter((r) => r.ok).length, failed };
});

ipcMain.handle('gallery:list', () => {
  ensureDir(GALLERY_DIR);
  const out = [];
  for (const name of fs.readdirSync(GALLERY_DIR)) {
    const dir = path.join(GALLERY_DIR, name);
    let st;
    try { st = fs.statSync(dir); } catch (_) { continue; }
    if (!st.isDirectory()) continue;

    let meta = {};
    try { meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')); } catch (_) {}

    const files = (meta.files && meta.files.length)
      ? meta.files
      : fs.readdirSync(dir).filter((f) => MIME[path.extname(f).toLowerCase()]);

    const images = files.map((f) => {
      const full = path.join(dir, f);
      if (!fs.existsSync(full)) return null;
      const thumb = path.join(dir, f.replace(/\.[^.]+$/, '') + '.thumb.png');
      if (!fs.existsSync(thumb)) makeThumb(full, thumb);
      const useThumb = fs.existsSync(thumb) ? thumb : full;
      let size = 0;
      try { size = fs.statSync(full).size; } catch (_) {}
      return {
        file: full,
        name: f,
        size,
        thumb: 'data:image/png;base64,' + fs.readFileSync(useThumb).toString('base64')
      };
    }).filter(Boolean);

    out.push({
      id: name,
      source: meta.source || name,
      kind: meta.kind || 'image',
      created: meta.created || st.mtimeMs,
      images
    });
  }
  out.sort((a, b) => b.created - a.created);
  return out;
});

ipcMain.handle('gallery:remove', (_e, id) => {
  if (!id || id.includes('..') || id.includes('/') || id.includes('\\')) return { ok: false, error: '非法 id' };
  const dir = path.join(GALLERY_DIR, id);
  if (!fs.existsSync(dir)) return { ok: false, error: '不存在' };
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e && e.message) };
  }
});

ipcMain.handle('gallery:openFolder', () => openFolder(GALLERY_DIR));

/* 改动前的磁盘快照，供「回滚」用 */
ipcMain.handle('docs:snapshot', (_e, name) => {
  try {
    if (!name) return { ok: false, error: '没有文件名' };
    const src = path.join(DOCS_DIR, name);
    if (!fs.existsSync(src)) return { ok: false, error: '文件不存在' };
    const stampDir = path.join(DOCS_DIR, '.history', name.replace(/\.md$/i, ''));
    ensureDir(stampDir);
    const target = path.join(stampDir, new Date().toISOString().replace(/[:.]/g, '-') + '.md');
    fs.copyFileSync(src, target);
    return { ok: true, path: target };
  } catch (e) {
    return { ok: false, error: String(e && e.message) };
  }
});

/* ---------------------------- 自测钩子 ---------------------------- */
// 设置 DMATH_SELFTEST=<输出目录> 时，加载完成后自动用编辑器内容跑一次导出，
// 结果打印到 stdout 并写 result.json，然后退出。仅用于开发验证。
async function runSelfTest() {
  const dir = process.env.DMATH_SELFTEST;
  const log = (m) => { try { console.log('[SELFTEST] ' + m); } catch (_) {} };
  let out;
  try {
    const content = await win.webContents.executeJavaScript(
      'document.getElementById("editor").value'
    );
    log('content length=' + String(content && content.length));
    out = await compileToPdf(
      content,
      { name: '李四', studentId: '20230002', course: '离散数学', assignment: '3' },
      path.join(dir, 'selftest.pdf')
    );
    log('result=' + JSON.stringify(out));
  } catch (e) {
    out = { ok: false, error: String(e && e.stack ? e.stack : e) };
    log('EXCEPTION ' + out.error);
  }
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(out, null, 2), 'utf8');
  } catch (e) { log('write failed: ' + e.code); }
  app.quit();
}

/* --------------------------- 生命周期 --------------------------- */
app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

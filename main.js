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

ipcMain.handle('docs:write', async (_e, { name, content }) => {
  ensureDirs();
  const n = safeName(name);
  if (!n) return { ok: false, error: '文件名为空' };
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

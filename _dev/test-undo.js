'use strict';
// 通过 CDP 验证「插入符号 → 撤回 → 内容复原」以及重做。
const http = require('http');

const get = (url) => new Promise((res, rej) => {
  http.get(url, (r) => {
    let d = '';
    r.on('data', (c) => { d += c; });
    r.on('end', () => res(d));
  }).on('error', rej);
});

const EXPR = `(() => {
  const ed = document.getElementById('editor');
  const undoBtn = () => document.querySelector('[data-act="undo"]');
  const redoBtn = () => document.querySelector('[data-act="redo"]');
  const base = ed.value;
  const out = { baseLen: base.length, undoEnabledAtStart: !undoBtn().disabled };

  // 1. 点符号面板第一个按钮（∈）
  document.querySelector('.pal-btn').click();
  const afterInsert = ed.value;
  out.insertChanged = afterInsert !== base;
  out.insertLen = afterInsert.length;
  out.undoEnabledAfterInsert = !undoBtn().disabled;

  // 2. 撤回一步
  undoBtn().click();
  out.undoRestored = ed.value === base;
  out.undoLen = ed.value.length;
  out.redoEnabledAfterUndo = !redoBtn().disabled;

  // 3. 重做
  redoBtn().click();
  out.redoRestored = ed.value === afterInsert;

  // 4. 再连撤两步，确认不会越界报错
  undoBtn().click();
  undoBtn().click();
  out.lenAtBottom = ed.value.length;
  out.undoDisabledAtBottom = undoBtn().disabled;

  // 复原到最初
  while (!redoBtn().disabled) redoBtn().click();
  out.finalEqualsInserted = ed.value === afterInsert;

  return JSON.stringify(out);
})()`;

(async () => {
  const list = JSON.parse(await get('http://127.0.0.1:9222/json/list'));
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error('没有找到页面目标');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });

  let seq = 1;
  const send = (method, params) => new Promise((res) => {
    const id = seq++;
    const onMsg = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id === id) { ws.removeEventListener('message', onMsg); res(m); }
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });

  const r = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true, awaitPromise: true });
  if (r.result && r.result.exceptionDetails) {
    console.log('EXCEPTION', JSON.stringify(r.result.exceptionDetails));
  } else {
    console.log(r.result.result.value);
  }
  ws.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });

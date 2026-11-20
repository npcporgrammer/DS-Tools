'use strict';
/* 在运行中的应用里执行一段 JS 并打印结果
   用法: node cdp-eval.js "<表达式>"            （表达式可为 Promise）
   需要应用带 --remote-debugging-port=9222 启动 */
const http = require('http');
const fs = require('fs');

const get = (url) => new Promise((res, rej) => {
  http.get(url, (r) => {
    let d = '';
    r.on('data', (c) => { d += c; });
    r.on('end', () => res(d));
  }).on('error', rej);
});

(async () => {
  let expr = process.argv[2];
  if (expr && expr.startsWith('@')) {
    expr = require('fs').readFileSync(expr.slice(1), 'utf8');
  }
  if (!expr) { console.error('缺表达式'); process.exit(1); }

  const port = process.argv[3] || '9222';
  const list = JSON.parse(await get('http://127.0.0.1:' + port + '/json/list'));
  const page = list.find((t) => t.type === 'page');
  if (!page) { console.error('没有页面目标'); process.exit(1); }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });

  const result = await new Promise((res) => {
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id === 1) res(m);
    });
    ws.send(JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: { expression: expr, returnByValue: true, awaitPromise: true }
    }));
  });

  if (result.result && result.result.exceptionDetails) {
    console.log('EXCEPTION: ' + JSON.stringify(result.result.exceptionDetails.text));
    console.log(JSON.stringify(result.result.exceptionDetails.exception && result.result.exceptionDetails.exception.description || '').slice(0, 500));
  } else {
    console.log(JSON.stringify(result.result.result.value, null, 2));
  }
  ws.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });

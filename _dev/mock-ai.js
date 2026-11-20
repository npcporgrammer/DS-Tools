'use strict';
/* 本地假的 OpenAI 兼容服务，用来验证流式链路（不需要真 API Key）。
   用法: node mock-ai.js [端口]，默认 8899
   支持 POST /chat/completions（stream:true / false） */
const http = require('http');

const PORT = Number(process.argv[2] || 8899);

const REASON = '先看题目：要证明 α = I_A ∪ β ∪ β^c 是相容关系。\n相容关系 = 自反 + 对称。\n自反看 I_A 是否包含主对角线；对称看 β 与 β^c 是否互为逆。';
const ANSWER = [
  '**思路**：相容关系就是**自反且对称**的二元关系，所以只需验证这两条。',
  '',
  '1. **自反**：由定义 $I_A=\\{\\langle x,x\\rangle \\mid x\\in A\\}\\subseteq\\alpha$，故 $\\forall x\\in A$ 有 $\\langle x,x\\rangle\\in\\alpha$。',
  '2. **对称**：任取 $\\langle x,y\\rangle\\in\\alpha$，分三种情形：',
  '   - $\\langle x,y\\rangle\\in I_A$：则 $x=y$，$\\langle y,x\\rangle=\\langle x,y\\rangle\\in\\alpha$；',
  '   - $\\langle x,y\\rangle\\in\\beta$：由逆关系定义 $\\langle y,x\\rangle\\in\\beta^{c}\\subseteq\\alpha$；',
  '   - $\\langle x,y\\rangle\\in\\beta^{c}$：同理 $\\langle y,x\\rangle\\in\\beta\\subseteq\\alpha$。',
  '',
  '所以 $\\alpha$ 既自反又对称，是 $A$ 上的相容关系。$\\blacksquare$',
  '',
  '> 提示：这里的 $\\beta^{c}$ 若是「逆关系」，上面第 2 步成立；若你书上的 $\\beta^{c}$ 指补关系，结论会不同。'
].join('\n');

function sse(res, obj) {
  res.write('data: ' + JSON.stringify(obj) + '\n\n');
}

const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || !req.url.includes('/chat/completions')) {
    res.writeHead(404).end('not found');
    return;
  }
  let body = '';
  req.on('data', (d) => { body += d; });
  req.on('end', () => {
    let payload = {};
    try { payload = JSON.parse(body); } catch (_) {}
    console.log('[mock] model=%s stream=%s', payload.model, payload.stream);

    if (!payload.stream) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'pong' } }] }));
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    // 先流式吐「思考」，再吐「正文」
    const reason = REASON.match(/[\s\S]{1,12}/g) || [];
    const answer = ANSWER.match(/[\s\S]{1,10}/g) || [];
    let i = 0, j = 0;

    const timer = setInterval(() => {
      if (i < reason.length) {
        sse(res, { choices: [{ delta: { reasoning_content: reason[i++] } }] });
        return;
      }
      if (j < answer.length) {
        sse(res, { choices: [{ delta: { content: answer[j++] } }] });
        return;
      }
      clearInterval(timer);
      res.write('data: [DONE]\n\n');
      res.end();
    }, 40);

    res.on('close', () => clearInterval(timer));
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('mock ai server on http://127.0.0.1:' + PORT);
});

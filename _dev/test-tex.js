'use strict';
// 不依赖 Electron，直接验证 md → tex → pdf 链路
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { buildTex } = require('../lib/md2tex');

const dir = __dirname;
const md = fs.readFileSync(path.join(dir, 'sample.md'), 'utf8');
const tex = buildTex(md, { name: '张三', studentId: '20230001', course: '离散数学', assignment: '3' });

const texPath = path.join(dir, 'sample.tex');
fs.writeFileSync(texPath, tex, 'utf8');

const r = spawnSync('xelatex', ['-interaction=nonstopmode', '-halt-on-error', '-file-line-error', 'sample.tex'], {
  cwd: dir,
  encoding: 'utf8'
});

console.log('exit:', r.status);
if (r.status !== 0) {
  const log = r.stdout || '';
  console.log(log.split('\n').filter((l) => /^!|error|Error|:\d+:/.test(l)).slice(0, 25).join('\n'));
}
console.log(fs.existsSync(path.join(dir, 'sample.pdf')) ? 'PDF OK' : 'PDF MISSING');

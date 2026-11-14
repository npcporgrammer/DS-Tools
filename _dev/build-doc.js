'use strict';
/* 用与应用完全相同的管线编译一个 md：
   node build-doc.js <源.md> <目标.pdf> [课程名] */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { buildTex } = require('../lib/md2tex');

const [, , mdPath, pdfPath, course] = process.argv;
if (!mdPath || !pdfPath) {
  console.error('用法: node build-doc.js <源.md> <目标.pdf>');
  process.exit(1);
}

const root = path.resolve(__dirname, '..');
const work = fs.mkdtempSync(path.join(root, '.cache', 'cli-'));
const texName = 'homework.tex';

fs.writeFileSync(path.join(work, texName), buildTex(fs.readFileSync(mdPath, 'utf8'), {
  course: course || '离散数学'
}), 'utf8');

const r = spawnSync('xelatex', ['-interaction=nonstopmode', '-halt-on-error', '-file-line-error', texName], {
  cwd: work,
  encoding: 'utf8',
  env: Object.assign({}, process.env, { TEMP: work, TMP: work, TMPDIR: work })
});

const logPath = path.join(work, 'homework.log');
const log = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';

if (r.status !== 0) {
  const errs = log.split(/\r?\n/).filter((l) => /^!|:\d+:/.test(l)).slice(0, 10);
  console.error('编译失败:\n' + errs.join('\n'));
  process.exit(2);
}

fs.mkdirSync(path.dirname(pdfPath), { recursive: true });
fs.copyFileSync(path.join(work, 'homework.pdf'), pdfPath);
fs.rmSync(work, { recursive: true, force: true });

const pages = (log.match(/Output written on .*?\((\d+) page/) || [])[1] || '?';
console.log(`OK -> ${pdfPath} (${pages} 页)`);

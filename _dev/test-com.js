'use strict';
// 复现 main.js 里 runPowerShell 的调用方式，对比 ASCII 与中文路径
const { spawn } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..');
const targets = [
  ['ASCII   ', path.join(root, 'Projects')],
  ['中文    ', path.join(root, '导出')]
];

function run(script) {
  return new Promise((resolve) => {
    let out = '';
    const child = spawn('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script],
      { windowsHide: true });
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { out += d.toString(); });
    child.on('error', (e) => resolve({ code: -1, out: 'spawn error: ' + e.message }));
    child.on('close', (code) => resolve({ code, out: out.trim() }));
  });
}

(async () => {
  for (const [label, dir] of targets) {
    const q = dir.replace(/'/g, "''");
    const script = "$ErrorActionPreference='Stop'; " +
      "(New-Object -ComObject Shell.Application).Explore('" + q + "'); Write-Output 'OK'";
    const r = await run(script);
    console.log(label, 'exit=' + r.code, 'out=' + JSON.stringify(r.out.slice(0, 200)));
  }
})();

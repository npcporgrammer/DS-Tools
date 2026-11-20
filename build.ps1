# 打包脚本：把 Electron 运行时 + 本应用打成一个可双击的目录
# 用法： powershell -ExecutionPolicy Bypass -File build.ps1
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$src  = Join-Path $root 'node_modules\electron\dist'

$running = Get-Process -Name '离散作业板' -ErrorAction SilentlyContinue
if ($running) {
  throw '应用正在运行（PID: ' + ($running.Id -join ',') + '），请先关闭窗口再打包，否则 dist 会被占用、删不掉。'
}

if (-not (Test-Path (Join-Path $src 'electron.exe'))) {
  throw '找不到 Electron 运行时，请先在项目目录执行： npm install'
}

$out = Join-Path $root 'dist'
if (Test-Path $out) { Remove-Item $out -Recurse -Force }
New-Item -ItemType Directory -Path $out | Out-Null

Write-Host '复制 Electron 运行时…'
Copy-Item (Join-Path $src '*') $out -Recurse -Force
Rename-Item (Join-Path $out 'electron.exe') '离散作业板.exe'

Write-Host '复制应用代码…'
$app = Join-Path $out 'resources\app'
New-Item -ItemType Directory -Path $app -Force | Out-Null
foreach ($f in @('main.js', 'preload.js', 'package.json', 'lib', 'src', 'vendor')) {
  $p = Join-Path $root $f
  if (Test-Path $p) { Copy-Item $p (Join-Path $app $f) -Recurse -Force }
}

Write-Host ''
Write-Host "打包完成：$out\离散作业板.exe"
Write-Host ("体积：" + [math]::Round(((Get-ChildItem $out -Recurse -File | Measure-Object Length -Sum).Sum / 1MB), 1) + " MB")

# 把图标写进 exe 资源段（这样桌面/资源管理器里显示的就是应用图标）
$iconScript = Join-Path $root '_dev\set-exe-icon.ps1'
$exePath = Join-Path $out '离散作业板.exe'
if ((Test-Path $iconScript) -and (Test-Path $exePath)) {
  try {
    & powershell -ExecutionPolicy Bypass -File $iconScript -Exe $exePath -Ico (Join-Path $root 'src\icon.ico') | Out-Null
    Write-Host '已写入 exe 图标'
  } catch {
    Write-Warning "写入 exe 图标失败：$_"
  }
}
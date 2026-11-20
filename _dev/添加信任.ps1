# 把本程序加入 Windows Defender 的排除项（需要管理员权限）
# 由「添加信任.bat」以管理员身份调用
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root 'dist\离散作业板.exe'

Write-Host '========================================'
Write-Host ' 把「离散作业板」加入 Defender 排除项'
Write-Host '========================================'
Write-Host ''
Write-Host '将被排除的位置：'
Write-Host "  文件夹：$root"
Write-Host "  进程名：离散作业板.exe"
Write-Host ''
Write-Host '注意：排除后 Defender 不再扫描该目录，'
Write-Host '      请确认这个目录里只有你自己的代码和构建产物。'
Write-Host ''

if (-not (Test-Path $exe)) {
  Write-Host "警告：没找到 $exe（先跑 build.ps1 打包）" -ForegroundColor Yellow
}

try {
  Add-MpPreference -ExclusionPath $root -ErrorAction Stop
  Write-Host "[OK] 已添加文件夹排除" -ForegroundColor Green
} catch {
  Write-Host "[失败] 文件夹排除：$_" -ForegroundColor Red
}

try {
  Add-MpPreference -ExclusionProcess '离散作业板.exe' -ErrorAction Stop
  Write-Host "[OK] 已添加进程排除" -ForegroundColor Green
} catch {
  Write-Host "[失败] 进程排除：$_" -ForegroundColor Red
}

Write-Host ''
Write-Host '当前排除项：'
try {
  $paths = (Get-MpPreference).ExclusionPath
  $procs = (Get-MpPreference).ExclusionProcess
  if ($paths) { $paths | ForEach-Object { Write-Host "  目录  $_" } } else { Write-Host '  目录  （无）' }
  if ($procs) { $procs | ForEach-Object { Write-Host "  进程  $_" } } else { Write-Host '  进程  （无）' }
} catch {
  Write-Host "  查询失败：$_"
}

Write-Host ''
Write-Host '如果之前已经被隔离，去「Windows 安全中心 → 病毒和威胁防护 →'
Write-Host '保护历史记录」里点「还原」，再执行本脚本。'

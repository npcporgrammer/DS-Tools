# 创建/更新桌面快捷方式。
# 关键点：快捷方式的 IconLocation 字段对非 ASCII 路径不可靠，
#         所以先把图标复制到一个纯英文目录，再让快捷方式指向那里。
param(
  [string]$Exe,
  [string]$Ico,
  [string]$Name = '离散作业板'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

if (-not $Exe) { $Exe = Join-Path $root 'dist\离散作业板.exe' }
if (-not $Ico) { $Ico = Join-Path $root 'src\icon.ico' }

if (-not (Test-Path $Exe)) { throw "找不到 exe：$Exe（先跑 build.ps1）" }
if (-not (Test-Path $Ico)) { throw "找不到 ico：$Ico" }

# 图标放到纯英文路径
$iconDir = Join-Path $env:LOCALAPPDATA 'DS-Tools'
New-Item -ItemType Directory -Path $iconDir -Force | Out-Null
$iconCopy = Join-Path $iconDir 'app.ico'
Copy-Item $Ico $iconCopy -Force

$lnkPath = Join-Path ([Environment]::GetFolderPath('Desktop')) ($Name + '.lnk')
$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut($lnkPath)
$lnk.TargetPath = $Exe
$lnk.Arguments = '--no-sandbox --disable-features=RendererCodeIntegrity'
$lnk.WorkingDirectory = Split-Path -Parent $Exe
$lnk.IconLocation = $iconCopy + ',0'
$lnk.Description = '离散数学作业板 —— 写作业、画关系图、导出 PDF'
$lnk.Save()

# 刷新图标缓存
try { ie4uinit.exe -show } catch {}

Write-Output "快捷方式：$lnkPath"
Write-Output "图标：    $iconCopy"

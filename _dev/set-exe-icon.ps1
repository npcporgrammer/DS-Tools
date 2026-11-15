# 把 .ico 写进 exe 的资源段（等价于 rcedit --set-icon，不依赖外部工具）
# 用法: powershell -ExecutionPolicy Bypass -File set-exe-icon.ps1 -Exe <exe路径> -Ico <ico路径>
param(
  [Parameter(Mandatory=$true)][string]$Exe,
  [Parameter(Mandatory=$true)][string]$Ico
)
$ErrorActionPreference = 'Stop'

if (-not (Test-Path $Exe)) { throw "找不到 exe: $Exe" }
if (-not (Test-Path $Ico)) { throw "找不到 ico: $Ico" }

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class IconRes {
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern IntPtr BeginUpdateResource(string pFileName, bool bDeleteExistingResources);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool UpdateResource(IntPtr hUpdate, IntPtr lpType, IntPtr lpName,
                                             ushort wLanguage, byte[] lpData, uint cbData);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool EndUpdateResource(IntPtr hUpdate, bool fDiscard);
}
'@

$RT_ICON = [IntPtr]3
$RT_GROUP_ICON = [IntPtr]14
$LANG = 1033

# ---- 解析 ico ----
$bytes = [System.IO.File]::ReadAllBytes($Ico)
$count = [BitConverter]::ToUInt16($bytes, 4)
if ($count -eq 0) { throw "ico 里没有图像" }

$entries = @()
for ($i = 0; $i -lt $count; $i++) {
  $o = 6 + 16 * $i
  $entries += [pscustomobject]@{
    Width      = [int]$bytes[$o]
    Height     = [int]$bytes[$o + 1]
    ColorCount = [int]$bytes[$o + 2]
    Planes     = [BitConverter]::ToUInt16($bytes, $o + 4)
    BitCount   = [BitConverter]::ToUInt16($bytes, $o + 6)
    Size       = [BitConverter]::ToUInt32($bytes, $o + 8)
    Offset     = [BitConverter]::ToUInt32($bytes, $o + 12)
  }
}

# ---- 组图标数据：GRPICONDIR + 每项 14 字节 ----
$grp = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($grp)
$bw.Write([uint16]0)                 # reserved
$bw.Write([uint16]1)                 # type = icon
$bw.Write([uint16]$count)
for ($i = 0; $i -lt $count; $i++) {
  $e = $entries[$i]
  $bw.Write([byte]$e.Width)
  $bw.Write([byte]$e.Height)
  $bw.Write([byte]$e.ColorCount)
  $bw.Write([byte]0)
  $bw.Write([uint16]$e.Planes)
  $bw.Write([uint16]$e.BitCount)
  $bw.Write([uint32]$e.Size)
  $bw.Write([uint16]($i + 1))        # 与 RT_ICON 的 ID 对应
}
$bw.Flush()
$grpBytes = $grp.ToArray()
$bw.Dispose(); $grp.Dispose()

# ---- 写入资源 ----
$h = [IconRes]::BeginUpdateResource($Exe, $false)
if ($h -eq [IntPtr]::Zero) { throw "BeginUpdateResource 失败: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }

try {
  for ($i = 0; $i -lt $count; $i++) {
    $e = $entries[$i]
    $blob = New-Object byte[] $e.Size
    [Array]::Copy($bytes, [int]$e.Offset, $blob, 0, [int]$e.Size)
    $ok = [IconRes]::UpdateResource($h, $RT_ICON, [IntPtr]($i + 1), $LANG, $blob, [uint32]$e.Size)
    if (-not $ok) { throw "写 RT_ICON #$($i+1) 失败" }
  }
  $ok = [IconRes]::UpdateResource($h, $RT_GROUP_ICON, [IntPtr]1, $LANG, $grpBytes, [uint32]$grpBytes.Length)
  if (-not $ok) { throw "写 RT_GROUP_ICON 失败" }
}
finally {
  $done = [IconRes]::EndUpdateResource($h, $false)
  if (-not $done) { throw "EndUpdateResource 失败" }
}

Write-Output "已写入 $count 个尺寸的图标 -> $Exe"

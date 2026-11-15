# QingYaoTP AILauncher —— 视觉增强包 zip 打包（可选能力，v1.6.0 起从主包拆出）
#
# 为什么单独一个脚本：主包 158.5MB 里有 101.1MB 是视觉 sidecar（llama.cpp b12144 / 53 文件），
# 不看图的人不该为它付流量。这里把 tools\llama.cpp 打成独立的「视觉增强包」：
#
#   QingYaoTP-AILauncher-v<APP_VERSION>-vision-pack.zip
#     QingYaoTP-AILauncher-v<APP_VERSION>-vision-pack/   <- 顶层目录（安装器会剥掉）
#       vision-pack.json                                <- 清单（format/name/version/sidecar/files/bytes）
#       llama/<tools\llama.cpp 的全部 53 个文件>
#
# 用户在「设置 -> 视觉」里选 zip 或点「一键安装」；后端校验清单 + required 8 件后解到 app\llama。
# 版本号从 server\app.mjs 的 APP_VERSION 解析（不手改）；所有路径由本脚本位置推导（repo = server 的上一级），不写死盘符。
#
# 用法：
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\make-vision-pack.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\make-vision-pack.ps1 -Out 'D:\tmp'
# 产出：<Out>\QingYaoTP-AILauncher-v<APP_VERSION>-vision-pack.zip（默认 Out = <repo>\dist）

param(
    # 源目录：默认 <repo>\tools\llama.cpp
    [string]$Src = '',
    # 输出目录：默认 <repo>\dist
    [string]$Out = '',
    # 增强包版本：默认从 server\app.mjs 的 APP_VERSION 解析
    [string]$Version = '',
    # llama.cpp 构建号（写进 vision-pack.json 的 sidecar 字段）
    [string]$Sidecar = 'b12144'
)

$ErrorActionPreference = 'Stop'
$Server = Split-Path -Parent $MyInvocation.MyCommand.Path
$Repo = Split-Path -Parent $Server
if (-not $Src) { $Src = Join-Path $Repo 'tools\llama.cpp' }
if (-not $Out) { $Out = Join-Path $Repo 'dist' }
if (-not $Version) {
    $verMatch = Select-String -Path (Join-Path $Server 'app.mjs') -Pattern 'const APP_VERSION = "([^"]+)"' | Select-Object -First 1
    if (-not $verMatch) { Write-Host '!! 解析不到 server\app.mjs 的 APP_VERSION（也可以用 -Version 指定）' -ForegroundColor Red; exit 1 }
    $Version = $verMatch.Matches[0].Groups[1].Value
    Write-Host ("   版本（取自 app.mjs）：$Version") -ForegroundColor DarkGray
} else {
    Write-Host ("   版本（-Version）：$Version") -ForegroundColor DarkGray
}

$Src = [System.IO.Path]::GetFullPath($Src).TrimEnd('\')
if (-not (Test-Path $Src)) { Write-Host "!! 找不到视觉 sidecar 源目录：$Src（把它放到 tools\llama.cpp）" -ForegroundColor Red; exit 1 }
Write-Host ("   源目录：$Src") -ForegroundColor DarkGray

# required 8 件：后端安装校验用同一份清单，缺一个就拒装（防半截包）
$required = @(
    'llama-server.exe',
    'llama-server-impl.dll',
    'llama.dll',
    'llama-common.dll',
    'ggml.dll',
    'ggml-base.dll',
    'mtmd.dll',
    'libomp.dll'
)
$missing = @($required | Where-Object { -not (Test-Path (Join-Path $Src $_)) })
if ($missing.Count -gt 0) {
    Write-Host ("!! 视觉 sidecar 缺 required 文件（{0} 个）：{1}" -f $missing.Count, ($missing -join ', ')) -ForegroundColor Red
    Write-Host "   源目录：$Src" -ForegroundColor Red
    exit 1
}

$srcFiles = @(Get-ChildItem $Src -File)
if ($srcFiles.Count -eq 0) { Write-Host "!! 源目录里没有文件：$Src" -ForegroundColor Red; exit 1 }
$srcBytes = ($srcFiles | Measure-Object Length -Sum).Sum

$rootName = 'QingYaoTP-AILauncher-v' + $Version + '-vision-pack'
if (-not (Test-Path $Out)) { New-Item -ItemType Directory -Force -Path $Out | Out-Null }
$zipPath = Join-Path ([System.IO.Path]::GetFullPath($Out)) ($rootName + '.zip')

$stageRoot = Join-Path $env:TEMP ('qytp-vp-' + [guid]::NewGuid().ToString('N'))
$stage = Join-Path $stageRoot $rootName
$llamaDst = Join-Path $stage 'llama'
New-Item -ItemType Directory -Force -Path $llamaDst | Out-Null

$files = @()
$bytes = 0
try {
    Write-Host '==> 暂存视觉 sidecar' -ForegroundColor Cyan
    Copy-Item (Join-Path $Src '*') $llamaDst -Recurse -Force
    $files = @(Get-ChildItem $llamaDst -Recurse -File)
    $bytes = ($files | Measure-Object Length -Sum).Sum
    if ($files.Count -ne $srcFiles.Count) {
        Write-Host ("!! 暂存文件数不一致：源 {0} / 暂存 {1}" -f $srcFiles.Count, $files.Count) -ForegroundColor Red
        exit 1
    }

    # vision-pack.json：UTF-8 无 BOM（后端 JSON.parse 读；带 BOM 反而要额外处理）
    $createdAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss'Z'")
    $json = @"
{
  "format": 1,
  "name": "QingYaoTP AILauncher 视觉增强包",
  "version": "$Version",
  "sidecar": "$Sidecar",
  "createdAt": "$createdAt",
  "files": $($files.Count),
  "bytes": $bytes
}
"@
    [System.IO.File]::WriteAllText((Join-Path $stage 'vision-pack.json'), $json + "`r`n", (New-Object System.Text.UTF8Encoding($false)))

    Write-Host '==> 压缩（正斜杠条目 + 目录项）' -ForegroundColor Cyan
    if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $t0 = Get-Date
    $fs = [System.IO.File]::Open($zipPath, [System.IO.FileMode]::Create)
    $ar = New-Object System.IO.Compression.ZipArchive($fs, [System.IO.Compression.ZipArchiveMode]::Create)
    $prefix = $rootName + '/'
    $null = $ar.CreateEntry($prefix)
    $base = (Get-Item $stage).FullName
    Get-ChildItem $stage -Recurse -Directory | ForEach-Object {
        $rel = $_.FullName.Substring($base.Length + 1).Replace('\', '/')
        $null = $ar.CreateEntry($prefix + $rel + '/')
    }
    Get-ChildItem $stage -Recurse -File | ForEach-Object {
        $rel = $_.FullName.Substring($base.Length + 1).Replace('\', '/')
        $entry = $ar.CreateEntry($prefix + $rel, [System.IO.Compression.CompressionLevel]::Optimal)
        $entry.LastWriteTime = $_.LastWriteTime
        # 注意：参数 -Out 与 $out 是同一个变量（PowerShell 变量名大小写不敏感），
        # 流不能用 $in / $out 命名，否则会被 [string]$Out 的类型约束转成字符串。
        $inStream = [System.IO.File]::OpenRead($_.FullName)
        $outStream = $entry.Open()
        $inStream.CopyTo($outStream)
        $outStream.Dispose()
        $inStream.Dispose()
    }
    $ar.Dispose()
    $fs.Dispose()
} finally {
    Remove-Item $stageRoot -Recurse -Force -ErrorAction SilentlyContinue
}

# 自检：文件条目数 = 53（llama 全部文件）+ 1（vision-pack.json），另加目录项
$z = Get-Item $zipPath
$zipRead = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
$entries = $zipRead.Entries.Count
$fileEntries = @($zipRead.Entries | Where-Object { -not ($_.FullName.EndsWith('/')) })
$hasJson = @($zipRead.Entries | Where-Object { $_.FullName -eq ($rootName + '/vision-pack.json') })
$zipRead.Dispose()
$expectFiles = $files.Count + 1
if ($fileEntries.Count -ne $expectFiles) {
    Write-Host ("!! 自检失败：zip 文件条目 {0} != 期望 {1}（{2} 个 llama 文件 + 1 个 vision-pack.json）" -f $fileEntries.Count, $expectFiles, $files.Count) -ForegroundColor Red
    exit 1
}
if ($hasJson.Count -ne 1) {
    Write-Host ("!! 自检失败：zip 里没有 {0}/vision-pack.json" -f $rootName) -ForegroundColor Red
    exit 1
}
$sha = (Get-FileHash $zipPath -Algorithm SHA256).Hash

Write-Host ('完成：{0}' -f $z.FullName) -ForegroundColor Green
Write-Host ('  {0:N1} MB / {1} 条目（{2} 个文件 + 目录项） / {3:N1}s' -f ($z.Length / 1MB), $entries, $fileEntries.Count, ((Get-Date) - $t0).TotalSeconds)
Write-Host ('  视觉 sidecar：{0} 个文件 / {1:N1} MB（required 8 件齐）；sidecar={2}' -f $files.Count, ($bytes / 1MB), $Sidecar)
Write-Host ('  SHA256 {0}' -f $sha)

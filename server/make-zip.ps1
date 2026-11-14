# QingYaoTP AILauncher —— 交付 zip 打包（build-portable.ps1 之后的一步）
#
# 为什么单独一个脚本：build-portable.ps1 只负责构建 dist 运行目录，不打 zip。
# 11-01 与 11-04 两轮都出现过「dist 已更新、交付 zip 还是旧的」。这里把规则固定下来：
#   · 只打发布载荷：data\ 与 logs\ 只保留空目录（WebView2 缓存、运行日志不进包）
#   · models\ 保留空目录（用户把 gguf 放这里，modelDir 留空即可用）
#   · 根目录名固定 QingYaoTP AILauncher-v1.4.0，条目一律用正斜杠（跨工具兼容）
#
# 用法：powershell -NoProfile -ExecutionPolicy Bypass -File .\make-zip.ps1
# 产出：D:\LocalModels\dist\QingYaoTP-AILauncher-v1.4.0.zip

param(
    [string]$Dist = 'D:\LocalModels\dist\QingYaoTP AILauncher',
    [string]$Zip = 'D:\LocalModels\dist\QingYaoTP-AILauncher-v1.4.0.zip',
    [string]$RootName = 'QingYaoTP AILauncher-v1.4.0'
)

$ErrorActionPreference = 'Stop'
$dist = [System.IO.Path]::GetFullPath($Dist).TrimEnd('\')
if (-not (Test-Path (Join-Path $dist 'QingYaoTP AILauncher.exe'))) {
    Write-Host "!! 发布目录里没有 QingYaoTP AILauncher.exe，先跑 build-portable.ps1：$dist" -ForegroundColor Red
    exit 1
}

$root = Join-Path $env:TEMP ('qytp-zip-' + [guid]::NewGuid().ToString('N'))
$stage = Join-Path $root $RootName
New-Item -ItemType Directory -Force -Path $stage | Out-Null

Write-Host '==> 暂存发布载荷（排除 data / logs 内容）' -ForegroundColor Cyan
$rc = @($dist, $stage, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/R:1', '/W:1', '/XD', (Join-Path $dist 'data'), (Join-Path $dist 'logs'))
& robocopy @rc | Out-Null
if ($LASTEXITCODE -ge 8) { Write-Host "!! robocopy 失败 $LASTEXITCODE" -ForegroundColor Red; exit 1 }

foreach ($d in @('data', 'logs', 'models')) {
    New-Item -ItemType Directory -Force -Path (Join-Path $stage $d) | Out-Null
}

# 运行期文件不进包：app\server.pid 是正在跑的服务写的（带着本机 pid），.log/.tmp 同理
Get-ChildItem (Join-Path $stage 'app') -File | Where-Object { @('.pid', '.log', '.tmp') -contains $_.Extension } | Remove-Item -Force -ErrorAction SilentlyContinue

# 交付 zip 必须可移植：清掉本机的绝对路径与本地选择（dist 运行目录里的 config.ini 保持原样）
$stageCfg = Join-Path $stage 'config.ini'
if (Test-Path $stageCfg) {
    $t = [System.IO.File]::ReadAllText($stageCfg, [System.Text.Encoding]::UTF8)
    $t = $t -replace '(?m)^modelDir=.*$', 'modelDir='
    $t = $t -replace '(?m)^autoLoad=.*$', 'autoLoad='
    $t = $t -replace '(?m)^vkDevices=.*$', 'vkDevices='
    $t = $t -replace '(?m)^visionModel=.*$', 'visionModel='
    $t = $t -replace '(?m)^visionMmproj=.*$', 'visionMmproj='
    [System.IO.File]::WriteAllText($stageCfg, $t, (New-Object System.Text.UTF8Encoding($true)))
}

Write-Host '==> 压缩（正斜杠条目 + 目录项）' -ForegroundColor Cyan
if (Test-Path $Zip) { Remove-Item $Zip -Force }
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$t0 = Get-Date
$fs = [System.IO.File]::Open($Zip, [System.IO.FileMode]::Create)
$ar = New-Object System.IO.Compression.ZipArchive($fs, [System.IO.Compression.ZipArchiveMode]::Create)
$prefix = $RootName + '/'
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
    $in = [System.IO.File]::OpenRead($_.FullName)
    $out = $entry.Open()
    $in.CopyTo($out)
    $out.Dispose()
    $in.Dispose()
}
$ar.Dispose()
$fs.Dispose()
Remove-Item $root -Recurse -Force -ErrorAction SilentlyContinue

$z = Get-Item $Zip
$zipRead = [System.IO.Compression.ZipFile]::OpenRead($Zip)
$n = $zipRead.Entries.Count
$zipRead.Dispose()
Write-Host ('完成：{0}' -f $z.FullName) -ForegroundColor Green
Write-Host ('  {0:N1} MB / {1} 条目 / {2:N1}s' -f ($z.Length / 1MB), $n, ((Get-Date) - $t0).TotalSeconds)

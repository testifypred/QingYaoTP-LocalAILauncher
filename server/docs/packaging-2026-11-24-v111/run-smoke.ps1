# Release smoke on dist instance (v1.11.1)
$ErrorActionPreference = 'Continue'
$out = 'D:\LocalModels\server\docs\packaging-2026-11-24-v111\smoke'
New-Item -ItemType Directory -Force -Path $out | Out-Null
$base = 'http://127.0.0.1:8099'
$cdp = 'http://127.0.0.1:9333'
$env:PROBE_SKIP_SWITCH = '1'
$server = 'D:\LocalModels\server'
$helper = Join-Path $server 'docs\feature-review-watchdog-2026-11-22\run-probe-with-edge.ps1'
$shots = Join-Path $out 'shots'
New-Item -ItemType Directory -Force -Path $shots | Out-Null
Push-Location $server
function RunNode($name, $file, $probeArgs) {
  $log = Join-Path $out ($name + '.txt')
  '=== ' + $name + ' ===' | Out-File -FilePath $log -Encoding utf8
  & node (@($file) + @($probeArgs)) *>&1 | Out-File -FilePath $log -Append -Encoding utf8
  $code = $LASTEXITCODE
  ('EXIT=' + $code) | Out-File -FilePath $log -Append -Encoding utf8
  Write-Output ($name + ' EXIT=' + $code)
}
function RunEdge($name, $probeFile, $probeArgs) {
  $log = Join-Path $out ($name + '.txt')
  '=== ' + $name + ' ===' | Out-File -FilePath $log -Encoding utf8
  & $helper -Probe (Join-Path $server $probeFile) -ProbeArgs $probeArgs *>&1 | Out-File -FilePath $log -Append -Encoding utf8
  Write-Output ($name + ' done')
}
'--- probe-version'; RunNode 'probe-version' 'probe-version.mjs' @($base)
'--- probe-debug'; RunNode 'probe-debug' 'probe-debug.mjs' @($base)
'--- probe-code-review-stream'; RunNode 'probe-code-review-stream' 'probe-code-review-stream.mjs' @($base)
'--- probe-readme'; RunEdge 'probe-readme' 'probe-readme.mjs' @($cdp, $base)
'--- probe-code-window-ui'; RunEdge 'probe-code-window-ui' 'probe-code-window-ui.mjs' @($cdp, $base)
'--- probe-code-panel-v2'; RunEdge 'probe-code-panel-v2' 'probe-code-panel-v2.mjs' @($base, $cdp, $shots)
'--- probe-review-watchdog'; RunEdge 'probe-review-watchdog' 'probe-review-watchdog.mjs' @($cdp, $base)
Pop-Location
'=== SMOKE SUMMARY ==='
Get-ChildItem $out -Filter '*.txt' | ForEach-Object { $t = Get-Content $_.FullName -Raw -Encoding UTF8; $res = ($t -split "`r?`n" | Where-Object { $_ -match 'RESULT|结果:' } | Select-Object -Last 1); '{0,-30} {1}' -f $_.BaseName, $res }

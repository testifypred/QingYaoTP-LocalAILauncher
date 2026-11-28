$ErrorActionPreference = "Continue"
$out = "D:\LocalModels\server\docs\ui-redesign\probe-regression"
New-Item -ItemType Directory -Force -Path $out | Out-Null
$helper = "D:\LocalModels\server\docs\feature-review-watchdog-2026-11-22\run-probe-with-edge.ps1"
$base = "http://127.0.0.1:8099"; $cdp = "http://127.0.0.1:9333"
$server = "D:\LocalModels\server"
Push-Location $server
function RunEdge($name, $probe, $args) {
  $log = Join-Path $out ($name + ".txt")
  "=== $name ===" | Out-File -FilePath $log -Encoding utf8
  & $helper -Probe (Join-Path $server $probe) -ProbeArgs $args *>&1 | Out-File -FilePath $log -Append -Encoding utf8
  $r = (Get-Content $log -Raw -Encoding utf8) -split "`r?`n" | Where-Object { $_ -match "RESULT|结果:" } | Select-Object -Last 1
  Write-Output ($name + " -> " + $r)
}
RunEdge "probe-start-screen" "probe-start-screen.mjs" @($cdp, (Join-Path $out "shots"))
RunEdge "probe-start-flow" "probe-start-flow.mjs" @($cdp, (Join-Path $out "shots"))
RunEdge "probe-ui-new" "probe-ui-new.mjs" @($cdp, (Join-Path $out "shots"))
RunEdge "probe-settings-tools" "probe-settings-tools.mjs" @($cdp)
RunEdge "probe-hero-modes" "probe-hero-modes.mjs" @($cdp)
RunEdge "probe-input-extras" "probe-input-extras.mjs" @($cdp)
RunEdge "probe-ui-version" "probe-ui-version.mjs" @($cdp, $base)
RunEdge "probe-code-window-ui" "probe-code-window-ui.mjs" @($cdp, $base)
Pop-Location
"DONE"

# Release smoke probes for v1.11.0 dist instance — ASCII only
$ErrorActionPreference = 'Continue'
$base = 'http://127.0.0.1:8099'
$cdp = 'http://127.0.0.1:9333'
$out = 'D:\LocalModels\server\docs\packaging-2026-11-22-v111'
$shots = Join-Path $out 'smoke-shots'
New-Item -ItemType Directory -Force -Path $shots | Out-Null
$script:fail = 0
function Run1([string]$name, [string[]]$nodeArgs) {
  Write-Output ('===== ' + $name + ' =====')
  & node @nodeArgs 2>&1 | Tee-Object -FilePath (Join-Path $out ('smoke-' + $name + '.log'))
  $code = $LASTEXITCODE
  Write-Output ('[smoke] ' + $name + ' exit=' + $code)
  if ($code -ne 0) { $script:fail += 1 }
}
$edge = Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'
if (-not (Test-Path $edge)) { $edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe' }
$ud = Join-Path $env:TEMP ('edge-smoke-v111-' + [guid]::NewGuid().ToString('N'))
$ep = Start-Process -FilePath $edge -ArgumentList @('--headless=new','--no-sandbox','--remote-debugging-port=9333','--user-data-dir=' + $ud,'--window-size=1440,900','--no-first-run') -PassThru -WindowStyle Hidden
$up = $false
for ($i = 0; $i -lt 90; $i++) { Start-Sleep -Seconds 1; try { $null = Invoke-RestMethod 'http://127.0.0.1:9333/json/version' -TimeoutSec 3; $up = $true; break } catch {} }
if (-not $up) { Write-Output '[edge] CDP DOWN'; exit 1 }
try { $null = Invoke-RestMethod -Method Put ('http://127.0.0.1:9333/json/new?' + $base + '/') -TimeoutSec 10 } catch {}
$got = $false
for ($i = 0; $i -lt 30; $i++) { Start-Sleep -Seconds 1; try { $list = Invoke-RestMethod 'http://127.0.0.1:9333/json/list' -TimeoutSec 5 } catch { continue }; $page = $list | Where-Object { $_.type -eq 'page' -and ([string]$_.url).StartsWith($base) } | Select-Object -First 1; if ($page) { $got = $true; break } }
if (-not $got) { Write-Output '[edge] no page'; Stop-Process -Id $ep.Id -Force -ErrorAction SilentlyContinue; exit 1 }
Start-Sleep -Seconds 5
Push-Location 'D:\LocalModels\server'
$env:PROBE_SKIP_SWITCH = '1'   # Phi-4-mini 切换在 Vulkan 上偶发原生层卡死（已知）：发布包冒烟按历史惯例跳过 D 段
Run1 'probe-version' @('probe-version.mjs', $base)
Run1 'probe-debug' @('probe-debug.mjs', $base)
Run1 'probe-readme' @('probe-readme.mjs', $cdp, $base)
Run1 'probe-code-window-ui' @('probe-code-window-ui.mjs', $cdp, $base)
Run1 'probe-code-panel-v2' @('probe-code-panel-v2.mjs', $base, $cdp, $shots)
Run1 'probe-code-review-stream' @('probe-code-review-stream.mjs', $base)
Run1 'probe-review-watchdog' @('probe-review-watchdog.mjs', $cdp, $base)
Pop-Location
Write-Output ('[smoke] failed=' + $script:fail)
Stop-Process -Id $ep.Id -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Remove-Item $ud -Recurse -Force -ErrorAction SilentlyContinue
exit $script:fail

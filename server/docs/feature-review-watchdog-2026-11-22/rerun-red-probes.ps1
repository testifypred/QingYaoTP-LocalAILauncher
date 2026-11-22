# Isolated re-run of the 6 red probes (fresh Edge, same dev instance) — ASCII only
$ErrorActionPreference = 'Continue'
$base = 'http://127.0.0.1:8099'
$cdp = 'http://127.0.0.1:9333'
$out = 'D:\LocalModels\server\docs\probe-full-2026-11-22-v111-r2'
$shots = Join-Path $out 'shots'
$logs = Join-Path $out 'logs'
New-Item -ItemType Directory -Force -Path $shots, $logs | Out-Null
$script:fail = 0
function Run1([string]$name, [string[]]$nodeArgs) {
  Write-Output ('===== ' + $name + ' =====')
  & node @nodeArgs 2>&1 | Tee-Object -FilePath (Join-Path $logs ('rerun-' + $name + '.out.txt'))
  $code = $LASTEXITCODE
  Write-Output ('[rerun] ' + $name + ' exit=' + $code)
  if ($code -ne 0) { $script:fail += 1 }
}
$edge = Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'
if (-not (Test-Path $edge)) { $edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe' }
$ud = Join-Path $env:TEMP ('edge-rerun-v111-' + [guid]::NewGuid().ToString('N'))
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
Run1 'probe-vision-pack' @('probe-vision-pack.mjs', $base)
Run1 'probe-ui-vision-pack' @('probe-ui-vision-pack.mjs', $cdp, $base, $shots)
Run1 'probe-start-screen' @('probe-start-screen.mjs', $cdp, $shots)
Run1 'probe-start-flow' @('probe-start-flow.mjs', $cdp, $shots)
Run1 'probe-small-features' @('probe-small-features.mjs', $cdp)
Run1 'probe-web-tools' @('probe-web-tools.mjs', $base, 'qwen3-5-4B-Q4_K_M.gguf')
Pop-Location
Write-Output ('[rerun] failed=' + $script:fail)
Stop-Process -Id $ep.Id -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Remove-Item $ud -Recurse -Force -ErrorAction SilentlyContinue
exit $script:fail

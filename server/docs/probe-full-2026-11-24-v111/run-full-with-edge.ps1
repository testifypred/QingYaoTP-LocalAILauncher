# Full-suite driver wrapper: launch headless Edge (CDP 9333) and run run-full.ps1 in the SAME process
# (Edge 158 pitfall: headless Edge is recycled with the process that launched it; must not be a separate invocation)
param([string]$OutDir = 'D:\LocalModels\server\docs\probe-full-2026-11-24-v111')
$ErrorActionPreference = 'Continue'
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$env:FULL_PROBE_OUT = $OutDir
$base = 'http://127.0.0.1:8099'
$edge = Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'
if (-not (Test-Path $edge)) { $edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe' }
$ud = Join-Path $env:TEMP ('edge-full-' + [guid]::NewGuid().ToString('N'))
$errlog = Join-Path $env:TEMP ('edge-full-err-' + [guid]::NewGuid().ToString('N') + '.txt')
$ep = Start-Process -FilePath $edge -ArgumentList @('--headless=new','--no-sandbox','--remote-debugging-port=9333','--remote-debugging-address=127.0.0.1','--user-data-dir=' + $ud,'--window-size=1440,900','--no-first-run','--no-default-browser-check') -PassThru -WindowStyle Hidden -RedirectStandardError $errlog
Write-Output ('[edge] pid=' + $ep.Id + ' launching')
$cdp = $false
for ($i = 0; $i -lt 180; $i++) { Start-Sleep -Seconds 1; try { $null = Invoke-RestMethod 'http://127.0.0.1:9333/json/version' -TimeoutSec 3; $cdp = $true; break } catch {} }
if (-not $cdp) { Write-Output '[edge] CDP DOWN - abort'; Stop-Process -Id $ep.Id -Force -ErrorAction SilentlyContinue; exit 1 }
Write-Output ('[edge] CDP up after ' + ($i+1) + 's')
$created = $false
for ($i = 0; $i -lt 5; $i++) { try { $t = Invoke-RestMethod -Method Put ('http://127.0.0.1:9333/json/new?' + $base + '/') -TimeoutSec 15; $created = $true; break } catch { Start-Sleep -Seconds 2 } }
if (-not $created) { Write-Output '[edge] create target FAILED'; Stop-Process -Id $ep.Id -Force -ErrorAction SilentlyContinue; exit 1 }
$got = $false
for ($i = 0; $i -lt 90; $i++) { Start-Sleep -Seconds 1; try { $list = Invoke-RestMethod 'http://127.0.0.1:9333/json/list' -TimeoutSec 5 } catch { continue }; $page = $list | Where-Object { $_.type -eq 'page' -and ([string]$_.url).StartsWith($base) } | Select-Object -First 1; if ($page) { $got = $true; break } }
if (-not $got) { Write-Output '[edge] page target NOT found - abort'; Stop-Process -Id $ep.Id -Force -ErrorAction SilentlyContinue; exit 1 }
Write-Output ('[edge] page ready: ' + $page.url)
Start-Sleep -Seconds 5
$t0 = Get-Date
& 'D:\LocalModels\server\docs\run-full.ps1'
$code = $LASTEXITCODE
Write-Output ('[full] exit=' + $code + ' elapsed=' + [int]((Get-Date) - $t0).TotalMinutes + 'min')
Stop-Process -Id $ep.Id -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Remove-Item $ud -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $errlog -Force -ErrorAction SilentlyContinue
exit $code

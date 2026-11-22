# Run one CDP probe with a fresh headless Edge in the SAME process.
# Edge 158 pitfall: "Multiple targets are not supported in headless mode" -> start WITHOUT a URL,
# then create the page target with PUT /json/new?<base> (CDP), wait for it, then run the probe.
# Usage: run-probe-with-edge.ps1 -Probe <probe .mjs path> [-ProbeArgs @('http://127.0.0.1:9333','http://127.0.0.1:8099')]
param(
  [Parameter(Mandatory=$true)][string]$Probe,
  [string[]]$ProbeArgs = @('http://127.0.0.1:9333','http://127.0.0.1:8099')
)
$ErrorActionPreference = 'Continue'
$base = 'http://127.0.0.1:8099'
$edge = Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'
if (-not (Test-Path $edge)) { $edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe' }
$ud = Join-Path $env:TEMP ('edge-probe-wd-' + [guid]::NewGuid().ToString('N'))
$ep = Start-Process -FilePath $edge -ArgumentList @('--headless=new','--no-sandbox','--remote-debugging-port=9333','--user-data-dir=' + $ud,'--window-size=1440,900','--no-first-run') -PassThru -WindowStyle Hidden
$cdp = $false
for ($i = 0; $i -lt 90; $i++) { Start-Sleep -Seconds 1; try { $null = Invoke-RestMethod 'http://127.0.0.1:9333/json/version' -TimeoutSec 3; $cdp = $true; break } catch {} }
if (-not $cdp) { Write-Output '[edge] CDP DOWN - abort'; Stop-Process -Id $ep.Id -Force -ErrorAction SilentlyContinue; exit 1 }
Write-Output ('[edge] pid=' + $ep.Id + ' cdp up')
$created = $false
for ($i = 0; $i -lt 3; $i++) {
  try { $t = Invoke-RestMethod -Method Put ('http://127.0.0.1:9333/json/new?' + $base + '/') -TimeoutSec 10; $created = $true; break } catch { Start-Sleep -Seconds 1 }
}
if (-not $created) { Write-Output '[edge] could not create page target - abort'; Stop-Process -Id $ep.Id -Force -ErrorAction SilentlyContinue; exit 1 }
$got = $false
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 1
  try { $list = Invoke-RestMethod 'http://127.0.0.1:9333/json/list' -TimeoutSec 5 } catch { continue }
  $page = $list | Where-Object { $_.type -eq 'page' -and ([string]$_.url).StartsWith($base) } | Select-Object -First 1
  if ($page) { $got = $true; break }
}
if (-not $got) { Write-Output '[edge] page target at base not found - abort'; Stop-Process -Id $ep.Id -Force -ErrorAction SilentlyContinue; exit 1 }
Write-Output ('[edge] page ready url=' + $page.url)
Start-Sleep -Seconds 4
$nodeArgs = @($Probe) + $ProbeArgs
& node @nodeArgs
$code = $LASTEXITCODE
Write-Output ('[probe] exit=' + $code)
Stop-Process -Id $ep.Id -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Remove-Item $ud -Recurse -Force -ErrorAction SilentlyContinue
exit $code

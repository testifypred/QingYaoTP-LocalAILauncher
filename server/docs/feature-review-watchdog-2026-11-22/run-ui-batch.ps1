$base = 'http://127.0.0.1:8099'
$cdp = 'http://127.0.0.1:9333'
$ev = 'D:\LocalModels\server\docs\feature-review-watchdog-2026-11-22'
$edge = Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'
if (-not (Test-Path $edge)) { $edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe' }
$ud = Join-Path $env:TEMP ('edge-ui-batch-' + [guid]::NewGuid().ToString('N'))
$ep = Start-Process -FilePath $edge -ArgumentList @('--headless=new','--no-sandbox','--remote-debugging-port=9333','--user-data-dir=' + $ud,'--window-size=1440,900','--no-first-run') -PassThru -WindowStyle Hidden
$up = $false
for ($i = 0; $i -lt 90; $i++) { Start-Sleep -Seconds 1; try { $null = Invoke-RestMethod 'http://127.0.0.1:9333/json/version' -TimeoutSec 3; $up = $true; break } catch {} }
if (-not $up) { Write-Output '[edge] CDP DOWN'; exit 1 }
Write-Output ('[edge] pid=' + $ep.Id)
try { $null = Invoke-RestMethod -Method Put ('http://127.0.0.1:9333/json/new?' + $base + '/') -TimeoutSec 10 } catch {}
$got = $false
for ($i = 0; $i -lt 30; $i++) { Start-Sleep -Seconds 1; try { $list = Invoke-RestMethod 'http://127.0.0.1:9333/json/list' -TimeoutSec 5 } catch { continue }; $page = $list | Where-Object { $_.type -eq 'page' -and ([string]$_.url).StartsWith($base) } | Select-Object -First 1; if ($page) { $got = $true; break } }
if (-not $got) { Write-Output '[edge] page not found'; Stop-Process -Id $ep.Id -Force -ErrorAction SilentlyContinue; exit 1 }
Start-Sleep -Seconds 5
$fail = 0
$results = @()
function Run-One([string]$name, [string[]]$nodeArgs) {
  Write-Output ('===== ' + $name + ' =====')
  & node @nodeArgs
  $code = $LASTEXITCODE
  Write-Output ('[batch] ' + $name + ' exit=' + $code)
  $script:results += ($name + ' exit=' + $code)
  if ($code -ne 0) { $script:fail += 1 }
}
Push-Location 'D:\LocalModels\server'
Run-One 'probe-code-window-ui' @('probe-code-window-ui.mjs', $cdp, $base)
Run-One 'probe-review-scroll' @('probe-review-scroll.mjs', $cdp, $base)
Run-One 'ui-review-22line' @((Join-Path $ev 'ui-review-once.mjs'), 'python-210407-1.py', '300')
Run-One 'ui-review-62line' @((Join-Path $ev 'ui-review-once.mjs'), 'python-115523-1.py', '360')
Pop-Location
Write-Output '===== batch summary ====='
$results | ForEach-Object { Write-Output $_ }
Write-Output ('[batch] failed=' + $fail)
Stop-Process -Id $ep.Id -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Remove-Item $ud -Recurse -Force -ErrorAction SilentlyContinue
exit $fail

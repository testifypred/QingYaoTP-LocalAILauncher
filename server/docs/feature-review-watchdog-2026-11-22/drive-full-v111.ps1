# Full 70-probe suite for v1.11.0 release (ASCII only, PS 5.1 safe)
$ErrorActionPreference = 'Continue'
$repo = 'D:\LocalModels'
$base = 'http://127.0.0.1:8099'
$out = Join-Path $repo 'server\docs\probe-full-2026-11-22-v111-r2'
New-Item -ItemType Directory -Force -Path $out | Out-Null
$log = Join-Path $out 'drive.log'
function Say($s) { Write-Output $s; $s | Out-File -FilePath $log -Append -Encoding utf8 }
Say ('[drive] start ' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))

# --- keep machine awake during the long run: remember AC standby/hibernate, set 0 ---
function Get-AcIndex($sub, $setting) {
  try {
    $q = powercfg /query SCHEME_CURRENT $sub $setting 2>&1
    $line = $q | Where-Object { $_ -match 'AC' } | Select-Object -First 1
    if (-not $line) { $line = $q | Select-Object -Last 1 }
    $m = [regex]::Match([string]$line, '0x([0-9a-fA-F]+)')
    if ($m.Success) { return [Convert]::ToInt32($m.Groups[1].Value, 16) } else { return -1 }
  } catch { return -1 }
}
$standbyAc = Get-AcIndex 'SUB_SLEEP' 'STANDBYIDLE'
$hibernateAc = Get-AcIndex 'SUB_SLEEP' 'HIBERNATEIDLE'
Say ('[drive] AC standby=' + $standbyAc + 's hibernate=' + $hibernateAc + 's (0 = never)')
powercfg /change standby-timeout-ac 0 | Out-Null
powercfg /change hibernate-timeout-ac 0 | Out-Null

# --- headless Edge (Edge 158: no command-line URL; create page via CDP PUT /json/new) ---
$edge = Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'
if (-not (Test-Path $edge)) { $edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe' }
$ud = Join-Path $env:TEMP ('edge-full-v111-' + [guid]::NewGuid().ToString('N'))
$ep = Start-Process -FilePath $edge -ArgumentList @('--headless=new','--no-sandbox','--remote-debugging-port=9333','--user-data-dir=' + $ud,'--window-size=1440,900','--no-first-run') -PassThru -WindowStyle Hidden
$cdp = $false
for ($i = 0; $i -lt 90; $i++) { Start-Sleep -Seconds 1; try { $null = Invoke-RestMethod 'http://127.0.0.1:9333/json/version' -TimeoutSec 3; $cdp = $true; break } catch {} }
Say ('[drive] edge pid=' + $ep.Id + ' cdp=' + $cdp)
$pageOk = $false
if ($cdp) {
  try { $null = Invoke-RestMethod -Method Put ($('http://127.0.0.1:9333/json/new?' + $base + '/')) -TimeoutSec 10 } catch {}
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    try { $list = Invoke-RestMethod 'http://127.0.0.1:9333/json/list' -TimeoutSec 5 } catch { continue }
    $page = $list | Where-Object { $_.type -eq 'page' -and ([string]$_.url).StartsWith($base) } | Select-Object -First 1
    if ($page) { $pageOk = $true; break }
  }
  Say ('[drive] page=' + $pageOk + ' url=' + ($page.url))
  Start-Sleep -Seconds 5
}
if (-not $pageOk) { Say '[drive] ABORT: no page at base'; Stop-Process -Id $ep.Id -Force -ErrorAction SilentlyContinue; powercfg /change standby-timeout-ac $standbyAc; exit 1 }

# --- run the suite ---
$env:FULL_PROBE_OUT = $out
Say ('[drive] run-full start ' + (Get-Date -Format 'HH:mm:ss'))
$t0 = Get-Date
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repo 'server\docs\run-full.ps1') 2>&1 | ForEach-Object { $_.ToString() } | Tee-Object -FilePath (Join-Path $out 'run-full.out.log')
$code = $LASTEXITCODE
$mins = [math]::Round(((Get-Date) - $t0).TotalMinutes, 1)
Say ('[drive] run-full exit=' + $code + ' minutes=' + $mins)

# --- cleanup ---
Stop-Process -Id $ep.Id -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Remove-Item $ud -Recurse -Force -ErrorAction SilentlyContinue
if ($standbyAc -ge 0) { powercfg /change standby-timeout-ac $standbyAc }
if ($hibernateAc -ge 0) { powercfg /change hibernate-timeout-ac $hibernateAc }
Say ('[drive] power restored standby=' + $standbyAc + ' hibernate=' + $hibernateAc)
Say ('[drive] DONE ' + (Get-Date -Format 'HH:mm:ss'))
exit $code

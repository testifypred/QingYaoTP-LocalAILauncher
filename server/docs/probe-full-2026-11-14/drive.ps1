$ErrorActionPreference = 'Continue'
$out = 'D:\LocalModels\server\docs\probe-full-2026-11-14'
New-Item -ItemType Directory -Force -Path $out | Out-Null
'[driver] start ' + (Get-Date -Format 'HH:mm:ss') | Tee-Object -Append (Join-Path $out 'drive.log')

# kill leftovers from a previous attempt
Get-Process -Name node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

# 1) dev server
$so = Join-Path $out 'server.out.txt'
$se = Join-Path $out 'server.err.txt'
$srv = Start-Process -FilePath 'node' -ArgumentList 'app.mjs' -WorkingDirectory 'D:\LocalModels\server' -PassThru -WindowStyle Hidden -RedirectStandardOutput $so -RedirectStandardError $se
'[driver] node pid=' + $srv.Id | Tee-Object -Append (Join-Path $out 'drive.log')
$up = $false
for ($i = 0; $i -lt 180; $i++) { Start-Sleep -Seconds 1; try { $null = Invoke-RestMethod 'http://127.0.0.1:8099/api/state' -TimeoutSec 3; $up = $true; break } catch {} }
'[driver] server up=' + $up | Tee-Object -Append (Join-Path $out 'drive.log')

# 2) headless edge
$edge = Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'
if (-not (Test-Path $edge)) { $edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe' }
'[driver] edge=' + $edge + ' exists=' + (Test-Path $edge) | Tee-Object -Append (Join-Path $out 'drive.log')
$ep = Start-Process -FilePath $edge -ArgumentList @('--headless=new','--remote-debugging-port=9333','--user-data-dir=' + (Join-Path $env:TEMP 'edge-probe-2026-11-14'),'--window-size=1440,900','--no-first-run','http://127.0.0.1:8099/') -PassThru -WindowStyle Hidden
$cdp = $false
for ($i = 0; $i -lt 90; $i++) { Start-Sleep -Seconds 1; try { $null = Invoke-RestMethod 'http://127.0.0.1:9333/json/version' -TimeoutSec 3; $cdp = $true; break } catch {} }
'[driver] edge pid=' + $ep.Id + ' cdp=' + $cdp | Tee-Object -Append (Join-Path $out 'drive.log')

# 3) full suite
$env:FULL_PROBE_OUT = $out
'[driver] run-full start ' + (Get-Date -Format 'HH:mm:ss') | Tee-Object -Append (Join-Path $out 'drive.log')
& powershell -NoProfile -ExecutionPolicy Bypass -File 'D:\LocalModels\server\docs\run-full.ps1' 2>&1 | ForEach-Object { $_.ToString() }
'[driver] run-full exit=' + $LASTEXITCODE + ' at ' + (Get-Date -Format 'HH:mm:ss') | Tee-Object -Append (Join-Path $out 'drive.log')

# 4) cleanup
Stop-Process -Id $ep.Id -Force -ErrorAction SilentlyContinue
if ($ep) { Get-CimInstance Win32_Process -Filter ("ParentProcessId=" + $ep.Id) | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } }
Stop-Process -Id $srv.Id -Force -ErrorAction SilentlyContinue
'[driver] DONE ' + (Get-Date -Format 'HH:mm:ss') | Tee-Object -Append (Join-Path $out 'drive.log')
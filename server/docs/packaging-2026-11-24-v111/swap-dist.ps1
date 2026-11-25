# Swap v1.11.1 build into dist, restore data, start, install vision pack
$ErrorActionPreference = 'Continue'
$dist = 'D:\LocalModels\dist\QingYaoTP AILauncher'
$new  = 'D:\LocalModels\tmp-build\QingYaoTP AILauncher'
$base = 'http://127.0.0.1:8099'
function Stop-SourceServer {
  try { $st = Invoke-RestMethod "$base/api/state" -TimeoutSec 5 } catch { $st = $null }
  if ($st -and $st.localToken) { try { Invoke-RestMethod -Method Post -Uri "$base/api/shutdown" -Headers @{'x-local-token'=$st.localToken} -ContentType 'application/json' -Body '{}' -TimeoutSec 15 | Out-Null } catch {} }
  for ($i=0; $i -lt 20; $i++) { if (-not (Get-NetTCPConnection -LocalPort 8099 -State Listen -ErrorAction SilentlyContinue)) { break }; Start-Sleep -Milliseconds 500 }
  if (Get-NetTCPConnection -LocalPort 8099 -State Listen -ErrorAction SilentlyContinue) {
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'app\.mjs' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 2
  }
}
'=== stop source server'; Stop-SourceServer
'8099 listening: ' + [bool](Get-NetTCPConnection -LocalPort 8099 -State Listen -ErrorAction SilentlyContinue)
'=== rotate dist'
$bak = $dist + '.v1.11.0.bak'
if (Test-Path $bak) { Remove-Item $bak -Recurse -Force }
Rename-Item $dist 'QingYaoTP AILauncher.v1.11.0.bak'
Move-Item $new $dist
Move-Item (Join-Path $bak 'data') (Join-Path $dist 'data') -ErrorAction SilentlyContinue
'rotated. dist files: ' + @(Get-ChildItem $dist -Recurse -File).Count
'=== start dist exe'
$exe = Join-Path $dist 'QingYaoTP AILauncher.exe'
$p = Start-Process -FilePath $exe -WorkingDirectory $dist -PassThru
'launcher pid=' + $p.Id
$ok = $false
for ($i=0; $i -lt 480; $i++) { try { $h = Invoke-RestMethod "$base/health" -TimeoutSec 2; if ($h.status -eq 'ok') { $ok = $true; break } } catch {}; Start-Sleep -Milliseconds 500 }
'health=' + $ok + ' after ' + [int]($i/2) + 's'
if (-not $ok) { '!! health failed'; exit 1 }
$v = Invoke-RestMethod "$base/api/version" -TimeoutSec 5
'version=' + $v.version + ' dir=' + $v.dir + ' pid=' + $v.pid
'=== install vision pack'
try {
  $st = Invoke-RestMethod "$base/api/state" -TimeoutSec 8
  $hdr = @{'x-local-token' = $st.localToken}
  $body = @{ path = 'D:\LocalModels\dist\QingYaoTP-AILauncher-v1.6.0-vision-pack.zip' } | ConvertTo-Json
  $r = Invoke-RestMethod -Method Post -Uri "$base/api/vision/pack/install" -Headers $hdr -ContentType 'application/json' -Body $body -TimeoutSec 300
  'install: ' + ($r | ConvertTo-Json -Compress)
} catch { 'install ERR: ' + $_.Exception.Message }
Start-Sleep -Seconds 2
$vp = Invoke-RestMethod "$base/api/vision/pack" -TimeoutSec 10
'vision source=' + $vp.source + ' files=' + $vp.files + ' installed=' + $vp.installed
'=== wait autoLoad model'
for ($i=0; $i -lt 180; $i++) { try { $st = Invoke-RestMethod "$base/api/state" -TimeoutSec 3; if ($st.loaded) { break } } catch {}; Start-Sleep -Milliseconds 500 }
'loaded=' + $st.loaded + ' ctx=' + $st.context + ' gpu=' + $st.gpu
'=== launcher log tail'
Get-Content (Join-Path $dist 'logs\launcher.log') -Tail 8 -Encoding UTF8 | Out-String

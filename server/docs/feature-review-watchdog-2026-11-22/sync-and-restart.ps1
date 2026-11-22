# Sync source -> dist and restart the 8099 release instance (integration helper, ASCII only)
$ErrorActionPreference = 'Stop'
$repo = 'D:\LocalModels'
$dist = Join-Path $repo 'dist\QingYaoTP AILauncher'
$app  = Join-Path $dist 'app'
$base = 'http://127.0.0.1:8099'

Write-Output '[1/5] Stop launcher + its node child ...'
Get-Process 'QingYaoTP AILauncher' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
$nodes = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*QingYaoTP AILauncher*' }
foreach ($n in $nodes) { try { Stop-Process -Id $n.ProcessId -Force -ErrorAction SilentlyContinue } catch {} }
Start-Sleep -Seconds 2
for ($i = 0; $i -lt 30; $i++) {
  try { $null = Invoke-RestMethod ($base + '/api/state') -TimeoutSec 2; Start-Sleep -Milliseconds 500 } catch { break }
}
Write-Output '    port free (or was free)'

Write-Output '[2/5] Copy app.html / app.mjs to dist ...'
foreach ($f in @('app.html','app.mjs')) {
  Copy-Item (Join-Path $repo ('server\' + $f)) (Join-Path $app $f) -Force
  $h1 = (Get-FileHash (Join-Path $repo ('server\' + $f))).Hash
  $h2 = (Get-FileHash (Join-Path $app $f)).Hash
  if ($h1 -ne $h2) { throw ("copy hash mismatch: " + $f) }
  Write-Output ("    " + $f + "  " + $h1)
}

Write-Output '[3/5] Start release instance ...'
$exe = Join-Path $dist 'QingYaoTP AILauncher.exe'
Start-Process -FilePath $exe -WorkingDirectory $dist | Out-Null
$up = $false
for ($i = 0; $i -lt 120; $i++) {
  Start-Sleep -Milliseconds 1000
  try { $st = Invoke-RestMethod ($base + '/api/state') -TimeoutSec 5; $up = $true; break } catch {}
}
if (-not $up) { throw 'server did not come up within 120s' }
Write-Output ("    up version=" + $st.version + " loaded=" + $st.loaded)

Write-Output '[4/5] Wait for model (AUTO_LOAD 4B; load manually if needed) ...'
$token = $st.localToken
for ($i = 0; $i -lt 90; $i++) {
  try { $st = Invoke-RestMethod ($base + '/api/state') -TimeoutSec 5 } catch {}
  if ($st.loaded) { break }
  Start-Sleep -Milliseconds 2000
}
if (-not $st.loaded) {
  $body = @{ file = 'qwen3-5-4B-Q4_K_M.gguf'; contextSize = 16384 } | ConvertTo-Json
  $null = Invoke-RestMethod -Method Post -Uri ($base + '/api/load') -ContentType 'application/json' -Headers @{ 'x-local-token' = $token } -Body $body -TimeoutSec 300
  for ($i = 0; $i -lt 90; $i++) { Start-Sleep -Milliseconds 2000; try { $st = Invoke-RestMethod ($base + '/api/state') -TimeoutSec 5 } catch {}; if ($st.loaded) { break } }
}
if (-not $st.loaded) { throw 'model not loaded' }
Write-Output ("    loaded=" + $st.loaded + " context=" + $st.context)

Write-Output '[5/5] Verify source <-> dist hashes + /api/version'
$ok = $true
foreach ($f in @('app.html','app.mjs')) {
  $h1 = (Get-FileHash (Join-Path $repo ('server\' + $f))).Hash
  $h2 = (Get-FileHash (Join-Path $app $f)).Hash
  if ($h1 -ne $h2) { $ok = $false; Write-Output ("    MISMATCH " + $f) }
}
$v = Invoke-RestMethod ($base + '/api/version') -TimeoutSec 10
Write-Output ('    hash-match=' + $ok + '  version=' + $v.version)
if (-not $ok) { throw 'dist hash mismatch' }
Write-Output 'DONE'

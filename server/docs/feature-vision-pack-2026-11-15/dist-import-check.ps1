$d = 'D:\LocalModels\dist\QingYaoTP AILauncher'
$node = Join-Path $d 'runtime\node.exe'
Write-Host ('node exists: ' + (Test-Path $node) + ' -> ' + $node)
$appDir = Join-Path $d 'app'
Write-Host ('app dir: ' + $appDir + ' exists=' + (Test-Path $appDir))
$tmp = Join-Path $env:TEMP ('vp-dist-check-' + [guid]::NewGuid().ToString('N').Substring(0,6))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$env:PORT='8398'; $env:MODEL_DIR=$tmp
$so = Join-Path $tmp 'out.txt'; $se = Join-Path $tmp 'err.txt'
$p = Start-Process -FilePath $node -ArgumentList 'app.mjs' -WorkingDirectory $appDir -PassThru -WindowStyle Hidden -RedirectStandardOutput $so -RedirectStandardError $se
Write-Host ('pid ' + $p.Id)
$ok = $false
for ($i=0; $i -lt 30; $i++) { Start-Sleep -Milliseconds 700; try { $v = Invoke-RestMethod 'http://127.0.0.1:8398/api/version' -TimeoutSec 2; $ok = $true; break } catch {} }
if ($ok) { Write-Host ('IMPORT OK version=' + $v.version); $pk = Invoke-RestMethod 'http://127.0.0.1:8398/api/vision/pack' -TimeoutSec 8; Write-Host ('PACK API OK installed=' + $pk.installed + ' source=' + $pk.source + ' files=' + $pk.files) } else { Write-Host 'IMPORT FAILED' }
if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
Start-Sleep 1
Write-Host '--- out ---'; Get-Content $so -ErrorAction SilentlyContinue | Select-Object -First 8
Write-Host '--- err ---'; Get-Content $se -ErrorAction SilentlyContinue | Select-Object -First 12
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue

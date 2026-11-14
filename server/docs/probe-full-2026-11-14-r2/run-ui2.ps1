param([int]$Batch)
$base='http://127.0.0.1:8099'
$cdpUrl='http://127.0.0.1:9333'
$out='D:\LocalModels\server\docs\probe-full-2026-11-14-r2'
$shots=Join-Path $out 'shots'
$logs=Join-Path $out 'logs'
New-Item -ItemType Directory -Force -Path $shots,$logs | Out-Null
$edge='C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
$ud = Join-Path $env:TEMP ('edge-b' + $Batch + '-' + [guid]::NewGuid().ToString('N'))
$ep = Start-Process -FilePath $edge -ArgumentList @('--headless=new','--no-sandbox','--disable-gpu','--remote-debugging-port=9333','--user-data-dir=' + $ud,'--window-size=1440,900','--no-first-run','--disable-extensions','http://127.0.0.1:8099/') -PassThru -WindowStyle Hidden
$ok=$false
for ($i=0; $i -lt 80; $i++) { Start-Sleep -Milliseconds 500; try { $null=Invoke-RestMethod ($cdpUrl + '/json/version') -TimeoutSec 2; $ok=$true; break } catch {} }
if (-not $ok) { Write-Output 'CDP never came up'; try { Stop-Process -Id $ep.Id -Force } catch {}; exit 3 }
Start-Sleep -Seconds 2
$sets = @{
  1 = @(
    @{n='probe-ui-new'; a=@($cdpUrl,$shots); t=120},
    @{n='probe-start-screen'; a=@($cdpUrl,$shots); t=120},
    @{n='probe-start-flow'; a=@($cdpUrl,$shots); t=150},
    @{n='probe-menu-stacking'; a=@($cdpUrl); t=120}
  )
  2 = @(
    @{n='probe-model-add'; a=@($cdpUrl); t=120},
    @{n='probe-model-delete'; a=@($cdpUrl,$base); t=180},
    @{n='probe-status'; a=@($cdpUrl); t=120},
    @{n='probe-ui-gpu'; a=@($cdpUrl); t=120}
  )
  3 = @(
    @{n='probe-code-panel'; a=@($base,$cdpUrl); t=120},
    @{n='probe-settings-tools'; a=@($cdpUrl); t=120},
    @{n='probe-workspace-ui'; a=@($cdpUrl); t=120},
    @{n='probe-hero-modes'; a=@($cdpUrl); t=120}
  )
  4 = @(
    @{n='probe-input-extras'; a=@($cdpUrl); t=120},
    @{n='probe-formula-panel'; a=@($cdpUrl); t=120},
    @{n='probe-formula-find'; a=@($cdpUrl); t=120},
    @{n='probe-timestamps'; a=@($base,$cdpUrl); t=150}
  )
  5 = @(
    @{n='probe-small-features'; a=@($cdpUrl); t=180},
    @{n='probe-title-ui'; a=@($cdpUrl,$base,$shots); t=150},
    @{n='probe-session-jump'; a=@($cdpUrl); t=150},
    @{n='probe-session-race'; a=@($cdpUrl); t=150}
  )
  6 = @(
    @{n='probe-ctx-panel'; a=@($cdpUrl); t=180},
    @{n='probe-code-run-ui'; a=@($cdpUrl,$shots); t=150},
    @{n='probe-ui-version'; a=@($cdpUrl,$base); t=120},
    @{n='probe-ui-rag'; a=@($cdpUrl,$base,$shots); t=150}
  )
  7 = @(
    @{n='probe-ui-tools'; a=@($cdpUrl,$base,$shots); t=240},
    @{n='probe-ui-web'; a=@($cdpUrl,$base,$shots); t=240},
    @{n='probe-ui-debug'; a=@($cdpUrl,$base); t=150},
    @{n='probe-download-ui'; a=@($cdpUrl,$base); t=150}
  )
  8 = @(
    @{n='probe-ui-backup'; a=@($cdpUrl,$base,$shots); t=150},
    @{n='probe-sidebar-search'; a=@($cdpUrl,$base); t=150},
    @{n='probe-auto-title'; a=@($cdpUrl,$shots); t=200},
    @{n='probe-context-switch'; a=@($cdpUrl); t=200}
  )
  9 = @(
    @{n='probe-ui-preload'; a=@($cdpUrl,$base,$shots); t=240},
    @{n='probe-ui-vision'; a=@($cdpUrl,$base,$shots); t=200},
    @{n='probe-ui-sessions'; a=@($cdpUrl,$base); t=180}
  )
}
$probes = $sets[$Batch]
if (-not $probes) { Write-Output ('no batch ' + $Batch); try { Stop-Process -Id $ep.Id -Force } catch {}; exit 2 }
Write-Output ('=== batch ' + $Batch + ' (' + $probes.Count + ') ' + (Get-Date -Format 'HH:mm:ss') + ' ===')
foreach ($p in $probes) {
  $o=Join-Path $logs ($p.n + '.out.txt'); $e=Join-Path $logs ($p.n + '.err.txt')
  Remove-Item $o,$e -Force -ErrorAction SilentlyContinue
  $t0=Get-Date
  $proc=Start-Process -FilePath 'node' -ArgumentList (@(($p.n + '.mjs')) + @($p.a)) -WorkingDirectory 'D:\LocalModels\server' -RedirectStandardOutput $o -RedirectStandardError $e -PassThru -WindowStyle Hidden
  $to=$false
  try { $proc | Wait-Process -Timeout $p.t -ErrorAction Stop } catch { $to=$true; try { Stop-Process -Id $proc.Id -Force } catch {} }
  $secs=[math]::Round(((Get-Date)-$t0).TotalSeconds,1)
  $res=''
  if (Test-Path $o) { $hit=@(Get-Content $o -Encoding utf8 | Where-Object { $_ -match '结果:|RESULT' } | Select-Object -Last 1); if ($hit.Count -gt 0 -and $hit[0]) { $res=[string]$hit[0] } }
  $flag = if ($to) { 'TIMEOUT' } elseif ($proc.ExitCode -eq 0) { 'PASS' } else { 'FAIL(exit ' + $proc.ExitCode + ')' }
  ('{0,-24} {1,-14} {2,6}s {3}' -f $p.n, $flag, $secs, $res.Trim()) | Tee-Object -Append (Join-Path $out ('batch' + $Batch + '.txt'))
}
try { Stop-Process -Id $ep.Id -Force } catch {}
Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -like ('*' + $ud + '*') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
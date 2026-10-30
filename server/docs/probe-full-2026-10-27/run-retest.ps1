
$ErrorActionPreference = 'Continue'
$root = 'D:\LocalModels\server'
$base = 'http://127.0.0.1:8099'
$cdp  = 'http://127.0.0.1:9333'
$out  = 'D:\LocalModels\server\docs\probe-full-2026-10-27'
$shots = Join-Path $out 'shots'
$logs = Join-Path $out 'logs2'
New-Item -ItemType Directory -Force -Path $shots, $logs | Out-Null
$summary = Join-Path $out 'summary-retest.txt'
if (Test-Path $summary) { Remove-Item $summary -Force }

$probes = @(
  @{n='probe-backup';        a=@($base);          t=180},
  @{n='probe-ui-backup';     a=@($cdp,$base,$shots); t=180},
  @{n='probe-start-screen';  a=@($cdp,$shots);    t=150},
  @{n='probe-model-add';     a=@($cdp);           t=150},
  @{n='probe-menu-stacking'; a=@($cdp);           t=150},
  @{n='probe-hero-modes';    a=@($cdp);           t=150},
  @{n='probe-formula-find';  a=@($cdp);           t=150},
  @{n='probe-small-features';a=@($cdp);           t=200},
  @{n='probe-title-ui';      a=@($cdp,$base,$shots); t=150},
  @{n='probe-ui-tools';      a=@($cdp,$base,$shots); t=300},
  @{n='probe-ui-web';        a=@($cdp,$base,$shots); t=300},
  @{n='probe-ui-preload';    a=@($cdp,$base,$shots); t=300},
  @{n='probe-preload';       a=@($base);          t=360},
  @{n='probe-code-run';      a=@($base);          t=180}
)

"# retest $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" | Out-File -Encoding utf8 $summary
foreach ($p in $probes) {
  $name = $p.n
  $o = Join-Path $logs ($name + '.out.txt'); $e = Join-Path $logs ($name + '.err.txt')
  Remove-Item $o, $e -Force -ErrorAction SilentlyContinue
  $t0 = Get-Date
  $argLine = @(($name + '.mjs')) + @($p.a)
  $proc = Start-Process -FilePath 'node' -ArgumentList $argLine -WorkingDirectory $root -RedirectStandardOutput $o -RedirectStandardError $e -PassThru -WindowStyle Hidden
  $timedOut = $false
  try { $proc | Wait-Process -Timeout $p.t -ErrorAction Stop } catch { $timedOut = $true; try { Stop-Process -Id $proc.Id -Force -ErrorAction Stop } catch {} }
  $secs = [math]::Round(((Get-Date) - $t0).TotalSeconds, 1)
  $code = '?'; try { $proc.Refresh(); $code = $proc.ExitCode } catch {}
  $res = ''
  if (Test-Path $o) { $res = (Get-Content $o -Encoding utf8 | Where-Object { $_ -match '结果:|RESULT' } | Select-Object -Last 1) }
  $fails = 0
  if (Test-Path $o) { $fails = (Get-Content $o -Encoding utf8 | Select-String -Pattern ('FAIL|' + [char]0x274C) | Measure-Object).Count }
  $flag = if ($timedOut) { 'TIMEOUT' } elseif ($code -eq 0) { 'PASS' } else { 'FAIL(exit ' + $code + ')' }
  $line = '{0,-24} {1,-16} {2,6}s  fails={3}  {4}' -f $name, $flag, $secs, $fails, $res.Trim()
  $line | Out-File -Append -Encoding utf8 $summary
  Write-Host $line
  try { $null = Invoke-RestMethod ($base + '/api/state') -TimeoutSec 5 } catch { '  [driver] server down!' | Out-File -Append -Encoding utf8 $summary }
}
"# done $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" | Out-File -Append -Encoding utf8 $summary
Write-Host 'RETEST DONE'


param([string]$Out = 'D:\LocalModels\server\docs\probe-full-2026-10-27')
$ErrorActionPreference = 'Continue'
$root = 'D:\LocalModels\server'
$base = 'http://127.0.0.1:8099'
$cdp  = 'http://127.0.0.1:9333'
$shots = Join-Path $Out 'shots'
$logs  = Join-Path $Out 'logs'
New-Item -ItemType Directory -Force -Path $shots, $logs | Out-Null
$summary = Join-Path $Out 'summary.txt'
if (Test-Path $summary) { Remove-Item $summary -Force }

$M7 = 'qwen2.5-7b-instruct-1m-q4_k_m.gguf'
$probes = @(
  @{n='probe-sessions';       a=@($base);                     t=120; g='A-api'},
  @{n='probe-workspace-api';  a=@($base);                     t=120; g='A-api'},
  @{n='probe-code-run';       a=@($base);                     t=150; g='A-api'},
  @{n='probe-ui-metric';      a=@('8099');                    t=60;  g='A-api'},
  @{n='probe-func';           a=@('8099');                    t=240; g='A-model'},
  @{n='probe-ui-new';         a=@($cdp,$shots);               t=150; g='B-ui'},
  @{n='probe-start-screen';   a=@($cdp,$shots);               t=150; g='B-ui'},
  @{n='probe-start-flow';     a=@($cdp,$shots);               t=150; g='B-ui'},
  @{n='probe-model-add';      a=@($cdp);                      t=150; g='B-ui'},
  @{n='probe-menu-stacking';  a=@($cdp);                      t=150; g='B-ui'},
  @{n='probe-status';         a=@($cdp);                      t=150; g='B-ui'},
  @{n='probe-code-panel';     a=@($cdp);                      t=150; g='B-ui'},
  @{n='probe-settings-tools'; a=@($cdp);                      t=150; g='B-ui'},
  @{n='probe-workspace-ui';   a=@($cdp);                      t=150; g='B-ui'},
  @{n='probe-hero-modes';     a=@($cdp);                      t=150; g='B-ui'},
  @{n='probe-input-extras';   a=@($cdp);                      t=150; g='B-ui'},
  @{n='probe-formula-panel';  a=@($cdp);                      t=150; g='B-ui'},
  @{n='probe-formula-find';   a=@($cdp);                      t=150; g='B-ui'},
  @{n='probe-timestamps';     a=@($cdp);                      t=180; g='C-ui-chat'},
  @{n='probe-small-features'; a=@($cdp);                      t=200; g='C-ui-chat'},
  @{n='probe-title-ui';       a=@($cdp,$shots);               t=180; g='C-ui-chat'},
  @{n='probe-session-jump';   a=@($cdp);                      t=180; g='C-ui-chat'},
  @{n='probe-session-race';   a=@($cdp);                      t=200; g='C-ui-chat'},
  @{n='probe-ctx-panel';      a=@($cdp);                      t=200; g='C-ui-chat'},
  @{n='probe-code-run-ui';    a=@($cdp);                      t=180; g='C-ui-chat'},
  @{n='probe-ui-tools';       a=@($cdp,$base,$shots);         t=300; g='C-ui-chat'},
  @{n='probe-ui-web';         a=@($cdp,$base,$shots);         t=300; g='C-ui-chat'},
  @{n='probe-ui-sessions';    a=@($cdp,$base);                t=200; g='C-ui-chat'},
  @{n='probe-auto-title';     a=@($cdp,$shots);               t=240; g='C-ui-chat'},
  @{n='probe-chat-plain';     a=@($base);                     t=240; g='D-model'},
  @{n='probe-tools-agent';    a=@($base,$M7);                 t=360; g='D-model'},
  @{n='probe-web-tools';      a=@($base,$M7);                 t=360; g='D-model'},
  @{n='probe-kv-long';        a=@('8099');                    t=360; g='D-model'},
  @{n='probe-context-switch'; a=@($cdp);                      t=300; g='E-switch'},
  @{n='probe-ui-preload';     a=@($cdp,$base,$shots);         t=300; g='E-switch'},
  @{n='probe-preload';        a=@($base);                     t=360; g='E-switch'},
  @{n='probe-second-opinion'; a=@($base);                     t=420; g='E-switch'}
)

function Get-Health {
  try { $null = Invoke-RestMethod ($base + '/api/state') -TimeoutSec 5; return $true } catch { return $false }
}
function Restart-Server {
  "  [driver] server down, restarting..." | Out-File -Append -Encoding utf8 $summary
  Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*node*' } | Out-Null
  Start-Process -FilePath 'node' -ArgumentList 'app.mjs' -WorkingDirectory $root -WindowStyle Hidden
  for ($i=0; $i -lt 30; $i++) { Start-Sleep -Seconds 2; if (Get-Health) { "  [driver] server back after $((($i+1)*2))s" | Out-File -Append -Encoding utf8 $summary; return $true } }
  "  [driver] server did NOT come back" | Out-File -Append -Encoding utf8 $summary
  return $false
}

"# probe run $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" | Out-File -Encoding utf8 $summary
foreach ($p in $probes) {
  $name = $p.n; $argsList = @($p.a)
  $o = Join-Path $logs ($name + '.out.txt'); $e = Join-Path $logs ($name + '.err.txt')
  if (Test-Path $o) { Remove-Item $o -Force }; if (Test-Path $e) { Remove-Item $e -Force }
  $t0 = Get-Date
  $argLine = @(($name + '.mjs')) + $argsList
  $proc = Start-Process -FilePath 'node' -ArgumentList $argLine -WorkingDirectory $root -RedirectStandardOutput $o -RedirectStandardError $e -PassThru -WindowStyle Hidden
  $timedOut = $false
  try { $proc | Wait-Process -Timeout $p.t -ErrorAction Stop } catch { $timedOut = $true; try { Stop-Process -Id $proc.Id -Force -ErrorAction Stop } catch {}; try { $proc.WaitForExit(5000) | Out-Null } catch {} }
  $secs = [math]::Round(((Get-Date) - $t0).TotalSeconds, 1)
  $code = '?'
  try { $proc.Refresh(); $code = $proc.ExitCode } catch {}
  $res = ''
  if (Test-Path $o) { $res = (Get-Content $o -Encoding utf8 | Where-Object { $_ -match '== 结果:' } | Select-Object -Last 1) }
  if (-not $res) { $res = (Get-Content $o -Encoding utf8 -ErrorAction SilentlyContinue | Select-Object -Last 2) -join ' / ' }
  $flag = if ($timedOut) { 'TIMEOUT' } elseif ($code -eq 0) { 'PASS' } else { 'FAIL(exit ' + $code + ')' }
  $line = '{0,-24} {1,-16} {2,6}s  {3}' -f $name, $flag, $secs, $res.Trim()
  $line | Out-File -Append -Encoding utf8 $summary
  Write-Host $line
  if (-not (Get-Health)) { Restart-Server | Out-Null }
}
"# done $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" | Out-File -Append -Encoding utf8 $summary
Write-Host 'ALL DONE'

param([int]$Batch)
$base='http://127.0.0.1:8099'
$cdp='http://127.0.0.1:9333'
$out='D:\LocalModels\server\docs\probe-full-2026-11-14-r2'
$shots=Join-Path $out 'shots'
$logs=Join-Path $out 'logs'
New-Item -ItemType Directory -Force -Path $shots,$logs | Out-Null
$sets = @{
  1 = @(
    @{n='probe-ui-gpu'; a=@($cdp); t=180},
    @{n='probe-ui-new'; a=@($cdp,$shots); t=150},
    @{n='probe-start-screen'; a=@($cdp,$shots); t=150},
    @{n='probe-start-flow'; a=@($cdp,$shots); t=180},
    @{n='probe-model-add'; a=@($cdp); t=150},
    @{n='probe-model-delete'; a=@($cdp,$base); t=200},
    @{n='probe-menu-stacking'; a=@($cdp); t=150},
    @{n='probe-status'; a=@($cdp); t=150}
  )
  2 = @(
    @{n='probe-code-panel'; a=@($base,$cdp); t=150},
    @{n='probe-settings-tools'; a=@($cdp); t=150},
    @{n='probe-workspace-ui'; a=@($cdp); t=150},
    @{n='probe-hero-modes'; a=@($cdp); t=150},
    @{n='probe-input-extras'; a=@($cdp); t=150},
    @{n='probe-formula-panel'; a=@($cdp); t=150},
    @{n='probe-formula-find'; a=@($cdp); t=150},
    @{n='probe-timestamps'; a=@($base,$cdp); t=180}
  )
  3 = @(
    @{n='probe-small-features'; a=@($cdp); t=220},
    @{n='probe-title-ui'; a=@($cdp,$base,$shots); t=180},
    @{n='probe-session-jump'; a=@($cdp); t=180},
    @{n='probe-session-race'; a=@($cdp); t=200},
    @{n='probe-ctx-panel'; a=@($cdp); t=220},
    @{n='probe-code-run-ui'; a=@($cdp,$shots); t=180},
    @{n='probe-ui-tools'; a=@($cdp,$base,$shots); t=300},
    @{n='probe-ui-web'; a=@($cdp,$base,$shots); t=300}
  )
  4 = @(
    @{n='probe-ui-rag'; a=@($cdp,$base,$shots); t=150},
    @{n='probe-ui-version'; a=@($cdp,$base); t=150},
    @{n='probe-ui-debug'; a=@($cdp,$base); t=200},
    @{n='probe-download-ui'; a=@($cdp,$base); t=200},
    @{n='probe-ui-backup'; a=@($cdp,$base,$shots); t=200},
    @{n='probe-sidebar-search'; a=@($cdp,$base); t=180},
    @{n='probe-auto-title'; a=@($cdp,$shots); t=240}
  )
  5 = @(
    @{n='probe-ui-sessions'; a=@($cdp,$base); t=200},
    @{n='probe-context-switch'; a=@($cdp); t=300},
    @{n='probe-ui-preload'; a=@($cdp,$base,$shots); t=300},
    @{n='probe-ui-vision'; a=@($cdp,$base,$shots); t=240}
  )
}
$probes = $sets[$Batch]
if (-not $probes) { Write-Output ('no such batch: ' + $Batch); exit 2 }
Write-Output ('=== batch ' + $Batch + ' (' + $probes.Count + ' probes) ' + (Get-Date -Format 'HH:mm:ss') + ' ===')
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
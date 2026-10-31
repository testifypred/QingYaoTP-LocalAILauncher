
$base='http://127.0.0.1:8099'
$cdp='http://127.0.0.1:9333'
$out='D:\LocalModels\server\docs\probe-full-2026-10-31'
$shots=Join-Path $out 'shots'
$logs=Join-Path $out 'logs'
New-Item -ItemType Directory -Force -Path $shots, $logs | Out-Null
$summary=Join-Path $out 'summary.txt'
Remove-Item $summary -Force -ErrorAction SilentlyContinue
$M='qwen2.5-7b-instruct-1m-q4_k_m.gguf'

# 有一批界面/接口探针默认「模型已加载」（hero-modes / start-flow / status / ctx-panel /
# small-features / session-jump / ui-tools / ui-web / auto-title / chat-plain）。
# 10-31 那次没加载，它们全红——所以驱动自己先把模型装上，别指望环境。
"# 预加载 $M" | Out-File -Append -Encoding utf8 $summary
try {
  $body = @{ file = $M; contextSize = 16384 } | ConvertTo-Json
  $null = Invoke-RestMethod -Method Post -Uri ($base + '/api/load') -ContentType 'application/json' -Body $body -TimeoutSec 300
  for ($i = 0; $i -lt 90; $i++) {
    $st = Invoke-RestMethod ($base + '/api/state') -TimeoutSec 5
    if ($st.loaded) { break }
    Start-Sleep -Seconds 2
  }
  ('  已加载: ' + (Invoke-RestMethod ($base + '/api/state') -TimeoutSec 5).loaded) | Tee-Object -Append -FilePath $summary
} catch {
  ('  预加载失败（后面的界面探针会因此变红）: ' + $_) | Tee-Object -Append -FilePath $summary
}

$probes=@(
  @{n='probe-sessions'; a=@($base); t=120},
  @{n='probe-workspace-api'; a=@($base); t=120},
  @{n='probe-code-run'; a=@($base); t=180},
  @{n='probe-ui-metric'; a=@('8099'); t=60},
  @{n='probe-backup'; a=@($base); t=200},
  @{n='probe-rag'; a=@($base); t=200},
  @{n='probe-plugins'; a=@($base); t=120},
  @{n='probe-version'; a=@($base); t=90},
  @{n='probe-func'; a=@('8099'); t=240},
  @{n='probe-ui-new'; a=@($cdp,$shots); t=150},
  @{n='probe-start-screen'; a=@($cdp,$shots); t=150},
  @{n='probe-start-flow'; a=@($cdp,$shots); t=180},
  @{n='probe-model-add'; a=@($cdp); t=150},
  @{n='probe-menu-stacking'; a=@($cdp); t=150},
  @{n='probe-status'; a=@($cdp); t=150},
  @{n='probe-code-panel'; a=@($cdp); t=150},
  @{n='probe-settings-tools'; a=@($cdp); t=150},
  @{n='probe-workspace-ui'; a=@($cdp); t=150},
  @{n='probe-hero-modes'; a=@($cdp); t=150},
  @{n='probe-input-extras'; a=@($cdp); t=150},
  @{n='probe-formula-panel'; a=@($cdp); t=150},
  @{n='probe-formula-find'; a=@($cdp); t=150},
  @{n='probe-timestamps'; a=@($cdp); t=180},
  @{n='probe-small-features'; a=@($cdp); t=220},
  @{n='probe-title-ui'; a=@($cdp,$base,$shots); t=180},
  @{n='probe-session-jump'; a=@($cdp); t=180},
  @{n='probe-session-race'; a=@($cdp); t=200},
  @{n='probe-ctx-panel'; a=@($cdp); t=220},
  @{n='probe-code-run-ui'; a=@($cdp,$shots); t=180},
  @{n='probe-ui-tools'; a=@($cdp,$base,$shots); t=300},
  @{n='probe-ui-web'; a=@($cdp,$base,$shots); t=300},
  @{n='probe-ui-rag'; a=@($cdp,$base,$shots); t=150},
  @{n='probe-ui-version'; a=@($cdp,$base); t=150},
  @{n='probe-ui-backup'; a=@($cdp,$base,$shots); t=200},
  @{n='probe-sidebar-search'; a=@($cdp,$base); t=180},
  @{n='probe-auto-title'; a=@($cdp,$shots); t=240},
  @{n='probe-ui-sessions'; a=@($cdp,$base); t=200},
  @{n='probe-chat-plain'; a=@($base); t=240},
  @{n='probe-tools-agent'; a=@($base,$M); t=360},
  @{n='probe-web-tools'; a=@($base,$M); t=360},
  @{n='probe-kv-long'; a=@('8099'); t=360},
  @{n='probe-context-switch'; a=@($cdp); t=300},
  @{n='probe-ui-preload'; a=@($cdp,$base,$shots); t=300},
  @{n='probe-preload'; a=@($base); t=360},
  @{n='probe-second-opinion'; a=@($base); t=420}
)
"# full suite $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  ($($probes.Count) probes)" | Out-File -Encoding utf8 $summary
foreach ($p in $probes) {
  $o=Join-Path $logs ($p.n + '.out.txt'); $e=Join-Path $logs ($p.n + '.err.txt')
  Remove-Item $o, $e -Force -ErrorAction SilentlyContinue
  $t0=Get-Date
  $proc=Start-Process -FilePath 'node' -ArgumentList (@(($p.n + '.mjs')) + @($p.a)) -WorkingDirectory 'D:\LocalModels\server' -RedirectStandardOutput $o -RedirectStandardError $e -PassThru -WindowStyle Hidden
  $to=$false
  try { $proc | Wait-Process -Timeout $p.t -ErrorAction Stop } catch { $to=$true; try { Stop-Process -Id $proc.Id -Force } catch {} }
  $secs=[math]::Round(((Get-Date)-$t0).TotalSeconds,1)
  # 探针没打出结果行时 $res 会是 $null，之前的 .Trim() 会抛「不能对 Null 值表达式调用方法」
  $res = ''
  if (Test-Path $o) {
    $hit = @(Get-Content $o -Encoding utf8 | Where-Object { $_ -match '结果:|RESULT' } | Select-Object -Last 1)
    if ($hit.Count -gt 0 -and $hit[0]) { $res = [string]$hit[0] }
  }
  $fails = if (Test-Path $o) { (Get-Content $o -Encoding utf8 | Select-String -Pattern ('FAIL|' + [char]0x274C) | Measure-Object).Count } else { '?' }
  $flag = if ($to) { 'TIMEOUT' } elseif ($proc.ExitCode -eq 0) { 'PASS' } else { 'FAIL(exit ' + $proc.ExitCode + ')' }
  ('{0,-24} {1,-14} {2,6}s fails={3} {4}' -f $p.n, $flag, $secs, $fails, $res.Trim()) | Tee-Object -Append -FilePath $summary
  try { $null = Invoke-RestMethod ($base + '/api/state') -TimeoutSec 5 } catch { '  [driver] SERVER DOWN after ' + $p.n | Tee-Object -Append -FilePath $summary }
}
"# done $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" | Out-File -Append -Encoding utf8 $summary
'FULL SUITE DONE'

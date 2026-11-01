
$base='http://127.0.0.1:8099'
$cdp='http://127.0.0.1:9333'
$out='D:\LocalModels\server\docs\probe-full-2026-11-01'
$shots=Join-Path $out 'shots'
$logs=Join-Path $out 'logs'
New-Item -ItemType Directory -Force -Path $shots, $logs | Out-Null
$summary=Join-Path $out 'summary.txt'
Remove-Item $summary -Force -ErrorAction SilentlyContinue
$M='qwen2.5-7b-instruct-1m-q4_k_m.gguf'

# 有两件事不能让环境背锅，驱动自己负责：
#  1) 一批探针默认「模型已加载」（hero-modes / start-flow / status / ctx-panel / small-features /
#     session-jump / ui-tools / ui-web / auto-title / chat-plain），开跑前先装模型；
#  2) Vulkan 后端在「生成中途断开」时可能 device lost 直接退出进程（已知问题 2）。裸跑 node
#     没有启动器兜底，所以探针之间发现服务没了就拉起来、再把模型装回去。
$restarts = 0

function Test-Server {
  try { $null = Invoke-RestMethod ($base + '/api/state') -TimeoutSec 5; return $true } catch { return $false }
}

function Start-Server {
  $script:restarts++
  $so = Join-Path $out ('server-restart-' + $script:restarts + '.out.txt')
  $se = Join-Path $out ('server-restart-' + $script:restarts + '.err.txt')
  $null = Start-Process -FilePath 'node' -ArgumentList 'app.mjs' -WorkingDirectory 'D:\LocalModels\server' -PassThru -WindowStyle Hidden -RedirectStandardOutput $so -RedirectStandardError $se
  for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Milliseconds 1000
    if (Test-Server) { return $true }
  }
  return $false
}

function Load-Model {
  try {
    $body = @{ file = $M; contextSize = 16384 } | ConvertTo-Json
    $null = Invoke-RestMethod -Method Post -Uri ($base + '/api/load') -ContentType 'application/json' -Body $body -TimeoutSec 300
    for ($i = 0; $i -lt 90; $i++) {
      $st = Invoke-RestMethod ($base + '/api/state') -TimeoutSec 5
      if ($st.loaded) { return $true }
      Start-Sleep -Seconds 2
    }
  } catch { }
  return $false
}

function Ensure-Server {
  if (Test-Server) { return }
  '  [driver] 服务已退出（多半是 Vulkan device lost），尝试拉起 …' | Tee-Object -Append -FilePath $summary
  if (Start-Server) {
    ('  [driver] 服务已起来，重新预加载 ' + $M) | Tee-Object -Append -FilePath $summary
    if (Load-Model) { '  [driver] 模型已就绪' | Tee-Object -Append -FilePath $summary }
    else { '  [driver] 模型没装回来，后面的界面探针可能变红' | Tee-Object -Append -FilePath $summary }
  } else {
    '  [driver] 拉不起来，后面的探针会全红' | Tee-Object -Append -FilePath $summary
  }
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
  @{n='probe-debug'; a=@($base); t=150},
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
  @{n='probe-ui-debug'; a=@($cdp,$base); t=200},
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
"# 预加载 $M" | Out-File -Append -Encoding utf8 $summary
if (Load-Model) { ('  已加载: ' + $M) | Tee-Object -Append -FilePath $summary }
else { '  预加载失败（后面的界面探针会因此变红）' | Tee-Object -Append -FilePath $summary }
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
  Ensure-Server
}
"# done $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" | Out-File -Append -Encoding utf8 $summary
'FULL SUITE DONE'

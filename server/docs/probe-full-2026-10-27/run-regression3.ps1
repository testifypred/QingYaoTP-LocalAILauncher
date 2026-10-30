
$base='http://127.0.0.1:8099'
$cdp='http://127.0.0.1:9333'
$shots='D:\LocalModels\server\docs\probe-full-2026-10-27\shots'
$logs='D:\LocalModels\server\docs\probe-full-2026-10-27\logs7'
New-Item -ItemType Directory -Force -Path $logs | Out-Null
$out=Join-Path $logs 'summary.txt'
Remove-Item $out -Force -ErrorAction SilentlyContinue
$probes=@(
  @{n='probe-start-flow'; a=@($cdp,$shots); t=180},
  @{n='probe-settings-tools'; a=@($cdp); t=150},
  @{n='probe-small-features'; a=@($cdp); t=220},
  @{n='probe-input-extras'; a=@($cdp); t=150},
  @{n='probe-title-ui'; a=@($cdp,$base,$shots); t=180},
  @{n='probe-ctx-panel'; a=@($cdp); t=220},
  @{n='probe-tools-agent'; a=@($base,'qwen2.5-7b-instruct-1m-q4_k_m.gguf'); t=360},
  @{n='probe-chat-plain'; a=@($base); t=240}
)
foreach ($p in $probes) {
  $o=Join-Path $logs ($p.n + '.out.txt')
  Remove-Item $o -Force -ErrorAction SilentlyContinue
  $proc=Start-Process -FilePath 'node' -ArgumentList (@(($p.n + '.mjs')) + @($p.a)) -WorkingDirectory 'D:\LocalModels\server' -RedirectStandardOutput $o -RedirectStandardError (Join-Path $logs ($p.n + '.err.txt')) -PassThru -WindowStyle Hidden
  $to=$false
  try { $proc | Wait-Process -Timeout $p.t -ErrorAction Stop } catch { $to=$true; try { Stop-Process -Id $proc.Id -Force } catch {} }
  $res = if (Test-Path $o) { (Get-Content $o -Encoding utf8 | Where-Object { $_ -match '结果:|RESULT' } | Select-Object -Last 1) } else { '' }
  $fails = if (Test-Path $o) { (Get-Content $o -Encoding utf8 | Select-String -Pattern ('FAIL|' + [char]0x274C) | Measure-Object).Count } else { '?' }
  $flag = if ($to) { 'TIMEOUT' } else { 'exit=' + $proc.ExitCode }
  ('{0,-22} {1} fails={2} {3}' -f $p.n, $flag, $fails, $res.Trim()) | Tee-Object -Append -FilePath $out
}
'REGRESSION2 DONE'


$base='http://127.0.0.1:8099'
$cdp='http://127.0.0.1:9333'
$shots='D:\LocalModels\server\docs\probe-full-2026-10-27\shots'
$logs='D:\LocalModels\server\docs\probe-full-2026-10-27\logs4'
New-Item -ItemType Directory -Force -Path $logs | Out-Null
$out=Join-Path $logs 'summary.txt'
Remove-Item $out -Force -ErrorAction SilentlyContinue
$probes=@(
  @{n='probe-backup'; a=@($base); t=180},
  @{n='probe-ui-backup'; a=@($cdp,$base,$shots); t=180},
  @{n='probe-ui-preload'; a=@($cdp,$base,$shots); t=240}
)
foreach ($p in $probes) {
  $o=Join-Path $logs ($p.n + '.out.txt')
  Remove-Item $o -Force -ErrorAction SilentlyContinue
  $t0=Get-Date
  $proc=Start-Process -FilePath 'node' -ArgumentList (@(($p.n + '.mjs')) + @($p.a)) -WorkingDirectory 'D:\LocalModels\server' -RedirectStandardOutput $o -RedirectStandardError (Join-Path $logs ($p.n + '.err.txt')) -PassThru -WindowStyle Hidden
  $to=$false
  try { $proc | Wait-Process -Timeout $p.t -ErrorAction Stop } catch { $to=$true; try { Stop-Process -Id $proc.Id -Force } catch {} }
  $res = if (Test-Path $o) { (Get-Content $o -Encoding utf8 | Where-Object { $_ -match '结果:' } | Select-Object -Last 1) } else { '' }
  $fails = if (Test-Path $o) { (Get-Content $o -Encoding utf8 | Select-String -Pattern ('FAIL|' + [char]0x274C) | Measure-Object).Count } else { '?' }
  $s=[math]::Round(((Get-Date)-$t0).TotalSeconds,1)
  $flag = if ($to) { 'TIMEOUT' } else { 'exit=' + $proc.ExitCode }
  ('{0,-20} {1} {2,6}s fails={3} {4}' -f $p.n, $flag, $s, $fails, $res.Trim()) | Tee-Object -Append -FilePath $out
}
'PROBES DONE'

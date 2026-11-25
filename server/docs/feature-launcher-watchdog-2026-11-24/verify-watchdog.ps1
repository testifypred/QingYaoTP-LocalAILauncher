# Launcher /health watchdog end-to-end probe (ASCII only; PS 5.1)
$ErrorActionPreference = 'Stop'
$root = 'D:\LocalModels\tmp-watchdog-2026-11-24\test-instance'
$exe  = Join-Path $root 'QingYaoTP AILauncher.exe'
$log  = Join-Path $root 'logs\launcher.log'
$base = 'http://127.0.0.1:8399'
$script:fail = 0
function Check([bool]$cond, [string]$name) { if ($cond) { Write-Host ('PASS  ' + $name) } else { Write-Host ('FAIL  ' + $name); $script:fail++ } }
function HealthOk { try { $r = Invoke-RestMethod -Uri ($base + '/health') -TimeoutSec 2; return ($r.status -eq 'ok') } catch { return $false } }
function WaitHealth([int]$sec) { $t0 = Get-Date; while (((Get-Date) - $t0).TotalSeconds -lt $sec) { if (HealthOk) { return $true }; Start-Sleep -Milliseconds 300 }; return (HealthOk) }
function NodePid { $p = Join-Path $root 'app\server.pid'; if (Test-Path $p) { try { return [int]((Get-Content $p -Raw).Trim()) } catch { return 0 } }; return 0 }
function LogText { if (Test-Path $log) { try { return (Get-Content $log -Raw -Encoding UTF8) } catch { return '' } } else { return '' } }
function NodeAlive([int]$npid) { if ($npid -le 0) { return $false }; try { Get-Process -Id $npid -ErrorAction Stop | Out-Null; return $true } catch { return $false } }
function TestNodes { return @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.ExecutablePath -eq (Join-Path $root 'runtime\node.exe') }) }

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class WdNative {
  [DllImport("kernel32.dll")] public static extern IntPtr OpenProcess(int access, bool inherit, int pid);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
  [DllImport("ntdll.dll")] public static extern int NtSuspendProcess(IntPtr h);
}
"@

# ---- pre-clean leftovers ----
foreach ($n in @(TestNodes)) { Stop-Process -Id $n.ProcessId -Force -ErrorAction SilentlyContinue }
Get-CimInstance Win32_Process -Filter "Name='QingYaoTP AILauncher.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.ExecutablePath -eq $exe } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Milliseconds 500
Remove-Item (Join-Path $root 'app\server.pid') -ErrorAction SilentlyContinue
Remove-Item (Join-Path $root 'logs\*') -Force -ErrorAction SilentlyContinue
@('port=8399','modelDir=','autoLoad=','contextSize=4096','kvReuse=1','gpu=cpu') |
  Set-Content -Path (Join-Path $root 'config.ini') -Encoding ASCII

# ---- S: fake app works standalone ----
$env:PORT = '8399'
$fake = Start-Process -FilePath (Join-Path $root 'runtime\node.exe') -ArgumentList (Join-Path $root 'app\app.mjs') -WorkingDirectory (Join-Path $root 'app') -PassThru
Check (WaitHealth 20) 'S1 fake app standalone /health'
Stop-Process -Id $fake.Id -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 600
Remove-Item (Join-Path $root 'app\server.pid') -ErrorAction SilentlyContinue

$env:LOCALAI_LAUNCHER_INSTANCE = 'probe-watchdog'
$env:LOCALAI_WATCHDOG_STALL_MS = '6000'
$env:LOCALAI_WATCHDOG_INTERVAL_MS = '1000'
$env:LOCALAI_WATCHDOG_TIMEOUT_MS = '800'

# ---- A: normal run, no false restart ----
$l1 = Start-Process -FilePath $exe -ArgumentList '--start-hidden' -WorkingDirectory $root -PassThru
Check (WaitHealth 40) 'A1 service health after launcher start'
Start-Sleep -Seconds 2
$nodePid1 = NodePid
Check ($nodePid1 -gt 0) ('A2 node pid file (' + $nodePid1 + ')')
$st = Start-Process -FilePath $exe -ArgumentList '--status' -WorkingDirectory $root -Wait -PassThru
Check ($st.ExitCode -eq 0) ('A3 --status exit 0 (got ' + $st.ExitCode + ')')
Start-Sleep -Seconds 20
Check (HealthOk) 'A4 healthy after grace window'
Check ((NodePid) -eq $nodePid1) 'A5 no false restart (pid unchanged)'
Check (-not ((LogText) -match 'watchdog\] restart reason=')) 'A6 no restart in launcher.log'

# ---- B: suspend node = native-layer hang, expect watchdog kill+restart ----
$h = [WdNative]::OpenProcess(0x0800, $false, $nodePid1)
Check ($h -ne [IntPtr]::Zero) 'B0 OpenProcess(PROCESS_SUSPEND_RESUME)'
[void][WdNative]::NtSuspendProcess($h)
[void][WdNative]::CloseHandle($h)
Start-Sleep -Milliseconds 500
Check (-not (HealthOk)) 'B0b health times out while suspended'
$t0 = Get-Date; $newPid = 0
while (((Get-Date) - $t0).TotalSeconds -lt 90) {
  $cand = NodePid
  if ($cand -gt 0 -and $cand -ne $nodePid1 -and (HealthOk)) { $newPid = $cand; break }
  Start-Sleep -Milliseconds 500
}
Check ($newPid -gt 0) ('B1 watchdog restarted node (old=' + $nodePid1 + ' new=' + $newPid + ')')
Check (-not (NodeAlive $nodePid1)) 'B2 old node process gone'
if ($newPid -gt 0) { Check (HealthOk) 'B3 health ok after restart' } else { Check $false 'B3 health ok after restart' }
$lg = LogText
Check ($lg -match 'watchdog\] restart reason=stalled') 'B4 log restart reason=stalled'
Check ($lg -match ('watchdog\] restarted pid=' + $newPid)) 'B5 log restarted with new pid'

# ---- C: user stop must NOT be resurrected ----
$st = Start-Process -FilePath $exe -ArgumentList '--stop' -WorkingDirectory $root -Wait -PassThru
Check ($st.ExitCode -eq 0) ('C1 --stop exit 0 (got ' + $st.ExitCode + ')')
$t0 = Get-Date; while (((Get-Date) - $t0).TotalSeconds -lt 15 -and (NodeAlive $newPid)) { Start-Sleep -Milliseconds 500 }
Check (-not (NodeAlive $newPid)) 'C2 node exited after --stop'
Start-Sleep -Seconds 15
Check (-not (HealthOk)) 'C3 service stays down after --stop'
Check (@(TestNodes).Count -eq 0) 'C4 no node process resurrected'
Check ((LogText) -match 'watchdog\] skip reason=user-stopped') 'C5 log skip reason=user-stopped'

# ---- D: crash exit (non-zero) still restarts exactly once via Exited guard ----
Stop-Process -Id $l1.Id -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 800
Remove-Item (Join-Path $root 'app\server.pid') -ErrorAction SilentlyContinue
$l2 = Start-Process -FilePath $exe -ArgumentList '--start-hidden' -WorkingDirectory $root -PassThru
Check (WaitHealth 40) 'D1 health after second launcher start'
Start-Sleep -Seconds 2
$nodePid2 = NodePid
Stop-Process -Id $nodePid2 -Force -ErrorAction SilentlyContinue
$t0 = Get-Date; $newPid2 = 0
while (((Get-Date) - $t0).TotalSeconds -lt 60) {
  $cand = NodePid
  if ($cand -gt 0 -and $cand -ne $nodePid2 -and (HealthOk)) { $newPid2 = $cand; break }
  Start-Sleep -Milliseconds 500
}
Check ($newPid2 -gt 0) ('D2 Exited guard restarted node (old=' + $nodePid2 + ' new=' + $newPid2 + ')')
Check (@(TestNodes).Count -eq 1) ('D3 exactly one node process (got ' + @(TestNodes).Count + ')')
Check ((LogText) -match 'guard\] restarted attempt=') 'D4 log guard restarted'
Check (-not ((LogText) -match 'watchdog\] restart reason=stalled.*pid=' + $nodePid2)) 'D5 watchdog did not double-restart'

# ---- cleanup ----
Stop-Process -Id $l2.Id -Force -ErrorAction SilentlyContinue
foreach ($n in @(TestNodes)) { Stop-Process -Id $n.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Milliseconds 500
Write-Host ('RESULT fail=' + $script:fail)
exit $(if ($script:fail -eq 0) { 0 } else { 1 })


param([string]$model = 'qwen3-5-4B-Q4_K_M.gguf')
$ErrorActionPreference = 'Continue'
$out = 'D:\LocalModels\server\docs\feature-stream-perf-2026-11-22\gpt-memory-4b.txt'
Remove-Item $out -ErrorAction SilentlyContinue
function Sample($tag) {
  $os = Get-CimInstance Win32_OperatingSystem
  $m = Get-CimInstance Win32_PerfRawData_PerfOS_Memory
  $p = Get-Process -Id $script:nodePid -ErrorAction SilentlyContinue
  $gpu = 0
  try { $gpu = (Get-Counter '\GPU Adapter Memory(*)\Shared Usage' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty CounterSamples | Measure-Object CookedValue -Sum).Sum } catch {}
  $line = "{0} | {1,-12} | free={2,5:N1} | commit={3,5:N1} | standby={4,5:N1} | gpuShared={5,5:N1} | nodeWS={6,5:N1} | nodePriv={7,5:N1}" -f (Get-Date -Format 'HH:mm:ss'), $tag, ($os.FreePhysicalMemory/1MB), ($m.CommittedBytes/1GB), ($m.StandbyCacheNormalPriorityBytes/1GB), ($gpu/1GB), ($p.WorkingSet64/1GB), ($p.PrivateMemorySize64/1GB)
  $line; $line | Out-File -FilePath $out -Append -Encoding utf8
}
$conn = Get-NetTCPConnection -LocalPort 8099 -State Listen -ErrorAction SilentlyContinue
$script:nodePid = $conn.OwningProcess
Sample 'before'
$job = Start-Job -ScriptBlock { param($mdl) try { Invoke-RestMethod 'http://127.0.0.1:8099/api/load' -Method Post -ContentType 'application/json' -Body (@{file=$mdl;contextSize=16384} | ConvertTo-Json) -TimeoutSec 300 | Out-Null; 'ok' } catch { 'fail: ' + $_.Exception.Message } } -ArgumentList $model
$i=0
while ($job.State -eq 'Running' -and $i -lt 60) { Start-Sleep -Seconds 2; $i += 2; Sample 'loading' }
Receive-Job $job | Out-Null
Start-Sleep -Seconds 3
Sample 'loaded'
Invoke-RestMethod 'http://127.0.0.1:8099/api/unload' -Method Post -ContentType 'application/json' -Body '{}' -TimeoutSec 60 | Out-Null
Start-Sleep -Seconds 2
Sample 'unloaded+2s'
Start-Sleep -Seconds 8
Sample 'unloaded+10s'
Remove-Job $job -Force


$ErrorActionPreference = 'Continue'
function Sample($tag) {
  $os = Get-CimInstance Win32_OperatingSystem
  $m = Get-CimInstance Win32_PerfRawData_PerfOS_Memory
  $p = Get-Process -Id $script:nodePid -ErrorAction SilentlyContinue
  $gpu = 0
  try {
    $gpu = (Get-Counter '\GPU Adapter Memory(*)\Shared Usage' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty CounterSamples | Measure-Object CookedValue -Sum).Sum
  } catch {}
  $line = "{0} | {1,-12} | free={2,5:N1} | commit={3,5:N1} | standby={4,5:N1} | gpuShared={5,5:N1} | nodeWS={6,5:N1} | nodePriv={7,5:N1}" -f (Get-Date -Format 'HH:mm:ss'), $tag, ($os.FreePhysicalMemory/1MB), ($m.CommittedBytes/1GB), ($m.StandbyCacheNormalPriorityBytes/1GB), ($gpu/1GB), ($p.WorkingSet64/1GB), ($p.PrivateMemorySize64/1GB)
  $line
  $line | Out-File -FilePath 'D:\LocalModels\server\docs\feature-stream-perf-2026-11-22\gpt-memory-sample.txt' -Append -Encoding utf8
}
$conn = Get-NetTCPConnection -LocalPort 8099 -State Listen -ErrorAction SilentlyContinue
$script:nodePid = $conn.OwningProcess
"node pid=" + $script:nodePid
# 清空旧采样
Remove-Item 'D:\LocalModels\server\docs\feature-stream-perf-2026-11-22\gpt-memory-sample.txt' -ErrorAction SilentlyContinue
Sample 'before-load'
$job = Start-Job -ScriptBlock {
  try { Invoke-RestMethod 'http://127.0.0.1:8099/api/load' -Method Post -ContentType 'application/json' -Body '{"file":"gpt-oss-20b-MXFP4.gguf","contextSize":16384}' -TimeoutSec 300 | Out-Null; 'load-ok' } catch { 'load-fail: ' + $_.Exception.Message }
}
$i = 0
while ($job.State -eq 'Running' -and $i -lt 180) {
  Start-Sleep -Seconds 2
  $i += 2
  Sample 'loading'
}
"job state=" + $job.State
Receive-Job $job
Start-Sleep -Seconds 4
Sample 'loaded+4s'
Start-Sleep -Seconds 6
Sample 'loaded+10s'
"--- unload ---"
try { Invoke-RestMethod 'http://127.0.0.1:8099/api/unload' -Method Post -ContentType 'application/json' -Body '{}' -TimeoutSec 60 | Out-Null } catch { "unload error: " + $_.Exception.Message }
Start-Sleep -Seconds 2
Sample 'unloaded+2s'
for ($j=0; $j -lt 12; $j++) { Start-Sleep -Seconds 5; Sample ('unloaded+' + (2 + ($j+1)*5) + 's') }
Remove-Job $job -Force

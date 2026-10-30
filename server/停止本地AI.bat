@echo off
setlocal
echo.
echo   Local AI  -  stopping service ...

rem /api/shutdown 要求同源页面拿到的本地令牌（防止外部网页关掉服务）。
rem 这里先读 /api/state 取令牌再带 x-local-token 头，才是真正的优雅退出；
rem 旧版没带令牌，一直被 403 挡下，只能靠下面那步强杀。
powershell -NoProfile -Command "$ErrorActionPreference='Stop'; try { $s=Invoke-RestMethod 'http://127.0.0.1:8099/api/state' -TimeoutSec 4; Invoke-RestMethod 'http://127.0.0.1:8099/api/shutdown' -Method Post -Headers @{ 'x-local-token' = $s.localToken } -TimeoutSec 4 | Out-Null; Write-Host '  Shutdown signal accepted (graceful).' } catch { Write-Host '  Service was not responding; forcing cleanup.' }"

rem Use PowerShell for the delay: `timeout` fails when stdin is redirected.
powershell -NoProfile -Command "Start-Sleep -Seconds 2"

powershell -NoProfile -Command "$c=@(Get-NetTCPConnection -LocalPort 8099 -State Listen -ErrorAction SilentlyContinue); if($c.Count -gt 0){ foreach($x in $c){ Stop-Process -Id $x.OwningProcess -Force -ErrorAction SilentlyContinue }; Write-Host '  Force-stopped remaining process.' } else { Write-Host '  Port 8099 is free.' }"

echo.
exit /b 0

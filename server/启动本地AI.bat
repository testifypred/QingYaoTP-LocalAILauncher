@echo off
setlocal
cd /d "%~dp0"

set "PORT=8099"
rem Edge: 先按 32 位安装位置找，找不到再按 64 位位置（不写死盘符/架构）
set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" set "EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"

rem ---- If the service is already up, just open the window ----
powershell -NoProfile -Command "try{ [void](Invoke-RestMethod 'http://127.0.0.1:8099/health' -TimeoutSec 2); exit 0 } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 goto openwin

echo.
echo   Local AI  -  starting model service ...
echo.

start "LocalAI-Service" /min "%~dp0run-server.cmd"

echo   Waiting for the service to become ready (loading a model takes a while) ...
powershell -NoProfile -Command "for($i=0;$i -lt 240;$i++){ try{ [void](Invoke-RestMethod 'http://127.0.0.1:8099/api/state' -TimeoutSec 2); exit 0 } catch { Start-Sleep -Milliseconds 500 } }; exit 1"
if errorlevel 1 (
  echo.
  echo   [FAILED] Service did not start. Check app.log in this folder.
  echo.
  pause
  exit /b 1
)

:openwin
start "" "%EDGE%" --app=http://127.0.0.1:%PORT%/ --window-size=1120,820
exit /b 0

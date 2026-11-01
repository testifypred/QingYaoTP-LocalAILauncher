@echo off
rem QingYaoTP AILauncher debugging tool (uses the bundled runtime if present)
setlocal
cd /d "%~dp0"
if exist "..\runtime\node.exe" (
  "..\runtime\node.exe" localai-debug.mjs %*
) else (
  node localai-debug.mjs %*
)
endlocal

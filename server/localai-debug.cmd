@echo off
rem Local AI Debugging Tool (uses the bundled runtime if present)
setlocal
cd /d "%~dp0"
if exist "..\runtime\node.exe" (
  "..\runtime\node.exe" localai-debug.mjs %*
) else (
  node localai-debug.mjs %*
)
endlocal

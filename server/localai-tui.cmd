@echo off
rem localai-tui - full screen terminal UI (chat + slash commands)
rem Prefers the bundled runtime\node.exe in the portable build.
setlocal
set "NODE=%~dp0..\runtime\node.exe"
if not exist "%NODE%" set "NODE=node"
"%NODE%" "%~dp0localai-tui.mjs" %*

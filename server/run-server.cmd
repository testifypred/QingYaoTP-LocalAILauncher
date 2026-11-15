@echo off
rem Internal helper: run the model service in the foreground with logging.
rem Called (minimized) by the launcher; not meant to be run directly.
rem Portable: no absolute paths. Model dir = repo root (parent of this script);
rem node = bundled runtime\node.exe > PATH > Program Files.
cd /d "%~dp0"
set "MODEL_DIR=%~dp0.."
set "PORT=8099"
set "CONTEXT_SIZE=16384"
rem set "AUTO_LOAD=your-model.gguf"
set "NODE=node"
where node >nul 2>&1
if errorlevel 1 set "NODE=%ProgramFiles%\nodejs\node.exe"
if exist "%~dp0..\runtime\node.exe" set "NODE=%~dp0..\runtime\node.exe"
"%NODE%" app.mjs >> app.log 2>&1

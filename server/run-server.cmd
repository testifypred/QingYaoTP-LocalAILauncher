@echo off
rem Internal helper: run the model service in the foreground with logging.
rem Called (minimized) by the launcher; not meant to be run directly.
cd /d "%~dp0"
set "MODEL_DIR=D:\LocalModels"
set "PORT=8099"
set "AUTO_LOAD=Qwen3.5-9B-Q4_K_M.gguf"
set "CONTEXT_SIZE=16384"
"D:\Node.js\node.exe" app.mjs >> app.log 2>&1

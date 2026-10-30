@echo off
rem localai - command line entry. Works from server\ (source) and app\ (portable).
rem Portable build prefers its bundled runtime\node.exe; source tree falls back to node on PATH.
setlocal
set "NODE=%~dp0..\runtime\node.exe"
if not exist "%NODE%" set "NODE=node"
"%NODE%" "%~dp0localai.mjs" %*

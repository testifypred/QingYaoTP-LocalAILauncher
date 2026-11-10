@echo off
rem QingYaoTP AILauncher debugging tool (uses the bundled runtime if present)
rem   localai-debug.cmd                          文本报告（服务没跑也能给本机诊断）
rem   localai-debug.cmd --json / --ui / --logs [app|crash] [行数]
rem   localai-debug.cmd --export [目录]          导出诊断包（服务没跑时出离线版）
rem   localai-debug.cmd --open <dir|logs|modelDir|sessions|workspace>
rem   localai-debug.cmd --history [小时] / --watch [秒] [--cycles N]
rem 退出码：0 正常 / 1 有错误 / 2 服务没跑或参数用错；原样透传给调用方。
setlocal
cd /d "%~dp0"
if exist "..\runtime\node.exe" (
  "..\runtime\node.exe" localai-debug.mjs %*
) else (
  node localai-debug.mjs %*
)
set "RC=%ERRORLEVEL%"
endlocal & exit /b %RC%

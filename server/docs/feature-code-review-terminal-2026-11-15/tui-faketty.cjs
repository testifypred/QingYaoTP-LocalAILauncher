// 伪 TTY 预载：把管道 stdin/stdout 伪装成终端，好在无控制台环境里冒烟 localai-tui 的交互循环
// 用法：  set NODE_OPTIONS=--require <本文件>  &&  node localai-tui.mjs
// 注意：只用于冒烟/取证，真实终端行为仍以实机为准。
process.stdout.isTTY = true;
process.stdout.columns = 100;
process.stdout.rows = 30;
process.stdin.isTTY = true;
if (typeof process.stdin.setRawMode !== "function") process.stdin.setRawMode = () => {};

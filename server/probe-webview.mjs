/**
 * 通过 WebView2 的远程调试端口，直接在「内嵌窗口里的页面」执行 JS。
 * 用途：确认内嵌环境下页面活着、能访问 /api/state、refresh() 能跑。
 *
 * 先以 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 启动启动器，
 * 再跑：node probe-webview.mjs
 */
const CDP = "http://127.0.0.1:9222";

const list = await (await fetch(`${CDP}/json`)).json();
const page = list.find((t) => t.type === "page" && t.url.includes("127.0.0.1"));
if (!page) {
  console.log("没找到页面目标，现有目标：", list.map((t) => `${t.type} ${t.url}`));
  process.exit(1);
}
console.log(`目标页面: ${page.url}`);

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener("message", (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});
await new Promise((r) => ws.addEventListener("open", r));

function send(method, params) {
  const myId = ++id;
  return new Promise((resolve) => {
    pending.set(myId, resolve);
    ws.send(JSON.stringify({ id: myId, method, params }));
  });
}

async function evaluate(label, expression) {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  const v = r.result?.result?.value;
  const err = r.result?.exceptionDetails?.text;
  console.log(`\n[${label}]`);
  console.log(err ? `  异常: ${err}` : `  → ${typeof v === "string" ? v : JSON.stringify(v)}`);
  return v;
}

await evaluate("页面是否可见/状态", `JSON.stringify({
  visibility: document.visibilityState,
  hasFocus: document.hasFocus(),
  title: document.title,
  状态行: (document.querySelector('.status') || {}).textContent || '(无 .status)',
  模型下拉: (document.querySelector('select') || {}).value || '(无)',
  输入框禁用: (document.querySelector('textarea') || {}).disabled
})`);

await evaluate(
  "页面自己再拉一次 /api/state",
  `fetch('/api/state').then(r => r.json()).then(s => JSON.stringify({
     loaded: s.loaded, loading: s.loading, models: s.models.length, kvReuse: s.kvReuse
  }))`,
);

await evaluate("手动调用 refresh()", `refresh().then(() => 'ok').catch(e => 'refresh 抛错: ' + e.message)`);

await evaluate(
  "refresh 之后的状态行",
  `JSON.stringify({
    状态行: (document.querySelector('.status') || {}).textContent || '(无)',
    模型下拉: (document.querySelector('select') || {}).value || '(无)',
    输入框禁用: (document.querySelector('textarea') || {}).disabled
  })`,
);

ws.close();

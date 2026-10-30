/**
 * 通过 CDP 给内嵌窗口截图，用于比对亮/暗两套主题。
 *
 *   node probe-ui-shot.mjs <输出前缀> [dark|light|both] [--reload]
 *
 * 前置：启动器带 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222
 */
import { writeFile } from "node:fs/promises";

const CDP = "http://127.0.0.1:9222";
const prefix = process.argv[2] ?? "D:/LocalModels/server/docs/ui";
const which = process.argv[3] ?? "both";
const reload = process.argv.includes("--reload");

const list = await (await fetch(`${CDP}/json`)).json();
const page = list.find((t) => t.type === "page" && t.url.includes("127.0.0.1"));
if (!page) throw new Error("没找到页面目标");
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
});
await new Promise((r) => ws.addEventListener("open", r));
const cmd = (method, params) =>
  new Promise((resolve, reject) => {
    const myId = ++id;
    const timer = setTimeout(() => { pending.delete(myId); reject(new Error(`超时 ${method}`)); }, 20000);
    pending.set(myId, (m) => { clearTimeout(timer); resolve(m); });
    ws.send(JSON.stringify({ id: myId, method, params }));
  });
const ev = (expression) => cmd("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });

if (reload) {
  await cmd("Page.reload", { ignoreCache: true });
  await new Promise((r) => setTimeout(r, 2500));
}

async function shot(name) {
  const r = await cmd("Page.captureScreenshot", { format: "png" });
  if (!r.result?.data) throw new Error("截图失败: " + JSON.stringify(r.error ?? r.result));
  const p = `${prefix}-${name}.png`;
  await writeFile(p, Buffer.from(r.result.data, "base64"));
  console.log("截图:", p);
}

const themes = which === "both" ? ["dark", "light"] : [which];
for (const t of themes) {
  await ev(`applyTheme('${t}')`);
  await new Promise((r) => setTimeout(r, 400));
  // 让页面处于顶部，截到头部和首条消息（平滑滚动会延迟，这里先临时关掉）
  await ev(`(() => { const m = document.getElementById('msgs'); m.style.scrollBehavior = 'auto'; m.scrollTop = 0; return m.scrollTop; })()`);
  await new Promise((r) => setTimeout(r, 500));
  await shot(t);
  // 再截一张滚到底的，用来看最后一条回复（公式/代码）
  const atBottom = await ev(`(() => { const m = document.getElementById('msgs'); m.scrollTop = m.scrollHeight; return m.scrollHeight - m.clientHeight - m.scrollTop; })()`);
  await new Promise((r) => setTimeout(r, 400));
  await shot(`${t}-end`);
  void atBottom;
}

const info = await ev(`JSON.stringify({
  theme: document.documentElement.dataset.theme,
  tabs: [...document.querySelectorAll('#modelSel .tab')].map(t => t.querySelector('.meta b').textContent + '|' + (t.classList.contains('sel') ? 'sel' : '')),
  icons: [...document.querySelectorAll('#modelSel .tab img')].map(i => i.src.split('/').pop() + ':' + i.naturalWidth),
  status: document.getElementById('statusText').textContent
})`);
console.log("状态:", info.result?.result?.value);
ws.close();

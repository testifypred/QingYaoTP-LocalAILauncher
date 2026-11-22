/**
 * 手点等价脚本：通过真实页面 + 真实 4B 审查一个代码文件（CDP）
 *   node ui-review-once.mjs [文件相对 code/ 的路径] [最长等待秒]
 * 记录：总耗时、busy 是否释放、状态行、结果标签数、是否触发前端看门狗、JS 异常。
 */
import { createRequire } from "node:module";
// 这个脚本放在 docs 证据目录：用 server 的 node_modules 解析 ws
const require = createRequire("D:/LocalModels/server/package.json");
const WebSocket = require("ws");
const CDP = process.env.CDP || "http://127.0.0.1:9333";
const BASE = process.env.BASE || "http://127.0.0.1:8099";
const FILE = process.argv[2] || "python-210407-1.py";
const MAX = Number(process.argv[3]) || 300;
const list = await (await fetch(CDP + "/json/list")).json();
const page = list.find((t) => t.type === "page" && String(t.url).startsWith(BASE));
if (!page) { console.log("FAIL 找不到 " + BASE + " 的页面"); process.exit(2); }
const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise((r, j) => { ws.once("open", r); ws.once("error", j); });
let seq = 0; const pending = new Map(); const exceptions = [];
ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.method === "Runtime.exceptionThrown") exceptions.push(String(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 200));
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const cmd = (method, params) => new Promise((resolve, reject) => {
  const id = ++seq;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error("超时 " + method)); }, 60000);
  pending.set(id, (m) => { clearTimeout(timer); resolve(m); });
  ws.send(JSON.stringify({ id, method, params: params || {} }));
});
const ev = async (expr, timeoutOk) => {
  const r = await cmd("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result && r.result.exceptionDetails && !timeoutOk) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300));
  return r.result && r.result.result ? r.result.result.value : undefined;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await cmd("Runtime.enable");
const t0 = Date.now();
const target = FILE.startsWith("code/") ? FILE : ("code/" + FILE);
console.log("打开 " + target + " …");
await ev("openCodePanel(" + JSON.stringify(target) + ")");
const opened = await ev("({cur: (typeof cwCurrent!=='undefined'?cwCurrent:''), len: cwValue().length})");
console.log("已打开 cur=" + opened.cur + " len=" + opened.len);
if (!opened.cur || !opened.cur.endsWith(target.split("/").pop())) { console.log("FAIL 打开的不是目标文件: " + opened.cur); process.exit(1); }
if (!opened.len) { console.log("FAIL 编辑器没有内容"); process.exit(1); }
// 不能 await 整个审查（CDP evaluate 会等到结束再返回，容易撞命令超时）：发起后轮询 busy
await ev("(cwReviewCode(), true)");
const waitStart = Date.now();
let busy = true;
while (Date.now() - waitStart < MAX * 1000) {
  busy = await ev("cwReviewBusy");
  if (!busy) break;
  await sleep(1000);
}
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
const state = await ev("(document.querySelector('#cwReviewState')||{}).textContent || ''");
const body = await ev("(document.querySelector('#cwReviewBody')||{}).textContent || ''");
const tabs = await ev("(cwResults||[]).length");
const btn = await ev("({disabled: document.querySelector('#cwReview').disabled, text: document.querySelector('#cwReview').textContent})");
const watchdog = /没有任何响应/.test(state + body);
console.log("总耗时=" + elapsed + "s busy=" + busy + " 看门狗触发=" + watchdog);
console.log("状态行=" + JSON.stringify(String(state).slice(0, 160)));
console.log("正文片段=" + JSON.stringify(String(body).slice(0, 120)));
console.log("结果标签=" + tabs + " 按钮=" + JSON.stringify(btn));
console.log("JS 异常=" + JSON.stringify(exceptions.slice(0, 3)));
ws.close();
if (busy) { console.log("FAIL busy 没有释放"); process.exit(1); }
if (btn && btn.disabled) { console.log("FAIL 审查按钮仍被禁用"); process.exit(1); }
console.log("OK");
process.exit(0);

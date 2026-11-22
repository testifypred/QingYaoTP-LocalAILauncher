// 9B + 用户实际文件：验证分段审查完成（不再 300s 超时）
import { readFile } from "node:fs/promises";
const CDP = "http://127.0.0.1:9333";
const BASE = "http://127.0.0.1:8099";
const FILE = "D:\\LocalModels\\workspace\\code\\python-115523-1.py";
const code = await readFile(FILE, "utf8");
const list = await (await fetch(CDP + "/json/list")).json();
const page = list.find((t) => t.type === "page" && String(t.url).startsWith(BASE));
if (!page) { console.log("no page"); process.exit(2); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0; const pending = new Map(); const errors = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === "Runtime.exceptionThrown") errors.push(String(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 200));
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true }); if (r.result.exceptionDetails) return { __err: r.result.exceptionDetails.text }; return r.result.result.value; };
await send("Runtime.enable");

function setup(codeText) {
  codeModal.hidden = false;
  cwApplyReviewOpen(true);
  cwResults.length = 0;
  cwRenderResultTabs();
  cwResetReviewView();
  const cm = cwEnsureEditor();
  if (cm) cm.setValue(codeText);
  cwCurrent = "python-115523-1.py";
  document.querySelector("#cwReview").click();
  return { busy: cwReviewBusy, lines: codeText.split("\n").length };
}
console.log("setup=" + JSON.stringify(await ev("(" + setup.toString() + ")(" + JSON.stringify(code) + ")")));
const t0 = Date.now();
let finalState = null;
for (let i = 0; i < 200; i += 1) {
  await new Promise((r) => setTimeout(r, 3000));
  const st = await ev("({busy: cwReviewBusy, state: (document.querySelector('#cwReviewState')||{}).textContent, tabs: document.querySelectorAll('#cwResultTabs .cwResTab').length, issues: document.querySelectorAll('#cwIssues .cwIssue').length})");
  if (i % 5 === 0 || (!st.busy)) console.log(((Date.now() - t0) / 1000).toFixed(0) + "s " + JSON.stringify(st));
  if (st && !st.busy) { finalState = st; break; }
}
console.log("final=" + JSON.stringify(finalState));
console.log("summary=" + JSON.stringify(await ev("(document.querySelector('#cwReviewSummary')||{}).textContent || ''")));
console.log("meta=" + JSON.stringify(await ev("(document.querySelector('#cwReviewMeta')||{}).textContent || ''")));
console.log("exceptions=" + JSON.stringify(errors.slice(0, 5)));
ws.close();

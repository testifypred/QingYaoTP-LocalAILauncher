// 诊断：点一次审查后轮询 cwReviewBusy / 状态 / 标签
const CDP = "http://127.0.0.1:9333";
const BASE = "http://127.0.0.1:8099";
const list = await (await fetch(CDP + "/json/list")).json();
const page = list.find((t) => t.type === "page" && String(t.url).startsWith(BASE));
if (!page) { console.log("no page"); process.exit(2); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0; const pending = new Map(); const errors = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === "Runtime.exceptionThrown") errors.push(String(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 300));
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true }); if (r.result.exceptionDetails) return { __err: r.result.exceptionDetails.text }; return r.result.result.value; };
await send("Runtime.enable");

function setup() {
  codeModal.hidden = false;
  cwApplyReviewOpen(true);
  cwResults.length = 0;
  cwRenderResultTabs();
  const lines = [];
  for (let i = 1; i <= 80; i += 1) lines.push(i % 5 === 0 ? "  return a + b;" : "  const v" + i + " = a * " + i + " + b;");
  const cm = cwEnsureEditor();
  if (cm) cm.setValue("function f(a, b) {\n" + lines.join("\n") + "\n}");
  cwCurrent = "probe-diag.js";
  document.querySelector("#cwReview").click();
  return { busy: cwReviewBusy, tabs: document.querySelectorAll("#cwResultTabs .cwResTab").length };
}
console.log("setup=" + JSON.stringify(await ev("(" + setup.toString() + ")()")));
for (let i = 0; i < 170; i += 1) {
  await new Promise((r) => setTimeout(r, 3000));
  const st = await ev("({busy: cwReviewBusy, state: (document.querySelector('#cwReviewState')||{}).textContent, tabs: document.querySelectorAll('#cwResultTabs .cwResTab').length, issues: document.querySelectorAll('#cwIssues .cwIssue').length, think: (document.querySelector('#cwThinkText')||{}).textContent.length})");
  console.log((i * 3) + "s " + JSON.stringify(st));
  if (st && !st.busy && st.tabs > 0) break;
  if (st && !st.busy && i > 2) { console.log("busy false but no tab"); break; }
}
console.log("exceptions=" + JSON.stringify(errors.slice(0, 5)));
ws.close();

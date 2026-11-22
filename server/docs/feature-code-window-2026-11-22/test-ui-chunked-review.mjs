// UI 端到端：80 行长代码 → 客户端两段审查，确认不超时且结果合并
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
  if (m.method === "Runtime.exceptionThrown") errors.push(String(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 200));
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
const ev = async (expr, timeout) => {
  const r = await Promise.race([
    send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }),
    new Promise((_, rej) => setTimeout(() => rej(new Error("evaluate timeout")), timeout || 30000)),
  ]);
  if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.text + " :: " + (r.result.exceptionDetails.exception?.description || ""));
  return r.result.result.value;
};
await send("Runtime.enable");

function pageRun() {
  return (async () => {
    const out = {};
    codeModal.hidden = false;
    cwApplyReviewOpen(true);
    cwResults.length = 0;
    cwRenderResultTabs();
    cwResetReviewView();
    const lines = [];
    for (let i = 1; i <= 80; i += 1) {
      if (i % 10 === 1) lines.push("function f" + i + "(a, b) {");
      else if (i % 10 === 0) lines.push("  return a + b;");
      else if (i % 10 === 5) lines.push("  if (a == null) return b;");
      else lines.push("  const v" + i + " = a * " + i + " + b;");
    }
    const cm = cwEnsureEditor();
    if (cm) cm.setValue(lines.join("\n"));
    cwCurrent = "probe-chunk-ui.js";
    const t0 = Date.now();
    document.querySelector("#cwReview").click();
    let tabs = 0;
    let issues = 0;
    let state = "";
    for (let i = 0; i < 240; i += 1) {
      await new Promise((r) => setTimeout(r, 2000));
      tabs = document.querySelectorAll("#cwResultTabs .cwResTab").length;
      issues = document.querySelectorAll("#cwIssues .cwIssue").length;
      state = (document.querySelector("#cwReviewState") || {}).textContent || "";
      if (!cwReviewBusy && i > 2) break;
    }
    out.seconds = Math.round((Date.now() - t0) / 1000);
    out.tabs = tabs;
    out.issues = issues;
    out.state = state;
    out.summary = (document.querySelector("#cwReviewSummary") || {}).textContent || "";
    out.meta = (document.querySelector("#cwReviewMeta") || {}).textContent || "";
    out.tabLabels = [...document.querySelectorAll("#cwResultTabs .cwResTab")].map((b) => b.textContent.trim());
    return out;
  })();
}

const out = await ev("(" + pageRun.toString() + ")()", 600000);
console.log(JSON.stringify(out, null, 2));
console.log("exceptions=" + JSON.stringify(errors));
ws.close();

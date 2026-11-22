// 验证「没点模型审查直接点他人复审」→ 先补一次本地审查，作为第 1 个结果
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
    new Promise((_, rej) => setTimeout(() => rej(new Error("evaluate timeout")), timeout || 60000)),
  ]);
  if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.text + " :: " + (r.result.exceptionDetails.exception?.description || ""));
  return r.result.result.value;
};
await send("Runtime.enable");

function pageCrossFirst() {
  return (async () => {
    const out = {};
    codeModal.hidden = false;
    cwApplyReviewOpen(true);
    cwResults.length = 0;
    cwActiveResultId = null;
    cwRenderResultTabs();
    const cm = cwEnsureEditor();
    if (cm) cm.setValue("function add(a, b) { return a + b; }\nconsole.log(add(1, 2));\n");
    cwCurrent = "probe-cross-first.js";
    out.beforeTabs = document.querySelectorAll("#cwResultTabs .cwResTab").length;
    const t0 = Date.now();
    document.querySelector("#cwCross").click();
    let labels = [];
    for (let i = 0; i < 120; i += 1) {
      await new Promise((r) => setTimeout(r, 2000));
      labels = [...document.querySelectorAll("#cwResultTabs .cwResTab")].map((b) => b.textContent.trim());
      const state = (document.querySelector("#cwReviewState") || {}).textContent || "";
      if (labels.length >= 2 && /复审完成|他人复审完成/.test(state)) break;
      if (!cwReviewBusy && i > 6 && labels.length < 2) break;
    }
    out.labels = labels;
    out.seconds = Math.round((Date.now() - t0) / 1000);
    out.state = (document.querySelector("#cwReviewState") || {}).textContent || "";
    out.localFirst = labels.length > 0 && labels[0].indexOf("模型审查") >= 0;
    out.crossSecond = labels.some((l) => l.indexOf("他人复审") >= 0);
    out.activeSummary = (document.querySelector("#cwReviewSummary") || {}).textContent || "";
    out.verdict = (document.querySelector("#cwCrossVerdict") || {}).textContent || "";
    return out;
  })();
}

const out = await ev("(" + pageCrossFirst.toString() + ")()", 300000);
console.log(JSON.stringify(out, null, 2));
console.log("exceptions=" + JSON.stringify(errors));
ws.close();

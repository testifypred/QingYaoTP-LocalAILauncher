// 代码工作区 UI 冒烟（标签页 / 最大化 / 拖拽 / 分隔条）
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
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.text); return r.result.result.value; };
await send("Runtime.enable");

function pageTest() {
  const out = {};
  out.hasTabs = !!document.querySelector("#cwResultTabs");
  out.hasSplitter = !!document.querySelector("#cwSplitter");
  out.hasMax = !!document.querySelector("#cwMax");
  codeModal.hidden = false;
  cwApplyReviewOpen(true);
  out.tabsHiddenIdle = document.querySelector("#cwResultTabs").hidden;
  cwResetReviewView();
  cwAddReviewResult({ kind: "local", label: "模型审查", icon: "∫", model: "qwen3-5-4B-Q4_K_M.gguf", summary: "本地结论", issues: [{ line: 1, endLine: 1, severity: "warn", title: "本地问题", detail: "d", fix: "f" }], stateText: "模型审查 · 1 个问题", at: Date.now() });
  const cr = cwAddReviewResult({ kind: "cross", label: "他人复审", icon: "≠", model: "Phi-4-mini", summary: "他人复审（Phi-4-mini）", issues: [{ line: 2, endLine: 2, severity: "error", title: "他人问题", detail: "d" }], compare: { verdict: "differs", stats: { primary: 1, second: 1, agree: 0, onlyPrimary: 1, onlySecond: 0, conflicts: 0 }, agree: [], onlyPrimary: [{ line: 1, endLine: 1, severity: "warn", title: "本地问题" }], onlySecond: [], conflicts: [] }, stateText: "他人复审：仅一方提出", at: Date.now() });
  cwActivateReviewResult(cr.id, true);
  out.tabCount = document.querySelectorAll("#cwResultTabs .cwResTab").length;
  out.tabLabels = [...document.querySelectorAll("#cwResultTabs .cwResTab")].map((b) => b.textContent.trim());
  out.tabIcons = [...document.querySelectorAll("#cwResultTabs .cwResIco")].map((b) => b.textContent);
  out.crossIssuesHidden = document.querySelector("#cwIssues").hidden;
  out.crossVerdict = document.querySelector("#cwCrossVerdict").textContent;
  out.crossSummary = document.querySelector("#cwReviewSummary").textContent;
  document.querySelectorAll("#cwResultTabs .cwResTab")[0].click();
  out.localSummary = document.querySelector("#cwReviewSummary").textContent;
  out.localIssuesVisible = !document.querySelector("#cwIssues").hidden;
  out.localCards = document.querySelectorAll("#cwIssues .cwIssue").length;
  const box = document.querySelector("#codeModal .cwBox");
  document.querySelector("#cwMax").click();
  out.maxOn = box.classList.contains("cwMax");
  document.querySelector("#cwMax").click();
  out.maxOff = !box.classList.contains("cwMax");
  const head = box.querySelector(".modalHead");
  head.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 100, clientY: 100, pointerId: 1 }));
  head.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 160, clientY: 140, pointerId: 1 }));
  out.transform = box.style.transform;
  head.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 160, clientY: 140, pointerId: 1 }));
  box.style.transform = "";
  const sp = document.querySelector("#cwSplitter");
  const panel = document.querySelector("#cwReviewPanel");
  const before = Math.round(panel.getBoundingClientRect().width);
  sp.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 500, clientY: 300, pointerId: 2 }));
  sp.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 420, clientY: 300, pointerId: 2 }));
  const after = Math.round(panel.getBoundingClientRect().width);
  sp.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 420, clientY: 300, pointerId: 2 }));
  out.widthBefore = before;
  out.widthAfter = after;
  out.wider = after > before;
  cwResetReviewView();
  codeModal.hidden = true;
  panel.style.width = "";
  try { localStorage.removeItem("localai.cwReviewWidth"); } catch {}
  return out;
}

const out = await ev("(" + pageTest.toString() + ")()");
console.log(JSON.stringify(out, null, 2));
console.log("exceptions=" + JSON.stringify(errors));
ws.close();

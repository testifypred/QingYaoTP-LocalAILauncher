/**
 * 代码工作区窗口 / 审查结果标签探针（2026-11-22）
 *
 *   node probe-code-window-ui.mjs [cdp] [base]
 *
 * 覆盖：
 *  A) 结果标签 #cwResultTabs / 分隔条 #cwSplitter / 最大化 #cwMax 存在；
 *  B) 追加本地审查 + 他人复审结果后出现 2 个标签（图标 ∫ / ≠、模型名）；
 *  C) 点标签切换内容：他人复审 → 隐藏问题卡片、显示判定；本地审查 → 恢复卡片与摘要；
 *  D) 窗口可最大化/还原、标题栏可拖拽、审查栏可拖宽；
 *  E) 全程无 JS 异常、收尾复位。
 *
 * 前置：Edge headless 在 9333，页面已导航到 BASE；纯 DOM，不调模型。
 */
import WebSocket from "ws";
const CDP = process.argv[2] || "http://127.0.0.1:9333";
const BASE = process.argv[3] || "http://127.0.0.1:8099";
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass += 1; console.log("  ok   " + name + (extra ? "  [" + extra + "]" : "")); }
  else { fail += 1; console.log("  FAIL " + name + "  " + (extra || "")); }
};
const list = await (await fetch(CDP + "/json/list")).json();
const page = list.find((t) => t.type === "page" && String(t.url).startsWith(BASE));
if (!page) { console.log("  FAIL 找不到 " + BASE + " 的页面目标"); process.exit(2); }
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
  const timer = setTimeout(() => { pending.delete(id); reject(new Error("超时 " + method)); }, 20000);
  pending.set(id, (m) => { clearTimeout(timer); resolve(m); });
  ws.send(JSON.stringify({ id, method, params: params || {} }));
});
const ev = async (expr) => {
  const r = await cmd("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.text);
  return r.result.result.value;
};
function pageRun() {
  const out = {};
  out.hasTabs = !!document.querySelector("#cwResultTabs");
  out.hasSplitter = !!document.querySelector("#cwSplitter");
  out.hasMax = !!document.querySelector("#cwMax");
  codeModal.hidden = false;
  cwApplyReviewOpen(true);
  // 复位上一轮残留（宽度 / 最大化 / 拖拽位移），保证多次跑结果一致
  try { localStorage.removeItem("localai.cwReviewWidth"); } catch {}
  const box0 = document.querySelector("#codeModal .cwBox");
  if (box0) { box0.classList.remove("cwMax"); box0.style.transform = ""; }
  const panel0 = document.querySelector("#cwReviewPanel");
  if (panel0) panel0.style.width = "";
  out.tabsHiddenIdle = document.querySelector("#cwResultTabs").hidden;
  cwResults.length = 0;
  cwActiveResultId = null;
  cwRenderResultTabs();
  cwResetReviewView();
  cwAddReviewResult({ kind: "local", label: "模型审查", icon: "∫", model: "qwen3-5-4B-Q4_K_M.gguf", summary: "本地结论", issues: [{ line: 1, endLine: 1, severity: "warn", title: "本地问题", detail: "d", fix: "f" }], stateText: "模型审查 · 1 个问题", at: Date.now() });
  const cr = cwAddReviewResult({ kind: "cross", label: "他人复审", icon: "≠", model: "Phi-4-mini", summary: "他人复审（Phi-4-mini）", issues: [{ line: 2, endLine: 2, severity: "error", title: "他人问题", detail: "d" }], compare: { verdict: "differs", stats: { primary: 1, second: 1, agree: 0, onlyPrimary: 1, onlySecond: 0, conflicts: 0 }, agree: [], onlyPrimary: [{ line: 1, endLine: 1, severity: "warn", title: "本地问题" }], onlySecond: [], conflicts: [] }, stateText: "他人复审：仅一方提出", at: Date.now() });
  cwActivateReviewResult(cr.id, true);
  out.tabCount = document.querySelectorAll("#cwResultTabs .cwResTab").length;
  out.labels = [...document.querySelectorAll("#cwResultTabs .cwResTab")].map((b) => b.textContent.trim());
  out.icons = [...document.querySelectorAll("#cwResultTabs .cwResIco")].map((b) => b.textContent);
  out.crossIssuesHidden = document.querySelector("#cwIssues").hidden;
  out.crossVerdict = document.querySelector("#cwCrossVerdict").textContent;
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
  cwResetReviewView();
  cwResults.length = 0;
  cwRenderResultTabs();
  codeModal.hidden = true;
  panel.style.width = "";
  try { localStorage.removeItem("localai.cwReviewWidth"); } catch {}
  return out;
}

console.log("\n== 目标页面 " + BASE + " ==");
await cmd("Runtime.enable");
const r = await ev("(" + pageRun.toString() + ")()");
ok("有结果标签 / 分隔条 / 最大化按钮", r.hasTabs && r.hasSplitter && r.hasMax);
ok("初始标签栏隐藏", r.tabsHiddenIdle === true);
ok("两种结果 → 2 个标签", r.tabCount === 2, JSON.stringify(r.labels));
ok("标签带图标与模型名", r.icons.join("") === "∫≠" && /模型审查/.test(r.labels[0]) && /他人复审/.test(r.labels[1]), JSON.stringify(r.labels));
ok("他人复审标签：隐藏问题卡片、显示判定", r.crossIssuesHidden === true && /仅一方提出/.test(r.crossVerdict), r.crossVerdict);
ok("切回本地审查：摘要与卡片恢复", r.localSummary === "本地结论" && r.localIssuesVisible === true && r.localCards === 1, JSON.stringify([r.localSummary, r.localCards]));
ok("最大化可开可还原", r.maxOn === true && r.maxOff === true);
ok("标题栏可拖拽（transform 生效）", r.transform === "translate(60px, 40px)", r.transform);
ok("审查栏可拖宽", r.widthAfter > r.widthBefore, r.widthBefore + " → " + r.widthAfter);
ok("全程无 JS 异常", exceptions.length === 0, JSON.stringify(exceptions.slice(0, 2)));

console.log("\n== 结果: " + pass + " 通过 / " + fail + " 失败 ==\n");
ws.close();
process.exit(fail ? 1 : 0);

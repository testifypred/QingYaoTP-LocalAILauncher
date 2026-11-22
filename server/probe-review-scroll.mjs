/**
 * 代码工作区「模型审查」面板滚动探针（2026-11-22 修：审查中不能上滚）
 *
 *   node probe-review-scroll.mjs [cdp] [base]
 *
 * 覆盖：
 *  A) #cwReviewPanel / #cwReviewBody / cwThinkBegin / cwThinkAppend 存在；
 *  B) 追加审查思路时，本来在底部才跟随滚动；
 *  C) 用户手动上滚后，后续 delta 不再把面板拽回底部（核心回归）；
 *  D) 用户滚回底部后，恢复自动跟随；
 *  E) 思路框内部（#cwThinkText）用 appendData 追加，不重置用户滚动位置；
 *  F) 全程无 JS 异常，收尾复位。
 *
 * 前置：Edge headless 在 9333，页面已导航到 BASE；纯 DOM 测试，不调模型。
 */
import WebSocket from "ws";
const CDP = process.argv[2] || "http://127.0.0.1:9333";
const BASE = process.argv[3] || "http://127.0.0.1:8099";
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass += 1; console.log("  ok   " + name + (extra ? "  [" + extra + "]" : "")); }
  else { fail += 1; console.log("  FAIL " + name + "  " + (extra || "")); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
  const r = await cmd("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result && r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.text);
  return r.result && r.result.result ? r.result.result.value : undefined;
};
function pageSetup() {
  const modal = document.querySelector("#codeModal");
  if (!modal) return { error: "no #codeModal" };
  modal.hidden = false;
  modal.style.cssText = "display:block;position:fixed;left:0;top:0;width:900px;height:600px;z-index:99999;background:#fff";
  const panel = document.querySelector("#cwReviewPanel");
  if (!panel) return { error: "no #cwReviewPanel" };
  panel.style.cssText = "display:flex;flex-direction:column;height:420px;width:360px";
  const think = document.querySelector("#cwThink");
  think.hidden = false;
  think.open = true;
  document.querySelector("#cwThinkText").style.cssText = "max-height:120px;overflow:auto";
  cwThinkBegin("测试审查思路");
  return { ok: true };
}
function pageFill(n) {
  const text = "第 N 行：这是一段用于制造滚动的审查思路文本，包含一些中文和 English words 用来测试滚动位置。\n";
  for (let i = 0; i < n; i += 1) cwThinkAppend(text.replace("N", String(i)));
  const body = document.querySelector("#cwReviewBody");
  return { scrollTop: body.scrollTop, scrollHeight: body.scrollHeight, clientHeight: body.clientHeight };
}
function pageScrollBody(top) {
  const body = document.querySelector("#cwReviewBody");
  body.scrollTop = top === "bottom" ? body.scrollHeight : top;
  return body.scrollTop;
}
function pageAppendAndMeasure(n, innerScrollTop) {
  const body = document.querySelector("#cwReviewBody");
  const pre = document.querySelector("#cwThinkText");
  if (innerScrollTop !== undefined) pre.scrollTop = innerScrollTop;
  const preBefore = pre.scrollTop;
  for (let i = 0; i < n; i += 1) cwThinkAppend("追加内容 " + i + "：再写一行比较长的中文，用来测试滚动是否被重置。\n");
  return {
    bodyTop: body.scrollTop,
    bodyGap: body.scrollHeight - body.scrollTop - body.clientHeight,
    preTop: pre.scrollTop,
    preBefore: preBefore,
    preGap: pre.scrollHeight - pre.scrollTop - pre.clientHeight,
  };
}
function pageCleanup() {
  cwThinkHide();
  const modal = document.querySelector("#codeModal");
  if (modal) { modal.hidden = true; modal.removeAttribute("style"); }
  const panel = document.querySelector("#cwReviewPanel");
  if (panel) panel.removeAttribute("style");
  document.querySelector("#cwThinkText").removeAttribute("style");
  return true;
}

console.log("\n== 目标页面 " + BASE + " ==");
await cmd("Runtime.enable");
ok("有代码审查面板 #cwReviewPanel", (await ev("!!document.querySelector('#cwReviewPanel')")) === true);
ok("有 #cwReviewBody 与 cwThinkAppend", (await ev("!!document.querySelector('#cwReviewBody') && typeof cwThinkAppend === 'function'")) === true);
const setup = await ev("(" + pageSetup.toString() + ")()");
ok("能打开面板并强制布局", setup && setup.ok === true, JSON.stringify(setup));
const filled = await ev("(" + pageFill.toString() + ")(80)");
ok("追加内容后外层面板跟随到底部", filled && filled.scrollHeight - filled.scrollTop - filled.clientHeight <= 2, JSON.stringify(filled));
await ev("(" + pageScrollBody.toString() + ")(0)");
const up = await ev("(" + pageAppendAndMeasure.toString() + ")(20)");
ok("用户上滚后，追加不再把面板拽回底部", up && up.bodyTop === 0, JSON.stringify(up));
await ev("(" + pageScrollBody.toString() + ")('bottom')");
const down = await ev("(" + pageAppendAndMeasure.toString() + ")(10)");
ok("用户滚回底部后，恢复自动跟随", down && down.bodyGap <= 2, JSON.stringify(down));
const inner = await ev("(" + pageAppendAndMeasure.toString() + ")(5, 30)");
ok("思路框内部滚到中间后，追加不重置位置", inner && inner.preTop >= 28 && inner.preTop <= 32, JSON.stringify(inner));
const innerBottom = await ev("(" + pageAppendAndMeasure.toString() + ")(3, 999999)");
ok("思路框内部在底部时，追加会跟随", innerBottom && innerBottom.preGap <= 2, JSON.stringify(innerBottom));
ok("全程无 JS 异常", exceptions.length === 0, JSON.stringify(exceptions.slice(0, 2)));
const cleaned = await ev("(" + pageCleanup.toString() + ")()");
ok("收尾复位（面板/思路/样式）", cleaned === true);

console.log("\n== 结果: " + pass + " 通过 / " + fail + " 失败 ==\n");
ws.close();
process.exit(fail ? 1 : 0);

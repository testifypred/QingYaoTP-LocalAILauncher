/**
 * Debugging Tool 界面探针（Edge CDP）
 *
 *   node probe-ui-debug.mjs [cdp] [base]
 *
 * 覆盖：顶栏 Debug 按钮、模型按钮上的新标记（∂ + ?）、设置 → 工具 的入口、
 *       点按钮会真的去调 /api/debug/open（用假 fetch 拦下来，避免真的弹窗）、
 *       调试页面本身能渲染检查项/日志/复制。
 */
import WebSocket from "ws";

const CDP = process.argv[2] || "http://127.0.0.1:9333";
const BASE = process.argv[3] || "http://127.0.0.1:8099";

const list = await (await fetch(CDP + "/json/list")).json();
const page = list.find((t) => t.type === "page" && t.url.includes("8099"));
if (!page) { console.log("no page"); process.exit(2); }
const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise((r, j) => { ws.once("open", r); ws.once("error", j); });
let id = 0; const pend = new Map();
ws.on("message", (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (e) => {
  const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(String(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text).slice(0, 300));
  return r.result?.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) { pass++; console.log("  ok   " + n + (d ? "  [" + d + "]" : "")); } else { fail++; console.log("  FAIL " + n + "  " + d); } };

await send("Page.enable"); await send("Runtime.enable");
await send("Page.navigate", { url: BASE + "/" });
await sleep(3200);

// ---- 顶栏按钮 ----
const btn = await ev("(() => { const b = document.getElementById('debugBtn'); if (!b) return null; const r = b.getBoundingClientRect(); return { text: b.textContent.trim(), w: r.width, h: r.height, title: b.title }; })()");
ok("顶栏有 Debug 按钮", !!btn && /Debug/.test(btn.text), btn ? btn.text : "missing");
ok("按钮可点（有尺寸）", !!btn && btn.w > 10 && btn.h > 10, btn ? btn.w + "x" + btn.h : "");
ok("按钮 tooltip 说明是独立程序", !!btn && /独立程序/.test(btn.title || ""), btn?.title || "");

// ---- 新标记（本体图标） ----
const mark = await ev("(() => { const b = document.querySelector('#modelBtn .int'); if (!b) return null; const cs = getComputedStyle(b); return { glyph: b.querySelector('b')?.textContent || '', q: b.querySelector('i')?.textContent || '', bg: cs.backgroundColor, border: cs.borderColor }; })()");
ok("模型按钮上的标记是 ∂", !!mark && mark.glyph === "∂", mark ? mark.glyph : "missing");
ok("标记带青色问号", !!mark && mark.q === "?", mark ? mark.q : "");
ok("标记底色是黑", !!mark && /rgb\(0, 0, 0\)|rgba\(0, 0, 0/.test(mark.bg), mark?.bg || "");

// ---- 设置入口 ----
await ev("document.getElementById('settingsBtn').click(); 1");
await sleep(350);
await ev("showSettingsTab('tools'); 1");
await sleep(250);
const entry = await ev("(() => { const b = document.getElementById('setDebugOpen'); return b ? { text: b.textContent.trim(), shown: !b.closest('.settingsBody').hidden } : null; })()");
ok("设置 → 工具有调试入口", !!entry && /调试窗口/.test(entry.text) && entry.shown, entry ? entry.text : "missing");
await ev("document.getElementById('settingsClose').click(); 1");
await sleep(200);

// ---- 点按钮真的发请求（用假 fetch 拦下，不真弹窗） ----
const clicked = await ev("(async () => {" +
  "window.__dbg = 0; const orig = window.fetch;" +
  "window.fetch = function (u, o) { if (String(u).indexOf('/api/debug/open') >= 0) { window.__dbg++; return Promise.resolve({ status: 200, json: async () => ({ ok: true, pid: 4321 }) }); } return orig(u, o); };" +
  "document.getElementById('debugBtn').click();" +
  "await new Promise((r) => setTimeout(r, 600));" +
  "const toast = (document.querySelector('.toasts') || {}).textContent || '';" +
  "window.fetch = orig;" +
  "return { n: window.__dbg, toast: toast };" +
  "})()");
ok("点按钮会调 /api/debug/open", clicked && clicked.n === 1, "calls=" + (clicked?.n ?? "?"));
ok("成功后给出提示", /调试窗口/.test(String(clicked?.toast || "")), String(clicked?.toast || "").slice(0, 60));

// ---- 调试页面本身 ----
await send("Page.navigate", { url: BASE + "/debug" });
await sleep(2600);
const ui = await ev("({ checks: document.querySelectorAll('#checks li').length, pills: document.querySelectorAll('#pills .pill').length, log: (document.getElementById('logBox').textContent || '').length, title: document.title, env: document.querySelectorAll('#env b').length, model: document.querySelectorAll('#model b').length })");
ok("调试页标题正确", /Debugging Tool/.test(ui.title || ""), ui.title);
ok("渲染了检查项（>=12）", ui.checks >= 12, "li=" + ui.checks);
ok("渲染了三档统计", ui.pills === 3, "pills=" + ui.pills);
ok("运行环境与模型区有内容", ui.env >= 5 && ui.model >= 4, ui.env + " / " + ui.model);
ok("日志面板有内容", ui.log > 20, "chars=" + ui.log);

const copy = await ev("(async () => { document.getElementById('copy').click(); await new Promise((r) => setTimeout(r, 400)); return document.getElementById('copy').textContent; })()");
ok("复制报告有反馈", /已复制/.test(String(copy || "")), String(copy || ""));

// 回到主界面，别把共用页面留在调试页
await send("Page.navigate", { url: BASE + "/" });
await sleep(2200);
ok("能回到主界面", await ev("!!document.getElementById('debugBtn')"));

console.log("\nRESULT " + pass + "/" + (pass + fail));
ws.close();
process.exit(fail ? 1 : 0);

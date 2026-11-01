/**
 * Debugging Tool 界面探针（Edge CDP）
 *
 *   node probe-ui-debug.mjs [cdp] [base]
 *
 * 覆盖：顶栏 Debug 按钮、模型按钮显示已加载模型的品牌图标（认不出品牌回退 ∫）、
 *       设置 → 工具 的入口、点按钮会真的去调 /api/debug/open（用假 fetch 拦下来，避免真的弹窗）、
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
// 调试页断言「没有未捕获异常」用：CDP 会在 Runtime.exceptionThrown 里报页面里的未捕获错误
let jsErrors = [];
ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.method === "Runtime.exceptionThrown") {
    const d = m.params?.exceptionDetails || {};
    jsErrors.push(String(d.exception?.description || d.text || "exception").split("\n")[0].slice(0, 200));
  }
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
});
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

// ---- 模型按钮图标（加载了模型就显示该模型的品牌图标；认不出品牌回退 ∫） ----
// 期望哪个图标由服务端状态决定，别写死模型名（以后换模型探针不该红）
let loadedFile = "";
try { loadedFile = (await (await fetch(BASE + "/api/state")).json()).loaded || ""; } catch {}
const brandOf = (f) => {
  const n = String(f || "").toLowerCase();
  if (n.includes("deepseek")) return "deepseek";
  if (n.includes("phi") || n.includes("microsoft")) return "microsoft";
  if (n.includes("qwen")) return "qwen";
  if (n.includes("gpt") || n.includes("openai") || n.includes("oss")) return "openai";
  return "";
};
const wantBrand = brandOf(loadedFile);
const mark = await ev("(() => { const box = document.querySelector('#modelBtn .int'); const img = document.getElementById('modelBtnImg'); const b = box?.querySelector('b'); if (!box || !img) return null; const cs = getComputedStyle(box); const r = img.getBoundingClientRect(); return { glyph: b?.textContent || '', q: box.querySelector('i')?.textContent || '', hasBrand: box.classList.contains('has-brand'), imgShown: !img.hidden && !!img.getAttribute('src'), src: img.getAttribute('src') || '', alt: img.getAttribute('alt') || '', bg: cs.backgroundColor, iw: Math.round(r.width), ih: Math.round(r.height) }; })()");
if (wantBrand) {
  ok("模型按钮显示已加载模型的品牌图标", !!mark && mark.hasBrand === true && mark.imgShown === true && mark.src === "/vendor/models/" + wantBrand + ".png",
    mark ? mark.src : "missing");
  ok("品牌图标有实际尺寸", !!mark && mark.iw >= 16 && mark.ih >= 16, mark ? mark.iw + "x" + mark.ih : "");
  ok("品牌图标不套黑底（回退标记此时隐藏）", !!mark && mark.hasBrand === true && /rgba?\(0, 0, 0, 0\)|transparent/.test(mark.bg), mark?.bg || "");
} else {
  ok("没加载模型/认不出品牌时回退 ∫ 标记（不显示品牌图）", !!mark && mark.hasBrand === false && mark.imgShown === false, mark ? JSON.stringify(mark.src) : "missing");
}
ok("回退标记仍是 ∫（不定积分，本体图标；问号属于调试图标）", !!mark && mark.glyph === "∫" && mark.q === "", mark ? mark.glyph + "/" + JSON.stringify(mark.q) : "missing");

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
jsErrors = [];
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

// ---- 实时资源卡（2 秒轮询 /api/diag/resources）----
// 页面加载时立刻采一次；CPU 首采可能没有基准（显示「—」），1 秒后补采，
// 所以等 ~3 秒（导航后 2.6s + 上面复制反馈 0.4s）再断言，数值必然已经有。
const resUi = await ev(`(() => {
  const g = (i) => document.getElementById(i);
  const card = g('resCard');
  if (!card) return null;
  const bar = (i) => { const el = g(i); return el ? Math.round(el.getBoundingClientRect().width) : -1; };
  const cv = g('resSpark');
  let painted = -1;
  try { const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; painted = n; } catch {}
  return {
    has: /实时资源/.test(card.textContent || ''),
    cpu: (g('resCpu').textContent || '').trim(),
    mem: (g('resMem').textContent || '').trim(),
    cpuBar: bar('resCpuBar'), memBar: bar('resMemBar'),
    spark: cv ? { w: cv.width, h: cv.height } : null,
    painted: painted,
    updated: (g('resUpdated').textContent || '').trim(),
  };
})()`);
ok("调试页有实时资源卡与 sparkline", !!resUi && resUi.has && !!resUi.spark && resUi.spark.w > 100 && resUi.spark.h > 0 && resUi.painted > 0,
  resUi ? resUi.spark.w + "x" + resUi.spark.h + " · painted " + resUi.painted : "missing");
ok("2.6s 后 CPU/内存有数值且条形有宽度", !!resUi && /^\d+%$/.test(resUi.cpu) && /\d+%/.test(resUi.mem) && resUi.cpuBar > 2 && resUi.memBar > 2,
  resUi ? resUi.cpu + " / " + resUi.mem + " · bars " + resUi.cpuBar + "/" + resUi.memBar + "px · " + resUi.updated : "missing");
ok("调试页无未捕获 JS 异常", jsErrors.length === 0, jsErrors.slice(0, 3).join(" | "));

// 回到主界面，别把共用页面留在调试页
await send("Page.navigate", { url: BASE + "/" });
await sleep(2200);
ok("能回到主界面", await ev("!!document.getElementById('debugBtn')"));

// ---- 窄窗回归：175% 缩放下窗口只有 ~850 CSS px ----
// 11-01 加 Debug 按钮后，顶栏在窄窗里把按钮压到文字竖排、主题键被挤出屏幕。
// 断言「按钮不竖排 + 页面不横向溢出」，防止下次再加按钮时复发。
await send("Emulation.setDeviceMetricsOverride", { width: 850, height: 700, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: BASE + "/" });
await sleep(2600);
const narrow = await ev(`(() => {
  const btns = [...document.querySelectorAll("header button")].filter(b => b.getBoundingClientRect().width > 0);
  const stacked = btns.filter(b => b.getBoundingClientRect().height > 44).map(b => (b.textContent || "").trim());
  return { win: innerWidth, bodyScroll: document.body.scrollWidth, stacked: stacked, headerH: Math.round(document.querySelector("header").getBoundingClientRect().height) };
})()`);
ok("窄窗（850px）按钮不竖排", narrow.stacked.length === 0, JSON.stringify(narrow.stacked));
ok("窄窗不横向溢出", narrow.bodyScroll <= narrow.win + 2, narrow.bodyScroll + " vs " + narrow.win);
ok("窄窗顶栏允许换行（高度 > 60）", narrow.headerH > 60, "headerH=" + narrow.headerH);
await send("Emulation.clearDeviceMetricsOverride");
await send("Page.navigate", { url: BASE + "/" });
await sleep(2000);

console.log("\nRESULT " + pass + "/" + (pass + fail));
ws.close();
process.exit(fail ? 1 : 0);

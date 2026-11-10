/**
 * 模型下载进度（顶栏 · 可折叠）界面探针（Edge CDP）
 *
 *   node probe-download-ui.mjs [cdp] [base]
 *
 * 契约：server/docs/feature-download-progress-2026-11-10/CONTRACT.md 第四节。
 * 覆盖 9 组：空闲 / 下载中 / 收起展开 / 卡住 / 完成 / 失败 / 取消 / 窄窗 850px / 无未捕获异常。
 *
 * 为什么用 stub：真下载要几百 MB、会改工作区，而且没法稳定停在「42%、还剩 148 秒」这种中间态。
 * 这里只把 window.fetch 对 /api/download/state 的响应换成假 JSON（其余请求照常透传），
 * 顺带拦 /api/download/cancel 记录调用次数与 x-local-token。不调 /api/download/start、
 * 不真下载、不弹真实窗口；跑完恢复 fetch，并把页面导航回主界面。
 *
 * 空闲态口径：严格按契约要求「真实服务没下载 → hidden」。若开发服务里残留着别的探针/自测
 * 留下的 done/error 状态（后端 done 会一直保留到下一次 start），真实空闲无从谈起——
 * 这时打印 [env] 告警，改用 stub 空闲态验证「空闲隐藏」这条渲染约定，并在断言名里标注。
 */
import WebSocket from "ws";

const CDP = process.argv[2] || "http://127.0.0.1:9333";
const BASE = process.argv[3] || "http://127.0.0.1:8099";

// 真实下载状态：判断空闲断言能不能按「真实服务」口径跑
let realState = null;
try { realState = await (await fetch(BASE + "/api/download/state")).json(); } catch (e) { console.log("[env] 取不到 /api/download/state：" + e.message); }
const realIdle = !!realState && realState.active !== true && realState.done !== true && !realState.error;
if (!realIdle) {
  console.log("[env] 后端残留非空闲下载状态，空闲断言改用 stub 空闲态：" +
    JSON.stringify({ active: realState?.active, done: realState?.done, error: realState?.error, file: realState?.file }));
}

const list = await (await fetch(CDP + "/json/list")).json();
const pages = list.filter((t) => t.type === "page" && t.url.includes("8099"));
const page = pages.find((t) => t.url.replace(/\/$/, "") === BASE) || pages[0];
if (!page) { console.log("no page"); process.exit(2); }
const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise((r, j) => { ws.once("open", r); ws.once("error", j); });
let id = 0; const pend = new Map();
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

// 页面里的下载状态假数据（字段对齐 CONTRACT 第二节）
const TOTAL = 491520000;                 // 468.75 MB
const RECEIVED = 206438400;              // 42%
const REMAINING = TOTAL - RECEIVED;      // 271.9 MB
const SPEED = 3355443;                   // ~3.2 MB/s
const FILE = "qwen2.5-0.5b-instruct-q4_k_m.gguf";
const ERRMSG = "磁盘空间不足（探针 stub，不是真的下载失败）";
const baseSt = {
  active: false, done: false, id: "qwen25-05b-q4km", file: FILE,
  received: 0, total: 0, receivedBytes: 0, totalBytes: 0, remainingBytes: 0,
  receivedMB: 0, totalMB: 0, remainingMB: 0, pct: 0,
  speedMBs: 0, speedBytes: 0, etaSec: null, error: null,
  elapsedSec: 0, startedAt: 0, finishedAt: 0, updatedAt: 0,
  lastDataAt: 0, stallSec: 0, elapsedTotalSec: 0,
};
const activeSt = { ...baseSt, active: true, received: RECEIVED, total: TOTAL, receivedBytes: RECEIVED, totalBytes: TOTAL,
  remainingBytes: REMAINING, receivedMB: 196.9, totalMB: 468.8, remainingMB: 271.9, pct: 42,
  speedMBs: 3.21, speedBytes: SPEED, etaSec: 148, elapsedSec: 12,
  startedAt: Date.now() - 12000, lastDataAt: Date.now(), updatedAt: Date.now() };
const stallSt = { ...activeSt, stallSec: 9, speedMBs: 0, speedBytes: 0, etaSec: null, updatedAt: Date.now() };
const failSt = { ...activeSt, active: false, error: ERRMSG, speedBytes: 0, speedMBs: 0, etaSec: null, updatedAt: Date.now() };
const doneSt = { ...baseSt, done: true, received: TOTAL, total: TOTAL, receivedBytes: TOTAL, totalBytes: TOTAL,
  remainingBytes: 0, receivedMB: 468.8, totalMB: 468.8, remainingMB: 0, pct: 100,
  finishedAt: Date.now(), updatedAt: Date.now(), elapsedTotalSec: 83 };
const idleSt = { ...baseSt };

await send("Page.enable"); await send("Runtime.enable");
try { await send("Page.bringToFront"); } catch {}
try { await send("Page.setWebLifecycleState", { state: "active" }); } catch {}   // 防 headless 判定 document.hidden 暂停轮询

// 从「localStorage 无值 = 默认展开」的干净起点开始
await send("Page.navigate", { url: BASE + "/" });
await sleep(3000);
await ev("(function(){ try { localStorage.removeItem('localai.dlPanel'); } catch (e) {} location.reload(); return 1; })()");
await sleep(3400);
// 首启引导/弹窗会盖住顶栏，本探针不需要它（不影响下载条自身的渲染）
await ev("(function(){ var m = document.getElementById('firstModal'); if (m) m.hidden = true; var s = document.getElementById('snapModal'); if (s) s.hidden = true; return 1; })()");
jsErrors = [];
const visState = await ev("document.visibilityState");

// ---- 1) 空闲：真实服务没下载时，下载条不占位 ----
const idle = await ev("(function(){ var g = function(i){ return document.getElementById(i); }; var w = g('dlWrap'), p = g('dlPanel'); return { hasW: !!w, hasP: !!p, wHidden: w ? w.hidden : null, pHidden: p ? p.hidden : null, wrapH: w ? Math.round(w.getBoundingClientRect().height) : -1 }; })()");
if (realIdle) {
  ok("空闲：#dlWrap 存在且 hidden（不占位）", !!idle && idle.hasW && idle.wHidden === true && idle.wrapH <= 0, idle ? JSON.stringify(idle) : "missing");
  ok("空闲：#dlPanel 存在且 hidden", !!idle && idle.hasP && idle.pHidden === true, idle ? JSON.stringify(idle) : "missing");
} else {
  // 后端残留别的下载状态：同一条「空闲隐藏」约定改用 stub 空闲态验证（原因已在 [env] 行打印），
  // 断言数保持一致（还是这 2 条），不因为环境脏就少验。
}

// ---- 装 stub：只换 /api/download/state 的响应，其余透传 ----
const stub = await ev(`(function(){
  if (window.__dlOrigFetch) { window.fetch = window.__dlOrigFetch; }
  window.__dlOrigFetch = window.fetch;
  window.__dlStateCalls = 0;
  window.__dlCancelCalls = [];
  window.__dlStub = null;
  window.fetch = function (u, o) {
    var url = String(u && u.url ? u.url : u);
    if (url.indexOf('/api/download/state') >= 0) {
      window.__dlStateCalls++;
      var body = Object.assign({
        active: false, done: false, id: '', file: '',
        received: 0, total: 0, receivedBytes: 0, totalBytes: 0, remainingBytes: 0,
        receivedMB: 0, totalMB: 0, remainingMB: 0, pct: 0,
        speedMBs: 0, speedBytes: 0, etaSec: null, error: null,
        elapsedSec: 0, startedAt: 0, finishedAt: 0, updatedAt: Date.now(),
        lastDataAt: 0, stallSec: 0, elapsedTotalSec: 0
      }, window.__dlStub || {});
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
    }
    if (url.indexOf('/api/download/cancel') >= 0) {
      var h = (o && o.headers) || {};
      var tok = '';
      try {
        if (typeof h.get === 'function') { tok = h.get('x-local-token') || ''; }
        else { tok = h['x-local-token'] || h['X-Local-Token'] || ''; }
      } catch (e) {}
      window.__dlCancelCalls.push({ url: url, token: tok });
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }));
    }
    return window.__dlOrigFetch.apply(window, arguments);
  };
  return { ok: true };
})()`);
ok("stub 已装好（window.fetch 可替换）", !!stub && stub.ok === true, JSON.stringify(stub));

const setStub = async (obj) => {
  await ev("window.__dlStub = " + JSON.stringify(obj) + "; 1");
  // 页面自带的探针钩子（app.html initDlPanel 里挂的）：立刻催一次，不用干等 1s/4s 轮询窗口
  await ev("(function(){ if (typeof window.dlRefreshNow === 'function') { window.dlRefreshNow(); return true; } return false; })()");
};
const waitFor = async (expr, ms = 8000, step = 200) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await ev(expr)) return true; await sleep(step); }
  return false;
};
const DL = `(function(){
  var g = function(i){ return document.getElementById(i); };
  var txt = function(e){ return e ? (e.textContent || '').trim() : null; };
  var shown = function(e){ if (!e || e.hidden) return false; var r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  var w = g('dlWrap'), chip = g('dlChip'), p = g('dlPanel');
  var fill = g('dlChipFill'), pfill = g('dlFill');
  return {
    wrapShown: shown(w), chipShown: shown(chip), panelShown: shown(p),
    chipText: txt(chip), chipTextEl: txt(g('dlChipText')), speed: txt(g('dlChipSpeed')),
    ico: txt(g('dlChipIco')), pct: txt(g('dlPct')), file: txt(g('dlFile')),
    received: txt(g('dlReceived')), total: txt(g('dlTotal')), left: txt(g('dlLeft')),
    speed2: txt(g('dlSpeed')), eta: txt(g('dlEta')), elapsed: txt(g('dlElapsed')), note: txt(g('dlNote')),
    cancelShown: shown(g('dlCancel')),
    chipTitle: chip ? (chip.title || '') : '',
    chipFillW: fill ? Math.round(fill.getBoundingClientRect().width) : -1,
    panelFillW: pfill ? Math.round(pfill.getBoundingClientRect().width) : -1,
    ls: (function(){ try { return localStorage.getItem('localai.dlPanel'); } catch (e) { return 'ERR'; } })(),
    stateCalls: window.__dlStateCalls || 0,
    visibility: document.visibilityState
  };
})()`;

// 环境残留时：先补验「stub 空闲态 → hidden」，再进入下载中
if (!realIdle) {
  await setStub(idleSt);
  const hid = await waitFor("(function(){ var w = document.getElementById('dlWrap'); return !!w && w.hidden === true; })()", 5000);
  const mid = await ev(DL);
  ok("空闲（stub，因后端残留非空闲状态）：#dlWrap 隐藏且不占位", hid && !!mid && !mid.wrapShown, mid ? "hidden=" + !mid.wrapShown + " stateCalls=" + mid.stateCalls : "missing");
  ok("空闲（stub）：#dlPanel 也隐藏", !!mid && mid.panelShown === false, mid ? "panel=" + mid.panelShown : "missing");
}

// ---- 2) 下载中：stub active（42% / 3.2MB/s / 总量 468.8MB / eta 148s）----
await setStub(activeSt);
const seenActive = await waitFor("(function(){ var c = document.getElementById('dlChip'); var w = document.getElementById('dlWrap'); return !!c && !!w && !w.hidden && /42\\s*%/.test(c.textContent || ''); })()", 10000);
const dl = await ev(DL);
ok("下载中：chip 可见且文本含 42%", !!dl && dl.chipShown && /42\s*%/.test(String(dl.chipText)), dl ? dl.chipText : "missing");
ok("下载中：chip 速度位含 MB/s", !!dl && /MB\s*\/\s*s/i.test(String(dl.speed || dl.chipText)), dl ? String(dl.speed) : "missing");
ok("下载中：#dlChipFill 有实际宽度（进度可见）", !!dl && dl.chipFillW > 0, dl ? dl.chipFillW + "px" : "missing");
ok("下载中：面板默认展开（localStorage 无值时）", !!dl && dl.panelShown && (dl.ls === null || dl.ls === "1"), dl ? "panel=" + dl.panelShown + " ls=" + JSON.stringify(dl.ls) : "missing");
ok("下载中：#dlPct 显示 42%", !!dl && /42\s*%/.test(String(dl.pct)), dl ? String(dl.pct) : "missing");
ok("下载中：#dlTotal 显示总量（468.8MB 口径）", !!dl && /468\.8|0\.46\s*GB|469\s*MB/i.test(String(dl.total)), dl ? String(dl.total) : "missing");
ok("下载中：#dlLeft 显示剩余量", !!dl && /271\.9|0\.27\s*GB|272\s*MB/i.test(String(dl.left)), dl ? String(dl.left) : "missing");
ok("下载中：#dlEta 显示预计剩余（约 N 分/秒）", !!dl && /[分秒]/.test(String(dl.eta)) && !/^—$/.test(String(dl.eta).trim()), dl ? String(dl.eta) : "missing");
ok("下载中：#dlCancel 可见", !!dl && dl.cancelShown === true, dl ? String(dl.cancelShown) : "missing");

// ---- 3) 收起 / 再展开 ----
await ev("document.getElementById('dlCollapse').click(); 1");
await sleep(350);
const col = await ev(DL);
ok("收起：面板隐藏、chip 仍在", !!col && !col.panelShown && col.chipShown, col ? "panel=" + col.panelShown + " chip=" + col.chipShown : "missing");
ok("收起：localStorage localai.dlPanel === '0'", !!col && col.ls === "0", col ? JSON.stringify(col.ls) : "missing");
await ev("document.getElementById('dlChip').click(); 1");
await sleep(350);
const exp = await ev(DL);
ok("再点 chip：面板重新展开、localStorage === '1'", !!exp && exp.panelShown && exp.ls === "1", exp ? "panel=" + exp.panelShown + " ls=" + JSON.stringify(exp.ls) : "missing");

// ---- 4) 卡住：stallSec=9 → 显示「连接中…」且不再摆速度 ----
await setStub(stallSt);
const stalled = await waitFor("(function(){ var c = document.getElementById('dlChip'); return !!c && /连接中/.test(c.textContent || ''); })()", 6000);
const st1 = await ev(DL);
ok("卡住：chip 文本/速度处显示「连接中…」", stalled && !!st1 && /连接中/.test(String(st1.chipText)), st1 ? st1.chipText : "missing");
ok("卡住：不再显示 MB/s 假速度", !!st1 && !/MB\s*\/\s*s/i.test(String(st1.chipText)), st1 ? st1.chipText : "missing");

// ---- 7) 取消：stub 拦 /api/download/cancel，点 #dlCancel 恰好 1 次 ----
await setStub(activeSt);
await waitFor("(function(){ var b = document.getElementById('dlCancel'); return !!b && !b.hidden && b.getBoundingClientRect().width > 0; })()", 6000);
await ev("document.getElementById('dlCancel').click(); 1");
await sleep(600);
const cancel = await ev("(function(){ var a = window.__dlCancelCalls || []; return { n: a.length, calls: a }; })()");
ok("取消：点 #dlCancel 恰好调用 1 次 /api/download/cancel", !!cancel && cancel.n === 1, cancel ? "calls=" + cancel.n + " " + JSON.stringify(cancel.calls).slice(0, 120) : "missing");
ok("取消：请求带 x-local-token", !!cancel && cancel.n === 1 && !!cancel.calls[0].token && /\/api\/download\/cancel/.test(cancel.calls[0].url), cancel && cancel.calls[0] ? "token=" + (cancel.calls[0].token ? "有(" + cancel.calls[0].token.length + "字符)" : "空") : "missing");

// ---- 8) 窄窗 850px（175% 缩放等价）：不溢出、chip 不竖排 ----
// 测量口径（2026-11-11 定稿，别再退回 body.scrollWidth）：
// app.html 里 header::before 是 HUD 扫光装饰（left:0;top:0;height:1px;width:26%，
// animation:sweep 7s linear infinite，translateX 从 -110% 扫到 480%）。它是伪元素，
// querySelectorAll 看不到，但 transform 溢出会把 header.scrollWidth / body.scrollWidth
// 随 7 秒周期撑大（实测同一状态 850→878→960→1042→1126）；而 body 是 overflow:hidden，
// 用户根本看不到横向滚动条。所以「body.scrollWidth <= innerWidth + 2」测的是装饰层，
// 相位一变就假红（probe-ui-debug 以前能过只是量在扫光位于左侧的时刻）。
// 这里改成两条「用户可见」的断言：
//   a) 尝试横向滚动后 scrollX 仍为 0（量之前临时切 prefers-reduced-motion：
//      app.html 的 @media 会关掉扫光动画，排除装饰 transform 溢出的干扰）；
//   b) 遍历真实 DOM（body *，只算 rect.width > 0），没有任何元素 rect.right > innerWidth + 2
//      —— 伪元素不在 DOM 里，因此不会误报。
await setStub(activeSt);
await waitFor("(function(){ var c = document.getElementById('dlChip'); return !!c && /42\s*%/.test(c.textContent || ''); })()", 6000);
await send("Emulation.setEmulatedMedia", { media: "", features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
await send("Emulation.setDeviceMetricsOverride", { width: 850, height: 700, deviceScaleFactor: 1, mobile: false });
await sleep(1200);
const narrow = await ev(`(function(){
  var g = function(i){ return document.getElementById(i); };
  var chip = g('dlChip'), sp = g('dlChipSpeed'), w = g('dlWrap'), panel = g('dlPanel');
  var r = chip ? chip.getBoundingClientRect() : { width: 0, height: 0, right: 0 };
  var pr = panel && !panel.hidden ? panel.getBoundingClientRect() : { right: -1 };
  var spShown = !!sp && !sp.hidden && getComputedStyle(sp).display !== 'none' && sp.getBoundingClientRect().width > 0;
  // a) 尝试横向滚动：用户能滚说明真有可见溢出
  window.scrollTo(9999, 0);
  var sx = window.scrollX;
  window.scrollTo(0, 0);
  // b) 真实 DOM 元素是否超出视口（伪元素不会被 querySelectorAll 选中，正好排除 HUD 扫光）
  var over = [];
  var all = document.querySelectorAll('body *');
  for (var i = 0; i < all.length; i++) {
    var e = all[i]; if (!(e instanceof Element)) continue;
    var b = e.getBoundingClientRect();
    if (b.width > 0 && b.right > innerWidth + 2) over.push(e.tagName + '#' + (e.id || '') + '.' + String(e.className || '').slice(0, 18) + ' right=' + Math.round(b.right));
  }
  return { win: innerWidth, bodyScroll: document.body.scrollWidth, chipH: Math.round(r.height), chipW: Math.round(r.width),
    chipRight: Math.round(r.right), panelRight: Math.round(pr.right),
    scrollXAfter: sx, realOverflow: over.slice(0, 10),
    reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
    chipShown: !!w && !w.hidden, speedShown: spShown, text: chip ? chip.textContent.trim() : '' };
})()`);
ok("窄窗 850px：chip 不竖排（高度 ≤44）", !!narrow && narrow.chipShown && narrow.chipH > 0 && narrow.chipH <= 44, narrow ? narrow.chipH + "px · " + narrow.text : "missing");
const realOverflowOk = !!narrow && narrow.realOverflow.length === 0;
ok("窄窗 850px：真实 DOM 元素都不超出视口（不量 body.scrollWidth：HUD 扫光 header::before 是伪元素，会随 7s 动画撑大它，用户不可见）",
  realOverflowOk && narrow.chipRight <= narrow.win + 2 && (narrow.panelRight <= 0 || narrow.panelRight <= narrow.win + 2),
  narrow ? "win " + narrow.win + " · 越界 " + (narrow.realOverflow.length ? JSON.stringify(narrow.realOverflow) : "0 个") +
    " · chipRight " + narrow.chipRight + " · panelRight " + narrow.panelRight : "missing");
ok("窄窗 850px：横向滚不动（scrollTo(9999,0) 后 scrollX 仍为 0；量前切 prefers-reduced-motion 排除扫光装饰的 transform 溢出）",
  !!narrow && narrow.scrollXAfter === 0, narrow ? "scrollX=" + narrow.scrollXAfter + " · reduced=" + narrow.reduced : "missing");
if (!realOverflowOk || (narrow && narrow.scrollXAfter !== 0)) {
  // 探针自诊断：真溢出时把「是谁把宽度撑出去」打出来，避免只报一个数字没法归因
  const nd = await ev(`(function(){
    var out = [];
    var all = document.querySelectorAll('body *');
    for (var i = 0; i < all.length; i++) {
      var e = all[i]; if (!(e instanceof Element)) continue;
      var cs = getComputedStyle(e); var r = e.getBoundingClientRect();
      var right = Math.round(r.right), w = Math.round(r.width);
      if ((w > 0 && right > innerWidth + 2) || e.scrollWidth > e.clientWidth + 3) {
        out.push({ tag: e.tagName, id: e.id, cls: String(e.className).slice(0, 22), right: right, w: w, sw: e.scrollWidth, cw: e.clientWidth, pos: cs.position, ox: cs.overflowX });
      }
    }
    return { win: innerWidth, bodyW: document.body.scrollWidth, docW: document.documentElement.scrollWidth,
      toasts: document.querySelectorAll('#toasts .toast').length,
      scrollX: scrollX, scrollY: scrollY, active: (document.activeElement || {}).id, list: out.slice(0, 15) };
  })()`);
  console.log("  [diag] 窄窗溢出：" + JSON.stringify(nd));
}
ok("窄窗 850px：隐藏速度位、chip 不超 150px", !!narrow && narrow.speedShown === false && narrow.chipW <= 152, narrow ? "speedShown=" + narrow.speedShown + " w=" + narrow.chipW : "missing");
await send("Emulation.clearDeviceMetricsOverride");
await send("Emulation.setEmulatedMedia", { media: "", features: [] });
await sleep(600);

// ---- 6) 失败：stub error → chip「下载失败」、note 写错误原因、不显示取消 ----
await setStub(failSt);
const failed = await waitFor("(function(){ var c = document.getElementById('dlChip'); return !!c && /失败/.test(c.textContent || ''); })()", 8000);
const fl = await ev(DL);
ok("失败：chip 文本含「失败」", failed && !!fl && /失败/.test(String(fl.chipText)), fl ? fl.chipText : "missing");
ok("失败：#dlCancel 隐藏", !!fl && fl.cancelShown === false, fl ? String(fl.cancelShown) : "missing");
ok("失败：note 显示错误文案", !!fl && String(fl.note).indexOf("磁盘空间不足") >= 0, fl ? String(fl.note) : "missing");
ok("失败：chip title 带错误原因", !!fl && String(fl.chipTitle).indexOf("磁盘空间不足") >= 0, fl ? String(fl.chipTitle) : "missing");

// ---- 5) 完成：stub done → chip「下载完成」、note 已完成、取消隐藏 ----
await setStub(doneSt);
const isDone = await waitFor("(function(){ var c = document.getElementById('dlChip'); return !!c && /完成/.test(c.textContent || ''); })()", 8000);
const dn = await ev(DL);
ok("完成：chip 文本含「完成」", isDone && !!dn && /完成/.test(String(dn.chipText)), dn ? dn.chipText : "missing");
ok("完成：chip 图标变 ✓", !!dn && /✓|✔/.test(String(dn.ico)), dn ? String(dn.ico) : "missing");
ok("完成：#dlCancel 隐藏", !!dn && dn.cancelShown === false, dn ? String(dn.cancelShown) : "missing");
ok("完成：note 含「已完成」", !!dn && /已完成/.test(String(dn.note)), dn ? String(dn.note) : "missing");
ok("完成：速度位改显示总量（468.8MB 口径）", !!dn && /468\.8|0\.46\s*GB|469\s*MB/i.test(String(dn.speed || dn.chipText)), dn ? String(dn.speed) : "missing");

// ---- 收尾：恢复 fetch、无未捕获异常、回主界面（页面按真实后端状态渲染，证明 stub 没残留） ----
const restored = await ev("(function(){ if (window.__dlOrigFetch) { window.fetch = window.__dlOrigFetch; } return window.fetch === window.__dlOrigFetch; })()");
ok("收尾：window.fetch 已恢复（其余请求不受影响）", restored === true, String(restored));
ok("全程无未捕获 JS 异常", jsErrors.length === 0, jsErrors.slice(0, 3).join(" | "));
await send("Page.navigate", { url: BASE + "/" });
await sleep(2800);
let realAfter = null;
try { realAfter = await (await fetch(BASE + "/api/download/state")).json(); } catch (e) {}
const back = await ev("(function(){ var w = document.getElementById('dlWrap'); var st = document.getElementById('status'); return { main: !!document.getElementById('debugBtn'), dl: !!w, wHidden: w ? w.hidden : null, chip: document.getElementById('dlChip') ? document.getElementById('dlChip').textContent.trim() : '', status: st ? (st.textContent || '').trim().slice(0, 40) : '' }; })()");
const realPhase = realAfter ? (realAfter.active ? 'active' : realAfter.done ? 'done' : String(realAfter.error || '').trim() ? (String(realAfter.error).trim() === '已取消' ? 'cancel' : 'error') : 'idle') : 'unknown';
const expectShown = realPhase === 'idle' ? back && back.wHidden === true : back && back.wHidden === false;
ok("收尾：回主界面，下载条按真实后端状态显示（stub 未残留）", !!back && back.main && expectShown, back ? "realPhase=" + realPhase + " " + JSON.stringify(back) : "missing");

console.log("\nRESULT " + pass + "/" + (pass + fail));
ws.close();
process.exit(fail ? 1 : 0);

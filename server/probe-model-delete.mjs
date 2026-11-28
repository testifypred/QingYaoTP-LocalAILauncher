/**
 * 删除模型文件探针（API + 界面，Edge CDP）
 *
 *   node probe-model-delete.mjs [cdp] [base]
 *   默认 http://127.0.0.1:9333 / http://127.0.0.1:8099
 *
 * 契约：server/docs/feature-model-delete-2026-11-11/CONTRACT.md 第四节。
 * 覆盖 API 10 组 + 界面 4 组：
 *   API：无令牌 403 / 路径穿越 400（两种载荷）/ 非 .gguf 400 / 不存在 404 /
 *        dryRun 单文件不删 / dryRun 分片整组识别 / 真删单文件（recycled 布尔）/
 *        /api/state.models 立即不再列出 / 真删分片整组 / 已加载模型拒绝（条件）
 *   UI ：模型行 .modelDel 删除键 → 确认弹窗（dryRun，文件还在）→ 取消（文件还在）→
 *        确认（文件消失、行消失、toast 含「已删除」）→ 0 未捕获异常 → 收尾清理。
 *
 * 安全边界（硬约束，别放宽）：
 *   - 只在 MODEL_DIR 下创建/删除 probe-del-* 前缀的假 .gguf（4KB ASCII 文本）；
 *   - 绝不加载模型、不下载、不清 sessions、不碰真实模型 / dist；
 *   - 「已加载模型拒绝」那条：先用 dryRun 探一次 409（dryRun 与真删共用同一条守卫，
 *     见 app.mjs deleteModelFiles：loaded 检查在 dryRun 分支之前），只有拿到 409
 *     且重新读 /api/state 确认 loaded 还是同一个文件，才补一次真删——代码路径相同、
 *     守卫已被证明有效；万一把来的代码把守卫改坏，也不会真的删掉用户的模型；
 *   - 收尾无条件 unlink 所有 probe-del-* 残留，并把页面导航回主界面。
 *
 * 环境：开发服务 8099 跑源码即可（app.html 每次请求现读，改完不用重启）。
 * 界面探针需要一个跑在 9333 的 Edge（自己起 headless，别和别人抢端口）：
 *   msedge --headless=new --remote-debugging-port=9333 --user-data-dir=%TEMP%\edge-probe-md
 *          --window-size=1440,900 --no-first-run about:blank
 */
import fs from "node:fs";
import path from "node:path";
import WebSocket from "ws";

const CDP = process.argv[2] || "http://127.0.0.1:9333";
const BASE = process.argv[3] || "http://127.0.0.1:8099";

// 只碰这个前缀；改这里等于改安全边界，别改
const PREFIX = "probe-del-";
const SINGLE = PREFIX + "single.gguf";
const SHARD1 = PREFIX + "shard-00001-of-00002.gguf";
const SHARD2 = PREFIX + "shard-00002-of-00002.gguf";
const UIFILE = PREFIX + "ui.gguf";
const FAKE_SIZE = 4096;

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; console.log("  ok   " + name + (detail ? "  [" + detail + "]" : "")); }
  else { fail++; console.log("  FAIL " + name + "  " + detail); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- 服务端信息（令牌 / 模型目录 / 已加载）
let state = null;
try { state = await (await fetch(BASE + "/api/state")).json(); }
catch (e) { console.log("取不到 /api/state：" + e.message); process.exit(2); }
const TOKEN = String(state?.localToken || "");
const MODEL_DIR = String(state?.modelDir || "");
const loadedAtStart = String(state?.loaded || "");
if (!MODEL_DIR || !fs.existsSync(MODEL_DIR)) { console.log("拿不到模型目录（/api/state.modelDir），退出"); process.exit(2); }
if (!TOKEN) { console.log("拿不到本地令牌（/api/state.localToken），退出"); process.exit(2); }

const full = (name) => path.join(MODEL_DIR, name);
const exists = (name) => { try { return fs.statSync(full(name)).isFile(); } catch { return false; } };
const fakeBody = "QingYaoTP probe fake model file, safe to delete. ".repeat(200).slice(0, FAKE_SIZE); // 纯 ASCII，恰好 4096 字节
const makeFake = (name) => fs.writeFileSync(full(name), fakeBody, "utf8");

/** 清掉所有 probe-del-* 残留（返回清理前看到的数量与成功删除数） */
const cleanFakes = () => {
  let names = [];
  try { names = fs.readdirSync(MODEL_DIR).filter((n) => n.startsWith(PREFIX)); } catch {}
  let removed = 0;
  for (const n of names) { try { fs.unlinkSync(full(n)); removed++; } catch {} }
  return { found: names.length, removed };
};

const delReq = async (body, withToken = true) => {
  const headers = { "content-type": "application/json" };
  if (withToken) headers["x-local-token"] = TOKEN;
  const r = await fetch(BASE + "/api/models/delete", { method: "POST", headers, body: JSON.stringify(body) });
  let j = null;
  try { j = await r.json(); } catch {}
  return { status: r.status, j };
};
const errText = (r) => String(r?.j?.error?.message || r?.j?.message || "");

const residue = cleanFakes();
console.log("[env] base=" + BASE + " · cdp=" + CDP);
console.log("[env] modelDir=" + MODEL_DIR + " · 已加载=" + (loadedAtStart || "（无）") +
  " · 现有模型 " + ((state.models || []).length) + " 个 · 本地令牌 " + TOKEN.length + " 字符");
if (residue.found) console.log("[env] 清掉上次残留 " + residue.removed + "/" + residue.found + " 个 probe-del-* 假文件");

// ================================================================ API 部分
console.log("\n-- API ----------------------------------------------------------");

// 1) 没令牌 → 403
const a1 = await delReq({ file: SINGLE }, false);
ok("API 1 没带 x-local-token → 403", a1.status === 403 && !!errText(a1),
  "status=" + a1.status + " msg=" + errText(a1));

// 2) 路径穿越 → 400（../ 与子目录两种载荷）
const a2 = await delReq({ file: "../evil.gguf" });
ok("API 2a ../evil.gguf → 400（路径穿越）", a2.status === 400 && !!errText(a2),
  "status=" + a2.status + " msg=" + errText(a2));
const a2b = await delReq({ file: "sub/x.gguf" });
ok("API 2b sub/x.gguf → 400（路径穿越）", a2b.status === 400 && !!errText(a2b),
  "status=" + a2b.status + " msg=" + errText(a2b));

// 3) 非 .gguf → 400
const a3 = await delReq({ file: PREFIX + "x.txt" });
ok("API 3 非 .gguf（probe-del-x.txt）→ 400", a3.status === 400 && !!errText(a3),
  "status=" + a3.status + " msg=" + errText(a3));

// 4) 不存在 → 404
const a4 = await delReq({ file: PREFIX + "missing.gguf" });
ok("API 4 不存在（probe-del-missing.gguf）→ 404", a4.status === 404 && !!errText(a4),
  "status=" + a4.status + " msg=" + errText(a4));

// 5) 造 4KB 假文件：单文件 + 两片分片
makeFake(SINGLE); makeFake(SHARD1); makeFake(SHARD2);
const sizes = [SINGLE, SHARD1, SHARD2].map((n) => { try { return fs.statSync(full(n)).size; } catch { return -1; } });
ok("API 5 造 3 个 probe-del-* 假文件（4KB/个）", sizes.every((s) => s === FAKE_SIZE),
  [SINGLE, SHARD1, SHARD2].map((n, i) => n + "=" + sizes[i] + "B").join(" · "));

// 6) dryRun 单文件：只校验、不删
const a6 = await delReq({ file: SINGLE, dryRun: true });
const j6 = a6.j || {};
ok("API 6 dryRun 单文件 → shardCount:1/totalBytes>0 且文件还在",
  a6.status === 200 && j6.ok === true && j6.dryRun === true && j6.shardCount === 1 &&
  Number(j6.totalBytes) > 0 && Array.isArray(j6.files) && j6.files.length === 1 && exists(SINGLE),
  "status=" + a6.status + " shardCount=" + j6.shardCount + " totalBytes=" + j6.totalBytes + " 文件还在=" + exists(SINGLE));

// 7) dryRun 传第二片：整组识别（shardCount:2），两片都还在
const a7 = await delReq({ file: SHARD2, dryRun: true });
const j7 = a7.j || {};
const names7 = (j7.files || []).map((f) => f.name).sort();
ok("API 7 dryRun 传第二片 → shardCount:2（整组）且两片都在",
  a7.status === 200 && j7.dryRun === true && j7.shardCount === 2 &&
  names7.length === 2 && names7[0] === SHARD1 && names7[1] === SHARD2 &&
  exists(SHARD1) && exists(SHARD2),
  "status=" + a7.status + " shardCount=" + j7.shardCount + " files=" + JSON.stringify(names7) +
  " 都在=" + (exists(SHARD1) && exists(SHARD2)));

// 8) 真删单文件：recycled 是布尔、文件真的没了
const a8 = await delReq({ file: SINGLE });
const j8 = a8.j || {};
ok("API 8 真删单文件 → ok/dryRun:false/recycled 布尔、文件真的没了",
  a8.status === 200 && j8.ok === true && j8.dryRun === false && typeof j8.recycled === "boolean" &&
  Array.isArray(j8.files) && j8.files.length === 1 && !exists(SINGLE),
  "status=" + a8.status + " recycled=" + j8.recycled + " files=" + (j8.files || []).length + " 文件还在=" + exists(SINGLE));

// 8b) /api/state.models 立即不再列出已删文件
const stAfter = await (await fetch(BASE + "/api/state")).json();
const stillListed = (stAfter.models || []).some((m) => m.file === SINGLE);
ok("API 8b /api/state.models 立即不再列出已删文件", !stillListed,
  "listed=" + stillListed + " · 现在 " + ((stAfter.models || []).length) + " 个模型");

// 9) 真删分片整组（传第二片）→ shardCount:2、两片都没了
const a9 = await delReq({ file: SHARD2 });
const j9 = a9.j || {};
ok("API 9 真删分片组（传第二片）→ shardCount:2、两片都没了",
  a9.status === 200 && j9.ok === true && j9.shardCount === 2 && !exists(SHARD1) && !exists(SHARD2),
  "status=" + a9.status + " shardCount=" + j9.shardCount + " recycled=" + j9.recycled +
  " 残留=" + JSON.stringify([SHARD1, SHARD2].filter(exists)));

// 10) 已加载模型拒绝（条件）：没加载就记跳过，断言数不变
if (loadedAtStart) {
  const d1 = await delReq({ file: loadedAtStart, dryRun: true });
  const nowLoaded = String((await (await fetch(BASE + "/api/state")).json()).loaded || "");
  // 只有守卫已经用 dryRun 证明有效、且 loaded 没变，才补一次真删（代码路径相同，安全）
  let d2 = null;
  if (d1.status === 409 && nowLoaded === loadedAtStart) d2 = await delReq({ file: loadedAtStart });
  ok("API 10 已加载模型拒绝删除 → 409 且文件仍在",
    d1.status === 409 && (!d2 || d2.status === 409) && exists(loadedAtStart),
    "loaded=" + loadedAtStart + " dryRun.status=" + d1.status + " 真删.status=" + (d2 ? d2.status : "未补（守卫未证明）") +
    " msg=" + errText(d1) + " 文件还在=" + exists(loadedAtStart));
} else {
  ok("API 10 已加载模型拒绝删除（跳过：当前没有加载模型；断言数不变）", true, "state.loaded 为空");
}

// ================================================================ 界面部分（CDP）
console.log("\n-- UI -----------------------------------------------------------");

// 连 CDP：优先已有 8099 页面，否则用第一个 page（自己起的 headless 初始是 about:blank）
let page = null;
try {
  const list = await (await fetch(CDP + "/json/list")).json();
  const pages = list.filter((t) => t.type === "page");
  page = pages.find((t) => t.url.includes("8099")) || pages[0];
} catch (e) { console.log("CDP 不可达（" + CDP + "）：" + e.message); process.exit(2); }
if (!page) { console.log("no page（" + CDP + "/json/list 里没有 page）"); process.exit(2); }

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
const send = (method, params = {}) => new Promise((res) => {
  const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params }));
});
const ev = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(String(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text).slice(0, 300));
  return r.result?.result?.value;
};
const waitDom = async (expr, ms = 8000, step = 200) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { if (await ev(expr)) return true; } catch {}
    await sleep(step);
  }
  return false;
};
const waitNoFile = async (name, ms = 40000, step = 250) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (!exists(name)) return true; await sleep(step); }
  return false;
};

await send("Page.enable"); await send("Runtime.enable");
try { await send("Page.bringToFront"); } catch {}
try { await send("Page.setWebLifecycleState", { state: "active" }); } catch {} // 防 headless 把后台轮询节流掉
await send("Page.navigate", { url: BASE + "/" });
await sleep(3200);
// 首启引导面板会盖住顶栏（程序化点击不受影响，但先关掉更贴近真实环境）
await ev("(function(){ var m = document.getElementById('firstModal'); if (m) m.hidden = true; return 1; })()");

// 拦截 /api/load：万一 .modelDel 没 stopPropagation 触发了行加载，只计数、绝不真的加载假模型
await ev("(function () {" +
  "if (window.__pdOrigFetch) window.fetch = window.__pdOrigFetch;" +
  "window.__pdOrigFetch = window.fetch;" +
  "window.__pdLoadCalls = 0;" +
  "window.fetch = function (u, o) {" +
  "  var url = String(u && u.url ? u.url : u);" +
  "  if (url.indexOf('/api/load') >= 0) {" +
  "    window.__pdLoadCalls++;" +
  "    return Promise.resolve(new Response(JSON.stringify({ error: { message: 'probe：不应触发行加载' } }), " +
  "      { status: 500, headers: { 'content-type': 'application/json' } }));" +
  "  }" +
  "  return window.__pdOrigFetch.apply(window, arguments);" +
  "};" +
  "return true;" +
  "})()");

const ROW_ARR = "var rows = [].slice.call(document.querySelectorAll('#modelSel .modelRow'));";
const rowExpr = (body) => "(function () { " + ROW_ARR +
  " var row = rows.filter(function (r) { return r.dataset.file === " + JSON.stringify(UIFILE) + "; })[0]; " + body + " })()";
const MODALINFO = "(function () {" +
  "var g = function (i) { return document.getElementById(i); };" +
  "var shown = function (e) { if (!e || e.hidden) return false; var r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };" +
  "var m = g('delModelModal'), nm = g('delModelName'), meta = g('delModelMeta');" +
  "return {" +
  " modal: shown(m)," +
  " name: nm ? (nm.textContent || '').trim() : null," +
  " meta: meta ? (meta.textContent || '').trim() : null," +
  " cancel: shown(g('delModelCancel'))," +
  " confirm: shown(g('delModelConfirm'))," +
  " loadCalls: window.__pdLoadCalls || 0," +
  " userPicked: (typeof userPicked === 'boolean') ? userPicked : null," +
  " sel: (typeof selectedModel === 'string') ? selectedModel : ''" +
  "};" +
  "})()";

// 造 UI 用的假模型，等页面 refresh() 收进菜单
makeFake(UIFILE);
jsErrors = []; // 从这里开始算「界面操作期间的未捕获异常」，排除页面启动噪声
await ev("(function(){ return (typeof refresh === 'function') ? refresh().then(function(){ return 1; }).catch(function(){ return 0; }) : 0; })()");
await sleep(600);
await ev("(function(){ var m = document.getElementById('modelMenu'); if (m) m.hidden = true; return 1; })()");
await ev("document.getElementById('modelBtn').click(); 1");
await sleep(400);

const rowInfo = await ev(rowExpr(
  "if (!row) return { rows: rows.length, found: false };" +
  "var del = row.querySelector('.modelDel');" +
  "var rr = row.getBoundingClientRect();" +
  "var dr = del ? del.getBoundingClientRect() : null;" +
  "return { rows: rows.length, found: true, hasDel: !!del, delText: del ? (del.textContent || '').trim() : '', delSvg: !!(del && del.querySelector('svg'))," +
  " menuOpen: document.getElementById('modelMenu').hidden === false," +
  " rowW: Math.round(rr.width), rowH: Math.round(rr.height)," +
  " delW: dr ? Math.round(dr.width) : -1, delH: dr ? Math.round(dr.height) : -1 };"));
ok("UI 11 假模型 probe-del-ui.gguf 出现在菜单且行内有 .modelDel 删除键（v1.11.2 起为垃圾桶 SVG，无文字）",
  !!rowInfo && rowInfo.found === true && rowInfo.hasDel === true && rowInfo.menuOpen === true &&
  rowInfo.delSvg === true && rowInfo.delH > 0,
  rowInfo ? "rows=" + rowInfo.rows + " del=" + JSON.stringify(rowInfo.delText) + " svg=" + rowInfo.delSvg + " " + rowInfo.delW + "x" + rowInfo.delH + " 菜单开=" + rowInfo.menuOpen : "missing");

// 点「删」→ dryRun → 弹窗
await ev(rowExpr("var d = row ? row.querySelector('.modelDel') : null; if (!d) return { clicked: false }; d.click(); return { clicked: true };"));
const modalUp = await waitDom("(function(){ var m = document.getElementById('delModelModal'); return !!m && m.hidden === false; })()", 12000);
const mi = await ev(MODALINFO);
const dryFileAlive = exists(UIFILE);
ok("UI 12 点「删」弹确认框（文件名/文件数/大小/取消/确认），dryRun 期间文件还在",
  modalUp && !!mi && mi.modal === true &&
  String(mi.name || "").includes(UIFILE.replace(/\.gguf$/i, "")) &&
  /个文件/.test(String(mi.meta)) && /1/.test(String(mi.meta)) && /(MB|GB|KB)/.test(String(mi.meta)) &&
  mi.cancel === true && mi.confirm === true && dryFileAlive,
  mi ? "name=" + JSON.stringify(mi.name) + " meta=" + JSON.stringify(mi.meta) +
    " cancel=" + mi.cancel + " confirm=" + mi.confirm + " 文件还在=" + dryFileAlive : "missing");
ok("UI 12b 点「删」不触发行选中/加载（.modelDel stopPropagation；/api/load 0 次、userPicked 仍 false）",
  !!mi && mi.loadCalls === 0 && mi.userPicked !== true,
  mi ? "loadCalls=" + mi.loadCalls + " userPicked=" + mi.userPicked + " selectedModel=" + JSON.stringify(mi.sel) : "missing");

// 取消 → 弹窗关闭、文件仍在
await ev("(function(){ var b = document.getElementById('delModelCancel'); if (b) b.click(); return 1; })()");
await sleep(450);
const cancelState = await ev("(function(){ var m = document.getElementById('delModelModal'); return { modal: !!m && m.hidden === false }; })()");
const cancelFileAlive = exists(UIFILE);
ok("UI 13 取消 → 弹窗关闭、文件仍在", cancelState.modal === false && cancelFileAlive,
  "modal=" + cancelState.modal + " 文件还在=" + cancelFileAlive);

// 再点「删」→ 确认 → 文件消失、弹窗关闭、行消失、toast 含「已删除」
await ev("(function(){ var m = document.getElementById('modelMenu'); if (m) m.hidden = true; return 1; })()");
await ev("document.getElementById('modelBtn').click(); 1");
await sleep(350);
const reopenReady = await waitDom(rowExpr(
  "var d = row ? row.querySelector('.modelDel') : null;" +
  "return !!d && document.getElementById('modelMenu').hidden === false;"), 8000);
await ev(rowExpr("var d = row ? row.querySelector('.modelDel') : null; if (!d) return { clicked: false }; d.click(); return { clicked: true };"));
const modalUp2 = await waitDom("(function(){ var m = document.getElementById('delModelModal'); return !!m && m.hidden === false; })()", 12000);
await ev("(function(){ var b = document.getElementById('delModelConfirm'); if (b) b.click(); return 1; })()");
const deletedFs = await waitNoFile(UIFILE, 40000);
const rowGone = await waitDom("(function () { " + ROW_ARR +
  " return rows.every(function (r) { return r.dataset.file !== " + JSON.stringify(UIFILE) + "; }); })()", 10000);
const afterDel = await ev("(function () {" +
  "var m = document.getElementById('delModelModal');" +
  "var toasts = [].slice.call(document.querySelectorAll('#toasts .toast'));" +
  "return { modal: !!m && m.hidden === false, toastCount: toasts.length," +
  " lastToast: toasts.length ? (toasts[toasts.length - 1].textContent || '').trim() : ''," +
  " allToasts: toasts.map(function (t) { return (t.textContent || '').trim(); }).join(' | ') };" +
  "})()");
ok("UI 14 确认删除 → 文件消失、弹窗关闭、行不再存在、toast 含「已删除」",
  reopenReady && modalUp2 && deletedFs && rowGone && afterDel.modal === false &&
  /已删除/.test(String(afterDel.lastToast || afterDel.allToasts)),
  "reopen=" + reopenReady + " modal2=" + modalUp2 + " 文件消失=" + deletedFs + " 行消失=" + rowGone +
  " 弹窗=" + afterDel.modal + " toast=" + JSON.stringify(afterDel.lastToast));

// 全场 0 未捕获异常
ok("全程 0 未捕获 JS 异常", jsErrors.length === 0, jsErrors.slice(0, 3).join(" | "));

// ================================================================ 收尾
const left = cleanFakes();
ok("收尾：probe-del-* 假文件全部清掉（API/UI 残留都没有）", left.found === 0,
  "残留 " + left.found + " 个（本轮已清 " + left.removed + "）");
await ev("(function () { if (window.__pdOrigFetch) window.fetch = window.__pdOrigFetch; return 1; })()");
await send("Page.navigate", { url: BASE + "/" });
await sleep(2800);
const back = await ev("(function () {" +
  "var rows = [].slice.call(document.querySelectorAll('#modelSel .modelRow'));" +
  "var probes = rows.filter(function (r) { return /^probe-del-/.test(String(r.dataset.file || '')); });" +
  "return { main: !!document.getElementById('modelBtn'), probes: probes.length, rows: rows.length };" +
  "})()");
ok("收尾：页面已回主界面且菜单里没有 probe-del-* 残留行",
  !!back && back.main === true && back.probes === 0,
  back ? "main=" + back.main + " probe行=" + back.probes + " 模型行=" + back.rows : "missing");

console.log("\nRESULT " + pass + "/" + (pass + fail));
ws.close();
process.exit(fail ? 1 : 0);

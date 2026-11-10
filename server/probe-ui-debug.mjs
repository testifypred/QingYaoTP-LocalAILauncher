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
// 页面口径：有已加载模型就显示它的品牌；没有已加载模型时跟随选项卡里选中的模型
//（userPicked 之前默认选中产物目录第一个）。所以期望品牌要按 loaded || selected 算，
// 只看 loaded 会在「选了没加载」时误判成应该回退 ∫。
let selectedFile = "";
try { selectedFile = await ev("(() => { try { return typeof selectedModel === 'string' ? selectedModel : ''; } catch (e) { return ''; } })()"); } catch {}
const wantBrand = brandOf(loadedFile || selectedFile);
const mark = await ev("(() => { const box = document.querySelector('#modelBtn .int'); const img = document.getElementById('modelBtnImg'); const b = box?.querySelector('b'); if (!box || !img) return null; const cs = getComputedStyle(box); const r = img.getBoundingClientRect(); return { glyph: b?.textContent || '', q: box.querySelector('i')?.textContent || '', hasBrand: box.classList.contains('has-brand'), imgShown: !img.hidden && !!img.getAttribute('src'), src: img.getAttribute('src') || '', alt: img.getAttribute('alt') || '', bg: cs.backgroundColor, iw: Math.round(r.width), ih: Math.round(r.height) }; })()");
if (wantBrand) {
  ok("模型按钮显示（已加载/已选中）模型的品牌图标", !!mark && mark.hasBrand === true && mark.imgShown === true && mark.src === "/vendor/models/" + wantBrand + ".png",
    (mark ? mark.src : "missing") + " · loaded=" + (loadedFile || "—") + " · selected=" + (selectedFile || "—"));
  ok("品牌图标有实际尺寸", !!mark && mark.iw >= 16 && mark.ih >= 16, mark ? mark.iw + "x" + mark.ih : "");
  ok("品牌图标不套黑底（回退标记此时隐藏）", !!mark && mark.hasBrand === true && /rgba?\(0, 0, 0, 0\)|transparent/.test(mark.bg), mark?.bg || "");
} else {
  ok("没加载模型/认不出品牌时回退 ∫ 标记（不显示品牌图）", !!mark && mark.hasBrand === false && mark.imgShown === false, mark ? JSON.stringify(mark.src) : "missing");
}
ok("回退标记仍是 ∫（不定积分，本体图标；问号属于调试图标）", !!mark && mark.glyph === "∫" && mark.q === "", mark ? mark.glyph + "/" + JSON.stringify(mark.q) : "missing");

// ---- 首次启动「自动检查用户配置」（modal 里 ⓪ 段） ----
const firstRun = await ev("(async () => { if (typeof firstRunOpen !== 'function') return null; await firstRunOpen(); await new Promise(function (r) { setTimeout(r, 700); }); const box = document.getElementById('frSysBox'); const rows = document.querySelectorAll('#frSysBox .frChk').length; const btn = document.getElementById('frApply'); const body = (box && box.textContent) || ''; document.getElementById('firstModal').hidden = true; return { rows: rows, btn: !!btn, okv: body.indexOf('建议配置') >= 0, head: body.slice(0, 90) }; })()");
ok("首启页有「自动检查用户配置」（硬件检查项 + 建议配置）", !!firstRun && firstRun.rows >= 5 && firstRun.okv === true, firstRun ? firstRun.rows + " 项 · " + firstRun.head : "missing");
ok("首启页有「按建议配置」按钮", !!firstRun && firstRun.btn === true, firstRun ? String(firstRun.btn) : "missing");

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
const ui = await ev("({ items: document.querySelectorAll('#checks li[data-id]').length, groups: document.querySelectorAll('#checks li.grp').length, pills: document.querySelectorAll('#pills .pill').length, log: (document.getElementById('logBox').textContent || '').length, title: document.title, env: document.querySelectorAll('#env b').length, model: document.querySelectorAll('#model b').length })");
ok("调试页标题正确", /Debugging Tool/.test(ui.title || ""), ui.title);
// v2 起 #checks 里混有组头 li.grp，只数真正的检查项，避免「靠组头凑数」
ok("渲染了检查项（>=12，不含组头）", ui.items >= 12, "items=" + ui.items + " · 组头=" + ui.groups);
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
// ---- v2：过滤 chip / 分组 / data-* / 复制键 / 导出键 / 历史卡 ----
const v2 = await ev(
  "(() => {" +
  "const txt = (id) => { const e = document.getElementById(id); return e ? e.textContent.trim() : null; };" +
  "const items = [...document.querySelectorAll('#checks li[data-id]')];" +
  "const groups = [...document.querySelectorAll('#checks li.grp')].map((e) => e.textContent.trim());" +
  "const pills = [...document.querySelectorAll('#pills .pill')].map((e) => e.textContent.trim());" +
  "const cp = items.filter((li) => li.querySelector('.cp')).length;" +
  "const eb = document.getElementById('exportBtn');" +
  "const hsp = document.getElementById('histSpark');" +
  "const hl = document.getElementById('histList');" +
  "let painted = -1;" +
  "if (hsp) { try { const d = hsp.getContext('2d').getImageData(0, 0, hsp.width, hsp.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; painted = n; } catch (e2) {} }" +
  "return {" +
  " all: txt('filterAll'), err: txt('filterErr'), warn: txt('filterWarn')," +
  " n: items.length," +
  " errs: items.filter((li) => li.getAttribute('data-level') === 'error').length," +
  " warns: items.filter((li) => li.getAttribute('data-level') === 'warn').length," +
  " levelsOk: items.length > 0 && items.every((li) => ['ok', 'warn', 'error'].includes(li.getAttribute('data-level')))," +
  " groupsOk: items.length > 0 && items.every((li) => !!li.getAttribute('data-group'))," +
  " dataIds: items.filter((li) => !!li.getAttribute('data-id')).length," +
  " groups: groups, pills: pills, cp: cp," +
  " eb: eb ? { w: Math.round(eb.getBoundingClientRect().width), h: Math.round(eb.getBoundingClientRect().height), disabled: !!eb.disabled } : null," +
  " hist: { card: !!document.getElementById('histCard'), spark: !!hsp, list: !!hl, note: !!document.getElementById('histNote') }," +
  " painted: painted, histW: hsp ? hsp.width : 0, histH: hsp ? hsp.height : 0," +
  " histKids: hl ? hl.children.length : -1," +
  " histText: hl ? (hl.textContent || '').trim().slice(0, 100) : ''" +
  "};" +
  "})()"
);
const numOf = (t) => { const m = String(t == null ? "" : t).match(/\d+/); return m ? Number(m[0]) : null; };
const pillNum = (kw, i) => { const p = (v2?.pills || []).find((x) => x.includes(kw)); return numOf(p != null ? p : (v2?.pills || [])[i]); };
ok("3 个过滤 chip 都在（全部 / 错误 / 警告）",
  !!v2 && /全部/.test(v2.all || "") && /错误/.test(v2.err || "") && /警告/.test(v2.warn || ""),
  v2 ? [v2.all, v2.err, v2.warn].join(" · ") : "missing");
ok("chip 计数与检查项/pills 自洽",
  !!v2 && numOf(v2.all) === v2.n && numOf(v2.err) === v2.errs && numOf(v2.warn) === v2.warns &&
  numOf(v2.err) === pillNum("错误", 0) && numOf(v2.warn) === pillNum("警告", 1),
  v2 ? "全部 " + numOf(v2.all) + "=" + v2.n +
    " · 错误 " + numOf(v2.err) + "=" + v2.errs + "/pill " + pillNum("错误", 0) +
    " · 警告 " + numOf(v2.warn) + "=" + v2.warns + "/pill " + pillNum("警告", 1) : "missing");
const errClick = await ev(
  "(async () => {" +
  "const errChip = document.getElementById('filterErr');" +
  "if (!errChip) return null;" +
  "errChip.click();" +
  "await new Promise((r) => setTimeout(r, 250));" +
  "const left = [...document.querySelectorAll('#checks li[data-id]')];" +
  "const levels = left.map((li) => li.getAttribute('data-level'));" +
  "const box = document.getElementById('checks');" +
  "const clip = box ? (box.textContent || '') : '';" +
  "const allChip = document.getElementById('filterAll'); if (allChip) allChip.click();" +
  "await new Promise((r) => setTimeout(r, 250));" +
  "return { chip: errChip.textContent.trim(), n: left.length, levels: levels, clip: clip.slice(0, 80) };" +
  "})()"
);
const errsBefore = v2 ? v2.errs : -1;
const filterOk = !!errClick && errClick.levels.every((l) => l === "error") &&
  (errsBefore > 0 ? errClick.n === errsBefore : (errClick.n === 0 && /错误\s*0/.test(errClick.chip || "")));
ok("点「错误」过滤后只剩 error 项（无错误项时「错误 0」+ 空列表）", filterOk,
  errClick ? "errsBefore=" + errsBefore + " · 过滤后 " + errClick.n + " 项 · " +
    JSON.stringify(errClick.levels.slice(0, 6)) + " · " + errClick.chip : "missing");
ok("检查项按组分组（组头 >= 4）", !!v2 && v2.groups.length >= 4,
  v2 ? v2.groups.length + " 个 · " + v2.groups.slice(0, 8).join("/") : "missing");
ok("每项带 data-id/data-level/data-group", !!v2 && v2.n > 0 && v2.dataIds === v2.n && v2.levelsOk && v2.groupsOk,
  v2 ? "items=" + v2.n + " · data-id=" + v2.dataIds + " · level合法=" + v2.levelsOk + " · group合法=" + v2.groupsOk : "missing");
ok("每项都有复制键 .cp", !!v2 && v2.n > 0 && v2.cp === v2.n, v2 ? v2.cp + "/" + v2.n : "missing");
ok("#exportBtn 存在且可点", !!v2 && !!v2.eb && v2.eb.w > 10 && v2.eb.h > 10 && !v2.eb.disabled,
  v2 && v2.eb ? v2.eb.w + "x" + v2.eb.h + (v2.eb.disabled ? " · disabled" : "") : "missing");
ok("历史卡存在且有内容/明确空态（#histCard/#histSpark/#histList）",
  !!v2 && v2.hist.card && v2.hist.spark && v2.hist.list && v2.histW > 100 &&
  (v2.painted > 0 || v2.histKids > 0 || /还没有历史|暂无历史|没有历史/.test(v2.histText)),
  v2 ? "spark " + v2.histW + "x" + v2.histH + " · painted " + v2.painted + " · list kids " + v2.histKids + " · " + v2.histText : "missing");
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

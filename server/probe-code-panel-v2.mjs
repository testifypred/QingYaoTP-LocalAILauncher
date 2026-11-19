/**
 * 代码面板 v2 探针（CDP UI，真模型，v1.7.0 契约 §2 / §4）
 *
 *   node probe-code-panel-v2.mjs [base] [cdp] [shotDir]
 *
 * 覆盖：
 *  A) 入口：#codeBtn -> #codeModal 打开、列表加载；
 *  B) 语言选择新建文件：#cwNewLang 选 python + 名字不带扩展名 -> 自动补 .py；placeholder 跟着变；文件真的落盘；
 *  C) 审查流式：点 #cwReview -> #cwThink 思考块出现且 #cwThinkText 在增长（轮询，不 sleep 死等）
 *     -> #cwReviewState「审查完成」-> #cwIssues 出问题卡片（data-line/data-severity + head/detail/fix + 一键更改）
 *     -> CodeMirror 行出现 .cwLineErr/.cwLineWarn/.cwLineInfo -> 点卡片跳行；
 *  D) 一键纠正：#cwFixAll -> 代码变化 + .cwLineChanged + 状态行「已修改 N 处」+ v1.9.2 自动写回文件 + 保存并运行按钮 + toolEnabled 同步 + 单条 scope=single 真模型；
 *  E) 发回对话：#cwSendChat -> 代码围栏 + 文件名 + 「修正后的版本」进聊天输入框 #q
 *     （契约 §2.6 写的 #input 是笔误：这个项目聊天输入框的 id 是 q，cwSendChat 里 input 变量就指向它）；
 *  F) 颜色设置：设置 -> 代码页 -> 改 #cwColorErr 落 localStorage + CSS 变量 -> #cwColorReset 恢复默认；
 *  G) 自复位：删掉探针建的文件、清 #input、还原 localStorage、关面板。
 */
import WebSocket from "ws";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] || "http://127.0.0.1:8099";
const CDP = process.argv[3] || "http://127.0.0.1:9333";
const OUT = process.argv[4] || path.join(SERVER_DIR, "docs", "feature-code-review-terminal-2026-11-15");
const MODEL = "qwen3-5-4B-Q4_K_M.gguf";
const PORT = new URL(BASE).port || "8099";
const STAMP = Date.now().toString(36);
const PY_BASE = "probe-lang-" + STAMP;
const JS_BASE = "probe-rev-" + STAMP;
const PY_PATH = "code/" + PY_BASE + ".py";
const JS_PATH = "code/" + JS_BASE + ".js";
// 一眼能看出来的 bug：返回值用了减法（应该是加法）。注释直接点出，4B 也能抓住。
const BUGGY = [
  "function add(a, b) {",
  "  // BUG: 这里应该是 a + b",
  "  return a - b;",
  "}",
  "",
  "console.log(add(1, 2));",
].join("\n");

let pass = 0, fail = 0, skip = 0;
const check = (n, c, d = "") => { if (c) { pass++; console.log("ok   " + n + (d ? "  [" + d + "]" : "")); } else { fail++; console.log("FAIL " + n + "  " + d); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJson(p) {
  try { const r = await fetch(BASE + p, { signal: AbortSignal.timeout(15000) }); const t = await r.text(); let d = null; try { d = JSON.parse(t); } catch {}; return { status: r.status, data: d }; }
  catch (e) { return { status: 0, data: null, error: String((e && e.message) || e) }; }
}
async function postJson(p, body) {
  try {
    const r = await fetch(BASE + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
    const t = await r.text(); let d = null; try { d = JSON.parse(t); } catch {};
    return { status: r.status, data: d };
  } catch (e) { return { status: 0, data: null, error: String((e && e.message) || e) }; }
}

// ---------- 前置：模型 ----------
const st0 = await getJson("/api/state");
const loaded0 = String((st0.data && st0.data.loaded) || "");
if (!loaded0) {
  await fetch(BASE + "/api/load", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ file: MODEL, contextSize: 8192 }) });
  for (let i = 0; i < 150; i++) { await sleep(1000); if (String((await getJson("/api/state")).data?.loaded || "")) break; }
}
console.log("\n== 目标 " + BASE + "，CDP " + CDP + "，模型 " + String((await getJson("/api/state")).data?.loaded || "（无）") + " ==");

// ---------- CDP ----------
const list = await (await fetch(CDP + "/json/list")).json();
const page = list.find((t) => t.type === "page" && t.url.includes("127.0.0.1:" + PORT));
if (!page) { console.log("no page"); process.exit(2); }
const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise((r, j) => { ws.once("open", r); ws.once("error", j); });
let id = 0; const pend = new Map();
ws.on("message", (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text + " " + (r.result.exceptionDetails.exception?.description || "")); return r.result?.result?.value; };
const q = (sel) => "document.querySelector(" + JSON.stringify(sel) + ")";
const GET_EDITOR = "(() => { const w = document.querySelector('#codeModal .CodeMirror'); if (w && w.CodeMirror) return w.CodeMirror.getValue(); const t = document.getElementById('cwEditor'); return t ? t.value : null; })()";
const LINE_COUNT = "((" + GET_EDITOR + ") || '').split('\\n').length";
const setEditor = (text) => ev("(() => { const w = document.querySelector('#codeModal .CodeMirror'); if (w && w.CodeMirror) { w.CodeMirror.setValue(" + JSON.stringify(text) + "); return true; } const t = document.getElementById('cwEditor'); if (t) { t.value = " + JSON.stringify(text) + "; t.dispatchEvent(new Event('input', { bubbles: true })); return true; } return false; })()");
const click = (elId) => ev("(() => { const el = document.getElementById(" + JSON.stringify(elId) + "); if (!el) return 'no'; el.click(); return 'ok'; })()");
const waitFor = async (expr, ms = 8000, step = 250) => {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < ms) { try { last = await ev(expr); if (last) return last; } catch {} await sleep(step); }
  try { last = await ev(expr); } catch {}
  return last;
};
const itemSel = (p) => "#cwList .cwItem[data-path=" + JSON.stringify(p) + "]";
async function openFile(p) {
  const okOpen = await ev("(() => { const el = " + q(itemSel(p)) + "; if (!el) return false; el.click(); return true; })()");
  await sleep(400);
  return okOpen;
}
async function chooseLang(kind) {
  return await ev("(() => {" +
    " const s = document.getElementById('cwNewLang'); if (!s) return 'no-select';" +
    " const opt = [...s.options].find((o) => new RegExp(" + JSON.stringify(kind) + ", 'i').test((o.value || '') + ' ' + (o.textContent || '')));" +
    " if (!opt) return 'no-option';" +
    " s.value = opt.value; s.dispatchEvent(new Event('change', { bubbles: true }));" +
    " return 'ok:' + opt.value;" +
    "})()");
}
async function shot(name) {
  try {
    fs.mkdirSync(OUT, { recursive: true });
    const r = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.result.data, "base64"));
    console.log("    截图: " + path.join(OUT, name));
  } catch (e) { console.log("    截图失败: " + String(e && e.message || e)); }
}

await send("Page.enable"); await send("Runtime.enable");
await send("Page.reload", { ignoreCache: true });
await sleep(3500);
// 首启面板可能盖住顶栏（驱动一般已置 done，这里兜底）
await ev("(() => { ['firstModal','readmeModal'].forEach((x) => { const el = document.getElementById(x); if (el) el.hidden = true; }); return 1; })()");

console.log("\n== A. 入口与列表 ==");
check("顶栏有 #codeBtn", (await ev("!!document.getElementById('codeBtn')")) === true);
await click("codeBtn");
check("#codeModal 打开", (await waitFor("!document.getElementById('codeModal').hidden", 6000)) === true);
check("代码列表已加载（空态或条目）", (await waitFor("(() => { const e = document.getElementById('cwEmpty'); const ev0 = !!e && !e.hidden && getComputedStyle(e).display !== 'none'; return ev0 || document.querySelectorAll('#cwList .cwItem[data-path]').length > 0; })()", 8000)) === true);

console.log("\n== B. 语言选择新建文件（python -> 自动补 .py）==");
const langOpts = await ev("(() => { const s = document.getElementById('cwNewLang'); return s ? [...s.options].map((o) => ({ v: o.value, t: String(o.textContent || '').trim() })) : null; })()");
check("#cwNewLang 存在", Array.isArray(langOpts), JSON.stringify(langOpts && langOpts.slice(0, 5)));
check("语言选项 >= 10 个", Array.isArray(langOpts) && langOpts.length >= 10, "n=" + (langOpts ? langOpts.length : 0));
const pickPy = await chooseLang("python|py");
check("能选到 python 语言项", String(pickPy || "").startsWith("ok"), String(pickPy));
await sleep(400);
const phPy = await ev("String((document.getElementById('cwNewName') || {}).placeholder || '')");
check("#cwNewName placeholder 跟着语言走（含 .py）", /\.py/i.test(phPy), phPy);
const beforePy = await ev("document.querySelectorAll('#cwList .cwItem[data-path]').length");
await ev("(() => { const i = document.getElementById('cwNewName'); i.value = " + JSON.stringify(PY_BASE) + "; i.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()");
await click("cwNew");
const pyCreated = await waitFor("!!" + q(itemSel(PY_PATH)), 12000);
const pyRead = await getJson("/api/workspace/read?path=" + encodeURIComponent(PY_PATH));
check("新建不带扩展名的文件 -> 自动补 .py 并落盘", pyCreated === true && pyRead.status === 200, "path=" + PY_PATH + " HTTP " + pyRead.status);
const afterPy = await ev("document.querySelectorAll('#cwList .cwItem[data-path]').length");
check("列表条目 +1", afterPy === beforePy + 1, beforePy + " -> " + afterPy);

console.log("\n== C. 新建 js 文件并放入有 bug 的代码 ==");
const pickJs = await chooseLang("javascript|^js$|js$");
check("能选到 javascript 语言项", String(pickJs || "").startsWith("ok"), String(pickJs));
await sleep(300);
await ev("(() => { const i = document.getElementById('cwNewName'); i.value = " + JSON.stringify(JS_BASE) + "; i.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()");
await click("cwNew");
const jsCreated = await waitFor("!!" + q(itemSel(JS_PATH)), 12000);
const jsRead0 = await getJson("/api/workspace/read?path=" + encodeURIComponent(JS_PATH));
check("新建 js 文件落盘", jsCreated === true && jsRead0.status === 200, "path=" + JS_PATH + " HTTP " + jsRead0.status);
await openFile(JS_PATH);
// cwNewFile / cwOpenFile 是异步的：先等当前文件真的切到 JS_PATH，再写编辑器，避免被文件加载覆盖
const curOk = await waitFor("(() => { try { return cwCurrent === " + JSON.stringify(JS_PATH) + "; } catch (e) { return false; } })()", 12000);
await setEditor(BUGGY);
const loadedOk = await waitFor("((" + GET_EDITOR + ") || '').includes('return a - b;')", 10000);
const editorNow = await ev(GET_EDITOR);
check("CodeMirror 载入探针代码", Boolean(curOk) && Boolean(loadedOk), "current=" + String(await ev("(() => { try { return cwCurrent; } catch (e) { return '?'; } })()")) + " len=" + String(editorNow || "").length);

console.log("\n== D. 审查（流式思考块）==");
await ev("(() => { const i = document.getElementById('cwIntent'); if (i) { i.value = '找出逻辑 bug：注意返回值算错了'; i.dispatchEvent(new Event('input', { bubbles: true })); } return 1; })()");

async function readThink() {
  try {
    const s = await ev("(() => {" +
      " const d = document.getElementById('cwThink');" +
      " const t = document.getElementById('cwThinkText');" +
      " const st = document.getElementById('cwReviewState');" +
      " return JSON.stringify({ has: !!d, open: d ? !d.hidden : null, tag: d ? d.tagName : '', len: t ? String(t.textContent || '').length : 0, state: st ? String(st.textContent || '') : '' });" +
      "})()");
    return JSON.parse(s);
  } catch (e) { return { has: false, len: 0, state: "" }; }
}
async function readIssues() {
  try {
    // 注意括号配对：以前这里少一个 )，Runtime.evaluate 语法错被 catch 吞掉 → 永远返回 []（假红）
    const s = await ev("(() => {" +
      " const list = [...document.querySelectorAll('#cwIssues .cwIssue')].map((el) => ({" +
      "   line: el.dataset.line," +
      "   severity: el.dataset.severity," +
      "   head: (el.querySelector('.cwIssueHead') || {}).textContent || ''," +
      "   detail: (el.querySelector('.cwIssueDetail') || {}).textContent || ''," +
      "   fix: (el.querySelector('.cwIssueFix') || {}).textContent || ''," +
      "   apply: !!el.querySelector('.cwIssueApply')" +
      " }));" +
      " return JSON.stringify(list);" +
      "})()");
    return JSON.parse(s);
  } catch (e) {
    console.log("    readIssues 失败（不是 0 张卡片，是查询本身出错）: " + String((e && e.message) || e).slice(0, 120));
    return [];
  }
}

async function reviewOnce(tag) {
  const before = await ev(GET_EDITOR);
  await click("cwReview");
  let seen = false, lenA = 0, lenB = 0;
  for (let i = 0; i < 120; i++) {
    await sleep(500);
    const t = await readThink();
    if (t.has && t.open !== false && t.len > 0) { seen = true; lenA = t.len; break; }
    if (/审查完成|失败/.test(t.state)) break;
  }
  if (seen) { await sleep(900); const t2 = await readThink(); lenB = t2.len; }
  const finished = await waitFor("(() => { const s = document.getElementById('cwReviewState'); return !!s && /审查完成/.test(s.textContent || ''); })()", 180000);
  return { before, seen, lenA, lenB, finished: Boolean(finished) };
}

const r1 = await reviewOnce("first");
const think1 = await readThink();
const st1 = await ev("String((document.getElementById('cwReviewState') || {}).textContent || '')");
check("审查中 #cwThink 思考块出现", r1.seen === true, "#cwThink=" + JSON.stringify({ has: think1.has, tag: think1.tag, len: r1.lenA }));
check("#cwThinkText 有内容且在增长（流式）", r1.lenA > 0 && r1.lenB >= r1.lenA, "len " + r1.lenA + " -> " + r1.lenB);
check("#cwReviewState「审查完成」", r1.finished === true, st1.slice(0, 120));
let issues = await readIssues();
if (issues.length === 0) {
  console.log("  第一次审查 0 个 issue，重试一次（模型波动，不是产品断言）…");
  await sleep(800);
  const r2 = await reviewOnce("retry");
  console.log("  重试: seen=" + r2.seen + " len=" + r2.lenA + " finished=" + r2.finished);
  issues = await readIssues();
}
check("问题卡片 >= 1 张", issues.length >= 1, "n=" + issues.length + " " + JSON.stringify(issues.slice(0, 2).map((x) => ({ line: x.line, sev: x.severity }))));
const SEVS = ["error", "warn", "info"];
const badIssue = issues.find((x) => !/^\d+$/.test(String(x.line || "")) || !SEVS.includes(String(x.severity)));
check("问题卡片带 data-line / data-severity", issues.length > 0 && !badIssue, badIssue ? JSON.stringify(badIssue).slice(0, 120) : JSON.stringify(issues.slice(0, 3).map((x) => x.line + ":" + x.severity)));
const first = issues[0] || {};
check("卡片头是「行 N · 严重度 · 标题」", /行\s*\d+/.test(String(first.head || "")), String(first.head || "").slice(0, 100));
check("卡片有 detail 与 fix", String(first.detail || "").trim().length > 0 && String(first.fix || "").trim().length > 0, "detail=" + String(first.detail || "").length + " fix=" + String(first.fix || "").length);
check("每条问题都有一键更改按钮", issues.length > 0 && issues.every((x) => x.apply === true), "n=" + issues.length);

const lineClasses = JSON.parse(await ev("(() => { const n = (c) => document.querySelectorAll('#codeModal .' + c).length; return JSON.stringify({ err: n('cwLineErr'), warn: n('cwLineWarn'), info: n('cwLineInfo') }); })()"));
const htmlLines = Number(await ev(LINE_COUNT)) || 0;
const firstLine = Number(first.line) || 0;
check("报告行号在代码范围内", firstLine >= 1 && firstLine <= htmlLines, "line=" + firstLine + " / 共 " + htmlLines + " 行");
check("CodeMirror 行出现错误/警告高亮 class", lineClasses.err + lineClasses.warn + lineClasses.info >= 1, JSON.stringify(lineClasses));
const sevKey = String(first.severity) === "error" ? "err" : String(first.severity) === "warn" ? "warn" : "info";
check("高亮 class 与首条 issue 的严重度一致（." + ({ err: "cwLineErr", warn: "cwLineWarn", info: "cwLineInfo" }[sevKey]) + "）", Number(lineClasses[sevKey]) >= 1, JSON.stringify(lineClasses));
await ev("(() => { const el = document.querySelector('#cwIssues .cwIssue'); if (el) el.click(); return 1; })()");
await sleep(600);
const cursorLine = Number(await ev("(() => { const w = document.querySelector('#codeModal .CodeMirror'); return w && w.CodeMirror ? w.CodeMirror.getCursor().line + 1 : 0; })()"));
check("点问题卡片跳到对应行", cursorLine === firstLine, "cursor=" + cursorLine + " issue=" + firstLine);
await shot("probe-code-panel-v2-review.png");

console.log("\n== E. 一键纠正 ==");
const beforeFix = await ev(GET_EDITOR);
await click("cwFixAll");
const fixState = await waitFor("(() => { const s = document.getElementById('cwReviewState'); return !!s && /已修改|修改完成|已纠正/.test(s.textContent || ''); })()", 240000);
await sleep(600);
const afterFix = await ev(GET_EDITOR);
const fixStateText = await ev("String((document.getElementById('cwReviewState') || {}).textContent || '')");
const changedCount = Number(await ev("document.querySelectorAll('#codeModal .cwLineChanged').length"));
check("一键纠正 -> 状态行「已修改」", Boolean(fixState), fixStateText.slice(0, 120));
check("编辑器代码被改写（不再等于原稿）", String(afterFix) !== String(beforeFix), "len " + String(beforeFix || "").length + " -> " + String(afterFix || "").length);
check("改动行出现 .cwLineChanged", changedCount >= 1, "n=" + changedCount);
check("状态行带新增 / 删除数字", /新增\s*\d+|删除\s*\d+/.test(fixStateText), fixStateText.slice(0, 120));
// v1.9.2 老账清算：一键纠正自动写回文件、保存并运行、toolEnabled 同步、scope=single 真模型
const fixStateNow = await ev("String((document.getElementById('cwReviewState') || {}).textContent || '')");
const fixRead = await getJson("/api/workspace/read?path=" + encodeURIComponent(JS_PATH));
check("一键纠正的改动自动写回文件（状态行「已写回文件」）", /已写回文件/.test(fixStateNow) && String((fixRead.data && fixRead.data.content) || "") === String(afterFix || ""), "state=" + fixStateNow.slice(0, 60) + " fileLen=" + String((fixRead.data && fixRead.data.content) || "").length + " editorLen=" + String(afterFix || "").length);
check("「保存并运行」按钮存在且可用（v1.9.2）", (await ev("(() => { const b = document.getElementById('cwSaveRun'); return !!b && !b.disabled; })()")) === true, "");
const toolSync = String(await ev("(() => { const c = document.getElementById('toolChk'); const v0 = c.checked; c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); const on = toolEnabled; c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); const off = toolEnabled; c.checked = v0; c.dispatchEvent(new Event('change', { bubbles: true })); return JSON.stringify({ on, off: off, restored: toolEnabled }); })()"));
let toolSyncJ = {}; try { toolSyncJ = JSON.parse(toolSync); } catch {}
check("勾/取消「调用工具」同步 toolEnabled（v1.9.2 老账）", toolSyncJ.on === true && toolSyncJ.off === false, toolSync);
const applyOne = await ev("(() => { const b = [...document.querySelectorAll('#cwIssues .cwIssueApply')][0]; if (!b) return 'no'; b.click(); return 'ok'; })()");
const singleFixState = await waitFor("(() => { const s = String((document.getElementById('cwReviewState') || {}).textContent || ''); return /已写回文件|已修改/.test(s) && /(新增|删除)/.test(s) ? s : ''; })()", 240000);
check("单条「一键更改」（scope=single）真模型跑通（v1.9.2 补跑）", applyOne === "ok" && Boolean(String(singleFixState || "").trim()), "state=" + String(singleFixState || "").slice(0, 90));

console.log("\n== F. 发回对话 ==");
const FENCE = String.fromCharCode(96, 96, 96);
// 先清空聊天输入框，避免上面探针残留的草稿让「围栏已填入」变成假绿
await ev("(() => { const el = document.getElementById('q'); if (el) { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); } return 1; })()");
await click("cwSendChat");
const inputVal = await waitFor("(() => { const el = document.getElementById('q'); const v = el ? String(el.value || '') : ''; return v.indexOf(String.fromCharCode(96,96,96)) >= 0 ? JSON.stringify(v) : ''; })()", 8000);
let chatText = "";
try { chatText = inputVal ? JSON.parse(inputVal) : ""; } catch { chatText = String(inputVal || ""); }
check("#cwSendChat 把代码围栏写进聊天输入框 #q", chatText.includes(FENCE), "len=" + chatText.length);
check("填入内容带文件名", chatText.includes(JS_BASE + ".js") || chatText.includes(JS_PATH), chatText.slice(0, 80));
check("填入内容注明「修正后的版本」", /修正后的版本|修改后/.test(chatText), chatText.slice(0, 120));

console.log("\n== G. 高亮颜色设置（设置 -> 代码）==");
await click("settingsBtn");
await sleep(600);
const codeTab = await ev("(() => { const b = [...document.querySelectorAll('.settingsTabs .stab')].find((x) => (x.dataset.tab || '') === 'code' || /代码/.test(x.textContent || '')); if (!b) return 'no'; b.click(); return 'ok'; })()");
check("设置里有「代码」页签", codeTab === "ok", String(codeTab));
check("#paneCode 可见", (await waitFor("(() => { const p = document.getElementById('paneCode'); return !!p && !p.hidden; })()", 6000)) === true);
const colorInputs = JSON.parse(await ev("(() => JSON.stringify(['cwColorErr','cwColorWarn','cwColorInfo','cwColorChanged'].map((x) => { const el = document.getElementById(x); return { id: x, has: !!el, type: el ? el.type : null }; })))()"));
check("4 个颜色输入框都存在且 type=color", colorInputs.length === 4 && colorInputs.every((c) => c.has && c.type === "color"), JSON.stringify(colorInputs.map((c) => c.type)));
const varBefore = String(await ev("getComputedStyle(document.documentElement).getPropertyValue('--cw-err-bg').trim()"));
await ev("(() => { const el = document.getElementById('cwColorErr'); if (!el) return 0; el.value = '#123456'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()");
await sleep(500);
const errColorState = JSON.parse(await ev("(() => { const raw = localStorage.getItem('localai.cwColors'); let j = null; try { j = JSON.parse(raw || 'null'); } catch {} return JSON.stringify({ raw, err: j && j.err ? j.err : '', cssVar: getComputedStyle(document.documentElement).getPropertyValue('--cw-err-bg').trim() }); })()"));
// 实现按契约把 <input type=color> 的 #rrggbb 统一补 40% alpha（#12345666），所以用前缀匹配
check("改 #cwColorErr -> localStorage localai.cwColors.err", String(errColorState.err).toLowerCase().startsWith("#123456"), "err=" + errColorState.err + " raw=" + String(errColorState.raw || "").slice(0, 80));
check("CSS 变量 --cw-err-bg 跟着变", /123456|18,\s*52,\s*86/i.test(String(errColorState.cssVar || "")), "before=" + varBefore + " after=" + errColorState.cssVar);
const resetClicked = await click("cwColorReset");
await sleep(500);
const resetState = JSON.parse(await ev("(() => { const raw = localStorage.getItem('localai.cwColors'); let j = null; try { j = JSON.parse(raw || 'null'); } catch {} return JSON.stringify({ raw, err: j && j.err ? j.err : '', cssVar: getComputedStyle(document.documentElement).getPropertyValue('--cw-err-bg').trim() }); })()"));
check("#cwColorReset 恢复默认（localStorage 回到默认或清空）", String(resetState.err).toLowerCase() === "#7f1d1d66" || resetState.raw === null, "err=" + resetState.err + " raw=" + String(resetState.raw || "").slice(0, 60));
check("恢复默认后 CSS 变量也回去（不再是 #123456）", !/123456/i.test(String(resetState.cssVar || "")), resetState.cssVar);
await shot("probe-code-panel-v2-colors.png");

console.log("\n== H. 自复位 ==");
try { await click("settingsClose"); } catch {}
try { await ev("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); 1"); } catch {}
await sleep(500);
await ev("(() => { const el = document.getElementById('q'); if (el) { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); } return 1; })()");
try { await ev("(() => { try { localStorage.removeItem('localai.cwColors'); } catch (e) {} return 1; })()"); } catch {}
for (const p of [PY_PATH, JS_PATH]) await postJson("/api/workspace/delete", { path: p });
const gone = [];
for (const p of [PY_PATH, JS_PATH]) {
  const r = await getJson("/api/workspace/read?path=" + encodeURIComponent(p));
  if (!(r.status === 400 || r.status === 404)) gone.push(p + ":" + r.status);
}
check("探针创建的文件已全部删除", gone.length === 0, gone.join(",") || "clean");
const modalState = JSON.parse(await ev("(() => JSON.stringify({ codeModal: !document.getElementById('codeModal').hidden, settings: document.getElementById('settingsModal') ? !document.getElementById('settingsModal').hidden : false, input: String((document.getElementById('q') || {}).value || '') }))()"));
check("收尾：代码面板/设置已关、聊天输入框 #q 已清", modalState.codeModal === false && modalState.settings === false && modalState.input.length === 0, JSON.stringify(modalState).slice(0, 120));

console.log("\n== 结果: " + pass + " 通过 / " + fail + " 失败" + (skip ? "（跳过 " + skip + " 项）" : "") + " ==\n");
ws.close();
process.exit(fail ? 1 : 0);

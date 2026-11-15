/**
 * v1.7.1 手验脚本（CDP，真模型）：0 问题空态 + 「停止」语义
 *
 *   node v171-empty-stop-check.mjs [base] [cdp]
 *
 * 覆盖：
 *  A) 审查模型下拉隐藏 Phi-4-mini（+ 下拉下方 hint）；
 *  B) 审查一段正确的短代码 -> #cwIssues 出现 .cwIssueEmpty 空态（✓ + 3 条建议）、
 *     状态行「审查完成 · 0 个问题」、按钮全部恢复、#cwFixAll disabled 且 title=「没有可修改的问题」；
 *  C) 审查一段有 bug 的长代码 -> 审查中 #cwReview 变「停止」可点 -> 点它 -> 状态「已停止」、
 *     清 timer（再等 700ms 状态不被计时覆盖）、按钮恢复、后端日志应出现「已停止（客户端断开）」。
 */
import WebSocket from "ws";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] || "http://127.0.0.1:8099";
const CDP = process.argv[3] || "http://127.0.0.1:9333";
const OUT = path.join(SERVER_DIR);
const MODEL = "qwen3-5-4B-Q4_K_M.gguf";
const PORT = new URL(BASE).port || "8099";
const STAMP = Date.now().toString(36);
const EMPTY_PATH = "code/probe-empty-" + STAMP + ".js";
const STOP_PATH = "code/probe-stop-" + STAMP + ".js";
const OK_CODE = ["function add(a, b) {", "  return a + b;", "}", "", "console.log(add(1, 2));"].join("\n");
const BUGGY_LONG = [
  "function sum(values) {",
  "  let total = 0;",
  "",
  "  // 累加求和",
  "  for (let i = 0; i <= values.length; i++) {",
  "    total += values[i];",
  "  }",
  "",
  "  return total;",
  "}",
  "",
  "console.log(sum([1, 2, 3]));",
].join("\n");

let pass = 0, fail = 0;
const check = (n, c, d = "") => { if (c) { pass++; console.log("ok   " + n + (d ? "  [" + d + "]" : "")); } else { fail++; console.log("FAIL " + n + "  " + d); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJson(p) {
  try { const r = await fetch(BASE + p, { signal: AbortSignal.timeout(15000) }); const t = await r.text(); let d = null; try { d = JSON.parse(t); } catch {}; return { status: r.status, data: d }; }
  catch (e) { return { status: 0, data: null, error: String((e && e.message) || e) }; }
}
async function postJson(p, body) {
  try { const r = await fetch(BASE + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) }); const t = await r.text(); let d = null; try { d = JSON.parse(t); } catch {}; return { status: r.status, data: d }; }
  catch (e) { return { status: 0, data: null, error: String((e && e.message) || e) }; }
}

// 前置：模型
const st0 = await getJson("/api/state");
if (!String((st0.data && st0.data.loaded) || "")) {
  await fetch(BASE + "/api/load", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ file: MODEL, contextSize: 8192 }) });
  for (let i = 0; i < 120; i++) { await sleep(1000); if (String((await getJson("/api/state")).data?.loaded || "")) break; }
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
const setEditor = (text) => ev("(() => { const w = document.querySelector('#codeModal .CodeMirror'); if (w && w.CodeMirror) { w.CodeMirror.setValue(" + JSON.stringify(text) + "); return true; } const t = document.getElementById('cwEditor'); if (t) { t.value = " + JSON.stringify(text) + "; t.dispatchEvent(new Event('input', { bubbles: true })); } return false; })()");
const click = (elId) => ev("(() => { const el = document.getElementById(" + JSON.stringify(elId) + "); if (!el) return 'no'; el.click(); return 'ok'; })()");
const waitFor = async (expr, ms = 10000, step = 250) => {
  const t0 = Date.now(); let last;
  while (Date.now() - t0 < ms) { try { last = await ev(expr); if (last) return last; } catch {} await sleep(step); }
  try { last = await ev(expr); } catch {}
  return last;
};
const itemSel = (p) => "#cwList .cwItem[data-path=" + JSON.stringify(p) + "]";
async function createFile(name, langRe) {
  const ok = await ev("(() => { const s = document.getElementById('cwNewLang'); if (!s) return 'no-select'; const opt = [...s.options].find((o) => new RegExp(" + JSON.stringify(langRe) + ", 'i').test((o.value || '') + ' ' + (o.textContent || ''))); if (!opt) return 'no-option'; s.value = opt.value; s.dispatchEvent(new Event('change', { bubbles: true })); return 'ok'; })()");
  if (ok !== "ok") return false;
  await sleep(300);
  await ev("(() => { const i = document.getElementById('cwNewName'); i.value = " + JSON.stringify(name) + "; i.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()");
  await click("cwNew");
  return (await waitFor("!!" + q(itemSel("code/" + name + ".js")), 12000)) === true;
}
async function openFile(p) {
  await ev("(() => { const el = " + q(itemSel(p)) + "; if (!el) return false; el.click(); return true; })()");
  await waitFor("(() => { try { return cwCurrent === " + JSON.stringify(p) + "; } catch (e) { return false; } })()", 12000);
  await sleep(300);
}
async function shot(name) {
  try { const r = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(path.join(OUT, name), Buffer.from(r.result.data, "base64")); console.log("    截图: " + path.join(OUT, name)); }
  catch (e) { console.log("    截图失败: " + String((e && e.message) || e)); }
}

await send("Page.enable"); await send("Runtime.enable");
await send("Page.reload", { ignoreCache: true });
await sleep(3500);
await ev("(() => { ['firstModal','readmeModal'].forEach((x) => { const el = document.getElementById(x); if (el) el.hidden = true; }); return 1; })()");

console.log("\n== A. 审查模型下拉隐藏 Phi-4-mini ==");
await click("codeBtn");
await waitFor("!document.getElementById('codeModal').hidden", 6000);
await waitFor("(() => { const s = document.getElementById('cwReviewModel'); return !!s && s.options.length > 1; })()", 10000);
const opts = await ev("(() => { const s = document.getElementById('cwReviewModel'); const hint = document.getElementById('cwReviewModelHint'); return JSON.stringify({ vals: [...s.options].map((o) => o.value), labels: [...s.options].map((o) => o.textContent), hint: hint ? { text: hint.textContent, hidden: hint.hidden } : null }); })()");
const optObj = JSON.parse(opts || "{}");
const phiOpt = (optObj.vals || []).find((v) => /Phi-4-mini/i.test(String(v)));
check("下拉里没有 Phi-4-mini", !phiOpt, "options=" + (optObj.vals || []).length);
check("下拉下方 hint 说明已隐藏 Phi-4-mini", !!(optObj.hint && /已隐藏 Phi-4-mini/.test(optObj.hint.text)) && optObj.hint.hidden === false, JSON.stringify(optObj.hint));

console.log("\n== B. 0 问题空态 ==");
let gotEmpty = false, emptyInfo = null, reviewTries = 0;
for (reviewTries = 1; reviewTries <= 3 && !gotEmpty; reviewTries++) {
  if (reviewTries === 1) {
    check("新建空态测试文件", await createFile("probe-empty-" + STAMP, "javascript|^js$|js$"), EMPTY_PATH);
    await openFile(EMPTY_PATH);
  }
  await setEditor(OK_CODE);
  await sleep(300);
  await ev("(() => { const i = document.getElementById('cwIntent'); if (i) { i.value = '这段代码已通过单元测试、确认正确。只做最终确认：确实没有问题就把 issues 写成空数组 []，不要为了凑数编造问题。'; i.dispatchEvent(new Event('input', { bubbles: true })); } return 1; })()");
  await click("cwReview");
  const done = await waitFor("(() => { const s = document.getElementById('cwReviewState'); return !!s && /审查完成/.test(s.textContent || ''); })()", 240000);
  emptyInfo = JSON.parse(await ev("(() => { const st = document.getElementById('cwReviewState'); const empty = document.querySelector('#cwIssues .cwIssueEmpty'); const fix = document.getElementById('cwFixAll'); const rev = document.getElementById('cwReview'); return JSON.stringify({ state: st ? st.textContent : '', empty: empty ? { text: empty.textContent, lis: empty.querySelectorAll('li').length } : null, cards: document.querySelectorAll('#cwIssues .cwIssue').length, fixDisabled: fix ? fix.disabled : null, fixTitle: fix ? fix.title : '', fixText: fix ? fix.textContent : '', reviewDisabled: rev ? rev.disabled : null, reviewText: rev ? rev.textContent : '', reviewTitle: rev ? rev.title : '' }); })()"));
  gotEmpty = Boolean(done && emptyInfo.empty && emptyInfo.cards === 0);
  console.log("  第 " + reviewTries + " 次审查: 完成=" + Boolean(done) + " 空态=" + Boolean(emptyInfo.empty) + " 卡片=" + emptyInfo.cards + " 状态=" + String(emptyInfo.state).slice(0, 80));
  if (!gotEmpty) await sleep(800);
}
check("0 问题时 #cwIssues 出现 .cwIssueEmpty 空态", Boolean(emptyInfo.empty), emptyInfo.empty ? emptyInfo.empty.text.slice(0, 100) : "没有空态块");
check("空态含「✓ 这次没有发现问题」", Boolean(emptyInfo.empty) && /✓ 这次没有发现问题/.test(emptyInfo.empty.text), "");
check("空态含 3 条建议", Boolean(emptyInfo.empty) && emptyInfo.empty.lis === 3, "li=" + (emptyInfo.empty ? emptyInfo.empty.lis : 0));
check("状态行「审查完成 · 0 个问题」", /审查完成\s*·\s*0 个问题/.test(String(emptyInfo.state)), emptyInfo.state);
check("#cwFixAll disabled 且 title=「没有可修改的问题」", emptyInfo.fixDisabled === true && emptyInfo.fixTitle === "没有可修改的问题", "disabled=" + emptyInfo.fixDisabled + " title=" + emptyInfo.fixTitle);
check("按钮恢复：审查可点、文字回到「模型审查」", emptyInfo.reviewDisabled === false && emptyInfo.reviewText === "模型审查", "text=" + emptyInfo.reviewText);
await shot("v171-empty-state.png");

console.log("\n== C. 审查中「停止」 ==");
check("新建停止测试文件", await createFile("probe-stop-" + STAMP, "javascript|^js$|js$"), STOP_PATH);
await openFile(STOP_PATH);
await setEditor(BUGGY_LONG);
await sleep(300);
await ev("(() => { const i = document.getElementById('cwIntent'); if (i) { i.value = '找出循环越界问题'; i.dispatchEvent(new Event('input', { bubbles: true })); } return 1; })()");
await click("cwReview");
const runningUi = await waitFor("(() => { const r = document.getElementById('cwReview'); const f = document.getElementById('cwFixAll'); return !!r && /停止/.test(r.textContent || '') && r.disabled === false && !!f && f.disabled === false; })()", 30000);
check("审查中 #cwReview 变「停止」且不再 disabled", runningUi === true, String(await ev("(() => { const r = document.getElementById('cwReview'); const f = document.getElementById('cwFixAll'); return JSON.stringify({ r: r.textContent, rd: r.disabled, f: f.textContent, fd: f.disabled }); })()")));
// 等真的开始流式输出再点停止：这样才测得到「后端把正在跑的生成掐掉」，而不是生成还没开始就断开
const streamedBeforeStop = await waitFor("(() => { const t = document.getElementById('cwThinkText'); return !!t && String(t.textContent || '').length > 20; })()", 90000);
check("停止前模型已在流式输出（测的是掐断生成）", Boolean(streamedBeforeStop), "thinkLen=" + String(await ev("(() => { const t = document.getElementById('cwThinkText'); return t ? t.textContent.length : 0; })()")));
const stateDuring = await ev("String((document.getElementById('cwReviewState') || {}).textContent || '')");
await click("cwReview");
const stopped = await waitFor("(() => { const s = document.getElementById('cwReviewState'); return !!s && /已停止/.test(s.textContent || ''); })()", 20000);
check("点「停止」后状态行显示「已停止」", stopped === true, String(await ev("String((document.getElementById('cwReviewState') || {}).textContent || '')")));
// 收尾是异步的（abort -> catch -> finally）：等按钮文字真的恢复，别抢在 finally 之前断言
await waitFor("(() => { const r = document.getElementById('cwReview'); const f = document.getElementById('cwFixAll'); return r.textContent === '模型审查' && !r.disabled && f.textContent === '一键纠正'; })()", 15000);
const stoppedInfo = JSON.parse(await ev("(() => { const r = document.getElementById('cwReview'); const f = document.getElementById('cwFixAll'); const t = document.getElementById('cwThinkSum'); return JSON.stringify({ state: (document.getElementById('cwReviewState') || {}).textContent || '', rText: r.textContent, rDisabled: r.disabled, fText: f.textContent, fDisabled: f.disabled, fTitle: f.title, think: t ? t.textContent : '' }); })()"));
check("停止后 #cwReview 恢复「模型审查」可点", stoppedInfo.rDisabled === false && stoppedInfo.rText === "模型审查", JSON.stringify(stoppedInfo.rText));
check("停止后 #cwFixAll 恢复「一键纠正」", stoppedInfo.fText === "一键纠正", stoppedInfo.fText);
await sleep(700);
const stateAfter = await ev("String((document.getElementById('cwReviewState') || {}).textContent || '')");
check("停表：700ms 后状态仍是「已停止」（不再被计时覆盖）", /已停止/.test(String(stateAfter)), String(stateAfter));
check("停止后思考块标为已停止", /已停止/.test(String(stoppedInfo.think)), String(stoppedInfo.think).slice(0, 40));
console.log("  停止前状态: " + stateDuring.slice(0, 60));
await shot("v171-stopped.png");

console.log("\n== C2. 问题卡片附带的该行代码片段（UI 渲染，合成一条 findings，不花模型时间） ==");
await ev("(() => { cwApplyFindings({ summary: '测试摘要', issues: [{ line: 6, endLine: 6, severity: 'warn', title: '合成测试', detail: 'd', fix: 'f' }] }); return 1; })()");
await sleep(300);
const cardInfo = JSON.parse(await ev("(() => { const el = document.querySelector('#cwIssues .cwIssue'); const codeEl = el ? el.querySelector('.cwIssueCode code') : null; const head = el ? el.querySelector('.cwIssueHead').textContent : ''; const cm = document.querySelector('#codeModal .CodeMirror')?.CodeMirror; const lineText = cm ? String(cm.getLine(5) || '').trim() : ''; return JSON.stringify({ has: !!el, head, code: codeEl ? codeEl.textContent : null, want: lineText.length > 60 ? lineText.slice(0, 60) + '…' : lineText }); })()"));
check("卡片标题仍是「行 6 · 警告 · 标题」", /^行 6 · 警告 · 合成测试$/.test(cardInfo.head), cardInfo.head);
check("标题下方一行带该行代码片段（.cwIssueCode code）", cardInfo.has && cardInfo.code === cardInfo.want && cardInfo.code === "total += values[i];", JSON.stringify(cardInfo));
await ev("(() => { cwResetReviewView(); return 1; })()");

console.log("\n== D. 收尾 ==");
try { await ev("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); 1"); } catch {}
for (const p of [EMPTY_PATH, STOP_PATH]) await postJson("/api/workspace/delete", { path: p });
const gone = [];
for (const p of [EMPTY_PATH, STOP_PATH]) { const r = await getJson("/api/workspace/read?path=" + encodeURIComponent(p)); if (!(r.status === 400 || r.status === 404)) gone.push(p + ":" + r.status); }
check("探针文件已删除", gone.length === 0, gone.join(",") || "clean");

console.log("\n== 结果: " + pass + " 通过 / " + fail + " 失败 ==\n");
ws.close();
process.exit(fail ? 1 : 0);

/**
 * codeui 自检（v1.7.0 代码面板升级，真后端 + 真模型）
 *   node codeui-cdp-check.mjs [base] [cdp]
 * 覆盖：新建语言（自动扩展名/mode/localStorage）、审查流式思考块、问题卡片 + 行高亮、
 *       点卡片跳行选中、一键纠正 + .cwLineChanged、发回对话填 #q、高亮颜色 + 恢复默认、控制台 0 error。
 * 截图存本目录 codeui-*.png；收尾删除自己建的文件并清掉临时 localStorage。
 */
import WebSocket from "ws";
import fs from "node:fs";

const BASE = process.argv[2] || "http://127.0.0.1:8099";
const CDP = process.argv[3] || "http://127.0.0.1:9333";
const OUT = "D:/LocalModels/server/docs/feature-code-review-terminal-2026-11-15";
const PORT = new URL(BASE).port || "8099";
const STAMP = Date.now().toString(36);
const FENCE = String.fromCharCode(96).repeat(3);

const list = await (await fetch(CDP + "/json/list")).json();
const page = list.find((t) => t.type === "page" && t.url.includes("127.0.0.1:" + PORT));
if (!page) { console.log("no page at " + CDP); process.exit(2); }
const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise((r, j) => { ws.once("open", r); ws.once("error", j); });
let id = 0;
const pend = new Map();
const consoleErrors = [];
ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
  if (m.method === "Runtime.exceptionThrown") {
    const d = m.params && m.params.exceptionDetails;
    consoleErrors.push("exception: " + ((d && (d.exception && (d.exception.description || d.exception.value))) || (d && d.text) || "?"));
  }
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
    consoleErrors.push("console.error: " + (m.params.args || []).map((a) => a.value || a.description || "").join(" "));
  }
});
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result && r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.text + " " + ((r.result.exceptionDetails.exception || {}).description || ""));
  return r.result && r.result.result ? r.result.result.value : undefined;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (n, c, d = "") => { if (c) { pass++; console.log("ok   " + n + (d ? "  [" + d + "]" : "")); } else { fail++; console.log("FAIL " + n + "  " + d); } };
const waitFor = async (expr, ms = 8000, step = 250) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await ev(expr)) return true; await sleep(step); }
  return (await ev(expr)) === true;
};
const shot = async (name) => {
  const s = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(OUT + "/" + name, Buffer.from(s.result.data, "base64"));
  console.log("  截图: " + OUT + "/" + name);
};
const api = async (method, p, body, token) => {
  const r = await fetch(BASE + p, {
    method,
    headers: Object.assign(body ? { "content-type": "application/json" } : {}, token ? { "x-local-token": token } : {}),
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await r.json(); } catch {}
  return { status: r.status, data };
};
const selItem = (p) => "#cwList .cwItem[data-path=" + JSON.stringify(p) + "]";
const clickPath = "[el]";

await send("Page.enable");
await send("Runtime.enable");
// 用 navigate 而不是 reload：上一个探针可能把页面留在 chrome-error，reload 会原地不动
await send("Page.navigate", { url: BASE + "/" });
await sleep(1500);
try {
  await Promise.race([
    new Promise((res) => { const h = (raw) => { const m = JSON.parse(raw.toString()); if (m.method === "Page.loadEventFired") { ws.off("message", h); res(); } }; ws.on("message", h); }),
    sleep(12000),
  ]);
} catch {}
await sleep(1500);
const booted = await (async () => { for (let i = 0; i < 40; i++) { if (await ev("!!document.getElementById('codeBtn')")) return true; await sleep(500); } return false; })();
if (!booted) { console.log("页面没起来，当前 URL=" + (await ev("location.href"))); ws.close(); process.exit(2); }

// ---------- 0. 基本环境 ----------
const vw = await ev("({w: innerWidth, h: innerHeight})");
check("Edge 视口正常（>1200 宽）", vw.w > 1200, JSON.stringify(vw));
const IDS = ["cwNewName","cwNew","cwSave","cwRun","cwDelete","cwEditor","cwTabs","cwList","cwEmpty","cwOutput","cwReview","cwReviewPanel","cwReviewToggle","cwReviewBody","cwReviewMeta","cwIntent","cwDir","cwStatus","cwNewLang","cwReviewModel","cwThink","cwThinkText","cwIssues","cwReviewState","cwFixAll","cwReReview","cwSendChat","cwColorErr","cwColorWarn","cwColorInfo","cwColorChanged","cwColorReset"];
const missing = await ev("(" + JSON.stringify(IDS) + ").filter(id => !document.getElementById(id))");
check("契约里的 id 全在（含新增）", missing.length === 0, missing.join(",") || "all " + IDS.length);

// ---------- 1. 打开代码面板 ----------
await ev("document.getElementById('codeBtn').click(); 1");
const opened = await waitFor("!document.getElementById('codeModal').hidden", 8000);
check("点击 #codeBtn 打开 #codeModal", opened === true);
const st0 = (await api("GET", "/api/state")).data || {};
let model0 = String(st0.loaded || "");
if (!model0) {
  // 别的探针可能刚把模型卸了：真审查要模型，自己装回来（4B，约 10-20s）
  console.log("  未加载模型，先装 4B…");
  const tok0 = String(st0.localToken || "");
  const lr = await api("POST", "/api/load", { file: "qwen3-5-4B-Q4_K_M.gguf", contextSize: 8192 }, tok0);
  console.log("  POST /api/load HTTP " + lr.status);
  for (let i = 0; i < 180; i++) {
    const s = (await api("GET", "/api/state")).data || {};
    if (s.loaded) { model0 = String(s.loaded); break; }
    await sleep(1000);
  }
}
check("已加载模型（真审查前提）", !!model0, model0);

// ---------- 2. 新建可选语言：main.py ----------
const l0 = (await api("GET", "/api/workspace/list?dir=code")).data || {};
const hasMainPy = (l0.entries || []).some((e) => e.path === "code/main.py");
const LANG_BASE = hasMainPy ? "codeui-lang-" + STAMP : "main";
const LANG_PATH = "code/" + LANG_BASE + ".py";
await ev("(() => { const s = document.getElementById('cwNewLang'); s.value = 'py'; s.dispatchEvent(new Event('change')); return 1; })()");
const ph = await ev("document.getElementById('cwNewName').placeholder");
check("选 Python 后 placeholder 变 main.py", /main\.py/.test(String(ph)), ph);
const nls = await ev("localStorage.getItem('localai.cwNewLang')");
check("语言选择记进 localai.cwNewLang", nls === "py", String(nls));
await ev("(() => { const i = document.getElementById('cwNewName'); i.value = " + JSON.stringify(LANG_BASE) + "; i.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()");
await ev("document.getElementById('cwNew').click(); 1");
const langCreated = await waitFor("!!document.querySelector(" + JSON.stringify(selItem(LANG_PATH)) + ")", 10000);
const langMode = await ev("(() => { const w = document.querySelector('#codeModal .CodeMirror'); return w && w.CodeMirror ? w.CodeMirror.getOption('mode') : null; })()");
check("无扩展名 " + LANG_BASE + " 自动补成 " + LANG_PATH, langCreated === true, LANG_PATH);
check("新建 py 后 CodeMirror mode = python", String(langMode).indexOf("python") >= 0, String(langMode));

// ---------- 3. 造一个有 bug 的 JS 并打开 ----------
const BUG_PATH = "code/codeui-bug-" + STAMP + ".js";
const BUG_CODE = ["function sumValues(arr) {","  let total = 0;","  for (let i = 0; i <= arr.length; i++) {","    total += arr[i].value;","  }","  return total;","}","console.log(sumValues([{ value: 1 }, { value: 2 }]));"].join("\n");
const cap = await api("POST", "/api/code/capture", { files: [{ name: "codeui-bug-" + STAMP + ".js", content: BUG_CODE }] });
check("capture 造 bug 文件", cap.status === 200 && cap.data && cap.data.saved && cap.data.saved.length === 1, "HTTP " + cap.status);
await ev("document.getElementById('cwRefresh').click(); 1");
await waitFor("!!document.querySelector(" + JSON.stringify(selItem(BUG_PATH)) + ")", 10000);
await ev("document.querySelector(" + JSON.stringify(selItem(BUG_PATH)) + ").click(); 1");
await waitFor("(() => { const w = document.querySelector('#codeModal .CodeMirror'); return !!(w && w.CodeMirror && w.CodeMirror.getValue().indexOf('sumValues') >= 0); })()", 10000);

// ---------- 4. 真模型流式审查 ----------
const tReview = Date.now();
await ev("document.getElementById('cwReview').click(); 1");
const gotThink = await waitFor("(document.getElementById('cwThinkText').textContent || '').length > 20", 60000, 400);
const firstDeltaMs = Date.now() - tReview;
check("审查中流式出现思考块（#cwThinkText 有内容）", gotThink === true, "首段 " + firstDeltaMs + "ms");
const thinkOpen = await ev("(() => { const d = document.getElementById('cwThink'); return !!d && !d.hidden; })()");
check("思考块 details#cwThink 可见", thinkOpen === true);
const doneReview = await waitFor("/审查完成/.test(document.getElementById('cwReviewState').textContent || '')", 150000, 500);
const reviewMs = Date.now() - tReview;
const rvJson = await ev("(() => {"
  + " var cards = Array.from(document.querySelectorAll('#cwIssues .cwIssue'));"
  + " return {"
  + "  state: document.getElementById('cwReviewState').textContent || '',"
  + "  summary: (document.getElementById('cwReviewSummary').textContent || '').trim(),"
  + "  thinkLen: (document.getElementById('cwThinkText').textContent || '').length,"
  + "  meta: document.getElementById('cwReviewMeta').textContent || '',"
  + "  cards: cards.map(function (c) { var h = c.querySelector('.cwIssueHead'); return { line: Number(c.dataset.line), endLine: Number(c.dataset.endLine), sev: c.dataset.severity, head: h ? h.textContent : '', hasDetail: !!c.querySelector('.cwIssueDetail'), hasFix: !!c.querySelector('.cwIssueFix'), hasApply: !!c.querySelector('.cwIssueApply') }; }),"
  + "  errLines: document.querySelectorAll('.cwLineErr').length,"
  + "  warnLines: document.querySelectorAll('.cwLineWarn').length,"
  + "  infoLines: document.querySelectorAll('.cwLineInfo').length"
  + " };"
  + "})()");
const rv = rvJson;
console.log("  审查结果: " + JSON.stringify({ ms: reviewMs, state: rv.state, meta: rv.meta, cards: rv.cards.length, thinkLen: rv.thinkLen, err: rv.errLines, warn: rv.warnLines, info: rv.infoLines }));
check("审查完成（#cwReviewState 含「审查完成」）", doneReview === true && /审查完成/.test(rv.state), rv.state + " · " + reviewMs + "ms");
check("#cwReviewMeta 显示模型与耗时", String(rv.meta).length > 0, rv.meta);
check("#cwReviewBody 有可读摘要", rv.summary.length > 0, rv.summary.slice(0, 80));
check("问题卡片 >=1（.cwIssue[data-line][data-severity]）", rv.cards.length >= 1, "n=" + rv.cards.length);
check("卡片结构完整（Head/Detail/Fix/Apply）", rv.cards.length > 0 && rv.cards.every(function (c) { return c.hasApply; }) && rv.cards.some(function (c) { return c.hasDetail; }), JSON.stringify(rv.cards[0]));
check("severity 只在 error/warn/info", rv.cards.every(function (c) { return ["error","warn","info"].indexOf(c.sev) >= 0; }), rv.cards.map(function (c) { return c.sev; }).join(","));
check("错误行有行 class（err/warn/info >=1）", (rv.errLines + rv.warnLines + rv.infoLines) >= 1, "err=" + rv.errLines + " warn=" + rv.warnLines + " info=" + rv.infoLines);
await shot("codeui-review.png");

// ---------- 5. 点卡片跳行并选中 ----------
if (!rv.cards.length) {
  check("点卡片跳行并选中（落在问题行范围）", false, "没有卡片可点");
} else {
  const line0 = rv.cards[0].line, end0 = rv.cards[0].endLine;
  await ev("document.querySelector('#cwIssues .cwIssue').click(); 1");
  await sleep(350);
  const sel = await ev("(() => { var w = document.querySelector('#codeModal .CodeMirror'); if (!w || !w.CodeMirror) return null; var cm = w.CodeMirror; var a = cm.getCursor('from'), b = cm.getCursor('to'); return { from: a.line + 1, to: b.line + 1, text: cm.getSelection() }; })()");
  check("点卡片跳行并选中（落在问题行范围）", !!sel && sel.from >= line0 && sel.from <= end0 && sel.text.length > 0, JSON.stringify(sel).slice(0, 120));
}

// ---------- 6. 一键纠正 → 写编辑器 + .cwLineChanged ----------
const beforeFix = await ev("(() => { var w = document.querySelector('#codeModal .CodeMirror'); return w && w.CodeMirror ? w.CodeMirror.getValue() : ''; })()");
await ev("document.getElementById('cwFixAll').click(); 1");
const fixDone = await waitFor("/已修改/.test(document.getElementById('cwReviewState').textContent || '')", 150000, 500);
const fxJson = await ev("(() => {"
  + " var w = document.querySelector('#codeModal .CodeMirror');"
  + " return { state: document.getElementById('cwReviewState').textContent || '', code: w && w.CodeMirror ? w.CodeMirror.getValue() : '', changed: document.querySelectorAll('.cwLineChanged').length, dirtyTab: !!document.querySelector('#cwTabs .cwTab.dirty'), file: document.getElementById('cwFile').textContent || '' };"
  + "})()");
const fx = fxJson;
check("一键纠正完成（#cwReviewState 含「已修改」）", fixDone === true && /已修改/.test(fx.state), fx.state);
check("纠正后的代码写进编辑器（与审查前不同且非空）", fx.code.trim().length > 0 && fx.code !== beforeFix, "len " + beforeFix.length + " -> " + fx.code.length);
check("改动行出现 .cwLineChanged", fx.changed >= 1, "n=" + fx.changed);
check("保持 dirty（未自动落盘）：标签有 ● / 文件标「未保存」", fx.dirtyTab === true || /未保存/.test(fx.file), fx.file + " dirtyTab=" + fx.dirtyTab);
const diskAfterFix = await api("GET", "/api/workspace/read?path=" + encodeURIComponent(BUG_PATH));
check("纠正后没有自动落盘（服务端仍是原 bug 代码）", diskAfterFix.status === 200 && diskAfterFix.data.content === BUG_CODE, "HTTP " + diskAfterFix.status + " same=" + (diskAfterFix.data && diskAfterFix.data.content === BUG_CODE));
await shot("codeui-fix.png");

// ---------- 7. 发回对话 ----------
await ev("document.getElementById('cwSendChat').click(); 1");
await sleep(400);
const chat = await ev("(() => { var q = document.getElementById('q'); return { val: q ? q.value : '', modalHidden: document.getElementById('codeModal').hidden }; })()");
check("发回对话后 #q 含围栏代码块", chat.val.indexOf(FENCE) >= 0 && chat.val.indexOf("sumValues") >= 0, "len=" + chat.val.length);
check("说明里含文件名 / 语言 / 「修正后的版本」", /这是修正后的版本/.test(chat.val) && /codeui-bug-/.test(chat.val) && /javascript/.test(chat.val), chat.val.split("\n").slice(0, 2).join(" | "));
check("未自动发送（只是填入输入框，面板收起）", chat.modalHidden === true, "codeModal.hidden=" + chat.modalHidden);

// ---------- 8. 设置 → 代码：改颜色 ----------
await ev("document.getElementById('settingsBtn').click(); 1");
await waitFor("!document.getElementById('settingsModal').hidden", 6000);
await ev("document.querySelector('.settingsTabs .stab[data-tab=\"code\"]').click(); 1");
const paneVisible = await waitFor("!document.getElementById('paneCode').hidden", 5000);
check("设置里新增「代码」页并可见", paneVisible === true);
const setColor = await ev("(() => { var el = document.getElementById('cwColorErr'); el.value = '#00ff00'; el.dispatchEvent(new Event('input', { bubbles: true })); var saved = JSON.parse(localStorage.getItem('localai.cwColors') || '{}'); var v = getComputedStyle(document.documentElement).getPropertyValue('--cw-err-bg').trim(); return { saved: saved.err, cssVar: v }; })()");
check("改 #cwColorErr → localStorage 记 localai.cwColors", setColor.saved === "#00ff0066", String(setColor.saved));
check("改色后 CSS 变量 --cw-err-bg 生效", setColor.cssVar === "#00ff0066", String(setColor.cssVar));
await shot("codeui-settings-code.png");
const reset = await ev("(() => { document.getElementById('cwColorReset').click(); var saved = JSON.parse(localStorage.getItem('localai.cwColors') || '{}'); var v = getComputedStyle(document.documentElement).getPropertyValue('--cw-err-bg').trim(); return { err: saved.err, cssVar: v, input: document.getElementById('cwColorErr').value }; })()");
check("#cwColorReset 恢复默认 #7f1d1d66", reset.err === "#7f1d1d66" && reset.cssVar === "#7f1d1d66" && reset.input === "#7f1d1d", JSON.stringify(reset));

// ---------- 9. 控制台无 error ----------
check("控制台 0 个 error / 未捕获异常", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));

// ---------- 10. 自复位 ----------
await ev("(() => { document.getElementById('settingsClose').click(); var q = document.getElementById('q'); q.value = ''; q.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()");
await sleep(700);
await ev("(() => { try { localStorage.removeItem('localai.cwNewLang'); localStorage.removeItem('localai.cwColors'); localStorage.removeItem('localai.cwOpen'); localStorage.removeItem('localai.cwIntent'); } catch (e) {} return 1; })()");
await api("POST", "/api/workspace/delete", { path: BUG_PATH });
await api("POST", "/api/workspace/delete", { path: LANG_PATH });
const left = [];
for (const p of [BUG_PATH, LANG_PATH]) { const r = await api("GET", "/api/workspace/read?path=" + encodeURIComponent(p)); if (!(r.status === 400 || r.status === 404)) left.push(p + ":" + r.status); }
check("自复位：探针建的文件已删", left.length === 0, left.join(",") || "clean");

console.log("\nRESULT " + pass + "/" + (pass + fail));
ws.close();
process.exit(fail ? 1 : 0);

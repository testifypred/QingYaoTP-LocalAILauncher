/**
 * codeui UI 自检（fetch stub 版，不碰 8099 / 不需要模型）
 *   node codeui-stub-check.mjs
 * 8069 被别的探针占满时用它验 UI：CDP 覆写 window.fetch，自造 SSE 事件流；
 * 真模型全流程另见 codeui-cdp-check.mjs。
 * 覆盖：#cwReview 流式思考块 / 问题卡片 / 行高亮 / 点卡片跳行 / 一键纠正 + .cwLineChanged /
 *       发回对话填 #q / 高亮颜色 localStorage + CSS 变量 + 恢复默认 / 控制台 0 error。
 * 前提：9333 里 8099 的页面已经打开（本脚本不导航、不 reload）。
 */
import WebSocket from "ws";
import fs from "node:fs";

const CDP = process.argv[2] || "http://127.0.0.1:9333";
const OUT = "D:/LocalModels/server/docs/feature-code-review-terminal-2026-11-15";
const FENCE = String.fromCharCode(96).repeat(3);

const BUG_CODE = ["function sumValues(arr) {","  let total = 0;","  for (let i = 0; i <= arr.length; i++) {","    total += arr[i].value;","  }","  return total;","}","console.log(sumValues([{ value: 1 }, { value: 2 }]));"].join("\n");
const FIXED_CODE = ["function sumValues(arr) {","  let total = 0;","  for (let i = 0; i < arr.length; i++) {","    if (arr[i]) total += arr[i].value;","  }","  return total;","}","console.log(sumValues([{ value: 1 }, { value: 2 }]));"].join("\n");
const REVIEW_EVENTS = [
  { type: "meta", model: "Qwen3.5-4B", modelFile: "qwen3-5-4B-Q4_K_M.gguf", contextSize: 8192, switchedModel: false },
  { type: "delta", text: "- 第 3 行：循环条件用 <= 会越界。\n" },
  { type: "delta", text: "- 第 4 行：arr[i] 可能是 undefined。\n" },
  { type: "delta", text: "- 建议：改成 < 并做存在性判断。\n" },
  { type: "phase", phase: "findings" },
  { type: "findings", summary: "发现 2 个问题：循环越界 + 可能空指针。", lineCount: 8, issues: [
    { line: 3, endLine: 3, severity: "error", title: "循环越界", detail: "i <= arr.length 会读到 undefined", fix: "改成 i < arr.length" },
    { line: 4, endLine: 4, severity: "warn", title: "可能空指针", detail: "arr[i] 可能是 undefined", fix: "加存在性判断" }
  ] },
  { type: "done", seconds: 2.4, model: "Qwen3.5-4B" },
];
const FIX_EVENTS = [
  { type: "meta", model: "Qwen3.5-4B", modelFile: "qwen3-5-4B-Q4_K_M.gguf", switchedModel: false },
  { type: "delta", text: "先修循环边界：<= 改成 <。\n" },
  { type: "delta", text: "再补空值判断：arr[i] 存在才累加。\n" },
  { type: "result", code: FIXED_CODE, changes: [{ start: 3, end: 4 }], added: 2, removed: 2, lineCount: 8 },
  { type: "done", seconds: 1.2, model: "Qwen3.5-4B" },
];
const SINGLE_CODE = ["function sumValues(arr) {","  let total = 0;","  for (let i = 0; i < arr.length; i++) {","    total += arr[i].value;","  }","  return total;","}","console.log(sumValues([{ value: 1 }, { value: 2 }]));"].join("\n");
const FIX_SINGLE_EVENTS = [
  { type: "meta", model: "Qwen3.5-4B", modelFile: "qwen3-5-4B-Q4_K_M.gguf", switchedModel: false },
  { type: "delta", text: "只改这一条：循环条件 <= 改成 <。\n" },
  { type: "result", code: SINGLE_CODE, changes: [{ start: 3, end: 3 }], added: 1, removed: 1, lineCount: 8 },
  { type: "done", seconds: 0.9, model: "Qwen3.5-4B" },
];
const REVIEW_SWITCH_EVENTS = [
  { type: "meta", model: "Phi-4-mini", modelFile: "Phi-4-mini-instruct-Q4_K_M.gguf", contextSize: 8192, switchedModel: true },
  { type: "delta", text: "- 换个模型看：循环边界仍然越界。\n" },
  { type: "findings", summary: "换模型审查：1 个越界问题。", lineCount: 8, issues: [{ line: 3, endLine: 3, severity: "error", title: "循环越界", detail: "i <= arr.length", fix: "改成 <" }] },
  { type: "done", seconds: 1.1, model: "Phi-4-mini" },
];

const list = await (await fetch(CDP + "/json/list")).json();
const page = list.find((t) => t.type === "page" && t.url.indexOf("127.0.0.1:8099") >= 0);
if (!page) { console.log("no 8099 page in Edge: " + JSON.stringify(list.map((t) => t.url))); process.exit(2); }
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
const waitFor = async (expr, ms = 8000, step = 120) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await ev(expr)) return true; await sleep(step); }
  return (await ev(expr)) === true;
};
const shot = async (name) => {
  const s = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(OUT + "/" + name, Buffer.from(s.result.data, "base64"));
  console.log("  截图: " + OUT + "/" + name);
};

await send("Runtime.enable");

// ---------- 0. 页面检查 + 装 stub（不碰 8099：/api/* 全部本地短路） ----------
if (!(await ev("!!document.getElementById('codeBtn')"))) { console.log("页面不是 app.html（没有 #codeBtn）"); process.exit(2); }
const stubFn = [
  "function (reviewEvents, fixEvents, fixSingleEvents, switchEvents) {",
  "  window.__codeuiOrigFetch = window.__codeuiOrigFetch || window.fetch;",
  "  window.__mkSSE = function (events) {",
  "    var enc = new TextEncoder();",
  "    var stream = new ReadableStream({ start: function (c) {",
  "      var i = 0;",
  "      var tick = function () {",
  "        if (i >= events.length) { try { c.close(); } catch (e) {} return; }",
  "        c.enqueue(enc.encode(\"data: \" + JSON.stringify(events[i]) + \"\\n\\n\"));",
  "        i += 1;",
  "        setTimeout(tick, 120);",
  "      };",
  "      tick();",
  "    } });",
  "    return new Response(stream, { status: 200, headers: { \"content-type\": \"text/event-stream\" } });",
  "  };",
  "  window.fetch = function (url, opt) {",
  "    var u = String(url);",
  "    if (u.indexOf(\"/api/code/review/stream\") >= 0) {",
  "      var rq = {}; try { rq = JSON.parse((opt && opt.body) || '{}'); } catch (e) {}",
  "      return Promise.resolve(window.__mkSSE(rq.model ? switchEvents : reviewEvents));",
  "    }",
  "    if (u.indexOf(\"/api/code/fix\") >= 0) {",
  "      var req = {}; try { req = JSON.parse((opt && opt.body) || '{}'); } catch (e) {}",
  "      return Promise.resolve(window.__mkSSE(req.scope === 'single' ? fixSingleEvents : fixEvents));",
  "    }",
  "    if (u.indexOf(\"/api/\") >= 0) return Promise.resolve(new Response(JSON.stringify({ error: { message: \"stub: 8099 暂停\" } }), { status: 503, headers: { \"content-type\": \"application/json\" } }));",
  "    return window.__codeuiOrigFetch.apply(this, arguments);",
  "  };",
  "}"
].join("\n");
await ev("(" + stubFn + ")(" + JSON.stringify(REVIEW_EVENTS) + "," + JSON.stringify(FIX_EVENTS) + "," + JSON.stringify(FIX_SINGLE_EVENTS) + "," + JSON.stringify(REVIEW_SWITCH_EVENTS) + "); 1");
const stubOn = await ev("window.fetch.toString().indexOf('__mkSSE') >= 0");
check("fetch stub 已装上（/api 不真发请求）", stubOn === true);

// ---------- 1. 准备编辑器内容 ----------
await ev("document.getElementById('codeBtn').click(); 1");
await sleep(200);
await ev("window.cwLoadIntoEditor('code/codeui-stub.js', " + JSON.stringify(BUG_CODE) + "); 1");
await sleep(250);
const curFile = await ev("document.getElementById('cwFile').textContent");
check("代码面板载入可审查代码", String(curFile).indexOf("codeui-stub.js") >= 0, curFile);
const optCount = await ev("document.getElementById('cwReviewModel').options.length");
const opt0 = await ev("document.getElementById('cwReviewModel').options[0].textContent");
check("审查模型下拉首项是「本对话模型（…）」", optCount >= 1 && /本对话模型/.test(String(opt0)), "n=" + optCount + " first=" + opt0);

// ---------- 2. 流式审查（stub SSE） ----------
await ev("document.getElementById('cwReview').click(); 1");
const thinkStreamed = await waitFor("(document.getElementById('cwThinkText').textContent || '').length > 20", 15000);
check("审查中流式出现思考块（#cwThinkText 有内容）", thinkStreamed === true);
const reviewDone = await waitFor("/审查完成/.test(document.getElementById('cwReviewState').textContent || '')", 20000);
const rv = await ev("(() => {"
  + " var cards = Array.from(document.querySelectorAll('#cwIssues .cwIssue'));"
  + " return {"
  + "  state: document.getElementById('cwReviewState').textContent || '',"
  + "  summary: (document.getElementById('cwReviewSummary').textContent || '').trim(),"
  + "  meta: document.getElementById('cwReviewMeta').textContent || '',"
  + "  thinkOpen: !document.getElementById('cwThink').hidden,"
  + "  thinkLen: (document.getElementById('cwThinkText').textContent || '').length,"
  + "  cards: cards.map(function (c) { var h = c.querySelector('.cwIssueHead'); return { line: Number(c.dataset.line), endLine: Number(c.dataset.endLine), sev: c.dataset.severity, head: h ? h.textContent : '', hasDetail: !!c.querySelector('.cwIssueDetail'), hasFix: !!c.querySelector('.cwIssueFix'), hasApply: !!c.querySelector('.cwIssueApply') }; }),"
  + "  errLines: document.querySelectorAll('.cwLineErr').length,"
  + "  warnLines: document.querySelectorAll('.cwLineWarn').length"
  + " }; })()");
console.log("  审查: " + JSON.stringify({ state: rv.state, meta: rv.meta, cards: rv.cards.length, thinkLen: rv.thinkLen, err: rv.errLines, warn: rv.warnLines }));
check("审查完成（#cwReviewState 含「审查完成」）", reviewDone === true && /审查完成/.test(rv.state), rv.state);
check("#cwReviewMeta 显示模型与耗时", /Qwen3\.5-4B/.test(rv.meta) && /s$/.test(rv.meta.trim()), rv.meta);
check("#cwReviewSummary 有摘要（#cwReviewBody 可读）", rv.summary.length > 0, rv.summary);
check("思考块可见且内容是审查思路", rv.thinkOpen === true && /循环/.test(await ev("document.getElementById('cwThinkText').textContent")), "len=" + rv.thinkLen);
check("问题卡片 2 条（.cwIssue[data-line][data-severity]）", rv.cards.length === 2, "n=" + rv.cards.length);
check("卡片结构完整（Head/Detail/Fix/Apply）", rv.cards.length === 2 && rv.cards.every(function (c) { return c.hasApply && c.hasDetail && c.hasFix && /^行 /.test(c.head); }), JSON.stringify(rv.cards[0]));
check("severity = error/warn 且行号 3/4", rv.cards[0] && rv.cards[0].sev === "error" && rv.cards[0].line === 3 && rv.cards[1] && rv.cards[1].sev === "warn" && rv.cards[1].line === 4, JSON.stringify(rv.cards.map(function (c) { return c.sev + "@" + c.line; })));
check("错误/警告行有行 class（.cwLineErr/.cwLineWarn）", rv.errLines >= 1 && rv.warnLines >= 1, "err=" + rv.errLines + " warn=" + rv.warnLines);
await shot("codeui-stub-review.png");

// ---------- 3. 点卡片跳行并选中 ----------
await ev("document.querySelectorAll('#cwIssues .cwIssue')[1].click(); 1");
await sleep(250);
const sel = await ev("(() => { var w = document.querySelector('#codeModal .CodeMirror'); var cm = w && w.CodeMirror; if (!cm) return null; var a = cm.getCursor('from'), b = cm.getCursor('to'); return { from: a.line + 1, to: b.line + 1, text: cm.getSelection() }; })()");
check("点卡片跳行并选中（第 4 行）", !!sel && sel.from === 4 && sel.to === 4 && sel.text.length > 0, JSON.stringify(sel).slice(0, 100));

// ---------- 3b. 单条「一键更改」= scope single ----------
await ev("document.querySelectorAll('#cwIssues .cwIssueApply')[0].click(); 1");
const singleDone = await waitFor("/已修改/.test(document.getElementById('cwReviewState').textContent || '')", 20000);
const single = await ev("(() => { var w = document.querySelector('#codeModal .CodeMirror'); return { state: document.getElementById('cwReviewState').textContent || '', code: w.CodeMirror.getValue(), changed: document.querySelectorAll('.cwLineChanged').length, think: (document.getElementById('cwThinkText').textContent || '') }; })()");
check("单条一键更改完成（#cwReviewState 含「已修改」）", singleDone === true && /已修改/.test(single.state), single.state);
check("单条更改只改 1 行（.cwLineChanged=1）且代码已更新", single.changed === 1 && single.code === SINGLE_CODE, "changed=" + single.changed + " len=" + single.code.length);
check("单条更改说明追加进思考块", /只改这一条/.test(single.think), single.think.slice(0, 40));

// ---------- 3c. 重新审查：清空旧 issues / 高亮后重跑 ----------
// 等这一轮修正确实收尾（按钮从 disabled 恢复）再点，避免流还没关就点（UI 上此时按钮是禁用的）
await waitFor("!document.getElementById('cwReview').disabled && !document.getElementById('cwReReview').disabled", 10000);
await sleep(200);
await ev("document.getElementById('cwReReview').click(); 1");
const reDone = await waitFor("/审查完成/.test(document.getElementById('cwReviewState').textContent || '')", 20000);
const re = await ev("(() => ({ state: document.getElementById('cwReviewState').textContent || '', cards: document.querySelectorAll('#cwIssues .cwIssue').length, changed: document.querySelectorAll('.cwLineChanged').length, err: document.querySelectorAll('.cwLineErr').length }))()");
check("重新审查后回到「审查完成」且卡片重新生成", reDone === true && /审查完成/.test(re.state) && re.cards === 2, JSON.stringify(re));
check("重新审查已清掉旧的改动行高亮（.cwLineChanged=0）", re.changed === 0, "changed=" + re.changed);

// ---------- 4. 一键纠正（stub SSE） ----------
// 同样等这一轮审查收尾（按钮恢复可点）再点「一键纠正」
await waitFor("!document.getElementById('cwReview').disabled && !document.getElementById('cwFixAll').disabled", 10000);
await sleep(200);
const beforeFix = await ev("document.querySelector('#codeModal .CodeMirror').CodeMirror.getValue()");
await ev("document.getElementById('cwFixAll').click(); 1");
const fixDone = await waitFor("/已修改/.test(document.getElementById('cwReviewState').textContent || '')", 20000);
const fx = await ev("(() => { var w = document.querySelector('#codeModal .CodeMirror'); return { state: document.getElementById('cwReviewState').textContent || '', code: w.CodeMirror.getValue(), changed: document.querySelectorAll('.cwLineChanged').length, dirtyTab: !!document.querySelector('#cwTabs .cwTab.dirty'), file: document.getElementById('cwFile').textContent || '', thinkLen: (document.getElementById('cwThinkText').textContent || '').length }; })()");
check("一键纠正完成（#cwReviewState 含「已修改」）", fixDone === true && /已修改/.test(fx.state), fx.state);
check("修正代码写进编辑器（与审查前不同）", fx.code === FIXED_CODE && fx.code !== beforeFix, "len " + beforeFix.length + " -> " + fx.code.length);
check("改动行出现 .cwLineChanged（1 处区间）", fx.changed >= 1, "n=" + fx.changed);
check("保持 dirty（未自动落盘）：标签有 ● / 文件标「未保存」", fx.dirtyTab === true || /未保存/.test(fx.file), fx.file);
check("修正说明追加进同一思考块", fx.thinkLen > 0 && /先修循环边界/.test(await ev("document.getElementById('cwThinkText').textContent")), "len=" + fx.thinkLen);
await shot("codeui-stub-fix.png");

// ---------- 5. 设置 → 代码：改颜色 / 恢复默认 ----------
await ev("document.getElementById('settingsBtn').click(); 1");
await waitFor("!document.getElementById('settingsModal').hidden", 5000);
await ev("document.querySelector('.settingsTabs .stab[data-tab=\"code\"]').click(); 1");
const paneShown = await waitFor("!document.getElementById('paneCode').hidden", 4000);
check("设置里新增「代码」页并可见", paneShown === true);
const col = await ev("(() => { var el = document.getElementById('cwColorErr'); el.value = '#00ff00'; el.dispatchEvent(new Event('input', { bubbles: true })); var saved = JSON.parse(localStorage.getItem('localai.cwColors') || '{}'); var v = getComputedStyle(document.documentElement).getPropertyValue('--cw-err-bg').trim(); var st = document.getElementById('cwColorState'); return { saved: saved.err, cssVar: v, info: st ? st.textContent : '(旧页面无 cwColorState)' }; })()");
check("改 #cwColorErr → localStorage 记 localai.cwColors", col.saved === "#00ff0066", String(col.saved));
check("改色后 CSS 变量 --cw-err-bg 生效", col.cssVar === "#00ff0066", String(col.cssVar));
await shot("codeui-stub-settings-code.png");
const rst = await ev("(() => { document.getElementById('cwColorReset').click(); var saved = JSON.parse(localStorage.getItem('localai.cwColors') || '{}'); var v = getComputedStyle(document.documentElement).getPropertyValue('--cw-err-bg').trim(); return { err: saved.err, cssVar: v, input: document.getElementById('cwColorErr').value }; })()");
check("#cwColorReset 恢复默认 #7f1d1d66", rst.err === "#7f1d1d66" && rst.cssVar === "#7f1d1d66" && rst.input === "#7f1d1d", JSON.stringify(rst));

// ---------- 6. 发回对话 ----------
await ev("document.getElementById('settingsClose').click(); 1");
await sleep(200);
await ev("document.getElementById('cwSendChat').click(); 1");
await sleep(300);
const chat = await ev("(() => { var q = document.getElementById('q'); return { val: q ? q.value : '', hidden: document.getElementById('codeModal').hidden }; })()");
check("发回对话后 #q 含围栏代码块", chat.val.indexOf(FENCE) >= 0 && chat.val.indexOf("sumValues") >= 0, "len=" + chat.val.length);
check("说明含文件名/语言/「修正后的版本」/改动行", /这是修正后的版本/.test(chat.val) && /codeui-stub\.js/.test(chat.val) && /javascript/.test(chat.val) && /改动行/.test(chat.val), chat.val.split("\n").slice(0, 2).join(" | "));
check("未自动发送（仅填入输入框）", chat.hidden === true, "codeModal.hidden=" + chat.hidden);

// ---------- 6b. 审查可选模型 + 切换提示（meta.switchedModel） ----------
await ev("document.getElementById('codeBtn').click(); 1");
await sleep(300);
await ev("window.cwLoadIntoEditor('code/codeui-stub.js', " + JSON.stringify(BUG_CODE) + "); 1");
await sleep(200);
const modelVal = await ev("(function () { var s = document.getElementById('cwReviewModel'); for (var i = 1; i < s.options.length; i++) { if (s.options[i].value) { s.value = s.options[i].value; s.dispatchEvent(new Event('change')); return s.value; } } return ''; })()");
await ev("document.getElementById('cwReview').click(); 1");
await sleep(150);
const switching = await ev("document.getElementById('cwReviewState').textContent || ''");
const switchDone = await waitFor("/审查完成/.test(document.getElementById('cwReviewState').textContent || '')", 15000);
const switchUi = await ev("(() => ({ state: document.getElementById('cwReviewState').textContent || '', meta: document.getElementById('cwReviewMeta').textContent || '', toasts: (document.getElementById('toasts') || {}).textContent || '', cards: document.querySelectorAll('#cwIssues .cwIssue').length }))()");
check("审查模型下拉有可选模型（value 非空）", !!modelVal && modelVal.length > 4, String(modelVal));
check("选了别的模型先显示「正在切换模型…」", /正在切换模型/.test(switching), switching);
check("meta.switchedModel=true → toast 提示已切换", switchDone === true && /已切换到/.test(switchUi.toasts), "toasts=" + switchUi.toasts.trim().slice(0, 80));
check("切模型审查仍渲染 findings 卡片", switchUi.cards === 1, "cards=" + switchUi.cards);
await ev("(() => { var s = document.getElementById('cwReviewModel'); s.value = ''; s.dispatchEvent(new Event('change')); return 1; })()");

// ---------- 7. 控制台 + 收尾 ----------
check("控制台 0 个 error / 未捕获异常", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
await ev("(() => { try { if (window.__codeuiOrigFetch) window.fetch = window.__codeuiOrigFetch; } catch (e) {} var q = document.getElementById('q'); q.value = ''; q.dispatchEvent(new Event('input', { bubbles: true })); try { localStorage.removeItem('localai.cwNewLang'); localStorage.removeItem('localai.cwColors'); localStorage.removeItem('localai.cwOpen'); localStorage.removeItem('localai.cwIntent'); } catch (e) {} return 1; })()");
console.log("\nRESULT " + pass + "/" + (pass + fail));
ws.close();
process.exit(fail ? 1 : 0);

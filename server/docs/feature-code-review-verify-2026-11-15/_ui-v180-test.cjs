/**
 * v1.8.0 前端 UI 联调脚本（临时证据脚本，跑完删除）
 * 覆盖：单锁互斥 / 质询真跑 / 停止 / 他人复审 compare 渲染 / 云端未配置 toast /
 *      云端确认弹窗（取消不发、确认才发）+ stub 上游脱敏校验 / 设置卡片回填、保存失败、清 Key。
 */
const fs = require("node:fs");
const http = require("node:http");
const BASE = process.argv[2] || "http://127.0.0.1:8299";
const PORT = new URL(BASE).port;
const CDP = "http://127.0.0.1:9334";
const OUT = "D:/LocalModels/server/docs/feature-code-review-verify-2026-11-15";
const CODE_PATH = "code/probe-v180.js";
const NL = String.fromCharCode(10);
const FENCE = String.fromCharCode(96, 96, 96);
const MODEL = "qwen3-5-4B-Q4_K_M.gguf";
const BUGGY = [
  "// v1.8.0 前端联调用样例：第 2 行应该是加法",
  "function add(a, b) {",
  "  return a - b;",
  "}",
  "",
  "const cfg = { apiKey: \"sk-ABCDEFGH12345678\", mail: \"user@example.com\", p: \"C:\\\\Users\\\\bob\\\\x.py\", ip: \"10.1.2.3\" };",
  "console.log(add(1, 2), cfg.mail);",
].join(NL);

async function main() {
  let token = "";
  let loadedBefore = "";
let pass = 0, fail = 0;
const lines = [];
const check = (n, c, d) => { if (c) { pass += 1; lines.push("ok   " + n + (d ? "  [" + d + "]" : "")); } else { fail += 1; lines.push("FAIL " + n + "  " + (d || "")); } console.log(lines[lines.length - 1]); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 本地云端 stub（OpenAI 形状；记录收到的请求体） ----------
let stubHits = 0;
let stubBody = "";
const STUB_TEXT = ["云端审查思路：", "- 第 3 行：return 用了减法，应该是加法，结果会算错"].join(NL) + NL + FENCE + "json" + NL +
  JSON.stringify({ summary: "stub 云端审查：发现 1 个问题", issues: [{ line: 3, endLine: 3, severity: "error", title: "stub 问题：减法应为加法", detail: "stub 返回的详情", fix: "改成 a + b" }] }) + NL + FENCE + NL;
const stub = http.createServer((req, res) => {
  let buf = "";
  req.on("data", (c) => { buf += c; });
  req.on("end", () => {
    stubHits += 1;
    stubBody = buf;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: STUB_TEXT } }] }));
  });
});
await new Promise((r) => stub.listen(0, "127.0.0.1", r));
const STUB_HOST = "127.0.0.1:" + stub.address().port;

const apiGet = async (p) => { const r = await fetch(BASE + p); return { status: r.status, body: await r.json().catch(() => null) }; };
const apiPost = async (p, body, token) => {
  const headers = { "content-type": "application/json" };
  if (token) headers["x-local-token"] = token;
  const r = await fetch(BASE + p, { method: "POST", headers, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};

// ---------- CDP ----------
const list = await (await fetch(CDP + "/json/list")).json();
const page = list.find((t) => t.type === "page" && t.url.indexOf("127.0.0.1:" + PORT) >= 0);
if (!page) { console.log("找不到页面（端口 " + PORT + "）：" + JSON.stringify(list.map((t) => t.url))); process.exit(3); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0;
const pend = new Map();
const netEvents = [];
const reqUrls = new Map();
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); return; }
  if (d.method === "Network.requestWillBeSent") reqUrls.set(d.params.requestId, d.params.request.url || "");
  else if (d.method === "Network.loadingFailed") netEvents.push({ id: d.params.requestId, url: reqUrls.get(d.params.requestId) || "", err: String(d.params.errorText || "") });
};
const send = (method, params) => new Promise((res) => { const i = ++msgId; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
const ev = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result && r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.text + " " + ((r.result.exceptionDetails.exception || {}).description || ""));
  return r.result && r.result.result ? r.result.result.value : undefined;
};
const click = (id) => ev("((() => { const el = document.getElementById(" + JSON.stringify(id) + "); if (!el) return 'no'; if (el.disabled) return 'disabled'; el.click(); return 'ok'; })())");
const waitFor = async (expr, ms, step) => {
  const t0 = Date.now();
  for (;;) {
    let v = false;
    try { v = await ev(expr); } catch (e) { v = false; }
    if (v) return v;
    if (Date.now() - t0 > (ms || 20000)) return false;
    await sleep(step || 400);
  }
};
const shot = async (name) => {
  try {
    const r = await send("Page.captureScreenshot", { format: "png" });
    if (r.result && r.result.data) { fs.writeFileSync(OUT + "/" + name, Buffer.from(r.result.data, "base64")); console.log("  截图 " + name); }
  } catch (e) { console.log("  截图失败 " + name + " " + e.message); }
};
await send("Page.enable");
await send("Network.enable");
// 请求被 AbortController 掐掉时 Chrome 报 net::ERR_ABORTED —— 用它证明「停止」是真 abort
const abortSeen = (frag) => netEvents.some((e) => String(e.url).indexOf(frag) >= 0 && /ABORT|CANCEL/i.test(e.err));

try {
  console.log("目标 BASE=" + BASE + "，CDP=" + CDP);
  // ---------- 0a. 复位云端配置 + 清自己的残留样例（避免被上一轮残留干扰） ----------
  await apiPost("/api/cloud/config", { enabled: false, baseURL: "", apiKey: "" }, "").catch(() => {});
  await apiPost("/api/workspace/delete", { path: CODE_PATH }, "").catch(() => {});
  const cfg0 = (await apiGet("/api/cloud/config")).body || {};
  check("开头云端配置已复位（ready=false，便于验 toast）", cfg0.ready === false && cfg0.hasKey === false, JSON.stringify({ ready: cfg0.ready, hasKey: cfg0.hasKey, enabled: cfg0.enabled }));

  // ---------- 0. 前置：模型 + 令牌 ----------
  const st0 = (await apiGet("/api/state")).body || {};
  token = st0.localToken || "";
  const loaded0 = String(st0.loaded || "");
  check("拿到本地令牌 localToken", !!token);
  if (!loaded0) {
    console.log("  未加载模型，加载 " + MODEL + " …");
    await apiPost("/api/load", { file: MODEL, contextSize: 8192 });
    await waitFor("(async () => { const r = await fetch('/api/state'); const j = await r.json(); return !!(j && j.loaded); })()", 180000, 1000);
  }
  const st1 = (await apiGet("/api/state")).body || {};
  loadedBefore = String(st1.loaded || "");
  check("有已加载的文本模型", !!loadedBefore, loadedBefore);
  let vw = await ev("window.innerWidth");
  check("Edge 视口宽度 ~1408（1440 窗口）", vw >= 1380 && vw <= 1450, "innerWidth=" + vw);
  if (!(vw >= 1380 && vw <= 1450)) {
    console.log("  实际 innerWidth=" + vw + "，用 Emulation 固定成 1440x900 再跑布局断言");
    await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await sleep(700);
    vw = await ev("window.innerWidth");
    check("视口已修正为 1440", vw === 1440, "innerWidth=" + vw);
  }

  // ---------- 1. 造样例文件并打开代码面板 ----------
  const saved = await apiPost("/api/workspace/save", { path: CODE_PATH, content: BUGGY }, token);
  check("样例代码已写入 code/", saved.status === 200, JSON.stringify(saved.body).slice(0, 120));
  await ev("openCodePanel(" + JSON.stringify(CODE_PATH) + ")");
  await sleep(900);
  check("#codeModal 已打开", (await ev("!document.getElementById('codeModal').hidden")) === true);
  await waitFor("(() => { const w = document.querySelector('#codeModal .CodeMirror'); return !!(w && w.CodeMirror && w.CodeMirror.getValue().length > 0); })()", 10000, 300);
  const edLen = await ev("document.querySelector('#codeModal .CodeMirror').CodeMirror.getValue().length");
  check("编辑器载入样例代码", edLen > 50, "len=" + edLen);
  // 审查面板默认展开
  const panelOpen = await ev("!document.getElementById('cwReviewPanel').hidden");
  if (!panelOpen) { await click("cwReviewToggle"); await sleep(400); }

  // ---------- 2. 新增 DOM 存在性 ----------
  check("#cwChallenge 存在", (await ev("!!document.getElementById('cwChallenge')")) === true);
  check("#cwCross 存在", (await ev("!!document.getElementById('cwCross')")) === true);
  check("#cwCrossModel 存在", (await ev("!!document.getElementById('cwCrossModel')")) === true);
  check("#cwCloud 存在", (await ev("!!document.getElementById('cwCloud')")) === true);
  check("#cwCrossModel 首项 value=\"\"「自动（换一个模型）」", (await ev("(() => { const s = document.getElementById('cwCrossModel'); return !!(s && s.options[0] && s.options[0].value === '' && /自动/.test(s.options[0].textContent || '')); })()")) === true);
  check("#cwCrossModel 无 Phi-4-mini 选项", (await ev("(() => { const s = document.getElementById('cwCrossModel'); return !!s && [...s.options].every((o) => !/^Phi-4-mini/i.test(o.textContent || '')); })()")) === true);
  check("#cwChallengeBox 默认隐藏", (await ev("document.getElementById('cwChallengeBox').hidden === true")) === true);
  check("#cwCrossPanel 默认隐藏", (await ev("document.getElementById('cwCrossPanel').hidden === true")) === true);

  // ---------- 3. 先跑一次模型审查（质询/复审的 primary 来源） ----------
  const runReview = async () => {
    await click("cwReview");
    return waitFor("(() => { const s = document.getElementById('cwReviewState'); return (typeof cwReviewBusy !== 'undefined' && (typeof cwReviewBusy !== 'undefined' ? cwReviewBusy : null) === false && /审查完成|审查失败/.test(s.textContent || '')) ? s.textContent : ''; })()", 240000, 800);
  };
  let revState = await runReview();
  let nIssues = Number(await ev("document.querySelectorAll('#cwIssues .cwIssue').length")) || 0;
  if (!nIssues) {
    console.log("  首次审查 0 个问题，重试一次（模型波动）…");
    await sleep(800);
    revState = await runReview();
    nIssues = Number(await ev("document.querySelectorAll('#cwIssues .cwIssue').length")) || 0;
  }
  check("审查完成且拿到 primary 问题", !!revState && nIssues >= 1, "state=" + String(revState || "").slice(0, 90) + " n=" + nIssues);
  const summarySaved = await ev("(() => { const el = document.getElementById('cwReviewSummary'); return (el.textContent || '').length; })()");
  check("审查摘要已记录（primary.summary）", summarySaved > 0, "summaryChars=" + summarySaved);

  // ---------- 4. 质询：展开 + 真跑一轮 + 单锁互斥 ----------
  await click("cwChallenge");
  check("点 #cwChallenge 展开 #cwChallengeBox", (await ev("!document.getElementById('cwChallengeBox').hidden")) === true);
  await ev("(() => { const t = document.getElementById('cwChallengeText'); t.value = '第 3 行不是 bug，因为测试期望就是减法'; t.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()");
  await click("cwChallengeSend");
  await sleep(900);
  const lock1 = JSON.parse(await ev("(() => JSON.stringify({ busy: (typeof cwReviewBusy !== 'undefined' ? cwReviewBusy : null), review: document.getElementById('cwReview').disabled, fix: document.getElementById('cwFixAll').disabled, cross: document.getElementById('cwCross').disabled, cloud: document.getElementById('cwCloud').disabled, chal: document.getElementById('cwChallenge').disabled, send: document.getElementById('cwChallengeSend').textContent }))()"));
  check("质询进行中：(typeof cwReviewBusy !== 'undefined' ? cwReviewBusy : null) = true（单锁）", lock1.busy === true, JSON.stringify(lock1));
  check("质询进行中：其余按钮全 disabled", lock1.review && lock1.fix && lock1.cross && lock1.cloud && lock1.chal, JSON.stringify(lock1));
  check("质询进行中：#cwChallengeSend 变「停止」", /停止/.test(lock1.send), lock1.send);
  const chDone = await waitFor("(() => { const s = document.getElementById('cwReviewState'); return ((typeof cwReviewBusy !== 'undefined' ? cwReviewBusy : null) === false && /质询完成|质询失败|已停止/.test(s.textContent || '')) ? s.textContent : ''; })()", 240000, 800);
  const card1 = await ev("(() => { const c = document.querySelector('#cwChallengeLog .cwChalCard'); if (!c) return null; const q = c.querySelector('.cwChalQ'); const a = c.querySelector('.cwChalA'); return JSON.stringify({ q: (q && q.textContent) || '', a: (a && a.textContent) || '' }); })()");
  const cardObj = card1 ? JSON.parse(card1) : null;
  check("质询完成（状态行）", !!chDone && !/失败/.test(String(chDone)), String(chDone || "").slice(0, 120));
  check("质询记录卡片落 #cwChallengeLog（.cwChalCard/.cwChalQ/.cwChalA）", !!cardObj, card1 ? card1.slice(0, 100) : "no card");
  check("质询卡片有回答正文（流式填进去的）", !!cardObj && String(cardObj.a).length > 20 && !/等待模型回答/.test(cardObj.a), "answerLen=" + (cardObj ? String(cardObj.a).length : 0));
  await shot("ui-v180-challenge.png");

  // ---------- 5. 停止：第二轮质询中途点「停止」（Lead 指定的边界②） ----------
  await ev("(() => { const t = document.getElementById('cwChallengeText'); t.value = '第二个质疑：还有别的边界问题吗？'; return 1; })()");
  netEvents.length = 0;
  await click("cwChallengeSend");
  await sleep(1600);
  const stopClick = await click("cwChallengeSend");
  check("进行中点 #cwChallengeSend 触发停止", stopClick === "ok", String(stopClick));
  const stopped = await waitFor("(() => { const s = document.getElementById('cwReviewState'); return ((typeof cwReviewBusy !== 'undefined' ? cwReviewBusy : null) === false && /已停止/.test(s.textContent || '')) ? s.textContent : ''; })()", 20000, 400);
  check("停止后状态行「已停止」", !!stopped, String(stopped || ""));
  await sleep(500);
  const lock2 = JSON.parse(await ev("(() => JSON.stringify({ busy: (typeof cwReviewBusy !== 'undefined' ? cwReviewBusy : null), review: document.getElementById('cwReview').disabled, cross: document.getElementById('cwCross').disabled, cloud: document.getElementById('cwCloud').disabled, send: document.getElementById('cwChallengeSend').textContent }))()"));
  check("停止后单锁释放、按钮恢复可用", lock2.busy === false && lock2.review === false && lock2.cross === false && lock2.cloud === false && /发送质询/.test(lock2.send), JSON.stringify(lock2));
  await sleep(2200);
  check("质询「停止」真的 abort 了流式请求（Network canceled）", abortSeen("/api/code/review/challenge"), JSON.stringify(netEvents.slice(-4)));

  // ---------- 6. 他人复审：verdict / 两栏 / 差异清单 / 跳行 ----------
  await ev("(() => { const s = document.getElementById('cwCrossModel'); s.value = ''; s.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()");
  await click("cwCross");
  await sleep(900);
  const lock3 = JSON.parse(await ev("(() => JSON.stringify({ busy: (typeof cwReviewBusy !== 'undefined' ? cwReviewBusy : null), review: document.getElementById('cwReview').disabled, cloud: document.getElementById('cwCloud').disabled, crossText: document.getElementById('cwCross').textContent, thinkOpen: !document.getElementById('cwThink').hidden }))()"));
  check("复审进行中：单锁 + 其余按钮 disabled", lock3.busy === true && lock3.review === true && lock3.cloud === true, JSON.stringify(lock3));
  check("复审进行中：#cwCross 变「停止」、复用 #cwThink 流式", /停止/.test(lock3.crossText) && lock3.thinkOpen === true, JSON.stringify(lock3));
  const cmp = await waitFor("(() => { const v = document.getElementById('cwCrossVerdict'); const t = (v && v.textContent) || ''; return /一致|仅一方提出|互相矛盾/.test(t) ? JSON.stringify({ t: t, cls: v.className }) : ''; })()", 300000, 800);
  const cmpObj = cmp ? JSON.parse(cmp) : null;
  check("compare 到达后 #cwCrossVerdict 渲染判定", !!cmpObj, cmp || "");
  check("判定徽标带 .ok/.warn/.err", !!cmpObj && /(^|\s)(ok|warn|err)(\s|$)/.test(String(cmpObj.cls || "")), cmpObj ? cmpObj.cls : "");
  check("判定徽标带 stats 计数", !!cmpObj && /原审查 \d+ · 他人 \d+/.test(cmpObj.t), cmpObj ? cmpObj.t : "");
  const crossDone = await waitFor("(() => { const s = document.getElementById('cwReviewState'); return ((typeof cwReviewBusy !== 'undefined' ? cwReviewBusy : null) === false && /他人复审完成|他人复审失败/.test(s.textContent || '')) ? s.textContent : ''; })()", 120000, 600);
  check("他人复审完成（状态行）", !!crossDone && !/失败/.test(String(crossDone)), String(crossDone || "").slice(0, 120));
  const cols = JSON.parse(await ev("(() => JSON.stringify({ panel: !document.getElementById('cwCrossPanel').hidden, cols: document.querySelectorAll('#cwCrossPanel .cwCrossCols .cwCrossCol').length, p: document.querySelectorAll('#cwCrossColPrimary .cwCrossItem').length, s: document.querySelectorAll('#cwCrossColSecond .cwCrossItem').length }))()"));
  check("并列两栏渲染（#cwCrossColPrimary / #cwCrossColSecond）", cols.panel && cols.cols === 2 && cols.p >= 1, JSON.stringify(cols));
  const diff = JSON.parse(await ev("(() => { const d = [...document.querySelectorAll('#cwCrossDiff .cwDiffItem')]; const cls = {}; d.forEach((x) => { ['agree', 'onlyP', 'onlyS', 'conflict'].forEach((c) => { if (x.classList.contains(c)) cls[c] = (cls[c] || 0) + 1; }); }); return JSON.stringify({ n: d.length, cls: cls, head: d.slice(0, 3).map((x) => (x.textContent || '').slice(0, 70)) }); })()"));
  check("差异清单渲染（.cwDiffItem）", diff.n >= 1, JSON.stringify(diff).slice(0, 200));
  check("差异清单带 .agree/.onlyP/.onlyS/.conflict 类别", Object.keys(diff.cls).length >= 1, JSON.stringify(diff.cls));
  const jump = await ev("(() => { const d = document.querySelector('#cwCrossDiff .cwDiffItem[data-line]'); if (!d) return null; const ln = Number(d.dataset.line); d.click(); const w = document.querySelector('#codeModal .CodeMirror'); return JSON.stringify({ want: ln, got: w.CodeMirror.getCursor().line + 1 }); })()");
  const jumpObj = jump ? JSON.parse(jump) : null;
  check("点差异清单条目跳到对应代码行", !!jumpObj && jumpObj.want === jumpObj.got, String(jump || "no diff item"));
  // 窄窗（<1100px）两栏要换行、不横向溢出（契约 §2.3）
  await send("Emulation.setDeviceMetricsOverride", { width: 1000, height: 800, deviceScaleFactor: 1, mobile: false });
  await sleep(700);
  const narrow = JSON.parse(await ev("(() => { const col = document.querySelector('#cwCrossPanel .cwCrossCol'); const cols = document.querySelector('#cwCrossPanel .cwCrossCols'); return JSON.stringify({ innerW: innerWidth, basis: col ? getComputedStyle(col).flexBasis : '', overflow: cols ? cols.scrollWidth - cols.clientWidth : -1 }); })()"));
  check("窄窗(<1100px) 两栏换行且不横向溢出", narrow.innerW < 1100 && /100%/.test(String(narrow.basis)) && narrow.overflow <= 1, JSON.stringify(narrow));
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(600);
  await shot("ui-v180-cross.png");

  // ---------- 6b. 审查中途「停止」：真 abort + 按钮恢复原样（Lead 指定的边界②） ----------
  netEvents.length = 0;
  await click("cwReview");
  await waitFor("(() => (typeof cwReviewBusy !== 'undefined' ? cwReviewBusy : null) === true)()", 8000, 120);
  await sleep(2800); // 让它真的开始生成再停，而不是刚点下就停
  const stillBusy = await ev("(typeof cwReviewBusy !== 'undefined' ? cwReviewBusy : null)");
  check("审查进行中（此时才点停止）", stillBusy === true, "busy=" + stillBusy);
  const revStopClick = await click("cwReview");
  check("审查进行中点 #cwReview 触发停止（进行中按钮可点）", revStopClick === "ok", String(revStopClick));
  const revStopped = await waitFor("(() => { const s = document.getElementById('cwReviewState'); return ((typeof cwReviewBusy !== 'undefined' ? cwReviewBusy : null) === false && /已停止/.test(s.textContent || '')) ? s.textContent : ''; })()", 25000, 400);
  check("审查「停止」后状态行显示已停止", !!revStopped, String(revStopped || ""));
  await sleep(2200);
  check("审查「停止」真的 abort 了流式请求（Network canceled）", abortSeen("/api/code/review/stream"), JSON.stringify(netEvents.slice(-4)));
  const restored = JSON.parse(await ev("(() => JSON.stringify({ reviewText: document.getElementById('cwReview').textContent, fixText: document.getElementById('cwFixAll').textContent, crossText: document.getElementById('cwCross').textContent, cloudText: document.getElementById('cwCloud').textContent, sendText: document.getElementById('cwChallengeSend').textContent, reviewDisabled: document.getElementById('cwReview').disabled, crossDisabled: document.getElementById('cwCross').disabled, chalDisabled: document.getElementById('cwChallenge').disabled }))()"));
  check("停止后按钮恢复原样（文案 + 可点）", restored.reviewText === "模型审查" && restored.fixText === "一键纠正" && restored.crossText === "他人复审" && restored.cloudText === "云端复审" && restored.sendText === "发送质询" && restored.reviewDisabled === false && restored.crossDisabled === false && restored.chalDisabled === false, JSON.stringify(restored));

  // ---------- 7. 云端：ready=false 只 toast、不弹窗 ----------
  check("配置未就绪时 stub 未被调用", stubHits === 0, "hits=" + stubHits);
  await click("cwCloud");
  await sleep(1600);
  const toastText = await ev("(() => { const t = [...document.querySelectorAll('#toasts .toast')].map((x) => x.textContent || ''); return JSON.stringify(t); })()");
  check("云端未配置：toast 指到 设置 → 代码", /设置/.test(toastText) && /代码/.test(toastText) && /云端/.test(toastText), String(toastText).slice(0, 180));
  check("云端未配置：不弹确认窗", (await ev("document.getElementById('cloudConfirmModal').hidden === true")) === true);
  check("云端未配置：不发请求", stubHits === 0, "hits=" + stubHits);

  // ---------- 8. 配置指向本地 stub，弹窗确认 / 取消 ----------
  const cfgSaved = await apiPost("/api/cloud/config", { enabled: true, baseURL: "http://" + STUB_HOST + "/v1", model: "stub-model", apiKey: "sk-UI-TEST-KEY-0001" }, token);
  check("云端配置保存到 stub（ready=true）", cfgSaved.status === 200 && !!cfgSaved.body.ready, JSON.stringify(cfgSaved.body).slice(0, 200));
  await click("cwCloud");
  const modalShown = await waitFor("(() => !document.getElementById('cloudConfirmModal').hidden)()", 10000, 200);
  check("ready 时点 #cwCloud 弹 #cloudConfirmModal", modalShown === true);
  const hostTxt = String(await ev("(document.getElementById('cloudConfirmHost') || {}).textContent || ''"));
  check("#cloudConfirmHost 写明「已脱敏」+ 目标域名", hostTxt.indexOf(STUB_HOST) >= 0 && /脱敏/.test(hostTxt), hostTxt);
  await shot("ui-v180-cloud-confirm.png");
  await click("cloudConfirmCancel");
  await sleep(900);
  check("点 #cloudConfirmCancel：什么都不发", stubHits === 0, "hits=" + stubHits);
  check("点取消后弹窗关闭", (await ev("document.getElementById('cloudConfirmModal').hidden === true")) === true);

  // ---------- 9. 确认发送：结果写回 cwIssues + meta「云端 · host · 模型 · 秒数」 ----------
  await click("cwCloud");
  await waitFor("(() => !document.getElementById('cloudConfirmModal').hidden)()", 10000, 200);
  await click("cloudConfirmOk");
  const cloudDone = await waitFor("(() => { const s = document.getElementById('cwReviewState'); return ((typeof cwReviewBusy !== 'undefined' ? cwReviewBusy : null) === false && /云端复审完成|云端复审失败/.test(s.textContent || '')) ? s.textContent : ''; })()", 120000, 600);
  check("确认后才发云端复审并完成", !!cloudDone && !/失败/.test(String(cloudDone)), String(cloudDone || "").slice(0, 140));
  check("云端请求只发了 1 次（取消那次没发）", stubHits === 1, "hits=" + stubHits);
  const cloudUi = JSON.parse(await ev("(() => JSON.stringify({ meta: document.getElementById('cwReviewMeta').textContent || '', n: document.querySelectorAll('#cwIssues .cwIssue').length, head: (document.querySelector('#cwIssues .cwIssue .cwIssueHead') || {}).textContent || '', fixDisabled: document.getElementById('cwFixAll').disabled, state: document.getElementById('cwReviewState').textContent || '' }))()"));
  check("meta 显示「云端 · host · 模型 · 秒数」", /云端/.test(cloudUi.meta) && cloudUi.meta.indexOf(STUB_HOST) >= 0 && /s$/.test(cloudUi.meta.trim()), cloudUi.meta);
  check("云端 findings 写回 #cwIssues 卡片", cloudUi.n >= 1, "n=" + cloudUi.n + " head=" + String(cloudUi.head).slice(0, 80));
  check("云端结论可用「一键纠正」（#cwFixAll 可用）", cloudUi.fixDisabled === false);
  const sentBody = (() => { try { return JSON.parse(stubBody); } catch (e) { return null; } })();
  const sentText = sentBody && Array.isArray(sentBody.messages) ? sentBody.messages.map((m) => m.content || "").join(NL) : "";
  check("发到上游的请求是 OpenAI 形状（model/messages）", !!sentBody && !!sentBody.model && Array.isArray(sentBody.messages), "model=" + (sentBody ? sentBody.model : "?"));
  check("请求体里的代码已脱敏（不含原 API Key / 邮箱 / 本机路径 / IP）", sentText.length > 0 && sentText.indexOf("sk-ABCDEFGH12345678") < 0 && sentText.indexOf("user@example.com") < 0 && sentText.indexOf("10.1.2.3") < 0, "sentChars=" + sentText.length);
  check("请求体出现脱敏占位符（<API_KEY> / <REDACTED> / <EMAIL> / <PATH>）", /<API_KEY>|<REDACTED>/.test(sentText) && /<EMAIL>/.test(sentText), "sentChars=" + sentText.length);
  await shot("ui-v180-cloud-result.png");

  // ---------- 10. 设置 → 代码 云端卡片：回填 / 保存失败 / 清 Key ----------
  await click("settingsBtn");
  await sleep(700);
  const tabClick = await ev("(() => { const b = [...document.querySelectorAll('.settingsTabs .stab')].find((x) => x.dataset.tab === 'code'); if (!b) return 'no'; b.click(); return 'ok'; })()");
  check("设置 → 代码页签可点", tabClick === "ok", String(tabClick));
  const cst = await waitFor("(() => { const s = document.getElementById('cloudState'); const t = (s && s.textContent) || ''; return /已启用|已保存|未启用|未配置/.test(t) ? JSON.stringify({ state: t, hint: document.getElementById('cloudHint').textContent || '', enabled: document.getElementById('cloudEnabled').checked, base: document.getElementById('cloudBase').value, model: document.getElementById('cloudModel').value, keyVal: document.getElementById('cloudKey').value, keyPh: document.getElementById('cloudKey').placeholder, keyType: document.getElementById('cloudKey').type }) : ''; })()", 10000, 300);
  const cstObj = cst ? JSON.parse(cst) : null;
  check("打开设置回填云端配置（#cloudState「已启用（host）」）", !!cstObj && /已启用/.test(cstObj.state) && cstObj.state.indexOf(STUB_HOST) >= 0, cstObj ? cstObj.state : "");
  check("回填 baseURL / model / enabled", !!cstObj && cstObj.enabled === true && cstObj.base === "http://" + STUB_HOST + "/v1" && cstObj.model === "stub-model", cstObj ? JSON.stringify({ base: cstObj.base, model: cstObj.model }) : "");
  check("#cloudKey 不回显明文（type=password，空值 + masked 占位）", !!cstObj && cstObj.keyType === "password" && cstObj.keyVal === "" && cstObj.keyPh.indexOf("sk-***0001") >= 0, cstObj ? cstObj.keyPh : "");
  check("#cloudHint 写明 apiKey 只存本机 / 不进日志", !!cstObj && /apiKey/.test(cstObj.hint) && /日志/.test(cstObj.hint), cstObj ? cstObj.hint.slice(0, 90) : "");
  await shot("ui-v180-settings-cloud.png");
  // 保存失败：http 非回环 → 400 INSECURE_URL，{code,message} 显示到 #cloudState
  await ev("(() => { document.getElementById('cloudBase').value = 'http://example.com/v1'; return 1; })()");
  await click("cloudSave");
  const failTxt = await waitFor("(() => { const s = document.getElementById('cloudState'); const t = (s && s.textContent) || ''; return /保存失败/.test(t) ? t : ''; })()", 12000, 300);
  check("保存失败把 {code,message} 显示到 #cloudState", !!failTxt && failTxt.indexOf("INSECURE_URL") >= 0 && failTxt.length > 20, String(failTxt || "").slice(0, 160));
  // 改回 stub 保存成功
  await ev("(() => { document.getElementById('cloudBase').value = 'http://" + STUB_HOST + "/v1'; return 1; })()");
  await click("cloudSave");
  const okTxt = await waitFor("(() => { const s = document.getElementById('cloudState'); const t = (s && s.textContent) || ''; return /已启用|已保存/.test(t) ? t : ''; })()", 12000, 300);
  check("保存成功 #cloudState「已启用（host）」", !!okTxt && /已启用/.test(okTxt) && okTxt.indexOf(STUB_HOST) >= 0, String(okTxt || ""));
  // 清 Key
  await click("cloudClearKey");
  const clearTxt = await waitFor("(() => { const s = document.getElementById('cloudState'); const t = (s && s.textContent) || ''; return /已清除/.test(t) ? t : ''; })()", 12000, 300);
  check("清除已存 Key 后 #cloudState 有文案", !!clearTxt, String(clearTxt || ""));
  const cfgAfter = (await apiGet("/api/cloud/config")).body || {};
  check("清除后 GET 里 hasKey=false、ready=false", cfgAfter.hasKey === false && cfgAfter.ready === false, JSON.stringify({ hasKey: cfgAfter.hasKey, ready: cfgAfter.ready }));
  check("#cloudKey 占位回到「只存本机」", (await ev("document.getElementById('cloudKey').placeholder.indexOf('已保存') < 0")) === true);
} catch (e) {
  fail += 1;
  lines.push("FAIL 脚本异常：" + String((e && e.stack) || e).slice(0, 500));
  console.log(lines[lines.length - 1]);
} finally {
  // ---------- 收尾：配置复位 + 删样例 + 恢复原模型 ----------
  try {
    await apiPost("/api/cloud/config", { enabled: false, baseURL: "", apiKey: "" }, token).catch(() => {});
    await apiPost("/api/workspace/delete", { path: CODE_PATH }, token).catch(() => {});
    const now = ((await apiGet("/api/state")).body || {}).loaded || "";
    if (loadedBefore && now && now !== loadedBefore) {
      console.log("  恢复原模型 " + loadedBefore);
      await apiPost("/api/load", { file: loadedBefore, contextSize: 16384 }).catch(() => {});
      await waitFor("(async () => { const r = await fetch('/api/state'); const j = await r.json(); return !!(j && j.loaded); })()", 180000, 1000);
    }
    if (fs.existsSync("D:/LocalModels/data/cloud-review.json")) {
      try {
        const j = JSON.parse(fs.readFileSync("D:/LocalModels/data/cloud-review.json", "utf8"));
        if (!j.enabled && !j.baseURL && !j.apiKey) fs.unlinkSync("D:/LocalModels/data/cloud-review.json");
      } catch (e) {}
    }
  } catch (e) { console.log("收尾异常：" + e.message); }
  stub.close();
  try { ws.close(); } catch (e) {}
  const head = ["# v1.8.0 前端 UI 联调结果（临时脚本 " + new Date().toISOString() + "）", "通过 " + pass + " / 失败 " + fail, ""];
  fs.writeFileSync(OUT + "/ui-v180-selfcheck.txt", head.concat(lines, ["", "云端 stub：http://" + STUB_HOST + "/v1"]).join(NL));
  console.log(NL + "===== 结果: " + pass + "/" + (pass + fail) + " 通过，失败 " + fail + " =====");
  process.exit(fail > 0 ? 1 : 0);
}

}
main().catch((e) => { console.log('MAIN ERROR', e); process.exit(4); });

/**
 * 审查结论导出 / 三方对照探针（v1.9.0）
 *
 *   node probe-code-review-export.mjs [base] [cdp] [shotDir]
 *
 * 覆盖（不需要加载模型：新接口都是纯函数）：
 *   A) 令牌与参数：/api/code/review/export 与 /api/code/review/compare3 无令牌 403、kind 非法 400
 *   B) compare3 纯函数口径（确定性夹具 + stats 自洽恒等式）：三方一致 / 两方一致 / 仅一方 / 严重度矛盾；
 *      以及空输入、两方输入、行距 ≤2 归并
 *   C) .challenge.md 导出：标题/原审查结论/质询轮次/问答、文件名格式、密钥脱敏
 *   D) .review.md 导出：六节（本地/两栏对照/云端/三方表/质询/说明）、三方表、缺失部分兜底文案
 *   E) UI（CDP）：按钮存在、#cwCompare3 渲染表格、导出后 #cwExportState、存进会话后消息真的落盘
 *
 * 自复位：删除探针建的临时会话、清掉注入的快照、结束前 reload 页面。
 * 注意：不要在真实会话里点「存进会话」——本探针先建临时会话再切过去。
 */
import WebSocket from "ws";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] || "http://127.0.0.1:8099";
const CDP = process.argv[3] || "http://127.0.0.1:9333";
const OUT = process.argv[4] || path.join(SERVER_DIR, "docs", "feature-review-export-2026-11-18");
const PORT = new URL(BASE).port || "8099";
const STAMP = Date.now().toString(36);

let pass = 0, fail = 0, skip = 0;
const check = (n, c, d = "") => { if (c) { pass++; console.log("ok   " + n + (d ? "  [" + d + "]" : "")); } else { fail++; console.log("FAIL " + n + "  " + d); } };
const skipCheck = (n, d = "") => { skip++; console.log("skip " + n + (d ? "  [" + d + "]" : "")); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(p) {
  try {
    const r = await fetch(BASE + p, { signal: AbortSignal.timeout(15000) });
    const t = await r.text();
    let d = null; try { d = JSON.parse(t); } catch {}
    return { status: r.status, data: d, text: t };
  } catch (e) { return { status: 0, data: null, text: "", error: String((e && e.message) || e) }; }
}
async function postJson(p, body, token, timeout = 15000) {
  try {
    const headers = { "content-type": "application/json" };
    if (token) headers["x-local-token"] = token;
    const r = await fetch(BASE + p, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
    const t = await r.text();
    let d = null; try { d = JSON.parse(t); } catch {}
    return { status: r.status, data: d, text: t };
  } catch (e) { return { status: 0, data: null, text: "", error: String((e && e.message) || e) }; }
}

const st = await getJson("/api/state");
const TOKEN = String((st.data && st.data.localToken) || "");
console.log("\n== 目标 " + BASE + "，CDP " + CDP + "，令牌 " + (TOKEN ? "已取到" : "缺失（后续会 skip UI）") + " ==");

// ============================================================ A. 令牌 / 参数
console.log("\n== A. 令牌与参数 ==");
{
  const a1 = await postJson("/api/code/review/export", { kind: "review" }, "");
  check("A1 export 无令牌 403", a1.status === 403, "HTTP " + a1.status);
  const a2 = await postJson("/api/code/review/compare3", { lineCount: 10, local: { issues: [] } }, "");
  check("A2 compare3 无令牌 403", a2.status === 403, "HTTP " + a2.status);
  const a3 = await postJson("/api/code/review/export", { kind: "nope" }, TOKEN);
  check("A3 export kind 非法 400", a3.status === 400, "HTTP " + a3.status + " " + String(a3.data && a3.data.error && a3.data.error.message || "").slice(0, 30));
  const a4 = await postJson("/api/code/review/compare3", { lineCount: 0, local: { issues: [] }, cross: { issues: [] }, cloud: { issues: [] } }, TOKEN);
  check("A4 compare3 全空合法 200 + rows=0", a4.status === 200 && a4.data && a4.data.stats && a4.data.stats.rows === 0, "HTTP " + a4.status + " rows=" + (a4.data && a4.data.stats && a4.data.stats.rows));
  check("A5 compare3 全空 verdict=consistent", a4.data && a4.data.verdict === "consistent", String(a4.data && a4.data.verdict));
}

// ============================================================ B. compare3 口径
console.log("\n== B. compare3 三方聚合 ==");
const FIX_LOCAL = [
  { line: 3, endLine: 3, severity: "error", title: "A", detail: "", fix: "" },
  { line: 10, endLine: 10, severity: "warn", title: "B", detail: "", fix: "" },
  { line: 20, endLine: 20, severity: "info", title: "C", detail: "", fix: "" },
];
const FIX_CROSS = [
  { line: 4, endLine: 4, severity: "error", title: "A2", detail: "", fix: "" },
  { line: 30, endLine: 30, severity: "error", title: "D", detail: "", fix: "" },
];
const FIX_CLOUD = [
  { line: 3, endLine: 3, severity: "warn", title: "A3", detail: "", fix: "" },
  { line: 30, endLine: 30, severity: "error", title: "D2", detail: "", fix: "" },
  { line: 40, endLine: 40, severity: "info", title: "E", detail: "", fix: "" },
];
let FIX_MAIN_RESULT = null;
{
  const b1 = await postJson("/api/code/review/compare3", {
    lineCount: 50,
    local: { issues: FIX_LOCAL },
    cross: { issues: FIX_CROSS },
    cloud: { issues: FIX_CLOUD },
  }, TOKEN);
  FIX_MAIN_RESULT = b1.data;
  const s = (b1.data && b1.data.stats) || {};
  const j = s.judgments || {};
  check("B1 compare3 200", b1.status === 200, "HTTP " + b1.status);
  check("B2 行数=5（3/4 归并、20/30/40 分开）", s.rows === 5, "rows=" + s.rows);
  check("B3 三方一致桶里 conflict3=1（严重度不同算矛盾）", s.all3 === 1 && j.conflict3 === 1 && j.all3 === 0, "all3=" + s.all3 + " conflict3=" + j.conflict3);
  check("B4 两方一致=1（30 行 cross+cloud 同为 error）", s.two === 1 && j.pair2 === 1, "two=" + s.two + " pair2=" + j.pair2);
  check("B5 仅一方=3（10/20/40 各自只有一方）", s.one === 3 && j.single === 3, "one=" + s.one);
  check("B6 矛盾计数=1（conflict2 + conflict3）", s.conflict === 1 && j.conflict2 === 0 && j.conflict3 === 1, "conflict=" + s.conflict);
  check("B7 bySource 各来源出现行数 3/2/3", s.bySource && s.bySource.local === 3 && s.bySource.cross === 2 && s.bySource.cloud === 3, JSON.stringify(s.bySource));
  check("B8 pair 两两同行数 lc=1 / lu=1 / cu=2", s.pair && s.pair.lc === 1 && s.pair.lu === 1 && s.pair.cu === 2, JSON.stringify(s.pair));
  check("B9 verdict=contradicts（有矛盾优先）", b1.data && b1.data.verdict === "contradicts", String(b1.data && b1.data.verdict));
  // 恒等式（探针口径自洽，改算法必须同步改这里）
  check("B10 恒等式 rows = all3 + two + one", s.rows === s.all3 + s.two + s.one, s.rows + " vs " + (s.all3 + s.two + s.one));
  check("B11 恒等式 all3 = judgments.all3 + judgments.conflict3", s.all3 === j.all3 + j.conflict3, s.all3 + " vs " + (j.all3 + j.conflict3));
  check("B12 恒等式 two = judgments.pair2 + judgments.conflict2", s.two === j.pair2 + j.conflict2, s.two + " vs " + (j.pair2 + j.conflict2));
  check("B13 恒等式 conflict = judgments.conflict2 + judgments.conflict3", s.conflict === j.conflict2 + j.conflict3, s.conflict + " vs " + (j.conflict2 + j.conflict3));
  check("B14 每行都有判定与 present", Array.isArray(b1.data && b1.data.rows) && b1.data.rows.every((r) => typeof r.judgment === "string" && Array.isArray(r.present) && r.present.length >= 1), "rows=" + (b1.data && b1.data.rows && b1.data.rows.length));
  check("B15 行号升序", (b1.data.rows || []).every((r, i, arr) => i === 0 || arr[i - 1].line <= r.line), "");
}

{
  const row = (FIX_MAIN_RESULT && FIX_MAIN_RESULT.rows || []).find((r) => r.line === 3);
  check("B16 3/4 行合并为三源同行（3-4）", row && row.line === 3 && row.endLine === 4 && row.present.length === 3, row ? "line=" + row.line + "-" + row.endLine + " present=" + row.present.join("+") : "no row");
  check("B17 3/4 行各源都带自己的 title", row && row.local && row.local.title === "A" && row.cross && row.cross.title === "A2" && row.cloud && row.cloud.title === "A3", row ? [row.local && row.local.title, row.cross && row.cross.title, row.cloud && row.cloud.title].join("/") : "");

  // 行距 3 不应归并（>2）
  const b2 = await postJson("/api/code/review/compare3", {
    lineCount: 20,
    local: { issues: [{ line: 5, endLine: 5, severity: "warn", title: "near" }] },
    cross: { issues: [{ line: 8, endLine: 8, severity: "warn", title: "far" }] },
    cloud: { issues: [] },
  }, TOKEN);
  check("B18 行距 3 不归并（rows=2）", b2.data && b2.data.stats && b2.data.stats.rows === 2, "rows=" + (b2.data && b2.data.stats && b2.data.stats.rows));

  // 两方一致：majority
  const b3 = await postJson("/api/code/review/compare3", {
    lineCount: 20,
    local: { issues: [{ line: 5, endLine: 5, severity: "error", title: "x" }] },
    cross: { issues: [{ line: 5, endLine: 5, severity: "error", title: "x2" }] },
    cloud: { issues: [] },
  }, TOKEN);
  check("B19 两方同严重度 verdict=majority", b3.data && b3.data.verdict === "majority", String(b3.data && b3.data.verdict));
  check("B20 两方同严重度 judgment=pair2", b3.data && b3.data.rows && b3.data.rows[0] && b3.data.rows[0].judgment === "pair2", String(b3.data && b3.data.rows && b3.data.rows[0] && b3.data.rows[0].judgment));

  // 两方不同严重度：contradicts + conflict2
  const b4 = await postJson("/api/code/review/compare3", {
    lineCount: 20,
    local: { issues: [{ line: 6, endLine: 6, severity: "warn", title: "y" }] },
    cross: { issues: [{ line: 6, endLine: 6, severity: "error", title: "y2" }] },
    cloud: { issues: [] },
  }, TOKEN);
  check("B21 两方严重度不同 verdict=contradicts", b4.data && b4.data.verdict === "contradicts", String(b4.data && b4.data.verdict));
  check("B22 两方严重度不同 judgment=conflict2", b4.data && b4.data.rows && b4.data.rows[0] && b4.data.rows[0].judgment === "conflict2", String(b4.data && b4.data.rows && b4.data.rows[0] && b4.data.rows[0].judgment));

  // 只有一方：differs
  const b5 = await postJson("/api/code/review/compare3", {
    lineCount: 20,
    local: { issues: [{ line: 2, endLine: 2, severity: "info", title: "z" }] },
    cross: { issues: [] },
    cloud: { issues: [] },
  }, TOKEN);
  check("B23 仅一方 verdict=differs judgment=single", b5.data && b5.data.verdict === "differs" && b5.data.rows[0].judgment === "single", String(b5.data && b5.data.verdict) + "/" + String(b5.data && b5.data.rows && b5.data.rows[0] && b5.data.rows[0].judgment));
}

// ============================================================ C. .challenge.md
console.log("\n== C. 导出质询记录 ==");
const CH_BODY = {
  kind: "challenge",
  meta: { file: "demo.js", lang: "javascript", lineCount: 12, intent: "检查并发写入", at: 1795000000000, model: "Qwen3.5-9B", crossModel: "" },
  primary: { summary: "发现 1 个问题", issues: [{ line: 3, endLine: 3, severity: "error", title: "竞态", detail: "key sk-ABCDEFGH12345678 可能泄露", fix: "加锁" }] },
  challenge: { history: [
    { question: "第 3 行不是 bug，因为调用方已经串行化了", answer: "成立：如果调用方保证串行，这里确实不需要额外加锁。" },
    { question: "那第 5 行呢？", answer: "不成立：第 5 行在异步回调里，无法保证顺序。" },
  ] },
};
{
  const c1 = await postJson("/api/code/review/export", CH_BODY, TOKEN);
  const md = String((c1.data && c1.data.markdown) || "");
  const fn = String((c1.data && c1.data.filename) || "");
  check("C1 challenge 导出 200", c1.status === 200, "HTTP " + c1.status);
  check("C2 文件名格式 <name>-YYYYMMDD-HHmm.challenge.md", /^[a-z0-9._-]+-\d{8}-\d{4}\.challenge\.md$/.test(fn), fn);
  check("C3 bytes 与 markdown UTF-8 长度一致", c1.data && c1.data.bytes === Buffer.byteLength(md, "utf8"), String(c1.data && c1.data.bytes) + " vs " + Buffer.byteLength(md, "utf8"));
  check("C4 一级标题含文件名", md.startsWith("# 质询记录 · demo.js"), md.split("\n")[0]);
  check("C5 有原审查结论小节", md.includes("## 原审查结论"), "");
  check("C6 质询轮数=2", md.includes("## 质询记录（2 轮）"), "");
  check("C7 两轮都有「质疑 / 回答」", (md.match(/### 第 \d+ 轮/g) || []).length === 2 && md.includes("**质疑**：") && md.includes("**回答**："), "轮次=" + (md.match(/### 第 \d+ 轮/g) || []).length);
  check("C8 问答原文都在", md.includes("第 3 行不是 bug，因为调用方已经串行化了") && md.includes("不成立：第 5 行在异步回调里，无法保证顺序。"), "");
  check("C9 密钥已脱敏成 <API_KEY>", md.includes("<API_KEY>") && !/sk-[A-Za-z0-9_-]{8,}/.test(md), "");
  check("C10 不含代码正文（只导出结论）", !md.includes("function add(") && md.includes("不含代码正文"), "");
}

// ============================================================ D. .review.md
console.log("\n== D. 导出复审结论 ==");
const RV_BODY = {
  kind: "review",
  meta: { file: "demo.js", lang: "javascript", lineCount: 50, intent: "检查", at: 1795000000000, model: "Qwen3.5-9B", crossModel: "qwen3-5-4B", cloudHost: "api.deepseek.com", cloudModel: "deepseek-flash" },
  primary: { summary: "本地结论", issues: FIX_LOCAL },
  cross: {
    model: "qwen3-5-4B", sameModel: false, summary: "复核结论", issues: FIX_CROSS, verdict: "differs",
    stats: { primary: 3, second: 2, matched: 1, agree: 1, onlyPrimary: 2, onlySecond: 1, conflicts: 0 },
    agree: [{ line: 3, primary: { line: 3, severity: "error", title: "A" }, second: { line: 4, severity: "error", title: "A2" } }],
    onlyPrimary: [{ line: 10, severity: "warn", title: "B" }],
    onlySecond: [{ line: 30, severity: "error", title: "D" }],
    conflicts: [],
  },
  cloud: { host: "api.deepseek.com", model: "deepseek-flash", summary: "云端结论", issues: FIX_CLOUD },
  compare3: FIX_MAIN_RESULT,
  challenge: { history: [{ question: "Q1", answer: "A1" }] },
};
{
  const d1 = await postJson("/api/code/review/export", RV_BODY, TOKEN);
  const md = String((d1.data && d1.data.markdown) || "");
  const fn = String((d1.data && d1.data.filename) || "");
  check("D1 review 导出 200", d1.status === 200, "HTTP " + d1.status);
  check("D2 文件名格式 .review.md", /^[a-z0-9._-]+-\d{8}-\d{4}\.review\.md$/.test(fn), fn);
  check("D3 标题与文件", md.startsWith("# 审查结论 · demo.js"), md.split("\n")[0]);
  const sections = ["## 一、本地审查", "## 二、他人复审", "### 两栏对照", "## 三、云端复审", "## 四、三方对照（本地 / 他人 / 云端）", "## 五、质询记录", "## 说明"];
  const missing = sections.filter((s) => !md.includes(s));
  check("D4 六个小节 + 说明齐全", missing.length === 0, missing.join(" | "));
  check("D5 含两栏对照四类标签", ["一致", "仅原审查提出", "仅他人复审提出", "互相矛盾"].every((x) => md.includes(x)), "");
  check("D6 含三方对照表头", md.includes("| 行 | 原审查 | 他人复审 | 云端复审 | 判定 |"), "");
  check("D7 三方表含矛盾行（3-4 行）", md.includes("| 3-4 |") && md.includes("三方矛盾"), "");
  check("D8 判定标签正确（互相矛盾）", md.includes("**判定**：互相矛盾") || md.includes("互相矛盾"), "");
  check("D9 云端上游/模型写进 meta", md.includes("api.deepseek.com") && md.includes("deepseek-flash"), "");
  check("D10 质询问答也在 review 文件里", md.includes("### 第 1 轮") && md.includes("Q1"), "");
  check("D11 计数展示（原审查/他人/一致/仅/矛盾）", md.includes("原审查 3") && md.includes("他人 2") && md.includes("矛盾 0"), "");
}
{
  const d2 = await postJson("/api/code/review/export", { kind: "review", primary: { summary: "只有本地", issues: [] } }, TOKEN);
  const md = String((d2.data && d2.data.markdown) || "");
  check("D12 缺失部分有兜底文案", md.includes("（没有运行他人复审）") && md.includes("（没有运行云端复审）") && md.includes("还没有生成三方对照"), "");
  check("D13 空问题列表有「没有发现问题」", md.includes("（本地审查没有发现问题）"), "");
}

// ============================================================ E. UI（CDP）
console.log("\n== E. UI：三方对照 / 导出 / 存进会话 ==");
let SESSION_ID = "";
let PREV_LAST_SESSION = "";
try {
  const list = await (await fetch(CDP + "/json/list")).json();
  const page = list.find((t) => t.type === "page" && t.url.includes("127.0.0.1:" + PORT));
  if (!page) { throw new Error("CDP 里没有 " + BASE + " 的页面（先起 headless Edge 9333 打开它）"); }
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise((r, j) => { ws.once("open", r); ws.once("error", j); });
  let id = 0; const pend = new Map();
  ws.on("message", (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text + " " + (r.result.exceptionDetails.exception?.description || "")); return r.result?.result?.value; };
  const click = (elId) => ev("(() => { const el = document.getElementById(" + JSON.stringify(elId) + "); if (!el) return 'no'; el.click(); return 'ok'; })()");
  const waitFor = async (expr, ms = 8000, step = 200) => {
    const t0 = Date.now(); let last;
    while (Date.now() - t0 < ms) { try { last = await ev(expr); if (last) return last; } catch {} await sleep(step); }
    try { last = await ev(expr); } catch {}
    return last;
  };
  const shot = async (name) => {
    try {
      fs.mkdirSync(OUT, { recursive: true });
      const r = await send("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(path.join(OUT, name), Buffer.from(r.result.data, "base64"));
      console.log("    截图: " + path.join(OUT, name));
    } catch (e) { console.log("    截图失败: " + String((e && e.message) || e)); }
  };

  await send("Page.enable"); await send("Runtime.enable");
  await send("Page.reload", { ignoreCache: true });
  await sleep(3500);
  await ev("(() => { ['firstModal','readmeModal'].forEach((x) => { const el = document.getElementById(x); if (el) el.hidden = true; }); return 1; })()");
  PREV_LAST_SESSION = String((await ev("(() => { try { return localStorage.getItem('localai.lastSession') || ''; } catch { return ''; } })()")) || "");

  const ids = ["cwCompare3", "cwExportReview", "cwExportChallenge", "cwStoreExport", "cwExportState", "cwCompare3Panel", "cwCompare3Table"];
  const present = await ev("(() => { const out = {}; for (const id of " + JSON.stringify(ids) + ") out[id] = !!document.getElementById(id); return out; })()");
  check("E1 新按钮/面板 id 齐全", ids.every((x) => present && present[x]), JSON.stringify(present));
  check("E2 三方对照面板初始隐藏", await ev("document.getElementById('cwCompare3Panel').hidden === true"), "");
  check("E3 按钮初始可用（无任务）", await ev("!document.getElementById('cwCompare3').disabled && !document.getElementById('cwExportReview').disabled"), "");

  // 建临时会话，避免污染用户真实会话
  const cs = await postJson("/api/sessions", { title: "probe-export-" + STAMP, model: "" }, "");
  SESSION_ID = String((cs.data && cs.data.id) || "");
  check("E4 建临时会话成功", Boolean(SESSION_ID), "id=" + SESSION_ID);
  if (SESSION_ID) {
    await ev("loadSession(" + JSON.stringify(SESSION_ID) + ")");
    await sleep(500);
  }

  // 打开代码面板，保证 cwValue() 有编辑器可用
  await click("codeBtn");
  await sleep(1200);
  const CODE_FIXTURE = Array.from({ length: 60 }, (_v, i) => "const v" + (i + 1) + " = " + (i + 1) + ";").join("\n");
  await ev("(() => { const code = " + JSON.stringify(CODE_FIXTURE) + "; const w = document.querySelector('#codeModal .CodeMirror'); if (w && w.CodeMirror) { w.CodeMirror.setValue(code); return 'cm'; } const t = document.getElementById('cwEditor'); if (t) { t.value = code; t.dispatchEvent(new Event('input', { bubbles: true })); return 'ta'; } return 'no'; })()");

  // 注入快照（与真实跑完三/两项后同样的形状；sig 与当前代码一致）
  const injected = await ev(`(() => {
    const sig = cwCodeSig();
    cwSnapshotLocal = { sig, model: 'probe-local', summary: '本地摘要（probe）', issues: [{ line: 3, endLine: 3, severity: 'error', title: 'A', detail: '', fix: '' }, { line: 10, endLine: 10, severity: 'warn', title: 'B', detail: '', fix: '' }], at: Date.now() };
    cwSnapshotCross = { sig, model: 'probe-cross', sameModel: false, summary: '复核摘要（probe）', issues: [{ line: 4, endLine: 4, severity: 'error', title: 'A2', detail: '', fix: '' }], verdict: 'differs', stats: { primary: 2, second: 1, matched: 1, agree: 1, onlyPrimary: 1, onlySecond: 0, conflicts: 0 }, agree: [{ line: 3, primary: { line: 3, severity: 'error', title: 'A' }, second: { line: 4, severity: 'error', title: 'A2' } }], onlyPrimary: [{ line: 10, severity: 'warn', title: 'B' }], onlySecond: [], conflicts: [], at: Date.now() };
    cwSnapshotCloud = null;
    cwChalHistory = [{ question: '第 3 行不是 bug', answer: '成立：调用方已串行化' }];
    cwCompare3Data = null;
    cwSetExportState('');
    return sig;
  })()`);
  check("E5 注入两份结论快照（本地 + 他人）", Boolean(injected), String(injected).slice(0, 24));

  // 三方对照
  await click("cwCompare3");
  const cmpShown = await waitFor("(!document.getElementById('cwCompare3Panel').hidden) && document.querySelectorAll('#cwCompare3Table tr').length >= 3", 8000);
  check("E6 点三方对照后表格渲染（≥2 行数据）", Boolean(cmpShown), "tr=" + await ev("document.querySelectorAll('#cwCompare3Table tr').length"));
  check("E7 三方对照判定文案在状态徽标", await ev("String(document.getElementById('cwCompare3Verdict').textContent).includes('仅一方') || String(document.getElementById('cwCompare3Verdict').textContent).includes('一致')"), await ev("document.getElementById('cwCompare3Verdict').textContent"));
  check("E8 表格行有「行 / 原审查 / 他人复审 / 云端复审 / 判定」表头", await ev("(() => { const ths = [...document.querySelectorAll('#cwCompare3Table th')].map(x => x.textContent); return ths.join('|') === '行|原审查|他人复审|云端复审|判定'; })()"), "");
  await shot("probe-export-compare3.png");

  // 导出 .review.md
  await click("cwExportReview");
  const expRv = await waitFor("String(document.getElementById('cwExportState').textContent).includes('.review.md')", 8000);
  check("E9 点「导出复审结论」→ 状态显示 .review.md", Boolean(expRv), await ev("document.getElementById('cwExportState').textContent"));
  check("E10 导出状态含「已导出」与字节数", await ev("/已导出.*[.]review[.]md（\\d+ 字节）/.test(String(document.getElementById('cwExportState').textContent))"), "");

  // 导出 .challenge.md
  await click("cwExportChallenge");
  const expCh = await waitFor("String(document.getElementById('cwExportState').textContent).includes('.challenge.md')", 8000);
  check("E11 点「导出质询记录」→ 状态显示 .challenge.md", Boolean(expCh), await ev("document.getElementById('cwExportState').textContent"));

  // 存进会话
  await click("cwStoreExport");
  const stored = await waitFor("String(document.getElementById('cwExportState').textContent).includes('已存进会话')", 12000);
  check("E12 点「存进会话」→ 状态显示已存进会话", Boolean(stored), await ev("document.getElementById('cwExportState').textContent"));
  await sleep(800);
  if (SESSION_ID) {
    const sess = await getJson("/api/sessions/" + encodeURIComponent(SESSION_ID));
    const msgs = Array.isArray(sess.data && sess.data.messages) ? sess.data.messages : [];
    const withDoc = msgs.find((m) => m.role === "assistant" && String(m.content || "").includes("# 审查结论 ·"));
    check("E13 会话里真的多了这条审查结论（assistant + 正文）", Boolean(withDoc), "messages=" + msgs.length);
    check("E14 存进会话的正文含三方对照表", Boolean(withDoc) && String(withDoc.content || "").includes("| 行 | 原审查 | 他人复审 | 云端复审 | 判定 |"), "");
    check("E15 消息带短 ctx（避免以后整段进模型上下文）", Boolean(withDoc) && String(withDoc.ctx || "").includes("审查结论已存进会话"), String(withDoc && withDoc.ctx || "").slice(0, 40));
    await shot("probe-export-stored.png");
  }

  // 自复位（注意：本探针切过临时会话，必须把 localStorage 的上次会话指针还原，
  // 否则后面的 probe-start-flow / probe-small-features / probe-start-screen 会因「上次对话」丢失而假红）
  try {
    if (SESSION_ID) await fetch(BASE + "/api/sessions/" + encodeURIComponent(SESSION_ID), { method: "DELETE" });
  } catch {}
  await ev("(() => { try { const v = " + JSON.stringify(PREV_LAST_SESSION) + "; if (v) localStorage.setItem('localai.lastSession', v); else localStorage.removeItem('localai.lastSession'); } catch {} return 1; })()").catch(() => {});
  await ev("(() => { cwSnapshotLocal = null; cwSnapshotCross = null; cwSnapshotCloud = null; cwCompare3Data = null; cwChalHistory = []; cwSetExportState(''); const m = document.getElementById('codeModal'); if (m) m.hidden = true; return 1; })()").catch(() => {});
  await send("Page.reload", { ignoreCache: true }).catch(() => {});
  ws.close();
} catch (e) {
  try { if (SESSION_ID) await fetch(BASE + "/api/sessions/" + encodeURIComponent(SESSION_ID), { method: "DELETE" }); } catch {}
  skipCheck("E UI（CDP 不可用或页面不对）", String((e && e.message) || e).slice(0, 120));
}

console.log("\n== 结果: " + pass + "/" + (pass + fail) + " 通过" + (skip ? ("，" + skip + " skip") : "") + " ==");
console.log("RESULT " + pass + "/" + (pass + fail));
process.exit(fail ? 1 : 0);

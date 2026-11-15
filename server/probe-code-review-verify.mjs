/**
 * 质询 / 他人复审 / 云端复审 探针（v1.8.0 契约 §3）
 *
 *   node probe-code-review-verify.mjs [base] [cdp]
 *
 *   base 默认 http://127.0.0.1:8099（本轮联调传 8299）；第二个参数有值时跑 UI 段（E，CDP/Edge 在 9333）。
 *
 * 覆盖：
 *  A) 质询 POST /api/code/review/challenge：无令牌 403 / 缺 code 400 / question 空 400 / code 超长 413；
 *     真跑：SSE 顺序 meta -> delta* -> done（done 最后）、delta 拼接非空且不含裸 JSON / 代码围栏、
 *     meta.modelFile、done.seconds；带 2 轮 history 再跑一次仍 200。
 *  B) 他人复审 POST /api/code/review/cross：无令牌 403 / 缺 code 400；
 *     真跑（指定 = 当前模型，便宜）：meta -> delta* ->(phase)-> findings -> compare -> done、
 *     findings.issues 字段齐全且行号在 1..lineCount、verdict 取值、compare.stats 三式自洽、
 *     sameModel 是 boolean、四个数组结构；指定 model 时 modelFile 匹配且 sameModel=true；
 *     不指定 model 时自动挑「第一个与当前不同」的模型，断言不会挑 Phi-4-mini（拿到 meta 就断开，不白烧生成）。
 *  C) 云端配置 GET/POST /api/cloud/config：GET 形状 8 字段（+ 契约 §1.3.2 的 file）/ POST 无令牌 403 /
 *     非法 URL 400 / http 非回环 400 INSECURE_URL / dryRun 不落盘 / 保存后 hasKey+keyMasked+host+ready /
 *     响应全文不含明文 key / apiKey:"" 清除。
 *  D) 云端复审 POST /api/code/review/cloud：未配置 400 CLOUD_NOT_READY / confirm 不匹配或缺失 409 CONFIRM_REQUIRED；
 *     自带本地 stub（node:http 随机端口，OpenAI 形状，支持路径 /fail/ 与 /slow/，也认 ?fail=1/?slow=1）：
 *     meta.provider=cloud + host + sentChars>0 + redactions>0（代码塞了 sk-/邮箱/Windows 路径/内网 IP）、
 *     delta 拼接 = stub 文本（且 >=3 段）、findings 解析、done.seconds；
 *     **stub 收到的 body 里没有原 key/邮箱/路径/IP，且出现脱敏标记**；上游 500 -> 502 CLOUD_UPSTREAM；
 *     上游慢（3s）不崩：正常 200 收尾或 error 事件带 message（契约 §3 明确不做超时断言）。绝不真出网。
 *  E) UI（有 cdp 参数才跑）：代码面板 #cwChallenge/#cwCross/#cwCrossModel/#cwCloud 存在、#cwCrossModel 无 Phi、
 *     点 #cwChallenge 展开 #cwChallengeBox；设置 -> 代码 有 #cloudBase/#cloudModel/#cloudKey/#cloudSave（key 是 password）；
 *     云端 ready 时 #cwCloud 弹 #cloudConfirmModal 且 #cloudConfirmHost 含 host；点取消不发请求（stub 计数不变）；
 *     点确认后状态行/meta 出现「云端」且 #cwIssues 渲染卡片。
 *
 * 收尾（finally）：恢复云端配置（停用 + 清 key）、关 stub、**模型状态原样恢复**（开跑前 loaded + context；
 * 未加载就 /api/unload 保持未加载）、删探针临时文件、UI 段导航回页面原地址。
 * 探针卫生（2026-11-15 全量教训）：别硬写 contextSize=8192！全量里驱动预加载 4B/16K，收尾写成 8K 会让后面的
 * probe-ctx-panel（按默认 16K 断言）假红 7 条。
 * 断言口径：带 cdp 73 条 / 不带 cdp 61 条（A-D + 收尾）；退出码 fail>0 -> 1。
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const EVIDENCE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "docs", "feature-code-review-verify-2026-11-15");

const BASE = process.argv[2] || "http://127.0.0.1:8099";
const CDP = process.argv[3] || "";
const RUN_UI = CDP.length > 0;
const PORT = new URL(BASE).port || "8099";
const MODEL = "qwen3-5-4B-Q4_K_M.gguf";
const STAMP = Date.now().toString(36);
const WS_PATH = "code/probe-verify-" + STAMP + ".js";
const FENCE = String.fromCharCode(96, 96, 96);

let pass = 0, fail = 0, skip = 0;
const failedNames = [];
function ok(name, cond, extra) {
  if (cond) { pass += 1; console.log("  ok   " + name + (extra ? "  [" + String(extra).slice(0, 170) + "]" : "")); }
  else { fail += 1; failedNames.push(name); console.log("  FAIL " + name + "  " + String(extra || "").slice(0, 240)); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errText = (r) => String((r && r.data && ((r.data.error && r.data.error.message) || r.data.message)) || (r && r.text) || (r && r.error) || "").slice(0, 240);
const respCode = (r) => String((r && r.data && (r.data.code || (r.data.error && r.data.error.code))) || "");

async function jsonReq(p, body, token, ms) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers["x-local-token"] = token;
  const o = { method: body !== undefined ? "POST" : "GET", headers, signal: AbortSignal.timeout(ms || 30000) };
  if (body !== undefined) o.body = JSON.stringify(body);
  try {
    const r = await fetch(BASE + p, o);
    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch {}
    return { status: r.status, data, text };
  } catch (e) {
    return { status: 0, data: null, text: "", error: String((e && e.message) || e) };
  }
}

/** 读一条 SSE；stopAfter 命中事件类型后立刻断开（省掉后面的真模型生成） */
async function sse(p, body, token, ms, stopAfter) {
  const t0 = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => { try { ac.abort(new Error("probe timeout")); } catch {} }, ms || 300000);
  let res;
  try {
    res = await fetch(BASE + p, {
      method: "POST",
      headers: { "content-type": "application/json", "x-local-token": token || "" },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    return { status: 0, ct: "", events: [], text: "", error: String((e && e.message) || e), ms: Date.now() - t0 };
  }
  const ct = String(res.headers.get("content-type") || "");
  if (!/text\/event-stream/i.test(ct)) {
    const text = await res.text();
    clearTimeout(timer);
    let data = null;
    try { data = JSON.parse(text); } catch {}
    return { status: res.status, ct, events: [], text, data, ms: Date.now() - t0 };
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  const events = [];
  let buf = "", text = "", aborted = false;
  try {
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      const piece = dec.decode(r.value, { stream: true });
      text += piece;
      buf += piece;
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const line = block.split("\n").find((l) => l.startsWith("data:"));
        if (!line) continue;
        const raw = line.slice(5).trim();
        if (!raw || raw === "[DONE]") continue;
        let j = null;
        try { j = JSON.parse(raw); } catch {}
        if (j) {
          events.push(j);
          if (stopAfter && stopAfter.indexOf(String(j.type)) >= 0) aborted = true;
        }
      }
      if (aborted) {
        try { await reader.cancel(); } catch {}
        try { ac.abort(); } catch {}
        break;
      }
    }
  } catch (e) { /* 主动断开的 AbortError 不算失败 */ }
  clearTimeout(timer);
  return { status: res.status, ct, events, text, ms: Date.now() - t0, aborted };
}

const typesOf = (events) => (events || []).map((e) => String((e && e.type) || ""));
const idxOf = (events, t) => (events || []).findIndex((e) => e && e.type === t);
const deltaIdxs = (events) => (events || []).map((e, i) => (e && e.type === "delta" ? i : -1)).filter((i) => i >= 0);
const sumDelta = (events) => (events || []).filter((e) => e && e.type === "delta").map((e) => String(e.text || "")).join("");
const state = async () => (await jsonReq("/api/state")).data || {};
const norm = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
const SEVS = new Set(["error", "warn", "info"]);
const VERDICTS = new Set(["consistent", "differs", "contradicts"]);

// ---------- 本地 stub 云端服务（node:http，随机端口，绝不真出网） ----------
const STUB_TEXT = [
  "独立复核意见：",
  "- 第 6 行：循环条件 i <= items.length 越界，items[i] 可能是 undefined；应改为 i < items.length。",
  "- 第 3 行：源码里写死了联系人、内网地址与密钥，建议统一收进环境变量。",
  "- 第 5 行：total 未做空值保护，元素缺 price 会得到 NaN。",
  "综合判定：存在 2 处真实问题，先修循环边界，再补空值校验。",
  '{"summary":"发现 2 处问题：循环越界、缺少空值保护","issues":[{"line":6,"endLine":6,"severity":"error","title":"循环条件越界","detail":"i <= items.length 会访问 undefined","fix":"改成 i < items.length"},{"line":5,"endLine":5,"severity":"warn","title":"缺少空值保护","detail":"items 元素可能不含 price","fix":"读取前判空"}]}',
].join("\n");
const stub = { server: null, port: 0, base: "", host: "", hits: 0, bodies: [] };
function startStub() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", async () => {
        const body = Buffer.concat(chunks).toString("utf8");
        const u = new URL(req.url || "/", "http://127.0.0.1");
        const isChat = /chat\/completions$/.test(u.pathname);
        if (!isChat) {
          res.writeHead(404, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: { message: "stub: 只支持 /chat/completions" } }));
          return;
        }
        stub.hits += 1;
        stub.bodies.push(body);
        const fail = /(^|\/)fail(\/|$)/.test(u.pathname) || u.searchParams.get("fail") === "1";
        const slow = /(^|\/)slow(\/|$)/.test(u.pathname) || u.searchParams.get("slow") === "1";
        if (slow) await sleep(3000);
        if (fail) {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: { message: "stub 上游故意 500" } }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          id: "chatcmpl-probe-" + stub.hits,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: "probe-stub",
          choices: [{ index: 0, message: { role: "assistant", content: STUB_TEXT }, finish_reason: "stop" }],
          usage: { prompt_tokens: 10, completion_tokens: 100, total_tokens: 110 },
        }));
      });
    });
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      stub.server = srv;
      stub.port = srv.address().port;
      stub.base = "http://127.0.0.1:" + stub.port + "/v1";
      stub.host = "127.0.0.1:" + stub.port;
      console.log("  本地 stub 云端: " + stub.base + "（随机端口 " + stub.port + "，不出网）");
      resolve();
    });
  });
}

// ---------- 测试素材 ----------
const CODE = [
  "function calcTotal(items) {",
  "  let total = 0;",
  "  for (let i = 0; i <= items.length; i++) {",
  "    total += items[i].price;",
  "  }",
  "  return total;",
  "}",
  "",
  "console.log(calcTotal([{ price: 3 }, { price: 4 }]));",
].join("\n");
const QUESTION = "第 3 行用 i <= items.length 是不是会导致 items[i] 越界？如果会，最小验证步骤是什么？";
const INTENT = "找出这段代码里的 bug（重点看循环边界和空值），按行号指出问题。";
const PRIMARY_ISSUE = { line: 3, endLine: 3, severity: "error", title: "循环条件越界", detail: "i <= items.length 会多跑一轮，items[i] 是 undefined", fix: "改成 i < items.length" };
const PRIMARY = { summary: "循环边界越界，可能访问 undefined", issues: [PRIMARY_ISSUE] };
const SECRET_CODE = [
  "// 联系运维：user@example.com",
  "// 服务器地址 10.1.2.3，部署在 C:\\Users\\bob\\x.py",
  'const apiKey = "sk-ABCdef0123456789xyz";',
  "function calcTotal(items) {",
  "  let total = 0;",
  "  for (let i = 0; i <= items.length; i++) {",
  "    total += items[i].price;",
  "  }",
  "  return total;",
  "}",
].join("\n");
const CLOUD_KEY = "sk-probe-verify-1234";
let STUB_FAIL_BASE = "";
let STUB_SLOW_BASE = "";

let TOKEN = "";
let originalLoaded = "";
let originalContext = 0;
let initialCfg = {};
let uiFileCreated = false;
let ws = null;
let cdpSend = null;
let pageHomeUrl = "";

console.log("\n== 目标 " + BASE + (RUN_UI ? " · CDP " + CDP : " · 不跑 UI 段") + " ==");

try {
  // ---------- 0. 前置 ----------
  const boot = await jsonReq("/api/state");
  ok("GET /api/state -> 200", boot.status === 200, "HTTP " + boot.status + " " + errText(boot));
  TOKEN = String((boot.data && boot.data.localToken) || "");
  originalLoaded = String((boot.data && boot.data.loaded) || "");
  originalContext = Number((boot.data && boot.data.context) || 0) || 0;
  console.log("  开跑前模型状态: loaded=" + (originalLoaded || "（未加载）") + " context=" + (originalContext || 0) + "（收尾会原样恢复）");
  const models = Array.isArray(boot.data && boot.data.models) ? boot.data.models.map((m) => String(m.file || "")) : [];
  if (!originalLoaded) {
    // 开跑前没有模型：先装一个跑（contextSize 用默认 16K，和驱动预加载口径一致）；收尾用 /api/unload 还原成「未加载」
    console.log("  未加载模型，先加载 " + MODEL + "（contextSize=16384，和驱动预加载口径一致）");
    await jsonReq("/api/load", { file: MODEL, contextSize: 16384 }, "", 30000);
    for (let i = 0; i < 150; i++) { await sleep(1000); if (String((await state()).loaded || "")) break; }
  }
  const currentModel = String((await state()).loaded || "");
  ok("前置：模型已就绪（他人复审要用同一个模型做指定分支）", currentModel.length > 0, "loaded=" + currentModel);
  let initialCfgR = await jsonReq("/api/cloud/config");
  initialCfg = initialCfgR.data || {};

  // 干净基线：只发「必填可空」的字段（baseURL/model 各有校验，空串可能 400，不硬塞）；
  // 开跑前的原配置在 initialCfg 里，收尾按它恢复能恢复的字段（明文 key 看不到，只能清）。
  await jsonReq("/api/cloud/config", { enabled: false, apiKey: "" }, TOKEN, 15000);

  // ---------- A. 质询 ----------
  console.log("\n== A. 质询 API（POST /api/code/review/challenge） ==");
  const aNoTok = await sse("/api/code/review/challenge", { code: CODE, question: QUESTION }, "", 30000);
  ok("A. 无令牌 -> 403", aNoTok.status === 403, "HTTP " + aNoTok.status + " " + errText(aNoTok));
  const aMissCode = await sse("/api/code/review/challenge", { question: QUESTION }, TOKEN, 30000);
  ok("A. 缺 code -> 400", aMissCode.status === 400, "HTTP " + aMissCode.status + " " + errText(aMissCode));
  const aMissQ = await sse("/api/code/review/challenge", { code: CODE, question: "   " }, TOKEN, 30000);
  ok("A. question 为空 -> 400", aMissQ.status === 400, "HTTP " + aMissQ.status + " " + errText(aMissQ));
  const aBig = await sse("/api/code/review/challenge", { code: "x".repeat(20001), question: QUESTION }, TOKEN, 30000);
  ok("A. code 超 20000 字符 -> 413", aBig.status === 413, "HTTP " + aBig.status + " " + errText(aBig));

  const chal = await sse("/api/code/review/challenge", { code: CODE, lang: "javascript", file: "probe-challenge.js", intent: INTENT, primary: PRIMARY, question: QUESTION, max_tokens: 600 }, TOKEN, 300000);
  const chT = typesOf(chal.events);
  const chMeta = idxOf(chal.events, "meta");
  const chDone = idxOf(chal.events, "done");
  const chDeltas = deltaIdxs(chal.events);
  const chText = sumDelta(chal.events);
  const chMetaEv = chal.events[chMeta] || {};
  const chDoneEv = chal.events[chDone] || {};
  console.log("  质询事件序列: " + chT.join(" -> ").slice(0, 260));
  ok("A. 质询 -> 200 + text/event-stream", chal.status === 200 && /text\/event-stream/i.test(chal.ct), "HTTP " + chal.status + " ct=" + chal.ct + " " + (chal.ms / 1000).toFixed(1) + "s");
  ok("A. 顺序 meta 第一 -> delta* -> done（done 最后）", chMeta === 0 && chDeltas.length >= 1 && chDeltas.every((i) => i > chMeta && i < chDone) && chDone === chal.events.length - 1, JSON.stringify({ meta: chMeta, deltas: chDeltas.length, done: chDone, total: chal.events.length }));
  ok("A. delta 拼接非空", chText.trim().length > 0, "len=" + chText.trim().length);
  ok("A. delta 不含裸 JSON（无 issues 字段）", !/"issues"/.test(chText), chText.replace(/\s+/g, " ").slice(0, 100));
  ok("A. delta 不含代码围栏", !chText.includes(FENCE), chText.replace(/\s+/g, " ").slice(0, 100));
  ok("A. meta.modelFile 非空", typeof chMetaEv.modelFile === "string" && chMetaEv.modelFile.length > 0, "modelFile=" + chMetaEv.modelFile);
  ok("A. done.seconds 是正数", Number(chDoneEv.seconds) > 0, "seconds=" + chDoneEv.seconds);

  const cholHist = [
    { question: "第 3 行边界对吗？", answer: "i <= items.length 会多跑一轮，items[9] 是 undefined。" },
    { question: "那第 4 行会抛错吗？", answer: "会，undefined.price 抛 TypeError。" },
  ];
  const chal2 = await sse("/api/code/review/challenge", { code: CODE, lang: "javascript", file: "probe-challenge.js", primary: PRIMARY, question: QUESTION, history: cholHist, max_tokens: 500 }, TOKEN, 300000);
  ok("A. 带 2 轮 history 再问 -> 仍 200", chal2.status === 200, "HTTP " + chal2.status + " " + (chal2.ms / 1000).toFixed(1) + "s" + (chal2.status === 200 ? "" : " " + errText(chal2)));

  // ---------- B. 他人复审 ----------
  console.log("\n== B. 他人复审 API（POST /api/code/review/cross） ==");
  const bNoTok = await sse("/api/code/review/cross", { code: CODE }, "", 30000);
  ok("B. 无令牌 -> 403", bNoTok.status === 403, "HTTP " + bNoTok.status + " " + errText(bNoTok));
  const bMissCode = await sse("/api/code/review/cross", { lang: "javascript" }, TOKEN, 30000);
  ok("B. 缺 code -> 400", bMissCode.status === 400, "HTTP " + bMissCode.status + " " + errText(bMissCode));

  const cross = await sse("/api/code/review/cross", { code: CODE, lang: "javascript", file: "probe-cross.js", intent: "独立复查这段代码，按行号指出问题", primary: PRIMARY, model: currentModel }, TOKEN, 420000);
  const crT = typesOf(cross.events);
  const crMeta = idxOf(cross.events, "meta");
  const crFind = idxOf(cross.events, "findings");
  const crComp = idxOf(cross.events, "compare");
  const crDone = idxOf(cross.events, "done");
  const crDeltas = deltaIdxs(cross.events);
  const crPhaseIdxs = (cross.events || []).map((e, i) => (e && e.type === "phase" ? i : -1)).filter((i) => i >= 0);
  const crMetaEv = cross.events[crMeta] || {};
  const crFindEv = cross.events[crFind] || {};
  const crCompEv = cross.events[crComp] || {};
  const crStats = crCompEv.stats || {};
  console.log("  复审事件序列: " + crT.join(" -> ").slice(0, 320));
  ok("B. 指定模型复审 -> 200 + text/event-stream", cross.status === 200 && /text\/event-stream/i.test(cross.ct), "HTTP " + cross.status + " ct=" + cross.ct + " " + (cross.ms / 1000).toFixed(1) + "s");
  ok("B. delta >= 1 且都在 findings 之前", crDeltas.length >= 1 && crDeltas.every((i) => i > crMeta && i < crFind), JSON.stringify({ deltas: crDeltas.length, findings: crFind }));
  ok("B. 有 findings 和 compare 事件（compare 在 findings 之后）", crFind >= 0 && crComp > crFind, "findings=" + crFind + " compare=" + crComp);
  ok("B. 顺序：meta 第一、done 在 compare 之后且最后、全程无 error", crMeta === 0 && crDone > crComp && crDone === cross.events.length - 1 && idxOf(cross.events, "error") < 0, JSON.stringify({ meta: crMeta, compare: crComp, done: crDone, total: cross.events.length, phase: crPhaseIdxs.length }));
  const crIssues = Array.isArray(crFindEv.issues) ? crFindEv.issues : null;
  ok("B. findings.issues 是数组", Array.isArray(crIssues), "type=" + typeof crFindEv.issues + " n=" + (crIssues ? crIssues.length : "null"));
  const crLineCount = Number(crFindEv.lineCount);
  const badIssue = (crIssues || []).find((it) => !it || !Number.isFinite(Number(it.line)) || !Number.isFinite(Number(it.endLine)) || !SEVS.has(String(it.severity)) || typeof it.title !== "string" || !it.title.trim() || typeof it.detail !== "string" || typeof it.fix !== "string");
  ok("B. findings.issues 字段齐全（line/endLine/severity/title/detail/fix）", (crIssues || []).length === 0 || !badIssue, badIssue ? JSON.stringify(badIssue).slice(0, 150) : "n=" + (crIssues || []).length);
  const badLine = (crIssues || []).find((it) => {
    const ln = Number(it.line), en = Number(it.endLine);
    return !(ln >= 1 && ln <= crLineCount && en >= ln && en <= crLineCount);
  });
  ok("B. issue 行号在 1..lineCount 内（已吸到真代码行）", crLineCount > 0 && ((crIssues || []).length === 0 || !badLine), "lineCount=" + crFindEv.lineCount + (badLine ? " bad=" + JSON.stringify({ line: badLine.line, endLine: badLine.endLine }) : ""));
  ok("B. verdict 属于 consistent/differs/contradicts", VERDICTS.has(String(crCompEv.verdict)), "verdict=" + crCompEv.verdict);
  const crN = (k) => Number(crStats[k]);
  ok("B. stats 自洽：matched = agree + conflicts", crN("matched") === crN("agree") + crN("conflicts"), JSON.stringify(crStats));
  ok("B. stats 自洽：matched + onlySecond === second", crN("matched") + crN("onlySecond") === crN("second"), JSON.stringify(crStats));
  ok("B. stats 自洽：matched + onlyPrimary === primary", crN("matched") + crN("onlyPrimary") === crN("primary"), JSON.stringify(crStats));
  ok("B. meta.sameModel 是 boolean", typeof crMetaEv.sameModel === "boolean", "sameModel=" + crMetaEv.sameModel);
  const crArrays = ["agree", "onlyPrimary", "onlySecond", "conflicts"];
  ok("B. agree/onlyPrimary/onlySecond/conflicts 都是数组", crArrays.every((k) => Array.isArray(crCompEv[k])), JSON.stringify(crArrays.map((k) => k + ":" + (Array.isArray(crCompEv[k]) ? crCompEv[k].length : typeof crCompEv[k]))));
  const lineItem = (x) => x && Number.isFinite(Number(x.line));
  const arraysStructOk = (crCompEv.onlyPrimary || []).every(lineItem) && (crCompEv.onlySecond || []).every(lineItem) &&
    (crCompEv.conflicts || []).every((c) => c && lineItem(c.primary) && lineItem(c.second) && typeof c.reason === "string" && c.reason.length > 0);
  ok("B. 数组项结构：only* 带 line、conflicts 是 {primary,second,reason}", arraysStructOk, "onlyP=" + (crCompEv.onlyPrimary || []).length + " onlyS=" + (crCompEv.onlySecond || []).length + " conflicts=" + (crCompEv.conflicts || []).length);
  ok("B. 指定 model 时 modelFile 匹配且 sameModel=true", String(crMetaEv.modelFile || "") === currentModel && crMetaEv.sameModel === true, "modelFile=" + crMetaEv.modelFile + " want=" + currentModel);

  // 不指定模型：后端按 scanModels 顺序挑「第一个与当前不同」的模型 —— 拿到 meta 就断开，不白烧生成
  const autoCross = await sse("/api/code/review/cross", { code: CODE, lang: "javascript", file: "probe-cross-auto.js", intent: "独立复查这段代码", primary: PRIMARY }, TOKEN, 300000, ["meta"]);
  const autoMetaEv = (autoCross.events || [])[0] || {};
  ok("B. 不指定模型：200 SSE、meta 第一、不会挑 Phi-4-mini", autoCross.status === 200 && autoMetaEv.type === "meta" && !/^Phi-4-mini/i.test(String(autoMetaEv.modelFile || "")), "HTTP " + autoCross.status + " modelFile=" + autoMetaEv.modelFile + " (候选 " + models.filter((m) => !/^Phi-4-mini/i.test(m)).join(", ") + ") " + (autoCross.ms / 1000).toFixed(1) + "s" + (autoCross.status === 200 ? "" : " " + errText(autoCross)));

  // ---------- C. 云端配置 ----------
  console.log("\n== C. 云端配置（GET/POST /api/cloud/config） ==");
  // stub 先起：C 段要用它的 host/端口
  await startStub();
  STUB_FAIL_BASE = "http://127.0.0.1:" + stub.port + "/fail/v1";
  STUB_SLOW_BASE = "http://127.0.0.1:" + stub.port + "/slow/v1";

  const g0 = await jsonReq("/api/cloud/config");
  const c0 = g0.data || {};
  const CORE = ["enabled", "baseURL", "model", "hasKey", "keyMasked", "host", "ready"];
  const typeBad = CORE.filter((k) => {
    if (k === "enabled" || k === "hasKey" || k === "ready") return typeof c0[k] !== "boolean";
    return typeof c0[k] !== "string";
  });
  ok("C. GET 形状：200/ok:true + 8 核心字段 + file，类型正确", g0.status === 200 && c0.ok === true && CORE.every((k) => k in c0) && typeBad.length === 0 && typeof c0.file === "string" && c0.file.length > 0, "HTTP " + g0.status + " missing=" + CORE.filter((k) => !(k in c0)).join(",") + " badType=" + typeBad.join(",") + " file=" + c0.file);

  const cNoTok = await jsonReq("/api/cloud/config", { enabled: true }, "", 15000);
  ok("C. POST 无令牌 -> 403", cNoTok.status === 403, "HTTP " + cNoTok.status + " " + errText(cNoTok));
  const cBadUrl = await jsonReq("/api/cloud/config", { baseURL: "不是网址" }, TOKEN, 15000);
  ok("C. 非法 URL -> 400", cBadUrl.status === 400, "HTTP " + cBadUrl.status + " " + errText(cBadUrl));
  const cHttp = await jsonReq("/api/cloud/config", { baseURL: "http://example.com/v1" }, TOKEN, 15000);
  ok("C. http 非回环 -> 400 INSECURE_URL", cHttp.status === 400 && respCode(cHttp) === "INSECURE_URL", "HTTP " + cHttp.status + " code=" + respCode(cHttp) + " " + errText(cHttp));

  const gBeforeDry = await jsonReq("/api/cloud/config");
  const cBeforeDry = gBeforeDry.data || {};
  const snapCfg = (c) => JSON.stringify([c.enabled, c.baseURL, c.model, c.hasKey, c.ready]);
  const dry = await jsonReq("/api/cloud/config", { enabled: true, baseURL: stub.base, model: "probe-stub", apiKey: CLOUD_KEY, dryRun: true }, TOKEN, 15000);
  ok("C. dryRun -> 200 且 dryRun:true", dry.status === 200 && dry.data && dry.data.dryRun === true, "HTTP " + dry.status + " dryRun=" + (dry.data && dry.data.dryRun));
  const gDry = await jsonReq("/api/cloud/config");
  const cDry = gDry.data || {};
  ok("C. dryRun 不落盘（GET 完全不变）", typeof cBeforeDry.enabled === "boolean" && snapCfg(cDry) === snapCfg(cBeforeDry), "before=" + snapCfg(cBeforeDry) + " after=" + snapCfg(cDry));

  const save = await jsonReq("/api/cloud/config", { enabled: true, baseURL: stub.base, model: "probe-stub", apiKey: CLOUD_KEY }, TOKEN, 15000);
  const cs = save.data || {};
  ok("C. 保存 -> 200 且 hasKey:true", save.status === 200 && cs.ok === true && cs.hasKey === true && cs.enabled === true, "HTTP " + save.status + " hasKey=" + cs.hasKey + " enabled=" + cs.enabled);
  const masked = String(cs.keyMasked || "");
  ok("C. keyMasked 是 3+***+4 形状且不带明文", /^\S{3}\*\*\*\S{4}$/.test(masked) && masked.endsWith(CLOUD_KEY.slice(-4)) && !masked.includes(CLOUD_KEY), "keyMasked=" + masked);
  ok("C. host = new URL(baseURL).host", String(cs.host || "") === stub.host, "host=" + cs.host + " want=" + stub.host);
  ok("C. ready = enabled && baseURL && model && apiKey", cs.ready === true, "ready=" + cs.ready);
  const gSave = await jsonReq("/api/cloud/config");
  const leakText = [g0.text, dry.text, save.text, gSave.text].join("\n");
  ok("C. 响应全文不含明文 key", !leakText.includes(CLOUD_KEY), "len=" + leakText.length);
  const clr = await jsonReq("/api/cloud/config", { apiKey: "" }, TOKEN, 15000);
  const gClr = await jsonReq("/api/cloud/config");
  const cClr = gClr.data || {};
  ok("C. apiKey:\"\" 清除 -> hasKey:false", clr.status === 200 && cClr.hasKey === false && String(cClr.keyMasked || "") === "", JSON.stringify({ hasKey: cClr.hasKey, keyMasked: cClr.keyMasked }));

  // ---------- D. 云端复审 ----------
  console.log("\n== D. 云端复审（POST /api/code/review/cloud，本地 stub） ==");
  const dNotReady = await sse("/api/code/review/cloud", { code: CODE, confirm: stub.host }, TOKEN, 30000);
  ok("D. 未配置 -> 400 CLOUD_NOT_READY", dNotReady.status === 400 && respCode(dNotReady) === "CLOUD_NOT_READY", "HTTP " + dNotReady.status + " code=" + respCode(dNotReady) + " " + errText(dNotReady));

  await jsonReq("/api/cloud/config", { enabled: true, baseURL: stub.base, model: "probe-stub", apiKey: CLOUD_KEY }, TOKEN, 15000);
  const dWrongConfirm = await sse("/api/code/review/cloud", { code: CODE, confirm: "evil.example.com" }, TOKEN, 30000);
  ok("D. confirm 不匹配 -> 409 CONFIRM_REQUIRED", dWrongConfirm.status === 409 && respCode(dWrongConfirm) === "CONFIRM_REQUIRED", "HTTP " + dWrongConfirm.status + " code=" + respCode(dWrongConfirm) + " " + errText(dWrongConfirm));
  const dNoConfirm = await sse("/api/code/review/cloud", { code: CODE }, TOKEN, 30000);
  ok("D. confirm 缺失 -> 409 CONFIRM_REQUIRED", dNoConfirm.status === 409 && respCode(dNoConfirm) === "CONFIRM_REQUIRED", "HTTP " + dNoConfirm.status + " code=" + respCode(dNoConfirm));

  const bodyIdx = stub.bodies.length;
  const cloud = await sse("/api/code/review/cloud", { code: SECRET_CODE, lang: "javascript", file: "probe-cloud.js", intent: "独立复核这段代码", confirm: stub.host, max_tokens: 800 }, TOKEN, 120000);
  const clT = typesOf(cloud.events);
  const clMeta = idxOf(cloud.events, "meta");
  const clFind = idxOf(cloud.events, "findings");
  const clDone = idxOf(cloud.events, "done");
  const clDeltas = deltaIdxs(cloud.events);
  const clDeltaText = sumDelta(cloud.events);
  const clMetaEv = cloud.events[clMeta] || {};
  const clFindEv = cloud.events[clFind] || {};
  const clDoneEv = cloud.events[clDone] || {};
  const stubBody = String(stub.bodies[bodyIdx] || "");
  console.log("  云端事件序列: " + clT.join(" -> ").slice(0, 280));
  ok("D. 云端复审 -> 200 + text/event-stream", cloud.status === 200 && /text\/event-stream/i.test(cloud.ct), "HTTP " + cloud.status + " ct=" + cloud.ct + " " + (cloud.ms / 1000).toFixed(1) + "s");
  ok("D. meta 第一且 provider=cloud、host 正确", clMeta === 0 && clMetaEv.provider === "cloud" && String(clMetaEv.host || "") === stub.host, "provider=" + clMetaEv.provider + " host=" + clMetaEv.host + " want=" + stub.host);
  ok("D. meta.sentChars>0 且 redactions>0（塞了 key/邮箱/路径/IP）", Number(clMetaEv.sentChars) > 0 && Number(clMetaEv.redactions) > 0, "sentChars=" + clMetaEv.sentChars + " redactions=" + clMetaEv.redactions);
  ok("D. delta 分 >=3 段推（~80 字一段）", clDeltas.length >= 3, "deltas=" + clDeltas.length);
  ok("D. delta 拼接 = stub 返回的文本", norm(clDeltaText) === norm(STUB_TEXT), "deltaLen=" + clDeltaText.length + " stubLen=" + STUB_TEXT.length);
  ok("D. findings 解析：parsed=true 且 issues>=1（stub 文本里的 JSON 能解析）", clFind >= 0 && clFindEv.parsed === true && Array.isArray(clFindEv.issues) && clFindEv.issues.length >= 1, "parsed=" + clFindEv.parsed + " n=" + (Array.isArray(clFindEv.issues) ? clFindEv.issues.length : "null"));
  ok("D. done 有 seconds", clDone >= 0 && Number.isFinite(Number(clDoneEv.seconds)), "seconds=" + clDoneEv.seconds);
  ok("D. stub 收到的 body 不含原 apiKey/邮箱/Windows 路径/内网 IP 明文", stubBody.length > 0 && !stubBody.includes(CLOUD_KEY) && !stubBody.includes("sk-ABCdef0123456789xyz") && !stubBody.includes("user@example.com") && !stubBody.includes("C:\\Users\\bob") && !stubBody.includes("10.1.2.3"), "bodyLen=" + stubBody.length);
  ok("D. stub 收到的 body 里出现 4 个脱敏标记", ["<API_KEY>", "<EMAIL>", "<PATH>", "<IP>"].every((m) => stubBody.includes(m)), JSON.stringify(["<API_KEY>", "<EMAIL>", "<PATH>", "<IP>"].filter((m) => !stubBody.includes(m))));

  await jsonReq("/api/cloud/config", { baseURL: STUB_FAIL_BASE }, TOKEN, 15000);
  const dUpstream = await sse("/api/code/review/cloud", { code: CODE, file: "probe-cloud.js", confirm: stub.host }, TOKEN, 60000);
  ok("D. 上游 500 -> 502 CLOUD_UPSTREAM", dUpstream.status === 502 && respCode(dUpstream) === "CLOUD_UPSTREAM", "HTTP " + dUpstream.status + " code=" + respCode(dUpstream) + " " + errText(dUpstream));

  await jsonReq("/api/cloud/config", { baseURL: STUB_SLOW_BASE }, TOKEN, 15000);
  const dSlow = await sse("/api/code/review/cloud", { code: CODE, file: "probe-cloud.js", confirm: stub.host }, TOKEN, 90000);
  const dSlowDone = idxOf(dSlow.events, "done");
  const dSlowErr = (dSlow.events || []).filter((e) => e && e.type === "error").map((e) => String(e.message || "")).join(";");
  const slowOk = dSlow.status === 200 && dSlowDone >= 0;
  ok("D. 上游慢（3s）不崩：200 收尾或 error 带 message", dSlow.status !== 0 && (slowOk || Boolean(dSlowErr) || Boolean(errText(dSlow))), "HTTP " + dSlow.status + " events=" + typesOf(dSlow.events).join(",") + " err=" + (dSlowErr || errText(dSlow)).slice(0, 100));
  ok("D. 慢上游确实等到 stub 延时（>=2s）", dSlow.status !== 0 && (dSlow.status !== 200 || dSlow.ms >= 2000), "ms=" + dSlow.ms + " HTTP " + dSlow.status);

  // 恢复成正常 stub，留给 E 段 UI
  await jsonReq("/api/cloud/config", { baseURL: stub.base }, TOKEN, 15000);

  // ---------- E. UI ----------
  console.log("\n== E. UI（CDP，Edge 9333） ==");
  if (!RUN_UI) {
    skip += 12;
    console.log("  skip: 没传 cdp 参数，跳过 UI 段（后端 API 段已覆盖）");
  } else {
    // 造一个临时工作区文件给代码面板打开（收尾删掉）
    const mk = await jsonReq("/api/workspace/save", { path: WS_PATH, content: SECRET_CODE }, TOKEN, 15000);
    uiFileCreated = mk.status === 200;

    const list = await (await fetch(CDP + "/json/list")).json();
    const page = list.find((t) => t.type === "page");
    if (!page) throw new Error("CDP 没有可用页面（Edge 是否 --headless=new --no-sandbox 起在 " + CDP + "？）");
    pageHomeUrl = /^http:\/\/127\.0\.0\.1:\d+\//.test(String(page.url || "")) ? String(page.url) : BASE + "/";
    ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
    await new Promise((r, j) => { ws.once("open", r); ws.once("error", j); });
    let id = 0;
    const pend = new Map();
    ws.on("message", (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    });
    const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
    cdpSend = send;
    const ev = async (e) => {
      const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true });
      if (r.result && r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.text + " " + ((r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description) || ""));
      return r.result && r.result.result ? r.result.result.value : undefined;
    };
    const waitFor = async (expr, ms, step) => {
      const t0 = Date.now();
      let last;
      while (Date.now() - t0 < (ms || 8000)) {
        try { last = await ev(expr); if (last) return last; } catch {}
        await sleep(step || 250);
      }
      try { last = await ev(expr); } catch {}
      return last;
    };
    const clickId = (elId) => ev("(() => { const el = document.getElementById(" + JSON.stringify(elId) + "); if (!el) return 'no'; el.click(); return 'ok'; })()");
    const shot = async (name) => {
      try {
        fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
        const r = await send("Page.captureScreenshot", { format: "png" });
        fs.writeFileSync(path.join(EVIDENCE_DIR, name), Buffer.from(r.result.data, "base64"));
        console.log("    截图: " + path.join(EVIDENCE_DIR, name));
      } catch (e) { console.log("    截图失败: " + String((e && e.message) || e)); }
    };

    await send("Page.enable");
    await send("Runtime.enable");
    await send("Page.navigate", { url: BASE + "/" });
    await sleep(3200);
    await ev("(() => { ['firstModal','readmeModal'].forEach((x) => { const el = document.getElementById(x); if (el) el.hidden = true; }); return 1; })()");
    const innerW = Number(await ev("innerWidth"));
    console.log("  Edge 视口 innerWidth=" + innerW + "（应约 1408；被缩成 500 就是窗口被缩了，重启 Edge）");
    await clickId("codeBtn");
    const modalOpen = await waitFor("(() => { const m = document.getElementById('codeModal'); return !!m && !m.hidden; })()", 8000);
    // 打开探针临时文件（没有就保持编辑器，直接 setValue）
    const itemSel = "#cwList .cwItem[data-path=" + JSON.stringify(WS_PATH) + "]";
    const itemReady = await waitFor("!!document.querySelector(" + JSON.stringify(itemSel) + ")", 12000);
    if (itemReady) {
      await ev("(() => { const el = document.querySelector(" + JSON.stringify(itemSel) + "); if (el) el.click(); return 1; })()");
      await sleep(700);
    }
    await ev("(() => { const w = document.querySelector('#codeModal .CodeMirror'); if (w && w.CodeMirror) { w.CodeMirror.setValue(" + JSON.stringify(SECRET_CODE) + "); return 1; } const t = document.getElementById('cwEditor'); if (t) { t.value = " + JSON.stringify(SECRET_CODE) + "; t.dispatchEvent(new Event('input', { bubbles: true })); } return 1; })()");
    await sleep(300);

    ok("E. 代码面板有 #cwChallenge/#cwCross/#cwCloud", Boolean(modalOpen) && (await ev("!!document.getElementById('cwChallenge')")) === true && (await ev("!!document.getElementById('cwCross')")) === true && (await ev("!!document.getElementById('cwCloud')")) === true, "modal=" + modalOpen);
    ok("E. 有 #cwCrossModel 下拉", (await ev("!!document.getElementById('cwCrossModel')")) === true);
    const phiOpts = await ev("(() => { const s = document.getElementById('cwCrossModel'); if (!s) return ['no-select']; return [...s.options].filter((o) => /^Phi-4-mini/i.test(String(o.value || '') + ' ' + String(o.textContent || ''))).map((o) => o.value); })()");
    ok("E. #cwCrossModel 里没有 Phi-4-mini 选项", Array.isArray(phiOpts) && phiOpts.length === 0, JSON.stringify(phiOpts));
    await clickId("cwChallenge");
    ok("E. 点 #cwChallenge 展开 #cwChallengeBox", (await waitFor("(() => { const b = document.getElementById('cwChallengeBox'); if (!b) return false; return !b.hidden && getComputedStyle(b).display !== 'none'; })()", 6000)) === true);
    const chalIds = ["cwChallengeText", "cwChallengeSend", "cwChallengeLog"];
    ok("E. 质询区有输入框/发送键/记录区", (await ev("(() => { return " + JSON.stringify(chalIds) + ".every((x) => !!document.getElementById(x)); })()")) === true, "ids=" + chalIds.join(","));

    // 设置 -> 代码
    await clickId("settingsBtn");
    await sleep(700);
    const codeTab = await ev("(() => { const b = [...document.querySelectorAll('.settingsTabs .stab')].find((x) => (x.dataset.tab || '') === 'code' || /代码/.test(x.textContent || '')); if (!b) return 'no'; b.click(); return 'ok'; })()");
    await waitFor("(() => { const p = document.getElementById('paneCode'); return !!p && !p.hidden; })()", 6000);
    const cloudIds = ["cloudBase", "cloudModel", "cloudKey", "cloudSave"];
    ok("E. 设置→代码 有 #cloudBase/#cloudModel/#cloudKey/#cloudSave", (await ev("(() => { return " + JSON.stringify(cloudIds) + ".every((x) => !!document.getElementById(x)); })()")) === true, "tab=" + codeTab + " ids=" + cloudIds.join(","));
    ok("E. #cloudKey 是 password 输入框", (await ev("(() => { const el = document.getElementById('cloudKey'); return !!el && el.type === 'password'; })()")) === true);
    await clickId("settingsClose");
    await sleep(500);
    const modalAgain = await waitFor("(() => { const m = document.getElementById('codeModal'); return !!m && !m.hidden; })()", 6000);
    if (!modalAgain) { await clickId("codeBtn"); await sleep(800); }

    // 云端确认弹窗：ready 后点 #cwCloud
    const hitsBefore = stub.hits;
    await clickId("cwCloud");
    const confirmShown = await waitFor("(() => { const m = document.getElementById('cloudConfirmModal'); if (!m) return false; return !m.hidden && getComputedStyle(m).display !== 'none'; })()", 8000);
    const hostText = String(await ev("String((document.getElementById('cloudConfirmHost') || {}).textContent || '')"));
    ok("E. 云端 ready 时点 #cwCloud 弹 #cloudConfirmModal", confirmShown === true, "hits=" + stub.hits);
    ok("E. #cloudConfirmHost 里含目标 host（" + stub.host + "）", hostText.includes(stub.host), hostText.slice(0, 160));
    await shot("probe-verify-ui-confirm.png");
    const cancelBtn = await clickId("cloudConfirmCancel");
    await sleep(1200);
    const cancelHidden = await ev("(() => { const m = document.getElementById('cloudConfirmModal'); return !!m && m.hidden; })()");
    ok("E. 点取消不发请求（stub 计数不变 + 弹窗关闭）", cancelBtn === "ok" && stub.hits === hitsBefore && cancelHidden === true, "hits " + hitsBefore + " -> " + stub.hits + " hidden=" + cancelHidden);

    // 再点一次 -> 确认发送（stub 返回固定文本 + 2 条 issue）
    await clickId("cwCloud");
    await waitFor("(() => { const m = document.getElementById('cloudConfirmModal'); return !!m && !m.hidden; })()", 8000);
    await clickId("cloudConfirmOk");
    const cloudUiText = await waitFor("(() => { const m = document.getElementById('cwReviewMeta'); const s = document.getElementById('cwReviewState'); const t = String((m && m.textContent) || '') + ' ' + String((s && s.textContent) || ''); return /云端/.test(t) ? t : false; })()", 30000);
    ok("E. 点确认后 meta/状态行出现「云端」", Boolean(cloudUiText), String(cloudUiText || "").replace(/\s+/g, " ").slice(0, 160));
    const uiIssues = Number(await waitFor("(() => { const n = document.querySelectorAll('#cwIssues .cwIssue').length; return n > 0 ? n : 0; })()", 12000));
    ok("E. #cwIssues 渲染出云端结论卡片（>=1 张）", uiIssues >= 1, "n=" + uiIssues + " hits=" + stub.hits);
    await shot("probe-verify-ui-cloud.png");
  }
} catch (e) {
  fail += 1;
  failedNames.push("探针异常中断");
  console.log("  FAIL 探针异常中断: " + String((e && e.stack) || (e && e.message) || e));
} finally {
  console.log("\n== Z. 收尾 ==");
  // 1) 云端配置：停用 + 清 key；开跑前的 baseURL/model 还原（明文 key 看不到，只能清）
  try {
    const restore = { enabled: false, apiKey: "" };
    if (String(initialCfg.baseURL || "").trim()) restore.baseURL = String(initialCfg.baseURL);
    if (String(initialCfg.model || "").trim()) restore.model = String(initialCfg.model);
    await jsonReq("/api/cloud/config", restore, TOKEN, 15000);
    // 开跑前 baseURL/model 是空的：尽力清掉（后端若不允许空串会 400，忽略即可，反正 enabled=false + hasKey=false）
    if (!String(initialCfg.baseURL || "").trim()) await jsonReq("/api/cloud/config", { enabled: false, baseURL: "", model: "" }, TOKEN, 15000);
    const gz = await jsonReq("/api/cloud/config");
    const cz = gz.data || {};
    ok("Z. 收尾：云端配置已停用 + Key 已清", cz.enabled === false && cz.hasKey === false, JSON.stringify({ enabled: cz.enabled, hasKey: cz.hasKey, baseURL: cz.baseURL }));
    if (initialCfg.hasKey === true) console.log("  注意：开跑前已有 apiKey（明文不可见），收尾只能清除，需用户重新填写。");
  } catch (e) {
    fail += 1;
    failedNames.push("收尾云端配置恢复异常");
    console.log("  FAIL 收尾云端配置恢复异常: " + String((e && e.message) || e));
  }
  // 2) 关 stub
  try {
    if (stub.server) await new Promise((r) => stub.server.close(() => r()));
    console.log("  stub 已关闭（共收到 " + stub.hits + " 次 /chat/completions 请求）");
  } catch {}
  // 3) UI 导航回 base + 关 CDP
  try {
    if (ws && cdpSend) {
      await cdpSend("Page.navigate", { url: pageHomeUrl || BASE + "/" });
      await sleep(900);
      ws.close();
      console.log("  UI 已导航回 " + (pageHomeUrl || BASE + "/"));
    }
  } catch {}
  // 4) 删探针临时工作区文件
  try {
    if (uiFileCreated) {
      const del = await jsonReq("/api/workspace/delete", { path: WS_PATH }, TOKEN, 15000);
      console.log("  临时文件删除: " + WS_PATH + " HTTP " + del.status);
    }
  } catch {}
  // 5) 恢复开跑前的模型状态（他人复审自动换过模型）：loaded + context 都原样还原，
  //    绝不硬写 contextSize=8192——全量里 probe-ctx-panel 按「默认 16K」断言，探针收尾把窗口改成 8K 会让它假红（2026-11-15 全量实测）。
  try {
    const cur = String((await state()).loaded || "");
    if (!originalLoaded) {
      // 开跑前未加载：加载过就卸载回去，别给后面的探针留一个模型
      if (cur) {
        const ur = await jsonReq("/api/unload", {}, "", 60000);
        for (let i = 0; i < 60; i++) { await sleep(500); if (!String((await state()).loaded || "")) break; }
        const nowLoaded = String((await state()).loaded || "");
        ok("Z. 收尾：开跑前未加载 -> 已卸载还原", ur.status === 200 && nowLoaded === "", "unloadHTTP=" + ur.status + " loaded=" + nowLoaded);
      } else {
        console.log("  开跑前未加载、现在也未加载，无需卸载");
      }
    } else if (cur !== originalLoaded) {
      const ctxSize = originalContext > 0 ? originalContext : 16384;
      console.log("  模型切回 " + originalLoaded + "（contextSize=" + ctxSize + "，与开跑时一致）…");
      let lr = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        lr = await jsonReq("/api/load", { file: originalLoaded, contextSize: ctxSize }, "", 60000);
        if (lr.status === 200) break;
        console.log("  切回第 " + attempt + " 次 -> HTTP " + lr.status + "（" + errText(lr).slice(0, 70) + "），3s 后重试…");
        await sleep(3000);
      }
      for (let i = 0; i < 120; i++) { await sleep(1000); if (String((await state()).loaded || "") === originalLoaded) break; }
      const stBack = await state();
      const back = String(stBack.loaded || "");
      const backCtx = Number(stBack.context) || 0;
      ok("Z. 收尾：模型与上下文已原样恢复（" + originalLoaded + " / " + ctxSize + "）", back === originalLoaded && backCtx === ctxSize, "loaded=" + back + " context=" + backCtx + "（开跑时 " + originalContext + "）loadHTTP=" + (lr && lr.status));
    } else {
      console.log("  模型没换过，不需要切回（loaded=" + (cur || "空") + " context=" + (Number((await state()).context) || 0) + "）");
    }
  } catch (e) {
    fail += 1;
    failedNames.push("收尾恢复模型状态异常");
    console.log("  FAIL 收尾恢复模型状态异常: " + String((e && e.message) || e));
  }
}

if (failedNames.length) console.log("\n失败断言:\n" + failedNames.map((n) => " - " + n).join("\n"));
console.log("\n== 结果: " + pass + "/" + (pass + fail) + " 通过" + (skip ? "（跳过 " + skip + " 项）" : "") + " ==\n");
process.exit(fail ? 1 : 0);

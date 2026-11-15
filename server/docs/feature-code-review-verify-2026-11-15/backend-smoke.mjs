/**
 * 后端自测（v1.8.0 二次验证三件套）—— 临时脚本，不是正式探针
 *
 *   node backend-smoke.mjs [base] [model]
 *
 * 覆盖 CONTRACT.md §1：
 *  A 质询：403 / 400（缺 code、question 空）/ 413 / 404 / 真跑一轮（meta -> delta* -> done）
 *  B 他人复审：403 / 400 / 413 / 404 / 真跑一轮（**同模型 sameModel=true 分支**）+ compare 自洽
 *  C 云端配置：GET 形状 / POST 403 / http 非回环 400 INSECURE_URL / 非法 URL 400 / dryRun 不落盘 /
 *              保存（masked key、host、ready）/ 响应不含明文 key / apiKey:"" 清除
 *  D 云端复审：未配置 400 / confirm 不匹配 409 / stub 200 SSE（meta.provider=cloud、delta 拼回原文、
 *              findings、done）/ stub 收到的 body 已脱敏 / 上游 500 -> 502 CLOUD_UPSTREAM
 *  E 日志红线：dev 日志里不出现明文 apiKey、不出现代码正文标记
 *
 * 云端段自带 node:http 本地 stub（随机端口），**不出网**。收尾会停用云端 + 清空 key + 关 stub。
 */
import http from "node:http";
import { readFileSync } from "node:fs";

const BASE = process.argv[2] || "http://127.0.0.1:8299";
const MODEL = process.argv[3] || "qwen3-5-4B-Q4_K_M.gguf";
const LOG_FILE = process.env.SMOKE_LOG || "D:\\LocalModels\\logs\\dev-8299.out.log";
const OUT_FILE = process.env.SMOKE_OUT || "D:\\LocalModels\\server\\docs\\feature-code-review-verify-2026-11-15\\backend-smoke.txt";
const FENCE = String.fromCharCode(96, 96, 96);
const BS = String.fromCharCode(92);

const lines = [];
const key = {};
let pass = 0;
let fail = 0;
const t0All = Date.now();
function out(s) { lines.push(s); console.log(s); }
function ok(name, cond, extra) {
  if (cond) { pass += 1; out("  ok   " + name + (extra ? "  [" + extra + "]" : "")); }
  else { fail += 1; out("  FAIL " + name + "  " + (extra || "")); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errText = (r) => String((r && r.data && r.data.error && r.data.error.message) || (r && r.data && r.data.message) || r.text || r.error || "").slice(0, 160);

async function jsonReq(path, body, token, ms) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers["x-local-token"] = token;
  const o = { method: body !== undefined ? "POST" : "GET", headers, signal: AbortSignal.timeout(ms || 30000) };
  if (body !== undefined) o.body = JSON.stringify(body);
  try {
    const r = await fetch(BASE + path, o);
    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch {}
    return { status: r.status, data, text };
  } catch (e) {
    return { status: 0, data: null, text: "", error: String((e && e.message) || e) };
  }
}

/** 读一条 SSE：返回 {status, ct, events, text, data, ms}；非流式响应按 JSON 带回 */
async function sse(path, body, token, ms) {
  const t = Date.now();
  let res;
  try {
    res = await fetch(BASE + path, {
      method: "POST",
      headers: { "content-type": "application/json", "x-local-token": token || "" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(ms || 300000),
    });
  } catch (e) {
    return { status: 0, ct: "", events: [], text: "", error: String((e && e.message) || e), ms: Date.now() - t };
  }
  const ct = String(res.headers.get("content-type") || "");
  if (!/text\/event-stream/i.test(ct)) {
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch {}
    return { status: res.status, ct, events: [], text, data, ms: Date.now() - t };
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let text = "";
  const events = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const piece = dec.decode(value, { stream: true });
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
      if (j) events.push(j);
    }
  }
  return { status: res.status, ct, events, text, ms: Date.now() - t };
}
const types = (events) => (events || []).map((e) => String((e && e.type) || ""));
const evs = (events, t) => (events || []).filter((e) => e && e.type === t);
const sumText = (events) => evs(events, "delta").map((e) => String(e.text || "")).join("");
const state = async () => ((await jsonReq("/api/state")).data || {});

async function loadModel(file, ms) {
  const r = await jsonReq("/api/load", { file, contextSize: 8192 });
  if (r.status !== 200) return { ok: false, r };
  const t = Date.now();
  while (Date.now() - t < (ms || 180000)) {
    const s = await state();
    if (String(s.loaded || "") === file) return { ok: true };
    await sleep(800);
  }
  return { ok: false, r };
}

// 有 bug 的 JS：off-by-one（<= 越界）+ 没判空；里面塞一个独特标记用于「日志不许出现代码正文」的红线检查
const CODE_MARK = "backendSmokeSecretFn";
const BUGGY = [
  "function " + CODE_MARK + "(items) {",
  "  let total = 0;",
  "  for (let i = 0; i <= items.length; i++) {",
  "    total += items[i].price;",
  "  }",
  "  return total;",
  "}",
  "",
  "console.log(" + CODE_MARK + "([{ price: 3 }, { price: 4 }]));",
].join("\n");
const INTENT = "找出这段代码里的 bug（重点看循环边界和空值），按行号指出问题。";
// 云端：代码里塞密钥 / 邮箱 / Windows 路径 / IP / 长 hex，用于脱敏断言
const CLOUD_KEY_IN_CODE = "sk-BACKENDSMOKE1234567890abcd";
const CLOUD_EMAIL = "user@example.com";
const CLOUD_PATH = "C:" + BS + "Users" + BS + "bob" + BS + "x.py";
const CLOUD_IP = "10.1.2.3";
const CLOUD_HEX = "0123456789abcdef0123456789abcdef";
const CLOUD_CODE = [
  "API_KEY = " + JSON.stringify(CLOUD_KEY_IN_CODE),
  "MAIL = " + JSON.stringify(CLOUD_EMAIL),
  "HOME = " + JSON.stringify(CLOUD_PATH),
  "HOST = " + JSON.stringify(CLOUD_IP),
  "HASH = " + JSON.stringify(CLOUD_HEX),
  "",
  "def calc(items):",
  "    total = 0",
  "    for i in range(len(items) + 1):",
  "        total += items[i]",
  "    return total",
].join("\n");
// stub 返回的「云端审查文本 + json 围栏块」（能被 parseFindingsFromText 解析）
const STUB_TEXT = [
  "审查思路：",
  "- 第 9 行：range(len(items)+1) 越界，最后会 IndexError。",
  "- 第 10 行：没有判空 items。",
  "",
  FENCE + "json",
  JSON.stringify({
    summary: "1 处越界 + 1 处未判空",
    issues: [
      { line: 9, endLine: 9, severity: "error", title: "循环越界", detail: "range(len+1) 会多访问一个下标", fix: "改成 range(len(items))" },
      { line: 10, endLine: 10, severity: "warn", title: "未判空", detail: "items 可能为空", fix: "先判 if not items: return 0" },
    ],
  }),
  FENCE,
].join("\n");
const CLOUD_STUB_KEY = "sk-BACKENDSMOKE-CONFIG-KEY-9876543210";

// ---------- 云端 stub（node:http，随机端口，不出网） ----------
const stub = { server: null, port: 0, last: null, hits: 0 };
function startStub() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => { raw += c; });
      req.on("end", () => {
        stub.hits += 1;
        stub.last = { url: req.url, headers: req.headers, body: raw };
        if (String(req.url).includes("fail")) {
          res.writeHead(500, { "content-type": "text/plain" });
          res.end("stub upstream boom");
          return;
        }
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: STUB_TEXT } }] }));
      });
    });
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      stub.server = srv;
      stub.port = srv.address().port;
      resolve();
    });
  });
}
const stopStub = () => new Promise((r) => { try { stub.server.close(() => r()); } catch { r(); } });

out("== v1.8.0 后端自测 · 目标 " + BASE + " · 模型 " + MODEL + " ==");
out("");

let TOKEN = "";
let originalLoaded = "";
try {
  // ---------- 0. 前置 ----------
  out("-- 0. 前置（服务 / 令牌 / 模型） --");
  const boot = await jsonReq("/api/state");
  ok("GET /api/state -> 200", boot.status === 200, "HTTP " + boot.status + " " + errText(boot));
  const st0 = boot.data || {};
  TOKEN = String(st0.localToken || "");
  ok("拿到本机令牌", TOKEN.length > 0, "len=" + TOKEN.length);
  ok("版本已是 1.8.0", String(st0.version) === "1.8.0", "version=" + st0.version);
  originalLoaded = String(st0.loaded || "");
  if (originalLoaded !== MODEL) {
    out("  .. 预加载 " + MODEL);
    const l = await loadModel(MODEL);
    ok("预加载模型 " + MODEL, l.ok, l.ok ? "" : "HTTP " + (l.r && l.r.status));
  } else {
    ok("模型已加载 " + MODEL, true);
  }

  // ---------- A. 质询 ----------
  out("");
  out("-- A. POST /api/code/review/challenge（质询） --");
  const aNoTok = await jsonReq("/api/code/review/challenge", { code: BUGGY, question: "第 3 行真的越界吗？" });
  ok("无令牌 -> 403", aNoTok.status === 403, "HTTP " + aNoTok.status);
  const aNoCode = await jsonReq("/api/code/review/challenge", { question: "为什么？" }, TOKEN);
  ok("缺 code -> 400", aNoCode.status === 400, "HTTP " + aNoCode.status);
  const aNoQ = await jsonReq("/api/code/review/challenge", { code: BUGGY, question: "   " }, TOKEN);
  ok("question 空白 -> 400", aNoQ.status === 400, "HTTP " + aNoQ.status);
  const aLong = await jsonReq("/api/code/review/challenge", { code: "x".repeat(20001), question: "?" }, TOKEN);
  ok("code 超 20000 -> 413", aLong.status === 413, "HTTP " + aLong.status);
  const aBadModel = await jsonReq("/api/code/review/challenge", { code: BUGGY, question: "?", model: "no-such-model.gguf" }, TOKEN);
  ok("模型不存在 -> 404", aBadModel.status === 404, "HTTP " + aBadModel.status);

  out("  .. 真跑一轮质询（4B，真模型）");
  const aReal = await sse("/api/code/review/challenge", {
    code: BUGGY,
    lang: "javascript",
    file: "backend-smoke.js",
    intent: INTENT,
    primary: { summary: "循环边界可能越界，且没有判空", issues: [{ line: 3, endLine: 3, severity: "error", title: "循环越界", detail: "i <= items.length", fix: "改成 <" }] },
    question: "第 3 行不是 bug，因为 items 永远非空。请说明你到底凭什么说它越界？",
    history: [{ question: "上一轮：这段代码有问题吗？", answer: "有：第 3 行循环条件用了 <=，会多访问一个下标，items[i] 是 undefined。" }],
    max_tokens: 900,
  }, TOKEN, 280000);
  const aTypes = types(aReal.events);
  ok("真跑质询 -> 200 text/event-stream", aReal.status === 200 && /event-stream/i.test(aReal.ct), "HTTP " + aReal.status + " ct=" + aReal.ct.slice(0, 30) + " " + errText(aReal));
  ok("事件顺序 meta 第一", aTypes[0] === "meta", aTypes.join(","));
  ok("有 delta 段", evs(aReal.events, "delta").length > 0, "delta=" + evs(aReal.events, "delta").length);
  ok("done 最后（无 error 事件）", aTypes[aTypes.length - 1] === "done" && evs(aReal.events, "error").length === 0, aTypes.slice(-3).join(","));
  ok("delta 拼接非空", sumText(aReal.events).trim().length > 0, "len=" + sumText(aReal.events).length);
  const aMeta = evs(aReal.events, "meta")[0] || {};
  ok("meta 字段齐全（model/modelFile/contextSize/switchedModel/startedAt/turn）",
    Boolean(aMeta.model && aMeta.modelFile && aMeta.contextSize >= 2048 && typeof aMeta.switchedModel === "boolean" && aMeta.startedAt && aMeta.turn >= 2),
    JSON.stringify({ model: aMeta.model, ctx: aMeta.contextSize, turn: aMeta.turn }));
  const aDone = evs(aReal.events, "done")[0] || {};
  ok("done 有 seconds / model", Number(aDone.seconds) > 0 && Boolean(aDone.model), "seconds=" + aDone.seconds + " model=" + aDone.model);
  ok("delta 里没有裸 JSON 围栏", !sumText(aReal.events).includes(FENCE + "json"), "");
  key.challenge = "质询 " + (aReal.ms / 1000).toFixed(1) + "s / 回答 " + sumText(aReal.events).length + " 字 / ctx " + aMeta.contextSize + " / delta " + evs(aReal.events, "delta").length + " 段";
  out("  .. 质询耗时 " + ((aReal.ms / 1000).toFixed(1)) + "s，回答 " + sumText(aReal.events).length + " 字");

  // ---------- B. 他人复审 ----------
  out("");
  out("-- B. POST /api/code/review/cross（他人复审） --");
  const bNoTok = await jsonReq("/api/code/review/cross", { code: BUGGY }, null);
  ok("无令牌 -> 403", bNoTok.status === 403, "HTTP " + bNoTok.status);
  const bNoCode = await jsonReq("/api/code/review/cross", {}, TOKEN);
  ok("缺 code -> 400", bNoCode.status === 400, "HTTP " + bNoCode.status);
  const bLong = await jsonReq("/api/code/review/cross", { code: "x".repeat(20001) }, TOKEN);
  ok("code 超 20000 -> 413", bLong.status === 413, "HTTP " + bLong.status);
  const bBadModel = await jsonReq("/api/code/review/cross", { code: BUGGY, model: "no-such-model.gguf" }, TOKEN);
  ok("模型不存在 -> 404", bBadModel.status === 404, "HTTP " + bBadModel.status);
  const bPhi = await jsonReq("/api/code/review/cross", { code: BUGGY, model: "Phi-4-mini-instruct-Q4_K_M.gguf" }, TOKEN);
  ok("显式指定 Phi-4-mini -> 400（永不使用）", bPhi.status === 400, "HTTP " + bPhi.status + " " + errText(bPhi));

  out("  .. 真跑一轮他人复审（同模型 sameModel=true 分支，真模型）");
  const bReal = await sse("/api/code/review/cross", {
    code: BUGGY,
    lang: "javascript",
    file: "backend-smoke.js",
    intent: INTENT,
    primary: { summary: "循环边界可能越界，且没有判空", issues: [{ line: 3, endLine: 3, severity: "error", title: "循环越界", detail: "i <= items.length", fix: "改成 <" }] },
    model: MODEL,
    max_tokens: 1000,
  }, TOKEN, 280000);
  const bTypes = types(bReal.events);
  const bMeta = evs(bReal.events, "meta")[0] || {};
  const bFind = evs(bReal.events, "findings")[0] || {};
  const bCmp = evs(bReal.events, "compare")[0] || {};
  const bStats = bCmp.stats || {};
  ok("真跑复审 -> 200 text/event-stream", bReal.status === 200 && /event-stream/i.test(bReal.ct), "HTTP " + bReal.status + " " + errText(bReal));
  ok("事件顺序 meta -> delta* -> (phase) -> findings -> compare -> done",
    bTypes[0] === "meta" && bTypes.includes("delta") && bTypes.includes("findings") && bTypes.includes("compare") && bTypes[bTypes.length - 1] === "done" && evs(bReal.events, "error").length === 0,
    bTypes.join(","));
  ok("meta.sameModel === true（指定当前模型）", bMeta.sameModel === true && bMeta.modelFile === MODEL, "sameModel=" + bMeta.sameModel + " file=" + bMeta.modelFile);
  ok("phase 事件 phase=findings", (evs(bReal.events, "phase")[0] || {}).phase === "findings", JSON.stringify(evs(bReal.events, "phase")[0] || {}));
  ok("delta（审查思路）非空", sumText(bReal.events).trim().length > 0, "len=" + sumText(bReal.events).length);
  ok("findings 有 summary/issues/parsed/lineCount",
    typeof bFind.summary === "string" && Array.isArray(bFind.issues) && typeof bFind.parsed === "boolean" && Number(bFind.lineCount) === 9,
    "parsed=" + bFind.parsed + " issues=" + (bFind.issues || []).length + " lineCount=" + bFind.lineCount);
  const badField = (bFind.issues || []).find((it) => !(it.line >= 1 && it.line <= 9 && it.endLine >= it.line && ["error", "warn", "info"].includes(it.severity) && it.title && typeof it.detail === "string" && typeof it.fix === "string"));
  ok("findings.issues 字段齐全且行号在 1..lineCount", !badField, badField ? JSON.stringify(badField).slice(0, 120) : "");
  ok("compare.verdict ∈ {consistent,differs,contradicts}", ["consistent", "differs", "contradicts"].includes(bCmp.verdict), "verdict=" + bCmp.verdict);
  ok("stats 自洽：matched=agree+conflicts", bStats.matched === bStats.agree + bStats.conflicts, JSON.stringify(bStats));
  ok("stats 自洽：matched+onlySecond===second", bStats.matched + bStats.onlySecond === bStats.second, JSON.stringify(bStats));
  ok("stats 自洽：matched+onlyPrimary===primary", bStats.matched + bStats.onlyPrimary === bStats.primary, JSON.stringify(bStats));
  ok("stats 计数与数组长度一致",
    bStats.agree === (bCmp.agree || []).length && bStats.conflicts === (bCmp.conflicts || []).length &&
    bStats.onlyPrimary === (bCmp.onlyPrimary || []).length && bStats.onlySecond === (bCmp.onlySecond || []).length,
    JSON.stringify(bStats));
  ok("agree / onlyPrimary / onlySecond / conflicts 都是数组且项有 line",
    [bCmp.agree, bCmp.onlyPrimary, bCmp.onlySecond, bCmp.conflicts].every((arr) => Array.isArray(arr)) &&
    (bCmp.agree || []).every((it) => it && it.primary && it.second && it.primary.line >= 1 && it.second.line >= 1) &&
    [...(bCmp.onlyPrimary || []), ...(bCmp.onlySecond || [])].every((it) => it && it.line >= 1) &&
    (bCmp.conflicts || []).every((c) => c && c.primary && c.second && String(c.reason || "").length > 0),
    "agree=" + (bCmp.agree || []).length + " onlyP=" + (bCmp.onlyPrimary || []).length + " onlyS=" + (bCmp.onlySecond || []).length + " conflict=" + (bCmp.conflicts || []).length);
  const bDone = evs(bReal.events, "done")[0] || {};
  ok("done 有 seconds / model", Number(bDone.seconds) > 0 && Boolean(bDone.model), "seconds=" + bDone.seconds);
  key.cross = "复审 " + (bReal.ms / 1000).toFixed(1) + "s / 判定 " + bCmp.verdict + " / 第二审查员 issues " + (bFind.issues || []).length + " 条 / parsed=" + bFind.parsed + " / sameModel=" + bMeta.sameModel;
  out("  .. 复审耗时 " + (bReal.ms / 1000).toFixed(1) + "s，判定 " + bCmp.verdict + "，第二审查员问题 " + (bFind.issues || []).length + " 条，parsed=" + bFind.parsed);

  // ---------- C. 云端配置 ----------
  out("");
  out("-- C. GET / POST /api/cloud/config --");
  const cGet0 = await jsonReq("/api/cloud/config");
  const c0 = cGet0.data || {};
  ok("GET 形状（ok/enabled/baseURL/model/hasKey/keyMasked/host/ready）",
    cGet0.status === 200 && c0.ok === true && typeof c0.enabled === "boolean" && typeof c0.baseURL === "string" &&
    typeof c0.model === "string" && typeof c0.hasKey === "boolean" && typeof c0.keyMasked === "string" && typeof c0.host === "string" && typeof c0.ready === "boolean",
    JSON.stringify(c0));
  const cNoTok = await jsonReq("/api/cloud/config", { enabled: true, baseURL: "https://api.example.com/v1", model: "gpt-4o-mini", apiKey: "sk-x1234567890" });
  ok("POST 无令牌 -> 403", cNoTok.status === 403, "HTTP " + cNoTok.status);
  const cInsecure = await jsonReq("/api/cloud/config", { baseURL: "http://api.example.com/v1" }, TOKEN);
  ok("http 非回环 -> 400 INSECURE_URL", cInsecure.status === 400 && (cInsecure.data || {}).code === "INSECURE_URL", "HTTP " + cInsecure.status + " code=" + JSON.stringify((cInsecure.data || {}).code));
  const cBadURL = await jsonReq("/api/cloud/config", { baseURL: "not a url" }, TOKEN);
  ok("非法 URL -> 400", cBadURL.status === 400, "HTTP " + cBadURL.status + " " + errText(cBadURL));
  const cBadModel = await jsonReq("/api/cloud/config", { model: "" }, TOKEN);
  ok("model 空 -> 400", cBadModel.status === 400, "HTTP " + cBadModel.status);
  const beforeDry = (await jsonReq("/api/cloud/config")).data || {};
  const cDry = await jsonReq("/api/cloud/config", { enabled: true, baseURL: "https://api.dryrun.example/v1", model: "dry-model", apiKey: "sk-dryrun1234567890", dryRun: true }, TOKEN);
  const afterDry = (await jsonReq("/api/cloud/config")).data || {};
  ok("dryRun -> 200 + dryRun:true", cDry.status === 200 && (cDry.data || {}).dryRun === true, "HTTP " + cDry.status);
  ok("dryRun 不落盘（GET 不变）", afterDry.baseURL === beforeDry.baseURL && afterDry.enabled === beforeDry.enabled && afterDry.hasKey === beforeDry.hasKey,
    "baseURL=" + afterDry.baseURL + " enabled=" + afterDry.enabled);

  // 起 stub（随机端口），把云端配置指向它
  await startStub();
  out("  .. 本地云端 stub 端口 " + stub.port);
  const stubBase = "http://127.0.0.1:" + stub.port + "/v1";
  const cSave = await jsonReq("/api/cloud/config", { enabled: true, baseURL: stubBase + "/", model: "stub-model", apiKey: CLOUD_STUB_KEY }, TOKEN);
  const cs = cSave.data || {};
  ok("保存 -> 200 ok:true", cSave.status === 200 && cs.ok === true, "HTTP " + cSave.status + " " + errText(cSave));
  ok("保存后 hasKey=true / ready=true", cs.hasKey === true && cs.ready === true, JSON.stringify({ hasKey: cs.hasKey, ready: cs.ready }));
  ok("baseURL 末尾 / 被去掉", cs.baseURL === stubBase, "baseURL=" + cs.baseURL);
  ok("host 正确", cs.host === "127.0.0.1:" + stub.port, "host=" + cs.host);
  ok("keyMasked 形状（前 3 + *** + 后 4）", /^sk\-\*\*\*[A-Za-z0-9]{4}$/.test(String(cs.keyMasked)), "keyMasked=" + cs.keyMasked);
  ok("保存响应里没有明文 apiKey", !cSave.text.includes(CLOUD_STUB_KEY), "");
  const cGet1 = await jsonReq("/api/cloud/config");
  ok("GET 也拿不到明文 apiKey", !cGet1.text.includes(CLOUD_STUB_KEY) && (cGet1.data || {}).hasKey === true, "");

  // ---------- D. 云端复审 ----------
  out("");
  out("-- D. POST /api/code/review/cloud（云端复审，本地 stub） --");
  const dNoTok = await jsonReq("/api/code/review/cloud", { code: CLOUD_CODE, confirm: cs.host });
  ok("无令牌 -> 403", dNoTok.status === 403, "HTTP " + dNoTok.status);
  const dNoConfirm = await jsonReq("/api/code/review/cloud", { code: CLOUD_CODE }, TOKEN);
  ok("confirm 缺失 -> 409 CONFIRM_REQUIRED", dNoConfirm.status === 409 && (dNoConfirm.data || {}).code === "CONFIRM_REQUIRED", "HTTP " + dNoConfirm.status + " code=" + ((dNoConfirm.data || {}).code));
  const dBadConfirm = await jsonReq("/api/code/review/cloud", { code: CLOUD_CODE, confirm: "evil.example.com" }, TOKEN);
  ok("confirm 不匹配 -> 409", dBadConfirm.status === 409, "HTTP " + dBadConfirm.status);
  const dLong = await jsonReq("/api/code/review/cloud", { code: "x".repeat(20001), confirm: cs.host }, TOKEN);
  ok("code 超 20000 -> 413", dLong.status === 413, "HTTP " + dLong.status);

  stub.last = null;
  const dReal = await sse("/api/code/review/cloud", { code: CLOUD_CODE, lang: "python", file: "cloud-demo.py", intent: "审查这段脚本", confirm: cs.host, max_tokens: 600 }, TOKEN, 120000);
  const dTypes = types(dReal.events);
  const dMeta = evs(dReal.events, "meta")[0] || {};
  const dFind = evs(dReal.events, "findings")[0] || {};
  const dDone = evs(dReal.events, "done")[0] || {};
  ok("云端复审 -> 200 SSE", dReal.status === 200 && /event-stream/i.test(dReal.ct), "HTTP " + dReal.status + " " + errText(dReal));
  ok("事件顺序 meta -> delta* -> findings -> done",
    dTypes[0] === "meta" && dTypes.includes("delta") && dTypes.includes("findings") && dTypes[dTypes.length - 1] === "done" && evs(dReal.events, "error").length === 0,
    dTypes.join(","));
  ok("meta.provider=cloud / host / model", dMeta.provider === "cloud" && dMeta.host === cs.host && dMeta.model === "stub-model", JSON.stringify(dMeta).slice(0, 160));
  ok("meta.sentChars > 0", Number(dMeta.sentChars) > 0, "sentChars=" + dMeta.sentChars);
  ok("meta.redactions > 0", Number(dMeta.redactions) > 0, "redactions=" + dMeta.redactions);
  ok("delta 拼起来 == stub 文本", sumText(dReal.events) === STUB_TEXT, "len=" + sumText(dReal.events).length);
  ok("findings 解析出 issues（parsed=true）", dFind.parsed === true && Array.isArray(dFind.issues) && dFind.issues.length === 2, "parsed=" + dFind.parsed + " issues=" + (dFind.issues || []).length);
  ok("findings 行号在 1..lineCount", (dFind.issues || []).every((it) => it.line >= 1 && it.line <= 11 && it.endLine >= it.line), JSON.stringify((dFind.issues || []).map((x) => x.line)));
  ok("done 有 seconds / model", Number(dDone.seconds) > 0 && Boolean(dDone.model), "seconds=" + dDone.seconds);
  key.cloud = "云端 发出 " + dMeta.sentChars + " 字符 / 脱敏 " + dMeta.redactions + " 处 / delta " + evs(dReal.events, "delta").length + " 段 / seconds=" + dDone.seconds + " / 上游 500->502 已验证";

  // stub 收到的请求：body 必须是**脱敏后**的代码
  const got = stub.last || { headers: {}, body: "" };
  let gotBody = {};
  try { gotBody = JSON.parse(got.body); } catch {}
  const sent = JSON.stringify(gotBody);
  ok("stub 收到请求（body 非空）", sent.length > 2, "len=" + sent.length);
  ok("上游请求体不含原 apiKey", !sent.includes(CLOUD_KEY_IN_CODE), "");
  ok("上游请求体不含原邮箱", !sent.includes(CLOUD_EMAIL), "");
  ok("上游请求体不含原 Windows 路径", !sent.includes("C:" + BS + "Users" + BS + "bob"), "");
  ok("上游请求体不含原 IP", !sent.includes(CLOUD_IP), "");
  ok("上游请求体不含原长 hex", !sent.includes(CLOUD_HEX), "");
  ok("上游请求体含脱敏占位符", sent.includes("<API_KEY>") && sent.includes("<EMAIL>") && sent.includes("<PATH>") && sent.includes("<IP>") && sent.includes("<HEX>"), "");
  ok("上游请求体不含配置里的 apiKey 明文", !sent.includes(CLOUD_STUB_KEY), "");
  ok("上游模型 / 参数正确（stream:false）", gotBody.model === "stub-model" && gotBody.stream === false && Number(gotBody.max_tokens) === 600 && Number(gotBody.temperature) === 0.2, JSON.stringify({ model: gotBody.model, stream: gotBody.stream, max_tokens: gotBody.max_tokens }));
  ok("上游 Authorization 头是 Bearer <key>", String(got.headers.authorization || "") === "Bearer " + CLOUD_STUB_KEY, "auth=" + String(got.headers.authorization || "").slice(0, 12) + "…");
  ok("stub 只被调用 1 次", stub.hits === 1, "hits=" + stub.hits);

  // 上游 500 -> 502 CLOUD_UPSTREAM
  const failBase = "http://127.0.0.1:" + stub.port + "/fail/v1";
  const cFail = await jsonReq("/api/cloud/config", { enabled: true, baseURL: failBase, model: "stub-model", apiKey: CLOUD_STUB_KEY }, TOKEN);
  const failHost = (cFail.data || {}).host;
  const dFail = await jsonReq("/api/code/review/cloud", { code: CLOUD_CODE, confirm: failHost }, TOKEN, 120000);
  ok("上游 500 -> 502 CLOUD_UPSTREAM", dFail.status === 502 && (dFail.data || {}).code === "CLOUD_UPSTREAM", "HTTP " + dFail.status + " code=" + ((dFail.data || {}).code) + " msg=" + errText(dFail));
  ok("502 的 message 带上游状态", String(errText(dFail)).includes("上游 500"), errText(dFail));

  // ---------- 收尾：清 key / 停用 ----------
  const cClear = await jsonReq("/api/cloud/config", { apiKey: "", enabled: false }, TOKEN);
  const afterClear = (await jsonReq("/api/cloud/config")).data || {};
  ok("apiKey:\"\" 清除 -> hasKey=false", cClear.status === 200 && afterClear.hasKey === false, "hasKey=" + afterClear.hasKey);
  ok("停用 -> ready=false", afterClear.ready === false && afterClear.enabled === false, JSON.stringify({ enabled: afterClear.enabled, ready: afterClear.ready }));
  ok("清 key 后 keyMasked 为空", String(afterClear.keyMasked) === "", "keyMasked=" + afterClear.keyMasked);

  // ---------- E. 日志红线 ----------
  out("");
  out("-- E. 日志红线（明文 apiKey / 代码正文） --");
  let logText = "";
  try { logText = readFileSync(LOG_FILE, "utf8"); } catch (e) { logText = ""; }
  ok("能读到 dev 日志 " + LOG_FILE, logText.length > 0, "len=" + logText.length);
  ok("日志里没有明文配置 apiKey", logText.length > 0 && !logText.includes(CLOUD_STUB_KEY), "");
  ok("日志里没有明文代码里的 sk-", !logText.includes(CLOUD_KEY_IN_CODE), "");
  ok("日志里没有代码正文标记（" + CODE_MARK + "）", logText.length > 0 && !logText.includes(CODE_MARK), "");
  ok("日志里有「云端复审 <host> 模型 … / 脱敏 N 处 …s」", /云端复审 .* 模型 .* 发出 \d+ 字符 \/ 脱敏 \d+ 处 [\d.]+s/.test(logText), "");
  ok("日志里没有 Bearer 明文", !logText.includes("Bearer " + CLOUD_STUB_KEY), "");
  key.log = "日志 " + logText.length + " 字 / 无明文 key / 无代码正文";
} catch (e) {
  fail += 1;
  out("  FAIL 脚本异常：" + String((e && e.stack) || e));
} finally {
  // 恢复：停用云端 + 清 key（失败也不影响其它断言）
  try { await jsonReq("/api/cloud/config", { enabled: false, apiKey: "" }, TOKEN); } catch {}
  try { await stopStub(); } catch {}
  const secs = ((Date.now() - t0All) / 1000).toFixed(1);
  out("");
  out("关键数字：" + (key.challenge || "-") + " | " + (key.cross || "-") + " | " + (key.cloud || "-") + " | 日志红线=" + (key.log || "-"));
  out("结果: " + pass + "/" + (pass + fail) + " 通过（失败 " + fail + "，耗时 " + secs + "s）");
  try {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(OUT_FILE, lines.join("\n") + "\n", "utf8");
    console.log("证据已写入 " + OUT_FILE);
  } catch (e) {
    console.log("证据写入失败：" + String((e && e.message) || e));
  }
  process.exit(fail > 0 ? 1 : 0);
}

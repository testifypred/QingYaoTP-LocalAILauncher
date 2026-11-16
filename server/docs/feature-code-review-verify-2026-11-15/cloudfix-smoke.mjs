/**
 * cloudfix-smoke.mjs —— v1.8.1 云端复审「推理型上游」修复的临时自测脚本（不是正式探针）
 *
 *   node cloudfix-smoke.mjs [base]
 *
 * 覆盖契约 v1.8.1 的云端复审重试阶梯：
 *  1) 真 DeepSeek（api.deepseek.com / deepseek-flash / 用户真实配置）：一次真跑
 *       - 200 + text/event-stream；meta.attempts=1、meta.thinkingDisabled=true
 *       - findings 有内容、done.seconds>0、无 error 事件、总耗时 < 60s
 *  2) 本地 stub（node:http，随机端口）：只回 reasoning_content、content 空、finish_reason=length
 *       - 服务必须重试（stub 收到 ≥2 次请求）：attempt3 放大 max_tokens 且去掉 thinking
 *       - 最终不 502：用 reasoning 兜底（meta.usedReasoningFallback=true），delta 有内容
 *  3) 本地 stub：400 + body 提到 thinking（模拟不认这个参数的上游）
 *       - 服务去掉 thinking 重发，第 2 次请求 body 不含 thinking，最终成功
 *  4) 本地 stub：content 空且 reasoning 也空 → 502 CLOUD_EMPTY（新错误文案带 finish_reason）
 *
 * 收尾一定把用户真实的云端配置（含 key）原样写回；全程不打印 apiKey。
 * 证据落 server\docs\feature-code-review-verify-2026-11-15\cloudfix-smoke.txt
 */
import http from "node:http";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const BASE = process.argv[2] || "http://127.0.0.1:8299";
const CONFIG_FILE = "D:\\LocalModels\\data\\cloud-review.json";
const OUT_FILE = "D:\\LocalModels\\server\\docs\\feature-code-review-verify-2026-11-15\\cloudfix-smoke.txt";
const FENCE = String.fromCharCode(96, 96, 96);

const lines = [];
let pass = 0;
let fail = 0;
const t0All = Date.now();
function out(s) { lines.push(s); console.log(s); }
function ok(name, cond, extra) {
  if (cond) { pass += 1; out("  ok   " + name + (extra ? "  [" + extra + "]" : "")); }
  else { fail += 1; out("  FAIL " + name + "  " + (extra || "")); }
}
const errText = (r) => String((r && r.data && r.data.error && r.data.error.message) || (r && r.data && r.data.message) || r.text || r.error || "").slice(0, 200);

// ---------- HTTP 小工具 ----------
let TOKEN = "";
async function jsonReq(path, body, ms) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (TOKEN) headers["x-local-token"] = TOKEN;
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
async function sse(path, body, ms) {
  const t = Date.now();
  let res;
  try {
    res = await fetch(BASE + path, {
      method: "POST",
      headers: { "content-type": "application/json", "x-local-token": TOKEN },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(ms || 120000),
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

// ---------- 测试用代码 / stub 文本 ----------
const PY_CODE = [
  "def total(items):",
  "    s = 0",
  "    for i in range(len(items) + 1):",
  "        s += items[i]",
  "    return s",
  "",
  "print(total([1, 2, 3]))",
].join("\n");
const INTENT = "找出这段 Python 的 bug（重点看循环边界和空值），按行号指出问题。";
const REASON_TEXT = [
  "审查思路：",
  "- 第 3 行：range(len(items) + 1) 会多循环一次，最后一个下标越界（IndexError）。",
  "- 第 4 行：没有判空，items 为空时同样会越界。",
].join("\n");
const STUB_TEXT = [
  "审查思路：",
  "- 第 3 行：range(len(items)+1) 越界，最后会 IndexError。",
  "- 第 4 行：没有判空 items。",
  "",
  FENCE + "json",
  JSON.stringify({
    summary: "1 处越界 + 1 处未判空",
    issues: [
      { line: 3, endLine: 3, severity: "error", title: "循环越界", detail: "range(len+1) 会多访问一个下标", fix: "改成 range(len(items))" },
      { line: 4, endLine: 4, severity: "warn", title: "未判空", detail: "items 可能为空", fix: "先判 if not items: return 0" },
    ],
  }),
  FENCE,
].join("\n");

// ---------- 本地 stub（node:http，随机端口，不出网） ----------
const stub = { server: null, port: 0, hits: {}, bodies: {} };
function resetStub(prefix) { stub.hits[prefix] = 0; stub.bodies[prefix] = []; }
function startStub() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => { raw += c; });
      req.on("end", () => {
        const url = String(req.url || "");
        const prefix = url.startsWith("/reasoning/") ? "reasoning" : url.startsWith("/think400/") ? "think400" : url.startsWith("/empty/") ? "empty" : "other";
        stub.hits[prefix] = (stub.hits[prefix] || 0) + 1;
        (stub.bodies[prefix] = stub.bodies[prefix] || []).push(raw);
        let bodyObj = {};
        try { bodyObj = JSON.parse(raw); } catch {}
        const sendJson = (status, obj) => {
          res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify(obj));
        };
        if (prefix === "reasoning") {
          // 只回 reasoning_content、content 空、finish_reason=length（模拟推理型上游把预算烧光）
          sendJson(200, {
            choices: [{ message: { role: "assistant", content: "", reasoning_content: REASON_TEXT }, finish_reason: "length" }],
            usage: { prompt_tokens: 100, completion_tokens: Number(bodyObj.max_tokens) || 0, reasoning_tokens: Number(bodyObj.max_tokens) || 0 },
          });
          return;
        }
        if (prefix === "think400") {
          if (stub.hits[prefix] === 1) {
            // 第一次：模拟「不认识 thinking 参数」的网关
            sendJson(400, { error: { message: "Unrecognized request argument supplied: thinking", type: "invalid_request_error" } });
            return;
          }
          sendJson(200, { choices: [{ message: { role: "assistant", content: STUB_TEXT }, finish_reason: "stop" }] });
          return;
        }
        if (prefix === "empty") {
          // content 和 reasoning 都空 → 应报 502 CLOUD_EMPTY
          sendJson(200, { choices: [{ message: { role: "assistant", content: "" }, finish_reason: "length" }] });
          return;
        }
        sendJson(500, { error: { message: "unknown stub path" } });
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
const stubHost = () => "127.0.0.1:" + stub.port;
const stubBase = (name) => "http://" + stubHost() + "/" + name;

/** 把上游配置指到 stub 的某个分支，返回 confirm 用的 host */
async function pointToStub(name) {
  resetStub(name);
  const r = await jsonReq("/api/cloud/config", { enabled: true, baseURL: stubBase(name), model: "stub-model", apiKey: "sk-cloudfix-stub-0000" });
  return String((r.data || {}).host || "");
}

// ---------- 原始云端配置（含 key；只留在内存，绝不打印） ----------
let ORIG = null;
function loadOrig() {
  const raw = JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
  ORIG = {
    enabled: Boolean(raw.enabled),
    baseURL: String(raw.baseURL || ""),
    model: String(raw.model || ""),
    apiKey: String(raw.apiKey || ""),
  };
}

async function restoreOrig() {
  if (!ORIG) return;
  const r = await jsonReq("/api/cloud/config", { enabled: ORIG.enabled, baseURL: ORIG.baseURL, model: ORIG.model, apiKey: ORIG.apiKey });
  return r;
}

function hostOf(url) { try { return new URL(url).host; } catch { return ""; } }

// ---------- 主流程 ----------
out("== v1.8.1 云端复审 cloudfix 自测 · 目标 " + BASE + " · " + new Date().toISOString() + " ==");
out("");

try {
  // 0. 前置：服务版本 / 令牌 / 真实配置
  out("-- 0. 前置（版本 / 令牌 / 用户真实云端配置） --");
  const boot = await jsonReq("/api/state");
  ok("GET /api/state -> 200", boot.status === 200, "HTTP " + boot.status + " " + errText(boot));
  const st0 = boot.data || {};
  TOKEN = String(st0.localToken || "");
  ok("拿到本机令牌", TOKEN.length > 0, "len=" + TOKEN.length);
  ok("版本已是 1.8.1", String(st0.version) === "1.8.1", "version=" + st0.version);

  loadOrig();
  const realHost = hostOf(ORIG.baseURL);
  ok("用户真实配置已就绪（enabled / baseURL / model / key）",
    ORIG.enabled === true && !!ORIG.baseURL && !!ORIG.model && ORIG.apiKey.length > 0,
    "host=" + realHost + " model=" + ORIG.model + " keyLen=" + ORIG.apiKey.length);
  ok("真实配置指向 api.deepseek.com", realHost === "api.deepseek.com", "host=" + realHost);

  // 1. 真 DeepSeek：默认 max_tokens（1200），thinking disabled 应让 content 正常返回
  out("");
  out("-- 1. 真 DeepSeek（deepseek-flash 推理型）POST /api/code/review/cloud --");
  const t1 = Date.now();
  const real = await sse("/api/code/review/cloud", {
    code: PY_CODE,
    lang: "python",
    file: "cloudfix-smoke.py",
    intent: INTENT,
    confirm: realHost,
    // 故意不传 max_tokens：用服务默认 1200，正是修复前会 content 空的场景
  }, 120000);
  const realTypes = types(real.events);
  const realMeta = evs(real.events, "meta")[0] || {};
  const realFind = evs(real.events, "findings")[0] || {};
  const realDone = evs(real.events, "done")[0] || {};
  const realSecs = (Date.now() - t1) / 1000;
  ok("真跑 -> 200 + text/event-stream", real.status === 200 && /text\/event-stream/i.test(real.ct), "HTTP " + real.status + " ct=" + real.ct.slice(0, 30) + " " + errText(real));
  ok("无 error 事件（推理模型没把请求撑爆）", evs(real.events, "error").length === 0, realTypes.join(","));
  ok("事件顺序 meta 第一 / done 最后", realTypes[0] === "meta" && realTypes[realTypes.length - 1] === "done", realTypes.join(","));
  ok("meta.attempts === 1", realMeta.attempts === 1, "attempts=" + realMeta.attempts);
  ok("meta.thinkingDisabled === true", realMeta.thinkingDisabled === true, "thinkingDisabled=" + realMeta.thinkingDisabled);
  ok("meta.usedReasoningFallback === false（推理被关掉，正文直接有）", realMeta.usedReasoningFallback === false, "usedReasoningFallback=" + realMeta.usedReasoningFallback);
  ok("delta 正文非空", sumText(real.events).trim().length > 0, "len=" + sumText(real.events).length);
  ok("findings 有内容（summary 或 issues 非空）", Boolean(realFind.summary) || (realFind.issues || []).length > 0, JSON.stringify({ summary: realFind.summary || "", issues: (realFind.issues || []).length, parsed: realFind.parsed }));
  ok("done.seconds > 0", Number(realDone.seconds) > 0, "seconds=" + realDone.seconds);
  ok("总耗时 < 60s", realSecs < 60, realSecs.toFixed(1) + "s");
  out("  .. 真 DeepSeek 耗时 " + realSecs.toFixed(1) + "s / attempts=" + realMeta.attempts + " / thinkingDisabled=" + realMeta.thinkingDisabled + " / delta " + sumText(real.events).length + " 字 / findings " + ((realFind.issues || []).length) + " 条");

  // 2. stub：只回 reasoning_content → 服务重试放大预算，最后用 reasoning 兜底，不 502
  out("");
  out("-- 2. stub：只回 reasoning_content（content 空 / finish_reason=length） --");
  await startStub();
  out("  .. 本地 stub 端口 " + stub.port);
  const rHost = await pointToStub("reasoning");
  ok("配置指到 stub（confirm host 非空）", Boolean(rHost), "confirm host=" + rHost);
  const t2 = Date.now();
  const rr = await sse("/api/code/review/cloud", { code: PY_CODE, lang: "python", file: "cloudfix-smoke.py", intent: INTENT, confirm: rHost, max_tokens: 1000 }, 120000);
  const rrSecs = (Date.now() - t2) / 1000;
  const rrTypes = types(rr.events);
  const rrMeta = evs(rr.events, "meta")[0] || {};
  const rrDelta = sumText(rr.events);
  ok("服务重试（stub 收到 >= 2 次请求）", (stub.hits.reasoning || 0) >= 2, "hits=" + (stub.hits.reasoning || 0));
  ok("没出现 502（200 SSE，无 error 事件）", rr.status === 200 && /text\/event-stream/i.test(rr.ct) && evs(rr.events, "error").length === 0, "HTTP " + rr.status + " ct=" + rr.ct.slice(0, 30) + " " + errText(rr));
  ok("meta.usedReasoningFallback === true", rrMeta.usedReasoningFallback === true, "usedReasoningFallback=" + rrMeta.usedReasoningFallback);
  ok("meta.attempts === 2（attempt1 + attempt3）", rrMeta.attempts === 2, "attempts=" + rrMeta.attempts);
  ok("meta.thinkingDisabled === false（attempt3 去掉了 thinking）", rrMeta.thinkingDisabled === false, "thinkingDisabled=" + rrMeta.thinkingDisabled);
  ok("delta 拼起来 == 推理内容（reasoning 兜底）", rrDelta === REASON_TEXT, "len=" + rrDelta.length);
  const rBody1 = JSON.parse(stub.bodies.reasoning[0] || "{}");
  const rBody2 = JSON.parse(stub.bodies.reasoning[1] || "{}");
  ok("第 1 次请求带 thinking:{type:\"disabled\"} 且 max_tokens=1000", Boolean(rBody1.thinking) && rBody1.thinking.type === "disabled" && Number(rBody1.max_tokens) === 1000, JSON.stringify({ thinking: rBody1.thinking, max_tokens: rBody1.max_tokens }));
  ok("第 2 次请求不带 thinking 且 max_tokens 放大到 3000", !("thinking" in rBody2) && Number(rBody2.max_tokens) === 3000, JSON.stringify({ thinking: rBody2.thinking, max_tokens: rBody2.max_tokens }));
  out("  .. reasoning stub 耗时 " + rrSecs.toFixed(1) + "s / hits=" + (stub.hits.reasoning || 0) + " / attempts=" + rrMeta.attempts + " / 兜底=" + rrMeta.usedReasoningFallback);

  // 3. stub：400 + body 含 thinking → 去掉 thinking 重发，第 2 次成功
  out("");
  out("-- 3. stub：400 + body 提到 thinking（不认这个参数的上游） --");
  const tHost = await pointToStub("think400");
  ok("配置指到 think400 stub", Boolean(tHost), "confirm host=" + tHost);
  const t3 = Date.now();
  const r400 = await sse("/api/code/review/cloud", { code: PY_CODE, lang: "python", file: "cloudfix-smoke.py", intent: INTENT, confirm: tHost }, 120000);
  const r400Secs = (Date.now() - t3) / 1000;
  const r400Meta = evs(r400.events, "meta")[0] || {};
  const b1 = JSON.parse(stub.bodies.think400[0] || "{}");
  const b2 = JSON.parse(stub.bodies.think400[1] || "{}");
  ok("stub 收到 2 次请求", (stub.hits.think400 || 0) === 2, "hits=" + (stub.hits.think400 || 0));
  ok("第 1 次带 thinking / 第 2 次不带 thinking", Boolean(b1.thinking) && !("thinking" in b2), JSON.stringify({ first: b1.thinking, second: b2.thinking }));
  ok("去掉 thinking 后重发成功（200 SSE，无 error 事件）", r400.status === 200 && /text\/event-stream/i.test(r400.ct) && evs(r400.events, "error").length === 0, "HTTP " + r400.status + " " + errText(r400));
  ok("meta.attempts === 2 / thinkingDisabled === false", r400Meta.attempts === 2 && r400Meta.thinkingDisabled === false, JSON.stringify({ attempts: r400Meta.attempts, thinkingDisabled: r400Meta.thinkingDisabled }));
  ok("delta 拼起来 == stub 正文", sumText(r400.events) === STUB_TEXT, "len=" + sumText(r400.events).length);
  out("  .. 400-thinking stub 耗时 " + r400Secs.toFixed(1) + "s / hits=" + (stub.hits.think400 || 0) + " / attempts=" + r400Meta.attempts);

  // 4. stub：content 空 + reasoning 也空 → 502 CLOUD_EMPTY（新文案能指方向）
  out("");
  out("-- 4. stub：content 空且 reasoning 也空 → 502 CLOUD_EMPTY --");
  const eHost = await pointToStub("empty");
  const rEmpty = await jsonReq("/api/code/review/cloud", { code: PY_CODE, confirm: eHost }, 60000);
  const emptyData = rEmpty.data || {};
  ok("-> 502 + code=CLOUD_EMPTY", rEmpty.status === 502 && emptyData.code === "CLOUD_EMPTY", "HTTP " + rEmpty.status + " code=" + emptyData.code + " msg=" + String(emptyData.message || "").slice(0, 60));
  ok("文案带 finish_reason 和解决方向", String(emptyData.message || "").includes("finish_reason=length") && String(emptyData.message || "").includes("推理模型"), String(emptyData.message || "").slice(0, 120));
  ok("这种分支不重试（stub 只收到 1 次）", (stub.hits.empty || 0) === 1, "hits=" + (stub.hits.empty || 0));
} catch (e) {
  fail += 1;
  out("  FAIL 脚本异常：" + String((e && e.stack) || e));
} finally {
  // 收尾：恢复用户真实云端配置（含 key），停 stub
  try { await restoreOrig(); } catch {}
  try { await stopStub(); } catch {}
  try {
    const back = await jsonReq("/api/cloud/config");
    const d = back.data || {};
    out("");
    out("收尾：云端配置已恢复 host=" + d.host + " model=" + d.model + " hasKey=" + d.hasKey + " enabled=" + d.enabled);
    ok("真实配置已恢复（host/model 一致、key 在位、已启用）",
      d.host === hostOf(ORIG.baseURL) && d.model === ORIG.model && d.hasKey === true && d.enabled === true,
      JSON.stringify({ host: d.host, model: d.model, hasKey: d.hasKey, enabled: d.enabled }));
  } catch (e) {
    ok("真实配置恢复检查", false, String(e && e.message));
  }
  const secs = ((Date.now() - t0All) / 1000).toFixed(1);
  out("");
  out("结果: " + pass + "/" + (pass + fail) + " 通过（失败 " + fail + "，耗时 " + secs + "s）");
  try {
    writeFileSync(OUT_FILE, lines.join("\n") + "\n", "utf8");
    console.log("证据已写入 " + OUT_FILE);
  } catch (e) {
    console.log("证据写入失败：" + String((e && e.message) || e));
  }
  process.exit(fail > 0 ? 1 : 0);
}

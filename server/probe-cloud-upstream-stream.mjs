/**
 * 云端复审「上游真流式」探针（v1.9.1）
 *
 *   node probe-cloud-upstream-stream.mjs [base]
 *
 * 覆盖（全部本地 stub，绝不真出网）：
 *   S 真流式：stub 用 text/event-stream 分块推（每块间隔 40ms，共 12 块）；断言产品把 delta 在 stub 结束前就推到前端
 *     （首个 delta 到达时间 < stub 最后一块发送时间）、delta 段数与拼接、findings、done。
 *   R 推理型重试：attempt1 只流 reasoning（content 空、finish_reason=length）→ 产品发 retry 事件 → attempt3 流 content；
 *     断言 retry 事件、meta.attempts>=2 / thinkingDisabled=false、retry 后的 delta 只含新内容、findings 正常。
 *   N 非 SSE 兜底：stub 返回整段 JSON（老网关）→ 产品仍按 v1.8.1 的 80 字切块推 delta、findings 正常。
 *   E 空正文：JSON 两空 → 502 CLOUD_EMPTY（不是 SSE 200 空正文）。
 *   Z 收尾：恢复云端配置（开跑前若有真 Key 原样写回）、关 stub、确认配置回到原样。
 *
 * 只读/写本机：stub 是 node:http；云端配置只改 baseURL/model/apiKey，收尾恢复。
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] || "http://127.0.0.1:8099";
const CLOUD_CFG_FILE = path.join(SERVER_DIR, "..", "data", "cloud-review.json");
const CLOUD_KEY = "sk-PROBESTREAM0123456789abcdef";
const CODE = [
  "function sumPrices(items) {",
  "  let total = 0;",
  "  for (let i = 0; i <= items.length; i++) {",
  "    total += items[i].price;",
  "  }",
  "  return total / items.length + 1;",
  "}",
].join("\n");

let pass = 0, fail = 0;
const failedNames = [];
function ok(name, cond, extra) {
  if (cond) { pass += 1; console.log("  ok   " + name + (extra ? "  [" + String(extra).slice(0, 180) + "]" : "")); }
  else { fail += 1; failedNames.push(name); console.log("  FAIL " + name + "  " + String(extra || "").slice(0, 240)); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
const errText = (r) => String((r && r.data && ((r.data.error && r.data.error.message) || r.data.message)) || (r && r.text) || "").slice(0, 220);
const respCode = (r) => String((r && r.data && (r.data.code || (r.data.error && r.data.error.code))) || "");
const norm = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
const typesOf = (events) => (events || []).map((e) => String((e && e.type) || ""));
const idxOf = (events, t) => (events || []).findIndex((e) => e && e.type === t);
const sumDelta = (events) => (events || []).filter((e) => e && e.type === "delta").map((e) => String(e.text || "")).join("");

/** 带「每个事件到达时间」的 SSE 读取（断言流式早到用） */
async function sseTimed(p, body, token, ms) {
  const t0 = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => { try { ac.abort(new Error("probe timeout")); } catch {} }, ms || 120000);
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
  let buf = "";
  try {
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      const piece = dec.decode(r.value, { stream: true });
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
        if (j) events.push({ t: Date.now(), ...j });
      }
    }
  } catch (e) { /* 主动断开 / 超时 */ }
  clearTimeout(timer);
  return { status: res.status, ct, events, text: buf, ms: Date.now() - t0, t0 };
}

// ---------- 本地 stub ----------
const STUB_TEXT = [
  "独立复核意见：",
  "- 第 3 行：循环条件 i <= items.length 会越界。",
  "- 第 4 行：items[i] 可能没有 price。",
  '{"summary":"发现 2 处问题：循环越界、缺少空值保护","issues":[{"line":3,"endLine":3,"severity":"error","title":"循环条件越界","detail":"i <= items.length 会访问 undefined","fix":"改成 i < items.length"},{"line":4,"endLine":4,"severity":"warn","title":"缺少空值保护","detail":"items 元素可能不含 price","fix":"读取前判空"}]}',
].join("\n");
const REASON_TEXT = "思考：先看循环边界，再看空值保护。" + '{"summary":"发现 1 处问题","issues":[{"line":3,"endLine":3,"severity":"error","title":"循环条件越界","detail":"i <= items.length","fix":"i < items.length"}]}';
const STUB_STREAM_CHUNKS = 12;
const STUB_CHUNK_TEXT = (() => {
  const per = Math.ceil(STUB_TEXT.length / STUB_STREAM_CHUNKS);
  const out = [];
  for (let i = 0; i < STUB_STREAM_CHUNKS; i += 1) out.push(STUB_TEXT.slice(i * per, (i + 1) * per));
  return out;
})();
const stub = { server: null, port: 0, base: "", host: "", hits: 0, modeHits: { s: 0, r: 0, n: 0, e: 0 }, firstSendAt: 0, lastSendAt: 0, lastMode: "" };

function sseWrite(res, obj) {
  res.write("data: " + JSON.stringify(obj) + "\n\n");
}
function startStub() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", async () => {
        const body = Buffer.concat(chunks).toString("utf8");
        const u = new URL(req.url || "/", "http://127.0.0.1");
        if (!/chat\/completions$/.test(u.pathname)) {
          res.writeHead(404, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: { message: "stub: only /chat/completions" } }));
          return;
        }
        stub.hits += 1;
        const modeM = /\/v1\/(s|r|n|e)(?:\/|$)/.exec(u.pathname);
        const mode = modeM ? modeM[1] : "";
        if (mode) stub.modeHits[mode] += 1;
        stub.lastMode = mode;
        let jb = null;
        try { jb = JSON.parse(body); } catch {}
        const wantStream = Boolean(jb && jb.stream === true);
        const hasThinking = Boolean(jb && typeof jb === "object" && Object.prototype.hasOwnProperty.call(jb, "thinking"));
        const mt = Number(jb && jb.max_tokens) || 0;
        stub.firstSendAt = Date.now();
        if (mode === "s" && wantStream) {
          res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
          for (let i = 0; i < STUB_CHUNK_TEXT.length; i += 1) {
            sseWrite(res, { choices: [{ index: 0, delta: { content: STUB_CHUNK_TEXT[i] }, finish_reason: null }] });
            stub.lastSendAt = Date.now();
            await sleep(40);
          }
          sseWrite(res, { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
          res.write("data: [DONE]\n\n");
          res.end();
          return;
        }
        if (mode === "r" && wantStream) {
          if (hasThinking && mt < 2000) {
            // attempt1：只流 reasoning，正文空（模拟推理型上游忽略 thinking）
            res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
            const parts = ["思考：", "先看循环边界", "，再看空值保护。"];
            for (const part of parts) {
              sseWrite(res, { choices: [{ index: 0, delta: { reasoning_content: part }, finish_reason: null }] });
              stub.lastSendAt = Date.now();
              await sleep(30);
            }
            sseWrite(res, { choices: [{ index: 0, delta: {}, finish_reason: "length" }] });
            res.write("data: [DONE]\n\n");
            res.end();
            return;
          }
          // attempt3：正常流 content
          res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
          const chunks3 = Math.ceil(STUB_TEXT.length / 40);
          for (let i = 0; i < chunks3; i += 1) {
            sseWrite(res, { choices: [{ index: 0, delta: { content: STUB_TEXT.slice(i * 40, (i + 1) * 40) }, finish_reason: null }] });
            stub.lastSendAt = Date.now();
            await sleep(20);
          }
          sseWrite(res, { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
          res.write("data: [DONE]\n\n");
          res.end();
          return;
        }
        // n / e：非 SSE（JSON 整段）
        res.writeHead(200, { "content-type": "application/json" });
        if (mode === "e") {
          res.end(JSON.stringify({ choices: [{ index: 0, message: { role: "assistant", content: "", reasoning_content: "" }, finish_reason: "length" }] }));
          return;
        }
        res.end(JSON.stringify({ choices: [{ index: 0, message: { role: "assistant", content: STUB_TEXT }, finish_reason: "stop" }] }));
      });
    });
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      stub.port = srv.address().port;
      stub.server = srv;
      stub.base = "http://127.0.0.1:" + stub.port + "/v1";
      stub.host = "127.0.0.1:" + stub.port;
      resolve();
    });
  });
}
async function stopStub() {
  if (!stub.server) return;
  await new Promise((r) => { try { stub.server.close(() => r()); } catch { r(); } });
  stub.server = null;
}

(async () => {
  const st = (await jsonReq("/api/state")).data || {};
  const TOKEN = String(st.localToken || "");
  console.log("\n== 目标 " + BASE + "，令牌 " + (TOKEN ? "已取到" : "缺失") + " ==");
  if (!TOKEN) { console.log("RESULT 0/0"); process.exit(2); }

  let cloudCfgBackup = null;
  try { cloudCfgBackup = fs.readFileSync(CLOUD_CFG_FILE, "utf8"); } catch {}
  const cfg0 = (await jsonReq("/api/cloud/config")).data || {};
  await startStub();

  try {
    // ---------- S. 真流式 ----------
    console.log("\n== S. 上游真流式（text/event-stream 分块，stub 每块 40ms） ==");
    const saveS = await jsonReq("/api/cloud/config", { enabled: true, baseURL: stub.base + "/s", model: "probe-stream", apiKey: CLOUD_KEY }, TOKEN, 15000);
    ok("S0 配置就绪（enabled/ready）", saveS.status === 200 && saveS.data && saveS.data.ready === true, "ready=" + (saveS.data && saveS.data.ready));
    const s1 = await sseTimed("/api/code/review/cloud", { code: CODE, lang: "javascript", file: "probe-stream.js", intent: "复核", confirm: stub.host }, TOKEN, 60000);
    const sTypes = typesOf(s1.events);
    const sMeta = s1.events[idxOf(s1.events, "meta")] || {};
    const sFind = s1.events[idxOf(s1.events, "findings")] || {};
    const sDone = s1.events[idxOf(s1.events, "done")] || {};
    const sDeltas = s1.events.filter((e) => e.type === "delta");
    const firstDeltaAt = sDeltas.length ? sDeltas[0].t : 0;
    const deltaText = sumDelta(s1.events);
    console.log("  事件序列: " + sTypes.join(" -> ").slice(0, 220));
    ok("S1 200 + text/event-stream", s1.status === 200 && /text\/event-stream/i.test(s1.ct), "HTTP " + s1.status + " " + (s1.ms / 1000).toFixed(2) + "s");
    ok("S2 meta 首 + provider=cloud + host 正确 + streaming:true", idxOf(s1.events, "meta") === 0 && sMeta.provider === "cloud" && String(sMeta.host || "") === stub.host && sMeta.streaming === true, "provider=" + sMeta.provider + " host=" + sMeta.host + " streaming=" + sMeta.streaming);
    ok("S3 delta 段数 = stub 块数（12）", sDeltas.length === STUB_STREAM_CHUNKS, "deltas=" + sDeltas.length);
    ok("S4 delta 拼接 = stub 全文", norm(deltaText) === norm(STUB_TEXT), "deltaLen=" + deltaText.length + " stubLen=" + STUB_TEXT.length);
    ok("S5 首个 delta 在 stub 最后一块之前到达（真流式，不是等整段）", firstDeltaAt > 0 && stub.lastSendAt > 0 && firstDeltaAt < stub.lastSendAt, "firstDeltaAt-" + s1.t0 + "ms=" + (firstDeltaAt - s1.t0) + " stubDurMs=" + (stub.lastSendAt - stub.firstSendAt));
    ok("S6 端到端耗时接近 stub 发送时长（< stubDur + 1500ms）", stub.lastSendAt - stub.firstSendAt > 0 && s1.ms < (stub.lastSendAt - stub.firstSendAt) + 1500, "ms=" + s1.ms);
    ok("S7 findings parsed=true 且 issues>=1", Boolean(sFind.parsed) && Array.isArray(sFind.issues) && sFind.issues.length >= 1, "parsed=" + sFind.parsed + " n=" + (Array.isArray(sFind.issues) ? sFind.issues.length : "null"));
    ok("S8 done.seconds>0 且 done 在 findings 之后", Number(sDone.seconds) > 0 && idxOf(s1.events, "done") > idxOf(s1.events, "findings"), "seconds=" + sDone.seconds);

    // ---------- R. 推理型重试 ----------
    console.log("\n== R. 推理型重试（reasoning 流 → retry → content 流） ==");
    await jsonReq("/api/cloud/config", { baseURL: stub.base + "/r", model: "probe-stream" }, TOKEN, 15000);
    const r1 = await sseTimed("/api/code/review/cloud", { code: CODE, file: "probe-stream.js", intent: "复核", confirm: stub.host, max_tokens: 1200 }, TOKEN, 60000);
    const rTypes = typesOf(r1.events);
    const rRetryIdx = idxOf(r1.events, "retry");
    const rFindIdx = idxOf(r1.events, "findings");
    const rMetaLast = [...r1.events].reverse().find((e) => e.type === "meta") || {};
    const rDeltasAfterRetry = r1.events.filter((e, i) => e.type === "delta" && i > rRetryIdx).map((e) => String(e.text || "")).join("");
    const rFind = r1.events[rFindIdx] || {};
    console.log("  事件序列: " + rTypes.join(" -> ").slice(0, 260));
    ok("R1 200 + SSE", r1.status === 200 && /text\/event-stream/i.test(r1.ct), "HTTP " + r1.status);
    ok("R2 出现 retry 事件且在 findings 之前", rRetryIdx > 0 && rRetryIdx < rFindIdx, "retryIdx=" + rRetryIdx + " findIdx=" + rFindIdx);
    ok("R3 最终 meta.attempts>=2 且 thinkingDisabled=false", Number(rMetaLast.attempts) >= 2 && rMetaLast.thinkingDisabled === false, "attempts=" + rMetaLast.attempts + " thinkingDisabled=" + rMetaLast.thinkingDisabled);
    ok("R4 retry 之后的 delta 拼接 = attempt3 的 content", norm(rDeltasAfterRetry) === norm(STUB_TEXT), "len=" + rDeltasAfterRetry.length);
    ok("R5 findings parsed=true 且 issues>=1", Boolean(rFind.parsed) && Array.isArray(rFind.issues) && rFind.issues.length >= 1, "parsed=" + rFind.parsed + " n=" + (Array.isArray(rFind.issues) ? rFind.issues.length : "null"));
    ok("R6 stub 被请求 >=2 次（attempt1 + attempt3）", stub.modeHits.r >= 2, "r_hits=" + stub.modeHits.r);
    ok("R7 done 最后且 seconds>0", (() => { const last = r1.events[r1.events.length - 1] || {}; return last.type === "done" && Number(last.seconds) > 0; })(), "last=" + ((r1.events[r1.events.length - 1] || {}).type));

    // ---------- N. 非 SSE 兜底 ----------
    console.log("\n== N. 非 SSE 兜底（老网关返回整段 JSON） ==");
    await jsonReq("/api/cloud/config", { baseURL: stub.base + "/n", model: "probe-stream" }, TOKEN, 15000);
    const n1 = await sseTimed("/api/code/review/cloud", { code: CODE, file: "probe-stream.js", confirm: stub.host }, TOKEN, 60000);
    const nFind = n1.events[idxOf(n1.events, "findings")] || {};
    ok("N1 200 + SSE", n1.status === 200 && /text\/event-stream/i.test(n1.ct), "HTTP " + n1.status);
    ok("N2 delta >=2 段（按 80 字补发）", n1.events.filter((e) => e.type === "delta").length >= 2, "deltas=" + n1.events.filter((e) => e.type === "delta").length);
    ok("N3 delta 拼接 = stub 全文", norm(sumDelta(n1.events)) === norm(STUB_TEXT), "len=" + sumDelta(n1.events).length);
    ok("N4 findings parsed=true 且 issues>=1", Boolean(nFind.parsed) && Array.isArray(nFind.issues) && nFind.issues.length >= 1, "parsed=" + nFind.parsed);

    // ---------- E. 空正文 ----------
    console.log("\n== E. 上游 200 但正文/推理都空 ==");
    await jsonReq("/api/cloud/config", { baseURL: stub.base + "/e", model: "probe-stream" }, TOKEN, 15000);
    const e1 = await sseTimed("/api/code/review/cloud", { code: CODE, file: "probe-stream.js", confirm: stub.host }, TOKEN, 60000);
    ok("E1 502 + CLOUD_EMPTY + 非 SSE（不是 200 空正文）", e1.status === 502 && respCode(e1) === "CLOUD_EMPTY" && !/text\/event-stream/i.test(e1.ct), "HTTP " + e1.status + " code=" + respCode(e1));
    ok("E2 错误文案提到 finish_reason", /finish_reason/i.test(errText(e1)), errText(e1).slice(0, 120));
  } finally {
    // ---------- Z. 收尾 ----------
    console.log("\n== Z. 收尾 ==");
    await jsonReq("/api/cloud/config", { enabled: false, apiKey: "" }, TOKEN, 15000);
    await stopStub();
    let restored = null;
    if (cloudCfgBackup !== null) {
      try { fs.writeFileSync(CLOUD_CFG_FILE, cloudCfgBackup, "utf8"); restored = true; } catch { restored = false; }
    }
    const cfgZ = (await jsonReq("/api/cloud/config")).data || {};
    const sameAsBefore = String(cfg0.enabled) === String(cfgZ.enabled) && String(cfg0.hasKey) === String(cfgZ.hasKey) && String(cfg0.host) === String(cfgZ.host);
    ok("Z1 云端配置已恢复（与开跑前一致）", sameAsBefore, JSON.stringify({ before: [cfg0.enabled, cfg0.hasKey, cfg0.host], after: [cfgZ.enabled, cfgZ.hasKey, cfgZ.host], restored }));
    ok("Z2 stub 已关闭", stub.server === null, "server=" + String(stub.server));
  }

  console.log("\n== 结果: " + pass + "/" + (pass + fail) + " 通过" + (failedNames.length ? "（失败: " + failedNames.join(" / ") + "）" : "") + " ==");
  console.log("RESULT " + pass + "/" + (pass + fail));
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.log("\n探针异常: " + String((e && e.stack) || e));
  console.log("RESULT " + pass + "/" + (pass + fail));
  process.exit(2);
});

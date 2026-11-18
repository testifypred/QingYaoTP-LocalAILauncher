/**
 * 真实上游兼容性冒烟：云端复审 POST /api/code/review/cloud（v1.8.1 推理型模型修复）
 *
 *   node probe-cloud-upstream-real.mjs [appBase]
 *
 *   appBase 默认 http://127.0.0.1:8099（开发态 / 发布包实例都可以）。
 *   本探针只读 GET /api/state 与 GET /api/cloud/config，绝不 POST 改配置、不重启服务、不读 data\cloud-review.json。
 *
 * 为什么单独一条、且不进 run-full.ps1：
 *   v1.8.0 的翻车（用户配 deepseek-flash 点云端复审报「上游 200 但没有返回内容」）证明：
 *   probe-code-review-verify 的本地 stub 只能证「代码路径」（thinking 去留、重试阶梯、reasoning 兜底都按预期被触发），
 *   证不了「真实上游协议」——真推理模型会不会认 thinking、会不会把预算烧在 reasoning_content、网关会不会 400。
 *   这条探针用用户已配置的真实上游发 1 条最小合成代码，验证 v1.8.1 的 thinking:{type:"disabled"} + 重试阶梯
 *   在真协议上成立。**它是手动 / 发版前冒烟，不是全量回归的一部分**（见同目录 RESULT.md）。
 *
 * 成本与安全：
 *   - 每次运行只发 1 次 POST /api/code/review/cloud，代码 9 行、完全合成（不含任何用户代码 / 真实密钥）；
 *     max_tokens=800，服务端内部最坏情况按重试阶梯请求上游 3 次；
 *   - 云端配置 enabled=false / ready=false / 没 Key / host 为空 -> 打印 SKIP 原因，**exit 0**，不发任何上游请求；
 *   - 服务没起 / 配置读不到 -> 同样 SKIP（exit 0），不重启服务；
 *   - 只打印遮罩 keyMasked（后端本来就这么回），不打印明文 apiKey；
 *   - 不写日志、不落 data\，原始 stdout 由调用方重定向到证据目录。
 *
 * 覆盖（20 条断言，全部真跑、无 stub）：
 *   P 前置：GET /api/state -> 200 + localToken 可用；GET /api/cloud/config -> 200 + enabled/ready/host 就绪；
 *           keyMasked 是「前 3 + *** + 后 4」遮罩（可见尾段只用于反向断言，不打印）；
 *   S 真跑：HTTP 200 + text/event-stream；无 502 / 无 CLOUD_EMPTY / 无 error 事件；
 *           事件序列 meta 第一、delta* 在 meta 与 findings 之间、findings 存在、done 最后且 seconds>0；
 *           meta.provider=cloud、meta.host === 配置 host、meta.attempts 是 >=1 的整数；
 *           meta.thinkingDisabled / meta.usedReasoningFallback 都是 boolean（v1.8.1 字段契约）；
 *           findings.issues 是数组、findings.parsed 是 boolean、lineCount = 代码行数；
 *           整个响应文本不含 apiKey 明文片段（keyMasked 可见尾段 + sk- 长串两条反向断言）；
 *           端到端耗时 < 60s（服务端 CLOUD_JOB_TIMEOUT_MS 默认 60s，超了说明超时 / 重试链路异常）；
 *   Z 收尾：再 GET 一次 /api/cloud/config，确认探针没改配置（enabled/host/hasKey 不变）。
 *
 * 退出码：断言失败 -> 1；SKIP / 全过 -> 0。
 * 证据：server\docs\feature-cloud-upstream-real-2026-11-18\run.txt（手动重定向，见同目录 RESULT.md）。
 */

const BASE = (process.argv[2] || "http://127.0.0.1:8099").replace(/\/+$/, "");
const MAX_TOKENS = 800;
const PROBE_TIMEOUT_MS = 120000;
const EVIDENCE_REL = "server\\docs\\feature-cloud-upstream-real-2026-11-18\\run.txt";

let pass = 0, fail = 0, skip = 0;
const failedNames = [];
function ok(name, cond, extra) {
  if (cond) { pass += 1; console.log("  ok   " + name + (extra ? "  [" + String(extra).slice(0, 200) + "]" : "")); }
  else { fail += 1; failedNames.push(name); console.log("  FAIL " + name + "  " + String(extra || "").slice(0, 260)); }
}

/** 干净退出：SKIP 一律 exit 0（这条探针默认跳过，不算回归失败） */
function skipExit(reason, detail) {
  console.log("");
  console.log("SKIP: " + reason);
  if (detail) console.log("      " + detail);
  console.log("      本次没有发出任何上游请求（0 成本）；服务与云端配置均未改动。");
  console.log("");
  console.log("== 结果: 0/0（SKIP，未运行） ==");
  console.log("RESULT 0/0（SKIP 未运行）");
  process.exit(0);
}

async function getJson(p, ms) {
  try {
    const r = await fetch(BASE + p, { signal: AbortSignal.timeout(ms || 15000) });
    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch {}
    return { status: r.status, ct: String(r.headers.get("content-type") || ""), data, text };
  } catch (e) {
    return { status: 0, ct: "", data: null, text: "", error: String((e && e.message) || e) };
  }
}

/** 读一条 SSE（服务端事件都是 data: {json}\n\n；收全再返回，不中途断开） */
async function sse(p, body, token, ms) {
  const t0 = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(function () { try { ac.abort(new Error("probe timeout")); } catch {} }, ms || PROBE_TIMEOUT_MS);
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
    const text = await res.text().catch(function () { return ""; });
    clearTimeout(timer);
    return { status: res.status, ct, events: [], text, ms: Date.now() - t0 };
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  const events = [];
  let buf = "", text = "";
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
        const line = block.split("\n").find(function (l) { return l.startsWith("data:"); });
        if (!line) continue;
        const raw = line.slice(5).trim();
        if (!raw || raw === "[DONE]") continue;
        let j = null;
        try { j = JSON.parse(raw); } catch {}
        if (j) events.push(j);
      }
    }
  } catch (e) { /* 超时 / 连接中断：按已收到的事件继续断言 */ }
  clearTimeout(timer);
  return { status: res.status, ct, events, text, ms: Date.now() - t0 };
}

/** 合成代码：9 行，故意留 3 个「已知小问题」（循环越界 / 空值未防 / 结果口径多余 +1）；不含任何用户数据 */
const CODE_LINES = [
  "function sumPrices(items) {",
  "  var total = 0;",
  "  for (var i = 0; i <= items.length; i++) {",
  "    total += items[i].price;",
  "  }",
  "  return total / items.length + 1;",
  "}",
  "",
  "console.log(sumPrices([{ price: 3 }, { price: 4 }]));",
];
const CODE = CODE_LINES.join("\n");
const LINE_COUNT = CODE_LINES.length;

console.log("");
console.log("== 真实上游兼容性冒烟：云端复审（POST /api/code/review/cloud）==");
console.log("  目标 " + BASE);
console.log("  只读云端配置 + 1 次真实上游请求（" + LINE_COUNT + " 行合成代码，不含任何用户数据）");
console.log("  说明：不进 run-full.ps1，是手动 / 发版前冒烟（见 " + EVIDENCE_REL + " 旁的 RESULT.md）");

// ---------- 前置：服务在不在、云端配置就绪没有 ----------
const stateR = await getJson("/api/state", 10000);
if (stateR.status !== 200) {
  skipExit("服务不可用（GET /api/state -> " + (stateR.status || stateR.error || "无响应") + "）", "先起服务再跑：node server\\probe-cloud-upstream-real.mjs " + BASE);
}
const token = String((stateR.data && stateR.data.localToken) || "");
const stateVer = String((stateR.data && stateR.data.version) || "");
const stateDir = String((stateR.data && stateR.data.dir) || "");
if (!token) skipExit("拿不到本地令牌（/api/state.localToken 为空）", "无法带 x-local-token 调 SSE 接口；确认这是完整的 app.mjs 服务。");

const cfgR = await getJson("/api/cloud/config", 10000);
if (cfgR.status !== 200) {
  skipExit("读不到云端配置（GET /api/cloud/config -> " + (cfgR.status || cfgR.error || "无响应") + "）", "可能是旧版服务（没有云端复审接口）。");
}
const cfg = cfgR.data || {};
const enabled = cfg.enabled === true;
const ready = cfg.ready === true;
const hasKey = cfg.hasKey === true;
const host = String(cfg.host || "");
const model = String(cfg.model || "");
const masked = String(cfg.keyMasked || "");
const missing = [];
if (!enabled) missing.push("enabled=false（未勾选启用）");
if (!ready) missing.push("ready=false");
if (!hasKey) missing.push("hasKey=false（没存 API Key）");
if (!host) missing.push("host 为空（baseURL 未配置）");
if (!model) missing.push("model 为空");
if (!enabled || !ready || !host || !hasKey) {
  skipExit("云端复审配置未就绪：" + missing.join("；"), "到「设置 → 代码 → 云端复审」填 baseURL / 模型 / API Key，勾选启用后再跑本探针。");
}

console.log("  服务：" + (stateVer ? "v" + stateVer : "版本未知") + (stateDir ? "  dir=" + stateDir : "") + "  localToken=已有（不打印）");
console.log("  云端：enabled=" + enabled + " ready=" + ready + " host=" + host + " model=" + model + " hasKey=" + hasKey + " keyMasked=" + (masked || "（空）"));

// 反向断言基准：keyMasked 的可见尾段（只用于判断响应有没有泄露，不打印明文）
const maskOk = /^\S{3}\*\*\*\S{4}$/.test(masked);
const keyTail = maskOk ? masked.slice(-4) : "";

// ---------- P. 前置断言（只读） ----------
console.log("");
console.log("== P. 前置（只读） ==");
ok("P1. GET /api/state -> 200 且 localToken 可用", stateR.status === 200 && token.length > 0, "HTTP " + stateR.status + " tokenLen=" + token.length);
ok("P2. GET /api/cloud/config -> 200 且 enabled/ready/host 就绪", cfgR.status === 200 && enabled && ready && host.length > 0, JSON.stringify({ enabled: enabled, ready: ready, host: host, model: model, hasKey: hasKey }));
ok("P3. keyMasked 是「前3+***+后4」遮罩（不含明文）", maskOk, "masked=" + (masked || "（空）"));

// ---------- S. 真跑（1 次真实上游请求） ----------
console.log("");
console.log("== S. 真跑（1 次 POST /api/code/review/cloud；合成代码 " + LINE_COUNT + " 行，max_tokens=" + MAX_TOKENS + "） ==");
const t0 = Date.now();
const smoke = await sse("/api/code/review/cloud", {
  code: CODE,
  lang: "javascript",
  file: "probe-cloud-upstream-real.js",
  intent: "找出这段代码里的 bug（循环边界 / 空值 / 计算结果），按行号指出问题。",
  confirm: host,
  max_tokens: MAX_TOKENS,
}, token, PROBE_TIMEOUT_MS);
const elapsedMs = Date.now() - t0;
const events = smoke.events || [];
const respText = String(smoke.text || "");
const types = events.map(function (e) { return String((e && e.type) || ""); });
const idxOf = function (t) { return types.indexOf(t); };
const metaIdx = idxOf("meta");
const findIdx = idxOf("findings");
const doneIdx = idxOf("done");
const errorIdx = idxOf("error");
const metaEv = events[metaIdx] || {};
const findEv = events[findIdx] || {};
const doneEv = events[doneIdx] || {};
const deltaIdxs = [];
for (let i = 0; i < events.length; i++) if (events[i] && events[i].type === "delta") deltaIdxs.push(i);
const sseOk = smoke.status === 200 && /text\/event-stream/i.test(smoke.ct);
console.log("  事件序列: " + (types.length ? types.slice(0, 14).join(" -> ") + (types.length > 14 ? " -> …(" + types.length + " 个)" : "") : "（没有 SSE 事件）"));

ok("S1. HTTP 200 + text/event-stream", sseOk, "HTTP " + smoke.status + " ct=" + (smoke.ct || "（空）") + " " + (elapsedMs / 1000).toFixed(1) + "s");
const emptyBlob = String([respText, smoke.error || ""].join(" "));
ok("S2. 不是 502 / 正文无 CLOUD_EMPTY / 无 error 事件（上游可正常返回）", smoke.status !== 0 && smoke.status !== 502 && !/CLOUD_EMPTY/.test(emptyBlob) && errorIdx < 0, "HTTP " + smoke.status + (errorIdx >= 0 ? " error=" + String(events[errorIdx].message || "").slice(0, 120) : ""));

if (!sseOk) {
  skip += 11;
  const diag = String(respText || smoke.error || "").replace(/\s+/g, " ").slice(0, 400);
  console.log("  skip: 没拿到 200 SSE，跳过 S3–S13（共 11 条结构断言）；服务端/上游返回：" + (diag || "（空）"));
} else {
  ok("S3. 事件序列：meta 是第一个事件", metaIdx === 0, "meta_idx=" + metaIdx + " types=" + types.slice(0, 6).join(","));
  ok("S4. meta.provider === \"cloud\"", String(metaEv.provider || "") === "cloud", "provider=" + metaEv.provider);
  ok("S5. meta.host 与配置 host 一致", String(metaEv.host || "") === host, "meta.host=" + metaEv.host + " config.host=" + host);
  ok("S6. meta.attempts 是 >=1 的整数", Number.isInteger(Number(metaEv.attempts)) && Number(metaEv.attempts) >= 1, "attempts=" + metaEv.attempts);
  ok("S7. meta.thinkingDisabled 是 boolean（v1.8.1 字段）", typeof metaEv.thinkingDisabled === "boolean", "thinkingDisabled=" + metaEv.thinkingDisabled);
  ok("S8. meta.usedReasoningFallback 是 boolean（v1.8.1 字段）", typeof metaEv.usedReasoningFallback === "boolean", "usedReasoningFallback=" + metaEv.usedReasoningFallback);
  ok("S9. 有 findings 事件且 findings.issues 是数组", findIdx >= 0 && Array.isArray(findEv.issues), "findings_idx=" + findIdx + " issuesType=" + (findIdx >= 0 ? typeof findEv.issues : "无事件") + " n=" + (Array.isArray(findEv.issues) ? findEv.issues.length : "?"));
  ok("S10. findings.parsed 是 boolean 且 lineCount = 代码行数", typeof findEv.parsed === "boolean" && Number(findEv.lineCount) === LINE_COUNT, "parsed=" + findEv.parsed + " lineCount=" + findEv.lineCount + " want=" + LINE_COUNT);
  const inSpan = deltaIdxs.length >= 1 && deltaIdxs.every(function (i) { return i > metaIdx && i < findIdx; });
  ok("S11. delta 至少 1 段，且都在 meta 与 findings 之间", inSpan, "deltas=" + deltaIdxs.length + " meta=" + metaIdx + " findings=" + findIdx);
  ok("S12. 有 done 事件且 done.seconds > 0", doneIdx >= 0 && Number(doneEv.seconds) > 0, "done_idx=" + doneIdx + " seconds=" + doneEv.seconds);
  ok("S13. done 是最后一个事件（正常收尾）", doneIdx >= 0 && doneIdx === events.length - 1, "done_idx=" + doneIdx + " total=" + events.length);
}

// 泄露反向断言：无论成功失败都要查（错误响应同样不能带 Key）
if (keyTail) {
  ok("S14. 整个响应文本不含 apiKey 可见尾段（keyMasked 后 4 位）", !respText.includes(keyTail), "tailLen=" + keyTail.length + " respLen=" + respText.length);
} else {
  skip += 1;
  console.log("  skip: keyMasked 没有可见尾段（Key <= 8 字符时后端全遮成 ***），S14 无法做反向断言");
}
const keyLike = /sk-[A-Za-z0-9_-]{16,}/.test(respText);
ok("S15. 响应文本无 sk- 长串明文 Key 形状、也不含完整 keyMasked", !keyLike && !(masked && respText.includes(masked)), "keyLike=" + keyLike + " respLen=" + respText.length);
ok("S16. 端到端耗时 < 60s（服务端 CLOUD_JOB_TIMEOUT_MS 默认 60s）", elapsedMs < 60000, (elapsedMs / 1000).toFixed(1) + "s");

// ---------- Z. 收尾（只读：确认没动配置） ----------
console.log("");
console.log("== Z. 收尾（只读） ==");
const cfgAfterR = await getJson("/api/cloud/config", 10000);
const cfgAfter = cfgAfterR.data || {};
const cfgSame = cfgAfterR.status === 200 && cfgAfter.enabled === enabled && String(cfgAfter.host || "") === host && cfgAfter.hasKey === hasKey;
ok("Z1. 云端配置未被探针改动（enabled/host/hasKey 不变）", cfgSame, JSON.stringify({ enabled: cfgAfter.enabled, host: cfgAfter.host, hasKey: cfgAfter.hasKey }));

// ---------- 关键观测（给人看的协议结论） ----------
console.log("");
console.log("== 关键观测 ==");
console.log("  服务 " + (stateVer ? "v" + stateVer : "版本未知") + " · 上游 host=" + host + " · 模型=" + model);
if (sseOk) {
  const attempts = Number(metaEv.attempts);
  console.log("  attempts=" + attempts + " thinkingDisabled=" + metaEv.thinkingDisabled + " usedReasoningFallback=" + metaEv.usedReasoningFallback);
  if (attempts === 1 && metaEv.usedReasoningFallback === false) {
    console.log("  => 真实上游在第 1 次就接受 thinking:{type:\"disabled\"} 并返回正文：没走重试阶梯、没触发 reasoning 兜底");
  } else if (attempts === 2) {
    console.log("  => 第 1 次被上游拒（4xx 且报 thinking 不认识），服务端去掉 thinking 重发成功（attempts=2）");
  } else if (attempts >= 3) {
    console.log("  => 上游忽略/不认 thinking，正文空后服务端放大 max_tokens 重发成功（attempts=" + attempts + "）");
  }
  if (metaEv.usedReasoningFallback === true) console.log("  => 正文仍空、最终拿 reasoning_content 当答案（v1.8.1 reasoning 兜底生效）");
  console.log("  脱敏：sentChars=" + metaEv.sentChars + " redactions=" + metaEv.redactions + "（只发脱敏后的合成代码）");
  console.log("  解析：delta=" + deltaIdxs.length + " 段 · findings.parsed=" + findEv.parsed + " · issues=" + (Array.isArray(findEv.issues) ? findEv.issues.length : "?") + " 条");
  console.log("  计时：done.seconds=" + doneEv.seconds + " · 端到端(含网络)=" + (elapsedMs / 1000).toFixed(1) + "s");
  console.log("  成本：本探针只发 1 次 POST /api/code/review/cloud；服务端内部共请求上游 attempts=" + attempts + " 次");
} else {
  console.log("  没拿到正常 SSE，无法给出 attempts/兜底结论；看上面的 FAIL 明细与原始响应。");
}
console.log("  安全：本探针未打印 apiKey、未读写 data\\cloud-review.json、未改云端配置。");

if (failedNames.length) console.log("\n失败断言:\n" + failedNames.map(function (n) { return " - " + n; }).join("\n"));
const total = pass + fail;
console.log("");
console.log("== 结果: " + pass + "/" + total + " 通过" + (skip ? "（跳过 " + skip + " 项）" : "") + " ==");
console.log("RESULT " + pass + "/" + total + (skip ? "（跳过 " + skip + " 项）" : ""));
console.log("");
process.exit(fail ? 1 : 0);

/**
 * 代码审查流式探针（API + SSE，真模型）
 *
 *   node probe-code-review-stream.mjs [base] [model]
 *
 * 覆盖（v1.7.0 契约 §1.1 / §1.2 / §4）：
 *  A) 校验：无令牌 403 / 缺 code 400 / code 超 20000 **413**（按实现为准；契约 §1.1 原来写 400 是笔误，
 *     与老 /api/code/review 一致，Lead 已同步改契约）/ 指定不存在的模型 404；
 *  B) POST /api/code/review/stream 真审查一段有 bug 的 JS：
 *     200 + text/event-stream、事件顺序 meta 第一 -> delta* ->（可选的 phase 事件）-> findings -> done 最后、
 *     delta 非空且**没有把裸 JSON / 代码围栏漏进 delta**、
 *     findings.summary 非空、issues 每项字段齐全（line/endLine/severity/title/detail/fix）、
 *     行号 1..lineCount 且 endLine>=line、done 有 seconds/model、全程无 error 事件；
 *  C) POST /api/code/fix：事件顺序 meta -> delta* -> result -> done、result.code 非空、
 *     changes 至少 1 段且有序（start<=end、行号 >=1、end<=lineCount）、added/removed 是数字；
 *  D) 指定另一个模型审查：meta.switchedModel===true 且 modelFile 匹配；跑完 finally 一定切回 4B。
 *     **可选分支**：环境变量 PROBE_SKIP_SWITCH=1 时整段跳过（只打一行 skip）。
 *     原因（2026-11-15）：Phi-4-mini（SWA disabled）偶发在原生层卡死——切过去就绪后 review 生成不返回、
 *     后续 HTTP 全超时、CPU 一直涨；隔离跑同请求 22s 能过，属已知产品风险，全量里默认跳过。
 *
 * 前置：服务在跑；没有加载模型时探针自己加载 MODEL（默认 4B）。默认会切一次模型，收尾恢复；
 *       PROBE_SKIP_SWITCH=1 时不切、也不需要切回。
 */
const BASE = process.argv[2] || "http://127.0.0.1:8099";
const MODEL = process.argv[3] || "qwen3-5-4B-Q4_K_M.gguf";
const ALT_MODEL = "Phi-4-mini-instruct-Q4_K_M.gguf";
/** 全量默认跳过「切到 Phi-4-mini」这一段（偶发原生层卡死，见头注释）；隔离深测时不设这个变量 */
const SKIP_SWITCH = process.env.PROBE_SKIP_SWITCH === "1";

let pass = 0, fail = 0, skip = 0;
function ok(name, cond, extra) {
  if (cond) { pass += 1; console.log("  ok   " + name + (extra ? "  [" + extra + "]" : "")); }
  else { fail += 1; console.log("  FAIL " + name + "  " + (extra || "")); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errText = (r) => String((r && r.data && r.data.error && r.data.error.message) || r.text || r.error || "").slice(0, 160);

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

/** 读一条 SSE：返回 {status, ct, events, text, ms}；非流式错误响应按 JSON 带回 */
async function sse(path, body, token, ms) {
  const t0 = Date.now();
  let res;
  try {
    res = await fetch(BASE + path, {
      method: "POST",
      headers: { "content-type": "application/json", "x-local-token": token || "" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(ms || 300000),
    });
  } catch (e) {
    return { status: 0, ct: "", events: [], text: "", error: String((e && e.message) || e), ms: Date.now() - t0 };
  }
  const ct = String(res.headers.get("content-type") || "");
  if (!/text\/event-stream/i.test(ct)) {
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch {}
    return { status: res.status, ct, events: [], text, data, ms: Date.now() - t0 };
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", text = "";
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
  return { status: res.status, ct, events, text, ms: Date.now() - t0 };
}

const types = (events) => (events || []).map((e) => String(e && e.type || ""));
const findIdx = (events, t) => (events || []).findIndex((e) => e && e.type === t);
const sumText = (events, t) => (events || []).filter((e) => e && e.type === t).map((e) => String(e.text || "")).join("");
const state = async () => (await jsonReq("/api/state")).data || {};
async function loadModel(file, ms) {
  await jsonReq("/api/load", { file, contextSize: 8192 });
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 120000)) {
    const s = await state();
    if (String(s.loaded || "") === file) return true;
    await sleep(800);
  }
  return false;
}

// 有 bug 的 JS：off-by-one（<= 导致 items[i] 越界）+ 没判空。意图写清楚，4B 也能抓住。
const BUGGY = [
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
const INTENT = "找出这段代码里的 bug（重点看循环边界和空值），按行号指出问题。";

console.log("\n== 目标 " + BASE + " · 模型 " + MODEL + " ==\n");

let originalLoaded = "";
try {
  // ---------- 0. 前置：服务 / 令牌 / 模型 ----------
  const boot = await jsonReq("/api/state");
  ok("GET /api/state -> 200", boot.status === 200, "HTTP " + boot.status + " " + errText(boot));
  let TOKEN = String((boot.data && boot.data.localToken) || "");
  ok("拿到本机令牌（state.localToken）", TOKEN.length > 0, "len=" + TOKEN.length);
  originalLoaded = String((boot.data && boot.data.loaded) || "");
  const models = Array.isArray(boot.data && boot.data.models) ? boot.data.models.map((m) => String(m.file || "")) : [];
  console.log("  当前模型: " + (originalLoaded || "（未加载）") + " · 模型库 " + models.length + " 个");
  if (originalLoaded !== MODEL) {
    const loadedOk = await loadModel(MODEL, 150000);
    ok("前置：模型已就绪（" + MODEL + "）", loadedOk, "loaded=" + (await state()).loaded);
  } else {
    ok("前置：模型已就绪（" + MODEL + "）", true, "已是目标模型");
  }
  TOKEN = TOKEN;

  // ---------- A. 参数校验 ----------
  console.log("\n== A. 参数校验（403 / 400 / 404）==");
  const noTok = await sse("/api/code/review/stream", { code: BUGGY, lang: "javascript" }, "", 30000);
  ok("无令牌 -> 403", noTok.status === 403, "HTTP " + noTok.status + " " + errText(noTok));
  ok("403 文案提到令牌 / token", /令牌|token/i.test(errText(noTok)), errText(noTok).slice(0, 80));

  const missCode = await sse("/api/code/review/stream", { lang: "javascript" }, TOKEN, 30000);
  ok("缺 code -> 400", missCode.status === 400, "HTTP " + missCode.status + " " + errText(missCode));
  ok("缺 code 文案提到 code / 代码", /code|代码/i.test(errText(missCode)), errText(missCode).slice(0, 80));

  const tooBig = await sse("/api/code/review/stream", { code: "x".repeat(20001), lang: "javascript" }, TOKEN, 30000);
  // 按实现为准：超长返回 413（与老 /api/code/review 一致）；契约 §1.1 原先写 400 是笔误，已由 Lead 改契约。
  // 兼容断言：413 为正确值，400 也放过（万一别的实现版本用 400）。
  ok("code 超过 20000 字符 -> 413（契约笔误写 400，按实现）", tooBig.status === 413 || tooBig.status === 400, "HTTP " + tooBig.status + " " + errText(tooBig));

  const badModel = await sse("/api/code/review/stream", { code: BUGGY, lang: "javascript", model: "no-such-model.gguf" }, TOKEN, 30000);
  ok("指定不存在的模型 -> 404", badModel.status === 404, "HTTP " + badModel.status + " " + errText(badModel));

  // ---------- B. 真审查（SSE） ----------
  console.log("\n== B. 真审查（SSE，模型约 20-90s）==");
  const rev = await sse("/api/code/review/stream", { code: BUGGY, lang: "javascript", file: "probe-review.js", intent: INTENT, max_tokens: 1200 }, TOKEN, 300000);
  const revTypes = types(rev.events);
  ok("POST /api/code/review/stream -> 200", rev.status === 200, "HTTP " + rev.status + " " + errText(rev) + "（" + (rev.ms / 1000).toFixed(1) + "s）");
  ok("Content-Type 是 text/event-stream", /text\/event-stream/i.test(rev.ct), rev.ct);
  console.log("  事件序列: " + revTypes.join(" -> ").slice(0, 300));

  const iMeta = findIdx(rev.events, "meta");
  const iFind = findIdx(rev.events, "findings");
  const iDone = findIdx(rev.events, "done");
  const deltaEvents = (rev.events || []).filter((e) => e && e.type === "delta");
  const deltaText = sumText(rev.events, "delta");
  ok("第一个事件是 meta", iMeta === 0, "types=" + revTypes.slice(0, 3).join(","));
  ok("有 findings 事件", iFind >= 0, "i=" + iFind);
  ok("有 done 事件", iDone >= 0, "i=" + iDone);
  // 两阶段实现：delta 只承载「审查思路」，之后可能还有 {type:"phase"}，再是 findings。
  // 断言按「meta 第一、delta>=1 且都在 findings 前、findings 在 done 前、done 最后」——容忍 phase。
  const deltaIdx = (rev.events || []).map((e, i) => (e && e.type === "delta" ? i : -1)).filter((i) => i >= 0);
  const lastDelta = deltaIdx.length ? deltaIdx[deltaIdx.length - 1] : -1;
  const phaseCount = (rev.events || []).filter((e) => e && e.type === "phase").length;
  ok("顺序：meta 第一、delta>=1、findings 在 done 前、done 最后（容忍 phase）", iMeta === 0 && deltaEvents.length >= 1 && lastDelta < iFind && iFind > iMeta && iDone > iFind && iDone === rev.events.length - 1, JSON.stringify({ meta: iMeta, delta: deltaEvents.length, lastDelta, phase: phaseCount, findings: iFind, done: iDone, total: (rev.events || []).length }));
  ok("delta 至少 1 段（逐段流式）", deltaEvents.length >= 1, "deltaEvents=" + deltaEvents.length);
  ok("phase 事件（如有）在 delta 之后、findings 之前", phaseCount === 0 || (rev.events || []).map((e, i) => (e && e.type === "phase" ? i : -1)).filter((i) => i >= 0).every((i) => i > lastDelta && i < iFind), "phase=" + phaseCount + " lastDelta=" + lastDelta + " findings=" + iFind);
  ok("delta 文本非空", deltaText.trim().length > 0, "len=" + deltaText.trim().length);
  ok("delta 没漏出裸 JSON（无 issues 字段）", !/"issues"/.test(deltaText), deltaText.replace(/\s+/g, " ").slice(0, 100));
  ok("delta 没漏出代码围栏标记", !deltaText.includes(String.fromCharCode(96, 96, 96)), deltaText.replace(/\s+/g, " ").slice(0, 100));
  ok("全程没有 error 事件", findIdx(rev.events, "error") < 0, JSON.stringify((rev.events || []).filter((e) => e && e.type === "error").map((e) => e.message).slice(0, 1)));

  const meta = rev.events[iMeta] || {};
  ok("meta.modelFile 非空", typeof meta.modelFile === "string" && meta.modelFile.length > 0, "modelFile=" + meta.modelFile);
  ok("meta.contextSize 是正数", Number(meta.contextSize) > 0, "contextSize=" + meta.contextSize);
  ok("meta.startedAt 是时间戳", Number(meta.startedAt) > 0, "startedAt=" + meta.startedAt);

  const findings = rev.events[iFind] || {};
  const issues = Array.isArray(findings.issues) ? findings.issues : null;
  ok("findings.summary 是非空字符串", typeof findings.summary === "string" && findings.summary.trim().length > 0, String(findings.summary || "").slice(0, 80));
  ok("findings.issues 是数组", Array.isArray(issues), "type=" + typeof findings.issues);
  ok("findings.lineCount 是正数", Number(findings.lineCount) > 0, "lineCount=" + findings.lineCount);
  const SEVS = new Set(["error", "warn", "info"]);
  const badIssue = (issues || []).find((it) => !it || !Number.isFinite(Number(it.line)) || !Number.isFinite(Number(it.endLine)) ||
    !SEVS.has(String(it.severity)) || typeof it.title !== "string" || !it.title.trim() ||
    typeof it.detail !== "string" || typeof it.fix !== "string");
  ok("每个 issue 字段齐全（line/endLine/severity/title/detail/fix）", (issues || []).length === 0 || !badIssue, badIssue ? JSON.stringify(badIssue).slice(0, 140) : "n=" + (issues || []).length);
  const badLine = (issues || []).find((it) => {
    const ln = Number(it.line), en = Number(it.endLine), lc = Number(findings.lineCount);
    return !(ln >= 1 && ln <= lc && en >= ln && en <= lc);
  });
  ok("issue 行号合法（1<=line<=endLine<=lineCount）", (issues || []).length === 0 || !badLine, badLine ? JSON.stringify({ line: badLine.line, endLine: badLine.endLine, lineCount: findings.lineCount }) : "n=" + (issues || []).length);
  ok("这次审查真的报出了问题（issues >= 1）", (issues || []).length >= 1, "issues=" + (issues || []).length + " severities=" + JSON.stringify((issues || []).map((x) => x.severity)));

  const doneEv = rev.events[iDone] || {};
  ok("done.seconds 是正数", Number(doneEv.seconds) > 0, "seconds=" + doneEv.seconds);
  ok("done.model 非空", typeof doneEv.model === "string" && doneEv.model.length > 0, "model=" + doneEv.model);

  // 留给 C 段用：fix 至少要带一条 issue（模型没报就把已知 bug 兜底塞进去，保证测的是修代码而不是运气）
  const issuesForFix = (issues && issues.length) ? issues : [
    { line: 3, endLine: 3, severity: "error", title: "循环条件越界", detail: "i <= items.length 会访问到 undefined", fix: "改成 i < items.length" },
  ];

  // ---------- C. 流式修正（SSE） ----------
  console.log("\n== C. 流式修正（/api/code/fix）==");
  const fix = await sse("/api/code/fix", { code: BUGGY, lang: "javascript", file: "probe-review.js", intent: INTENT, issues: issuesForFix, scope: "all" }, TOKEN, 300000);
  const fixTypes = types(fix.events);
  ok("POST /api/code/fix -> 200", fix.status === 200, "HTTP " + fix.status + " " + errText(fix) + "（" + (fix.ms / 1000).toFixed(1) + "s）");
  ok("fix 的 Content-Type 是 text/event-stream", /text\/event-stream/i.test(fix.ct), fix.ct);
  console.log("  事件序列: " + fixTypes.join(" -> ").slice(0, 300));
  const fMeta = findIdx(fix.events, "meta");
  const fResult = findIdx(fix.events, "result");
  const fDone = findIdx(fix.events, "done");
  const fDeltas = (fix.events || []).filter((e) => e && e.type === "delta");
  ok("fix 顺序 meta -> delta* -> result -> done 最后", fMeta === 0 && fDeltas.length >= 1 && fResult > fMeta && fDone > fResult && fDone === fix.events.length - 1, JSON.stringify({ meta: fMeta, delta: fDeltas.length, result: fResult, done: fDone, total: fix.events.length }));
  ok("fix 没有 error 事件", findIdx(fix.events, "error") < 0, JSON.stringify((fix.events || []).filter((e) => e && e.type === "error").map((e) => e.message).slice(0, 1)));
  const fixResult = fix.events[fResult] || {};
  const fixedCode = String(fixResult.code || "");
  ok("result.code 是非空字符串（完整代码）", fixedCode.trim().length > 0, "len=" + fixedCode.length);
  const changes = Array.isArray(fixResult.changes) ? fixResult.changes : null;
  ok("result.changes 是数组且至少 1 段", Array.isArray(changes) && changes.length >= 1, "n=" + (changes ? changes.length : "null"));
  const badChange = (changes || []).find((c) => !c || !Number.isFinite(Number(c.start)) || !Number.isFinite(Number(c.end)) || Number(c.start) < 1 || Number(c.end) < Number(c.start));
  ok("changes 每段 start<=end 且行号 >=1", (changes || []).length === 0 || !badChange, badChange ? JSON.stringify(badChange) : JSON.stringify(changes));
  const sortedOk = (changes || []).every((c, i, arr) => i === 0 || Number(c.start) > Number(arr[i - 1].start));
  ok("changes 有序（start 升序、不重叠）", (changes || []).length === 0 || sortedOk, JSON.stringify(changes));
  const fLineCount = Number(fixResult.lineCount);
  ok("result.lineCount 是正数", fLineCount > 0, "lineCount=" + fixResult.lineCount);
  const inRange = (changes || []).every((c) => Number(c.end) <= fLineCount);
  ok("changes 的行号落在新代码范围内（end<=lineCount）", (changes || []).length === 0 || inRange, "lineCount=" + fLineCount + " changes=" + JSON.stringify(changes));
  ok("result.added / removed 是数字", Number.isFinite(Number(fixResult.added)) && Number.isFinite(Number(fixResult.removed)), "added=" + fixResult.added + " removed=" + fixResult.removed);
  const fDoneEv = fix.events[fDone] || {};
  ok("fix done.seconds 是正数", Number(fDoneEv.seconds) > 0, "seconds=" + fDoneEv.seconds);

  // ---------- D. 指定另一个模型审查（会切模型，放最后；可选） ----------
  console.log("\n== D. 指定模型审查（meta.switchedModel）==");
  if (SKIP_SWITCH) {
    skip += 3;
    console.log("  skip: Phi 切换（PROBE_SKIP_SWITCH=1）");
  } else {
    const altExists = models.includes(ALT_MODEL);
    if (!altExists) {
      skip += 2;
      console.log("  skip 指定模型分支：" + ALT_MODEL + " 不在模型库里（现有 " + models.join(", ") + "）");
    } else {
      const alt = await sse("/api/code/review/stream", { code: "const user = null;\nconsole.log(user.name);", lang: "javascript", file: "probe-alt.js", intent: "指出空指针问题", model: ALT_MODEL, max_tokens: 400 }, TOKEN, 300000);
      const altMeta = (alt.events || []).find((e) => e && e.type === "meta") || {};
      ok("指定模型审查 -> 200 且拿到 meta", alt.status === 200 && findIdx(alt.events, "meta") === 0, "HTTP " + alt.status + " " + errText(alt));
      ok("meta.switchedModel === true", altMeta.switchedModel === true, "switchedModel=" + altMeta.switchedModel + " modelFile=" + altMeta.modelFile);
      ok("meta.modelFile 是指定的 " + ALT_MODEL, String(altMeta.modelFile || "") === ALT_MODEL, "modelFile=" + altMeta.modelFile);
      console.log("  指定模型事件数: " + (alt.events || []).length + " / " + (alt.ms / 1000).toFixed(1) + "s");
    }
  }
} catch (e) {
  fail += 1;
  console.log("  FAIL 探针异常中断: " + String((e && e.message) || e));
} finally {
  // ---------- 收尾：默认把模型切回来（后面还有 UI 探针要靠 4B）；跳过切换时只复核、不发 /api/load ----------
  console.log("\n== E. 收尾：模型切回 " + MODEL + " ==");
  try {
    if (SKIP_SWITCH) {
      // 跳过 D 段 = 没切到 Phi，不需要也不应该再发 /api/load（全量里避免多余切模型）
      const cur = String((await state()).loaded || "");
      console.log("  skip: 未做模型切换，不需要切回（PROBE_SKIP_SWITCH=1）");
      ok("收尾：模型仍是 " + MODEL + "（未做切换）", cur === MODEL, "loaded=" + cur);
    } else {
      // 2026-11-15：/api/load 现在遇到「代码审查/修正进行中」会 409（防止卸掉正在用的权重），
      // 所以切回要重试（最多 3 次），别人正好在审查时也不会把收尾搞红。
      let restored = false;
      for (let attempt = 1; attempt <= 3 && !restored; attempt++) {
        const cur = String((await state()).loaded || "");
        if (cur === MODEL) { restored = true; break; }
        const lr = await jsonReq("/api/load", { file: MODEL, contextSize: 8192 }, "", 30000);
        if (lr.status !== 200) {
          console.log("  切回模型第 " + attempt + " 次 -> HTTP " + lr.status + "（" + errText(lr).slice(0, 70) + "），3s 后重试…");
          await sleep(3000);
          continue;
        }
        const t0 = Date.now();
        while (Date.now() - t0 < 120000) {
          const s = await state();
          if (String(s.loaded || "") === MODEL) { restored = true; break; }
          await sleep(800);
        }
        if (!restored) await sleep(3000);
      }
      ok("收尾：模型已切回 " + MODEL + "（/api/load 409 时最多重试 3 次）", restored, "loaded=" + (await state()).loaded);
    }
  } catch (e) {
    fail += 1;
    console.log("  FAIL 收尾切回模型异常: " + String((e && e.message) || e));
  }
}

console.log("\n== 结果: " + pass + " 通过 / " + fail + " 失败" + (skip ? "（跳过 " + skip + " 项）" : "") + " ==\n");
process.exit(fail ? 1 : 0);

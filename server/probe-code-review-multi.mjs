/**
 * 多文件 / 整工作区一起审查探针（v1.10.0 契约 §4）
 *
 *   node probe-code-review-multi.mjs [base] [cdp] [shotDir]
 *   （参数顺序与 probe-code-review-export 一致：base、cdp、shotDir）
 *
 * 分段（不需要模型的分段必须能在未加载模型时全绿）：
 *   A) 纯函数（直接 import ./code-review-multi.mjs；确定性，不需要服务 / 模型）
 *   B) API plan + 参数校验（不需要模型；403 / 400 / 40 边界 / plan 计数 / 9 个文件 limit）
 *   C) 真模型 SSE（模型没加载 或 接口 404 → skip 并 exit 0）：事件顺序、逐文件 findings 行号、
 *      done.stats 自洽、并发 /api/load 期望 409（锁复用）、跑完服务仍 200
 *   D) 导出 kind=multi（不需要模型）：200 + 文件名 .multi.review.md + 四节 + 跳过清单
 *   E) UI（CDP + 模型；否则 skip）：#cwSelAll/#cwReviewSel/#cwReviewWs/#cwExportMulti、
 *      勾 2 个文件、点「审查选中」出 2 张卡、点卡片头打开文件、导出 #cwExportState
 *
 * 夹具统一 code/probe-multi-<stamp>-*：跑前先清残留、跑后删干净（finally 里再核一遍）。
 * 收尾：还原 localStorage['localai.lastSession'] 并 reload 页面（硬约束：界面探针切过会话必须还原）。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MULTI_MAX_FILES,
  MULTI_PER_FILE_CHARS,
  MULTI_TOTAL_CHARS,
  MULTI_MAX_INPUT_FILES,
  normalizeMultiPaths,
  isUnderCodeDir,
  buildMultiPlan,
  multiReviewPrompt,
  issueLineTexts,
  normalizeCrossFindings,
  multiCrossPrompt,
  aggregateMultiReview,
  buildMultiReviewMarkdown,
} from "./code-review-multi.mjs";

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] || "http://127.0.0.1:8099";
const CDP = process.argv[3] || "http://127.0.0.1:9333";
const OUT = process.argv[4] || path.join(SERVER_DIR, "docs", "feature-review-multi-2026-11-19");
const PORT = (() => { try { return new URL(BASE).port || "8099"; } catch { return "8099"; } })();
const STAMP = Date.now().toString(36);
const FENCE = String.fromCharCode(96, 96, 96);
const FIX_PREFIX = "probe-multi-" + STAMP;
const fx = (name) => "code/" + FIX_PREFIX + "-" + name;

let pass = 0, fail = 0, skip = 0;
const check = (n, c, d) => { if (c) { pass++; console.log("ok   " + n + (d ? "  [" + d + "]" : "")); } else { fail++; console.log("FAIL " + n + "  " + (d || "")); } };
const skipCheck = (n, d) => { skip++; console.log("skip " + n + (d ? "  [" + d + "]" : "")); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const S = (v) => String(v === null || v === undefined ? "" : v);
const types = (evs) => (evs || []).map((e) => S(e && e.type));

async function getJson(p, ms) {
  try {
    const r = await fetch(BASE + p, { signal: AbortSignal.timeout(ms || 15000) });
    const t = await r.text();
    let d = null;
    try { d = JSON.parse(t); } catch {}
    return { status: r.status, data: d, text: t };
  } catch (e) {
    return { status: 0, data: null, text: "", error: S(e && e.message) };
  }
}
async function postJson(p, body, token, ms) {
  try {
    const headers = { "content-type": "application/json" };
    if (token) headers["x-local-token"] = token;
    const r = await fetch(BASE + p, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(ms || 20000) });
    const t = await r.text();
    let d = null;
    try { d = JSON.parse(t); } catch {}
    return { status: r.status, data: d, text: t };
  } catch (e) {
    return { status: 0, data: null, text: "", error: S(e && e.message) };
  }
}

/** 读一条 SSE：边读边解析（onEvent 用于「审查中并发打 /api/load」这类断言）；非流式错误按 JSON 带回 */
async function sse(p, body, token, ms, onEvent) {
  const t0 = Date.now();
  let res;
  try {
    res = await fetch(BASE + p, {
      method: "POST",
      headers: { "content-type": "application/json", "x-local-token": token || "" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(ms || 300000),
    });
  } catch (e) {
    return { status: 0, ct: "", events: [], text: "", error: S(e && e.message), data: null, ms: Date.now() - t0 };
  }
  const ct = S(res.headers.get("content-type"));
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
  const handleBlock = (block) => {
    const line = block.split("\n").find((l) => l.startsWith("data:"));
    if (!line) return;
    const raw = line.slice(5).trim();
    if (!raw || raw === "[DONE]") return;
    let j = null;
    try { j = JSON.parse(raw); } catch {}
    if (!j) return;
    events.push(j);
    if (onEvent) { try { onEvent(j); } catch {} }
  };
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
      handleBlock(block);
    }
  }
  if (buf.trim()) handleBlock(buf);
  return { status: res.status, ct, events, text, data: null, ms: Date.now() - t0 };
}

const st0 = await getJson("/api/state");
const SERVER_UP = st0.status === 200;
const TOKEN = S(st0.data && st0.data.localToken);
const MODEL_LOADED = S(st0.data && st0.data.loaded);
console.log("\n== 目标 " + BASE + "，CDP " + CDP + "，令牌 " + (TOKEN ? "已取到" : "缺失（只跑纯函数段）") + "，模型 " + (MODEL_LOADED || "（未加载）") + " ==");

// ============================================================ A. 纯函数（确定性）
console.log("\n== A. 纯函数（import ./code-review-multi.mjs，不需要服务 / 模型）==");
try {
  // ---------- A1 常量
  check("A1 常量口径 8 / 6000 / 36000 / 40",
    MULTI_MAX_FILES === 8 && MULTI_PER_FILE_CHARS === 6000 && MULTI_TOTAL_CHARS === 36000 && MULTI_MAX_INPUT_FILES === 40,
    [MULTI_MAX_FILES, MULTI_PER_FILE_CHARS, MULTI_TOTAL_CHARS, MULTI_MAX_INPUT_FILES].join(" / "));

  // ---------- normalizeMultiPaths
  const n2 = normalizeMultiPaths("code/a.js");
  const n2b = normalizeMultiPaths(null);
  check("A2 normalizeMultiPaths 非数组 / 空输入 → paths: []、dropped: []",
    Array.isArray(n2.paths) && n2.paths.length === 0 && Array.isArray(n2.dropped) && n2.dropped.length === 0 &&
    Array.isArray(n2b.paths) && n2b.paths.length === 0 && Array.isArray(n2b.dropped) && n2b.dropped.length === 0,
    JSON.stringify(n2) + " / " + JSON.stringify(n2b));

  const n3 = normalizeMultiPaths([" code/a.js ", "code//b.js", "./code/c.js", "code\\d.js", "code/e/"]);
  check("A3 normalizeMultiPaths 归一（trim / 反斜杠转斜杠 / 去 ./ / 折叠 // / 去尾 /）",
    eq(n3.paths, ["code/a.js", "code/b.js", "code/c.js", "code/d.js", "code/e"]) && n3.dropped.length === 0,
    JSON.stringify(n3));

  const n4 = normalizeMultiPaths(["code/a.js", "code/A.JS", "code/b.js", "code/a.js"]);
  check("A4 normalizeMultiPaths 大小写不敏感去重（保留第一次）",
    eq(n4.paths, ["code/a.js", "code/b.js"]) && n4.dropped.length === 2 && n4.dropped.every((d) => d.reason === "duplicate"),
    JSON.stringify(n4));

  const n5 = normalizeMultiPaths(["", "code/a\u0000b.js", "code/../x.js", "C:/x/y.js", "code/a.js"]);
  check("A5 normalizeMultiPaths 非法（空 / NUL / .. 段 / 盘符）→ dropped reason invalid",
    eq(n5.paths, ["code/a.js"]) && n5.dropped.length === 4 && n5.dropped.every((d) => d.reason === "invalid"),
    JSON.stringify(n5));

  const n6 = normalizeMultiPaths([{ path: "code/obj.js" }, "code/str.js"]);
  check("A6 normalizeMultiPaths 接受 { path } 对象", eq(n6.paths, ["code/obj.js", "code/str.js"]), JSON.stringify(n6));

  const n7 = normalizeMultiPaths(["/code/slash.js"]);
  const slashKept = eq(n7.paths, ["code/slash.js"]);
  const slashDropped = n7.paths.length === 0 && n7.dropped.length === 1 && n7.dropped[0].reason === "invalid";
  check("A7 以 / 开头 → 归一成 code/slash.js 或 dropped invalid（§1.1 两处口径不一，二者都算过）",
    slashKept || slashDropped, JSON.stringify(n7));

  // ---------- isUnderCodeDir
  const under = {
    "code/a.js": true, "code/x": true, "code/a/b/c.py": true,
    "code/": false, "code": false, "codelike/a.py": false, "workspace/code/a.js": false, "": false,
  };
  const underBad = Object.keys(under).filter((k) => isUnderCodeDir(k) !== under[k]);
  check("A8 isUnderCodeDir：归一后以 code/ 开头且长度 > 5",
    underBad.length === 0,
    underBad.map((k) => JSON.stringify(k) + "=>" + isUnderCodeDir(k) + "（期望 " + under[k] + "）").join("; "));

  // ---------- buildMultiPlan：lang 映射
  const LANG_CASES = [
    ["code/lang-a.js", "javascript"], ["code/lang-b.mjs", "javascript"], ["code/lang-c.cjs", "javascript"],
    ["code/lang-d.ts", "typescript"], ["code/lang-e.py", "python"], ["code/lang-f.html", "html"],
    ["code/lang-g.css", "css"], ["code/lang-h.json", "json"], ["code/lang-i.md", "markdown"],
    ["code/lang-j.ps1", "powershell"], ["code/lang-k.java", "java"], ["code/lang-l.cs", "csharp"],
    ["code/lang-m.cpp", "cpp"], ["code/lang-n.cc", "cpp"], ["code/lang-o.cxx", "cpp"], ["code/lang-p.h", "cpp"],
    ["code/lang-q.c", "c"], ["code/lang-r.go", "go"], ["code/lang-s.rs", "rust"], ["code/lang-t.sh", "shell"],
    ["code/lang-u.sql", "sql"], ["code/lang-v.yml", "yaml"], ["code/lang-w.yaml", "yaml"],
    ["code/lang-x.txt", "text"], ["code/lang-y.nope", "text"], ["code/lang-z.JS", "javascript"],
    ["code/lang-zz", "text"], ["code/sub/lang-deep.js", "javascript"],
  ];
  const langPlan = buildMultiPlan(LANG_CASES.map((c) => ({ path: c[0], content: "x" })), { maxFiles: 60 });
  const langBad = LANG_CASES.map((c, i) => ({ path: c[0], want: c[1], got: langPlan.files[i] && langPlan.files[i].lang })).filter((x) => x.got !== x.want);
  check("A9 buildMultiPlan lang 扩展名映射（28 例，含大写扩展名 / 无扩展名 / 未知）",
    langBad.length === 0 && langPlan.files.length === LANG_CASES.length,
    langBad.map((x) => x.path + " 期望 " + x.want + " 实得 " + x.got).join("; ") || "n=" + langPlan.files.length);

  const nameBad = LANG_CASES.filter((c, i) => !langPlan.files[i] || langPlan.files[i].path !== c[0] || langPlan.files[i].name !== c[0].split("/").pop());
  check("A10 buildMultiPlan name=basename、files 顺序 = entries 顺序",
    nameBad.length === 0 && langPlan.files.every((f, i) => f.path === LANG_CASES[i][0]),
    nameBad.map((c) => c[0]).join(", ") || "n=" + langPlan.files.length);

  // ---------- buildMultiPlan：ok / 四类 reason
  const OK_A = "const probeMultiA = 1;";
  const OK_B = "let probeMultiB = 2;\nlet probeMultiC = 3;";
  const EMPTY_CONTENT = "   \n\t  ";
  const BOUND_CONTENT = "y".repeat(MULTI_PER_FILE_CHARS);
  const BIG_CONTENT = "x".repeat(MULTI_PER_FILE_CHARS + 1);
  const planMain = buildMultiPlan([
    { path: "code/m-main-a.js", content: OK_A },
    { path: "code/m-err.js", content: "", error: "EACCES: permission denied" },
    { path: "code/m-empty.js", content: EMPTY_CONTENT },
    { path: "code/m-main-b.js", content: OK_B },
    { path: "code/m-big.js", content: BIG_CONTENT },
    { path: "code/m-bound.js", content: BOUND_CONTENT },
  ]);
  const planReasons = (planMain.files || []).map((f) => (f.ok ? "ok" : S(f.reason)));
  check("A11 buildMultiPlan 四类 reason：ok / unreadable / empty / too_large / 6000 字符边界不超",
    eq(planReasons, ["ok", "unreadable", "empty", "ok", "too_large", "ok"]),
    JSON.stringify(planReasons));

  check("A12 buildMultiPlan reviewable = 只含 ok:true 的 path（顺序同上）",
    eq(planMain.reviewable, ["code/m-main-a.js", "code/m-main-b.js", "code/m-bound.js"]) &&
    planMain.files.every((f) => f.ok === planMain.reviewable.includes(f.path)),
    JSON.stringify(planMain.reviewable));

  const expectChars = OK_A.length + OK_B.length + BOUND_CONTENT.length;
  check("A13 buildMultiPlan totals 自洽（input/reviewable/skipped/chars/lines 只算 ok）",
    planMain.totals && planMain.totals.input === 6 && planMain.totals.reviewable === 3 && planMain.totals.skipped === 3 &&
    planMain.totals.chars === expectChars && planMain.totals.lines === 4,
    JSON.stringify(planMain.totals) + " 期望 chars=" + expectChars + " lines=4");

  const skBig = (planMain.skipped || []).find((s) => s.path === "code/m-big.js") || {};
  const skErr = (planMain.skipped || []).find((s) => s.path === "code/m-err.js") || {};
  const skEmpty = (planMain.skipped || []).find((s) => s.path === "code/m-empty.js") || {};
  check("A14 buildMultiPlan skipped 项带 chars（too_large=6001 / unreadable=0）",
    skBig.chars === MULTI_PER_FILE_CHARS + 1 && skErr.chars === 0 && Number.isFinite(Number(skEmpty.chars)) && S(skEmpty.reason) === "empty",
    JSON.stringify({ big: skBig.chars, err: skErr.chars, empty: skEmpty.chars }));

  const planBudget = buildMultiPlan([
    { path: "code/m-b1.js", content: "a".repeat(60) },
    { path: "code/m-b2.js", content: "a".repeat(60) },
    { path: "code/m-b3.js", content: "a".repeat(60) },
  ], { maxFiles: 8, perFileChars: 6000, totalChars: 100 });
  check("A15 buildMultiPlan budget（totalChars=100，60+60 超预算 → 第 2 个起 budget）",
    (planBudget.files[0] || {}).ok === true && S((planBudget.files[1] || {}).reason) === "budget" && S((planBudget.files[2] || {}).reason) === "budget" &&
    planBudget.totals.reviewable === 1 && planBudget.totals.skipped === 2,
    JSON.stringify((planBudget.files || []).map((f) => f.ok ? "ok" : f.reason)));

  const planLimit = buildMultiPlan(Array.from({ length: 9 }, (_v, i) => ({ path: "code/m-lim-" + i + ".js", content: "let v = 1;" })));
  check("A16 buildMultiPlan limit（9 个文件 → 8 个可审 + 第 9 个 limit）",
    planLimit.reviewable.length === MULTI_MAX_FILES && S((planLimit.files[8] || {}).reason) === "limit" && planLimit.totals.skipped === 1,
    JSON.stringify((planLimit.files || []).map((f) => f.ok ? "ok" : f.reason)));

  const planEmpty = buildMultiPlan([]);
  let planNullOk = false;
  try { planNullOk = Array.isArray(buildMultiPlan(null).files); } catch {}
  check("A17 buildMultiPlan 空数组 / null → 空结构、不抛",
    Array.isArray(planEmpty.files) && planEmpty.files.length === 0 && planEmpty.totals && planEmpty.totals.input === 0 && planNullOk,
    JSON.stringify(planEmpty.totals));

  // ---------- multiReviewPrompt
  const p1 = multiReviewPrompt({ index: 2, total: 3, file: "code/a.js", lang: "javascript", intent: "检查并发写入", lineCount: 42 });
  const p1b = multiReviewPrompt({ index: 2, total: 3, file: "code/a.js", lang: "javascript", intent: "检查并发写入", lineCount: 42 });
  const p1First = S(p1).split("\n")[0] || "";
  check("A18 multiReviewPrompt 第一行带【第 i/N 个文件】", /【第\s*2\s*\/\s*3\s*个文件】/.test(p1First), p1First.slice(0, 60));

  const structOk = /【用户意图】[^\n]*检查并发写入/.test(p1) &&
    /【文件】[^\n]*code\/a\.js/.test(p1) &&
    /【语言】[^\n]*javascript/.test(p1) &&
    /【代码行数】[^\n]*42/.test(p1);
  check("A19 multiReviewPrompt 沿用【用户意图】【文件】【语言】【代码行数】+ 围栏",
    structOk && S(p1).includes(FENCE + "javascript"), S(p1).split("\n").filter((l) => l.startsWith("【")).join(" | ").slice(0, 160));

  const p2 = multiReviewPrompt({ index: 1, total: 1, file: "code/b.txt", lang: "", intent: "", lineCount: 3 });
  const fenceLines2 = S(p2).split("\n").filter((l) => l.startsWith(FENCE));
  check("A20 multiReviewPrompt lang 为空 → 围栏不带语言标记",
    fenceLines2.length >= 1 && fenceLines2.every((l) => l === FENCE) && /【第\s*1\s*\/\s*1\s*个文件】/.test(S(p2).split("\n")[0] || ""),
    JSON.stringify(fenceLines2));

  check("A21 multiReviewPrompt 确定性（同参数两次相同）", eq(p1, p1b), "");

  // ---------- issueLineTexts
  const CODE_TXT = ["function a() {", "  const x = 1;", "", "  return x;", "}"].join("\n");
  const ISSUES_IN = [{ line: 2, severity: "error", title: "t" }, { line: 3 }, { line: 0 }, { line: 99 }];
  const outLines = issueLineTexts(ISSUES_IN, CODE_TXT);
  check("A22 issueLineTexts 行原文 + 空行 \"\" + 行号 clamp 到 [1, lines.length]",
    Array.isArray(outLines) && outLines.length === 4 &&
    (outLines[0] || {}).lineText === "const x = 1;" &&
    (outLines[1] || {}).lineText === "" &&
    (outLines[2] || {}).lineText === "function a() {" &&
    (outLines[3] || {}).lineText === "}",
    JSON.stringify((outLines || []).map((x) => x && x.lineText)));

  const longCode = "  " + "z".repeat(200) + "  ";
  const outLong = issueLineTexts([{ line: 1 }], longCode);
  const longText = S((outLong[0] || {}).lineText);
  check("A23 issueLineTexts trim + 截断 <= 80 字符、不改入参",
    ISSUES_IN[0].lineText === undefined &&
    longText.length > 0 && longText.length <= 80 && longText.startsWith("z"),
    "len=" + longText.length + " inPlace=" + S(ISSUES_IN[0].lineText));

  // ---------- normalizeCrossFindings
  const KNOWN = ["code/a.js", "code/b.js", "code/sub/c.py"];
  const CROSS_IN = [
    { file: "code/a.js", line: 3, endLine: 2, severity: "error", title: "T1", detail: "D1", fix: "F1" },
    { file: "b.js", line: "5.6", severity: "nope", title: "" },
    { file: "c.py" },
    { file: "code/a.js", line: -5, endLine: -9, severity: "warn", title: "T2" },
  ];
  const cf = normalizeCrossFindings(CROSS_IN, KNOWN);
  const cf0 = cf.findings[0] || {}, cf1 = cf.findings[1] || {}, cf2 = cf.findings[2] || {}, cf3 = cf.findings[3] || {};
  check("A24 normalizeCrossFindings 全等 / basename 唯一匹配 + 字段归一（line/endLine/severity/title）",
    cf.findings.length === 4 &&
    cf0.file === "code/a.js" && cf0.line === 3 && cf0.endLine === 3 && cf0.severity === "error" && cf0.title === "T1" && cf0.detail === "D1" && cf0.fix === "F1" &&
    cf1.file === "code/b.js" && cf1.line === 6 && cf1.endLine === 6 && cf1.severity === "info" && cf1.title === "问题" &&
    cf2.file === "code/sub/c.py" && cf2.line === 1 && cf2.endLine === 1 &&
    cf3.line === 1 && cf3.endLine === 1 && cf3.severity === "warn",
    JSON.stringify(cf.findings.map((f) => [f.file, f.line, f.endLine, f.severity, f.title])));

  const cfDrop = normalizeCrossFindings([{ file: "missing.js", line: 1 }, { file: "code/zzz.js" }], KNOWN);
  check("A25 normalizeCrossFindings 未知 file → 丢弃计数（不抛）",
    cfDrop.findings.length === 0 && cfDrop.dropped === 2, JSON.stringify(cfDrop));

  const cfAmb = normalizeCrossFindings([{ file: "a.js", line: 1 }], ["code/a.js", "code/x/a.js"]);
  check("A26 normalizeCrossFindings basename 有多个同名 → 丢弃（不猜）",
    cfAmb.findings.length === 0 && cfAmb.dropped === 1, JSON.stringify(cfAmb));

  const cfLong = normalizeCrossFindings([{ file: "code/b.js", line: 2, title: "T".repeat(200), detail: "d".repeat(1000), fix: "f".repeat(1000) }], KNOWN);
  const cfL0 = cfLong.findings[0] || {};
  check("A27 normalizeCrossFindings title<=120 / detail,fix<=800 / 空 title → 问题",
    S(cfL0.title).length > 0 && S(cfL0.title).length <= 120 && S(cfL0.detail).length <= 800 && S(cfL0.fix).length <= 800,
    "title=" + S(cfL0.title).length + " detail=" + S(cfL0.detail).length + " fix=" + S(cfL0.fix).length);

  const manyCross = Array.from({ length: 15 }, (_v, i) => ({ file: "code/a.js", line: i + 1, title: "t" + i }));
  const cfDefault = normalizeCrossFindings(manyCross, KNOWN);
  const cfTwo = normalizeCrossFindings(manyCross, KNOWN, { maxFindings: 2 });
  check("A28 normalizeCrossFindings 默认截断 12 / opts.maxFindings=2",
    cfDefault.findings.length === 12 && cfTwo.findings.length === 2,
    cfDefault.findings.length + " / " + cfTwo.findings.length);

  const cfNull = normalizeCrossFindings(null, KNOWN);
  const cfBad = normalizeCrossFindings([null, { file: null }], KNOWN);
  check("A29 normalizeCrossFindings 非数组 / 脏元素 → 空结构、不抛",
    Array.isArray(cfNull.findings) && cfNull.findings.length === 0 && cfNull.dropped === 0 && Array.isArray(cfBad.findings) && cfBad.dropped === 2,
    JSON.stringify({ nul: cfNull.dropped, bad: cfBad.dropped }));

  // ---------- multiCrossPrompt
  const MCP_FILES = [
    { path: "code/a.js", name: "a.js", lines: 12, issues: [{ line: 3, severity: "error", title: "循环越界" }] },
    { path: "code/b.py", name: "b.py", lines: 8, issues: [] },
  ];
  const mcp = multiCrossPrompt({ intent: "看看两个文件之间的一致性", files: MCP_FILES });
  const mcpOk = typeof mcp === "string" && mcp.includes("看看两个文件之间的一致性") &&
    mcp.includes("code/a.js") && mcp.includes("code/b.py") &&
    /summary/.test(mcp) && /findings/.test(mcp) && /JSON/.test(mcp) &&
    mcp.includes("循环越界") && /必须|只能|之一/.test(mcp);
  check("A30 multiCrossPrompt：intent + 路径 + 行数 + 问题标题 + JSON 约束（file 必须是给定路径之一）",
    mcpOk, S(mcp).slice(0, 120).replace(/\n/g, " "));

  check("A31 multiCrossPrompt 简短（只放摘要与问题标题，不放代码正文）",
    S(mcp).length > 0 && S(mcp).length < 5000 && !S(mcp).includes(FENCE),
    "len=" + S(mcp).length);

  // ---------- aggregateMultiReview
  const agg = aggregateMultiReview([
    { path: "code/a.js", issues: [] },
    { path: "code/b.js", issues: [{ severity: "error" }, { severity: "warn" }, { severity: "error" }] },
    { path: "code/c.py", issues: [{ severity: "info" }] },
  ]);
  check("A32 aggregateMultiReview：files=3 / issues=4 / clean=1 / bySeverity error2 warn1 info1",
    agg && agg.files === 3 && agg.issues === 4 && agg.clean === 1 && agg.bySeverity &&
    agg.bySeverity.error === 2 && agg.bySeverity.warn === 1 && agg.bySeverity.info === 1,
    JSON.stringify(agg));

  // ---------- buildMultiReviewMarkdown
  const MD_AT = new Date(2026, 10, 19, 23, 30, 0).getTime();
  const MD_PAYLOAD = {
    meta: {
      intent: "一起看看多文件", at: MD_AT, model: "Qwen3.5-9B",
      skipped: [{ path: "code/big.js", reason: "too_large", chars: 6001 }, { path: "code/emp.js", reason: "empty" }],
    },
    files: [
      {
        path: "code/a.js", name: "a.js", lang: "javascript", lines: 12, summary: "有 2 个问题", seconds: 12.5, parsed: true,
        issues: [
          { line: 3, endLine: 3, severity: "error", title: "循环越界", detail: "i<=len 会越界", fix: "改成 i<len", lineText: "for (let i = 0; i <= items.length; i++) {" },
          { line: 5, endLine: 5, severity: "warn", title: "没判空", detail: "", fix: "" },
        ],
      },
      { path: "code/b.js", name: "b.js", lang: "javascript", lines: 4, summary: "", issues: [], seconds: 3, parsed: false },
    ],
    cross: {
      summary: "两个文件都有边界问题",
      findings: [{ file: "code/a.js", line: 3, endLine: 3, severity: "error", title: "越界", detail: "同上" }],
    },
  };
  const md = buildMultiReviewMarkdown(MD_PAYLOAD);
  const mdS = S(md);
  check("A33 buildMultiReviewMarkdown 标题「# 多文件审查 · N 个文件」+ 四节 + 说明",
    mdS.startsWith("# 多文件审查 · 2 个文件") &&
    ["## 一、总览", "## 二、逐文件结论", "## 三、跨文件问题", "## 四、跳过的文件", "## 说明"].every((x) => mdS.includes(x)),
    mdS.split("\n")[0] + " / 缺: " + ["## 一、总览", "## 二、逐文件结论", "## 三、跨文件问题", "## 四、跳过的文件", "## 说明"].filter((x) => !mdS.includes(x)).join(","));

  check("A34 buildMultiReviewMarkdown meta 四行（审查时间 / 模型 / 用户意图 / 计划）",
    mdS.includes("**审查时间**") && /2026[-/]11[-/]19/.test(mdS) &&
    mdS.includes("**模型**") && mdS.includes("Qwen3.5-9B") &&
    mdS.includes("**用户意图**") && mdS.includes("一起看看多文件") &&
    /审查\s*2\s*个/.test(mdS) && /跳过\s*2\s*个/.test(mdS),
    mdS.split("\n").filter((l) => l.includes("**")).slice(0, 6).join(" | ").slice(0, 200));

  check("A35 buildMultiReviewMarkdown 逐文件小节（行数 / 问题数 / 摘要 / 问题行 / 无问题与无摘要兜底）",
    mdS.includes("### 1. code/a.js") && mdS.includes("12 行") && mdS.includes("2 个问题") &&
    mdS.includes("有 2 个问题") && mdS.includes("行 3（error）") && mdS.includes("循环越界") &&
    mdS.includes("i<=len 会越界") && mdS.includes("建议：改成 i<len") &&
    mdS.includes("### 2. code/b.js") && mdS.includes("4 行") && mdS.includes("0 个问题") &&
    mdS.includes("（没有摘要）") && mdS.includes("（没有发现问题）"),
    S(mdS.split("## 二、逐文件结论")[1] || "").slice(0, 200).replace(/\n/g, " / "));

  check("A36 buildMultiReviewMarkdown 跨文件问题（summary + 每条 finding 的 文件/行/严重度/标题）",
    mdS.includes("两个文件都有边界问题") && mdS.includes("code/a.js 行 3（error）") && mdS.includes("越界"),
    S(mdS.split("## 三、跨文件问题")[1] || "").slice(0, 160).replace(/\n/g, " / "));

  const mdNoCross = S(buildMultiReviewMarkdown({ meta: { intent: "x", at: MD_AT, model: "m", skipped: [] }, files: [], cross: null }));
  const mdEmptyCross = S(buildMultiReviewMarkdown({ meta: { intent: "x", at: MD_AT, model: "m", skipped: [] }, files: [], cross: { summary: "", findings: [] } }));
  check("A37 buildMultiReviewMarkdown 空 cross 兜底（没有生成跨文件总览 / 没有发现跨文件问题）",
    /（没有生成跨文件总览）|（没有发现跨文件问题）/.test(mdNoCross) && /（没有生成跨文件总览）|（没有发现跨文件问题）/.test(mdEmptyCross),
    mdNoCross.split("\n").find((l) => l.includes("跨文件")) || "无跨文件行");

  check("A38 buildMultiReviewMarkdown 跳过清单（path + reason + 6001 字符）+ 空清单兜底",
    mdS.includes("code/big.js") && mdS.includes("too_large") && /6001\s*字符/.test(mdS) && mdS.includes("code/emp.js") && mdS.includes("empty") &&
    mdNoCross.includes("（没有跳过的文件）"),
    S(mdS.split("## 四、跳过的文件")[1] || "").slice(0, 160).replace(/\n/g, " / "));

  const mdBadAt = S(buildMultiReviewMarkdown({ meta: { intent: "x", at: "not-a-date", model: "", skipped: [] }, files: [], cross: null }));
  check("A39 buildMultiReviewMarkdown at 非法 → 「未知」+ 0 文件标题",
    /未知/.test(mdBadAt) && mdBadAt.startsWith("# 多文件审查 · 0 个文件"),
    mdBadAt.split("\n").slice(0, 3).join(" / "));
} catch (e) {
  fail++;
  console.log("FAIL A 段异常中断: " + S(e && e.stack || e).split("\n").slice(0, 3).join(" | "));
}

// ============================================================ B/C/D/E（需要服务）
/** 本探针建过的夹具（收尾统一删） */
const fixtures = [];
async function saveFixture(p, content) {
  const r = await postJson("/api/workspace/save", { path: p, content }, TOKEN);
  if (r.status === 200) fixtures.push(p);
  return r;
}
async function deleteFixture(p) {
  try { await postJson("/api/workspace/delete", { path: p }, TOKEN); } catch {}
}
async function cleanupFixtures() {
  while (fixtures.length) { const p = fixtures.pop(); await deleteFixture(p); }
}
/** 跑前清残留：任何 probe-multi-* 都算上次没删干净的夹具 */
async function cleanupStale() {
  const list = await getJson("/api/workspace/list?dir=code");
  const entries = (list.data && list.data.entries) || [];
  let n = 0;
  for (const e of entries) {
    if (e && !e.dir && S(e.name).startsWith("probe-multi-")) { await deleteFixture(e.path); n++; }
  }
  if (n) console.log("  （清掉 " + n + " 个上次残留的 probe-multi-* 夹具）");
}

let ROUTE_PLAN_OK = false;
let ROUTE_MULTI_OK = false;
let LOADED_C = "";

if (!SERVER_UP) {
  skipCheck("B 段（服务不可达）", S(st0.error || ("HTTP " + st0.status)));
  skipCheck("C 段（服务不可达）", "");
  skipCheck("D 段（服务不可达）", "");
  skipCheck("E 段（服务不可达）", "");
} else {
  await cleanupStale();
  try {
    // ============================================================ B. API plan + 参数校验
    console.log("\n== B. API plan + 参数校验（不需要模型）==");
    const planPath = "/api/code/review/multi/plan";
    const multiPath = "/api/code/review/multi";
    const B_OK = fx("b-ok.js");
    const B_EMPTY = fx("b-empty.js");
    const B_BIG = fx("b-big.js");
    const B_MISSING = fx("b-missing.js");
    const B_OK_CODE = ["const probeMultiA = 1;", "const probeMultiB = 2;", "", "console.log(probeMultiA + probeMultiB);"].join("\n");

    check("B1 /api/state 200 且拿到本机令牌", TOKEN.length > 0, "tokenLen=" + TOKEN.length);
    if (!TOKEN) throw new Error("没有令牌，B/C/D/E 无法继续（服务刚起？）");

    const b2 = await postJson(planPath, { files: [B_OK] }, "");
    check("B2 plan 无令牌 → 403", b2.status === 403, "HTTP " + b2.status + " " + S(b2.data && b2.data.error && b2.data.error.message).slice(0, 60));

    const b3 = await postJson(planPath, {}, TOKEN);
    check("B3 plan 缺 files → 400 且文案提到 files / 文件",
      b3.status === 400 && /files|文件/i.test(S(b3.data && b3.data.error && b3.data.error.message)),
      "HTTP " + b3.status + " " + S(b3.data && b3.data.error && b3.data.error.message).slice(0, 70));

    const b4 = await postJson(planPath, { files: "code/x.js" }, TOKEN);
    check("B4 plan files 不是数组 → 400", b4.status === 400, "HTTP " + b4.status + " " + S(b4.text).slice(0, 70));

    const b5 = await postJson(planPath, { files: Array.from({ length: 41 }, (_v, i) => fx("n" + i + ".js")) }, TOKEN);
    check("B5 plan 41 个路径 → 400（一次最多 " + MULTI_MAX_INPUT_FILES + " 个）", b5.status === 400,
      "HTTP " + b5.status + " " + S(b5.data && b5.data.error && b5.data.error.message).slice(0, 70));

    const b6 = await postJson(planPath, { files: ["note.txt"] }, TOKEN);
    check("B6 plan 非 code/ 路径 → 400 且文案提到 code/",
      b6.status === 400 && /code\//i.test(S(b6.data && b6.data.error && b6.data.error.message)),
      "HTTP " + b6.status + " " + S(b6.data && b6.data.error && b6.data.error.message).slice(0, 80));

    const b7 = await postJson(planPath, { files: ["code/../../secret.txt", "../note.txt"] }, TOKEN);
    check("B7 plan 路径穿越（.. 段）→ 400", b7.status === 400,
      "HTTP " + b7.status + " " + S(b7.data && b7.data.error && b7.data.error.message).slice(0, 70));

    const sOk = await saveFixture(B_OK, B_OK_CODE);
    const sEmpty = await saveFixture(B_EMPTY, "   \n\t  ");
    const sBig = await saveFixture(B_BIG, "x".repeat(MULTI_PER_FILE_CHARS + 1));
    check("B8 夹具建好（POST /api/workspace/save 200 ×3）",
      sOk.status === 200 && sEmpty.status === 200 && sBig.status === 200,
      "HTTP " + sOk.status + "/" + sEmpty.status + "/" + sBig.status);

    const b9 = await postJson(planPath, { files: [B_OK, B_EMPTY, B_BIG, B_MISSING] }, TOKEN);
    ROUTE_PLAN_OK = b9.status === 200 || b2.status === 403;
    const p9 = (b9.data && b9.data.plan) || {};
    const sk9 = (p9.skipped || []).map((s) => S(s.reason));
    const files9 = (p9.files || []).map((f) => S(f.path));
    check("B9 plan 200：reviewable 只含 ok 夹具、skipped = empty/too_large/unreadable、files 顺序 = 请求顺序",
      b9.status === 200 && eq(p9.reviewable, [B_OK]) && eq(sk9, ["empty", "too_large", "unreadable"]) &&
      eq(files9, [B_OK, B_EMPTY, B_BIG, B_MISSING]) && p9.totals && p9.totals.reviewable === 1 && p9.totals.skipped === 3,
      "HTTP " + b9.status + " reviewable=" + JSON.stringify(p9.reviewable) + " skipped=" + JSON.stringify(sk9) +
      " " + S(b9.data && b9.data.error && b9.data.error.message).slice(0, 80));

    const b10 = await postJson(planPath, { files: [fx("dup.js"), fx("DUP.JS")] }, TOKEN);
    const p10 = (b10.data && b10.data.plan) || {};
    check("B10 plan 顶层带 dropped：大小写重复路径 → duplicate、files 只 1 个",
      b10.status === 200 && Array.isArray(p10.dropped) && p10.dropped.length === 1 &&
      S(p10.dropped[0].reason) === "duplicate" && (p10.files || []).length === 1,
      "HTTP " + b10.status + " dropped=" + JSON.stringify(p10.dropped));

    const forty = Array.from({ length: 40 }, (_v, i) => fx("n" + i + ".js"));
    const b11 = await postJson(planPath, { files: forty }, TOKEN);
    const p11 = (b11.data && b11.data.plan) || {};
    check("B11 plan 40 个（边界内）→ 200，40 个都按 unreadable 跳过（不因数量 400）",
      b11.status === 200 && (p11.files || []).length === 40 && (p11.reviewable || []).length === 0 && (p11.skipped || []).length === 40,
      "HTTP " + b11.status + " files=" + (p11.files || []).length + " skipped=" + (p11.skipped || []).length);

    const limPaths = Array.from({ length: 9 }, (_v, i) => fx("lim" + (i + 1) + ".js"));
    let limSaved = true;
    for (const p of limPaths) { const r = await saveFixture(p, "let limited = 1;"); if (r.status !== 200) limSaved = false; }
    const b12 = await postJson(planPath, { files: limPaths }, TOKEN);
    const p12 = (b12.data && b12.data.plan) || {};
    check("B12 plan 9 个文件 → 200、reviewable 8 个、skipped 1 个 reason=limit",
      limSaved && b12.status === 200 && (p12.reviewable || []).length === MULTI_MAX_FILES &&
      (p12.skipped || []).length === 1 && S((p12.skipped || [])[0] && p12.skipped[0].reason) === "limit",
      "HTTP " + b12.status + " reviewable=" + (p12.reviewable || []).length + " reasons=" + JSON.stringify((p12.skipped || []).map((s) => s.reason)));

    const m13 = await sse(multiPath, { files: [] }, TOKEN, 30000);
    ROUTE_MULTI_OK = m13.status === 400 || m13.status === 200 || m13.status === 403;
    check("B13 /multi files 为空 → 400（参数错误先于模型校验；不是 409、不是 SSE）",
      m13.status === 400 && !/text\/event-stream/i.test(S(m13.ct)),
      "HTTP " + m13.status + " ct=" + S(m13.ct).slice(0, 40) + " " + S(m13.data && m13.data.error && m13.data.error.message).slice(0, 80));

    const m14 = await sse(multiPath, { files: ["note.txt"] }, TOKEN, 30000);
    check("B14 /multi 非 code/ 路径 → 400", m14.status === 400,
      "HTTP " + m14.status + " " + S(m14.data && m14.data.error && m14.data.error.message).slice(0, 70));

    const m15 = await sse(multiPath, { files: Array.from({ length: 41 }, (_v, i) => fx("m" + i + ".js")) }, TOKEN, 30000);
    check("B15 /multi 41 个路径 → 400", m15.status === 400, "HTTP " + m15.status + " " + S(m15.data && m15.data.error && m15.data.error.message).slice(0, 60));

    // ============================================================ C. 真模型 SSE
    console.log("\n== C. 真模型 SSE（模型没加载 / 接口 404 → skip）==");
    const C1 = fx("c1.js");
    const C2 = fx("c2.py");
    const C1_CODE = [
      "function calcTotal(items) {",
      "  let total = 0;",
      "  for (let i = 0; i <= items.length; i++) {",
      "    total += items[i].price;",
      "  }",
      "  return total;",
      "}",
      "console.log(calcTotal([{ price: 3 }, { price: 4 }]));",
    ].join("\n");
    const C2_CODE = [
      "def average(nums):",
      "    total = 0",
      "    for n in nums:",
      "        total += n",
      "    return total / len(nums)",
      "",
      "print(average([]))",
    ].join("\n");
    const C_INTENT = "找出每个文件里的 bug：重点看循环边界、空列表/除零、空值。按行号指出问题。";

    const stC = await getJson("/api/state");
    LOADED_C = S(stC.data && stC.data.loaded);
    if (!(ROUTE_PLAN_OK && ROUTE_MULTI_OK)) {
      skipCheck("C 段（plan / multi 接口 404：后端未就绪）", "ROUTE_PLAN=" + ROUTE_PLAN_OK + " ROUTE_MULTI=" + ROUTE_MULTI_OK);
    } else if (!LOADED_C) {
      skipCheck("C 段（没有加载模型；真模型 SSE 段跳过）", "loaded=（空）");
    } else {
      const cs1 = await saveFixture(C1, C1_CODE);
      const cs2 = await saveFixture(C2, C2_CODE);
      if (cs1.status !== 200 || cs2.status !== 200) {
        skipCheck("C 段（真模型夹具建不起来）", "HTTP " + cs1.status + "/" + cs2.status);
      } else {
        // 审查进行中并发 /api/load 必须 409（codeJobLocked 锁复用）：等第一个 file-start 再打，肯定在同一把锁里
        let loadDuring = null;
        const rev = await sse(multiPath, { files: [C1, C2], intent: C_INTENT }, TOKEN, 660000, (e) => {
          if (e && e.type === "file-start" && !loadDuring) loadDuring = postJson("/api/load", { file: LOADED_C, contextSize: 8192 }, TOKEN, 30000);
        });
        const evs = rev.events || [];
        const tp = types(evs);
        const at = (t) => tp.indexOf(t);
        const planEv = evs[at("plan")] || {};
        const doneEv = evs[at("done")] || {};
        const crossEv = evs[at("cross")] || {};
        const fileStarts = evs.filter((e) => e && e.type === "file-start");
        const fileFindings = evs.filter((e) => e && e.type === "file-findings");
        const fileErrors = evs.filter((e) => e && e.type === "file-error");
        const deltas = evs.filter((e) => e && e.type === "delta");
        const planReviewable = Array.isArray(planEv.reviewable) ? planEv.reviewable : [];
        const linesOf = {};
        for (const fs of fileStarts) if (fs && fs.path) linesOf[S(fs.path)] = Number(fs.lines) || 0;
        console.log("  事件序列: " + tp.join(" -> ").slice(0, 400));
        if (fileErrors.length) console.log("  file-error: " + JSON.stringify(fileErrors.map((x) => S(x.path) + ": " + S(x.message).slice(0, 60))));

        check("C1 /api/code/review/multi → 200 + text/event-stream",
          rev.status === 200 && /text\/event-stream/i.test(rev.ct),
          "HTTP " + rev.status + " ct=" + S(rev.ct).slice(0, 40) + " " + S(rev.error).slice(0, 80) + "（" + (rev.ms / 1000).toFixed(1) + "s）");

        check("C2 事件顺序：meta 第一、plan 第二、done 最后",
          at("meta") === 0 && at("plan") === 1 && evs.length > 0 && at("done") === evs.length - 1,
          JSON.stringify({ total: evs.length, meta: at("meta"), plan: at("plan"), done: at("done"), tail: tp.slice(-3) }));

        check("C3 plan 事件带 totals、reviewable = 2 个夹具",
          planEv.totals && Array.isArray(planReviewable) && planReviewable.length === 2 && eq(planReviewable, [C1, C2]),
          JSON.stringify(planEv.reviewable));

        const badStart = fileStarts.find((f) => !(Number(f.index) >= 1 && Number(f.index) <= 2 && Number(f.total) === 2 &&
          planReviewable.includes(S(f.path)) && S(f.name).length > 0 && S(f.lang).length > 0 && Number(f.chars) > 0 && Number(f.lines) > 0));
        check("C4 file-start 2 个且字段齐全（index/total/path/name/lang/chars/lines）",
          fileStarts.length === 2 && !badStart,
          badStart ? JSON.stringify(badStart).slice(0, 160) : JSON.stringify(fileStarts.map((f) => [f.index, f.path, f.lines])));

        const orderBad = planReviewable.map((p) => {
          const si = evs.findIndex((e) => e && e.type === "file-start" && S(e.path) === p);
          const fi = evs.findIndex((e) => e && e.type === "file-findings" && S(e.path) === p);
          return { p: p, si: si, fi: fi };
        }).filter((x) => !(x.si >= 0 && x.fi > x.si));
        check("C5 每个文件：file-start 早于自己的 file-findings，且 file-findings 2 个",
          fileFindings.length === 2 && orderBad.length === 0,
          orderBad.length ? JSON.stringify(orderBad) : "findings=" + fileFindings.length);

        check("C6 有 delta 流式输出、全程没有 error 事件",
          deltas.length >= 1 && at("error") < 0,
          "delta=" + deltas.length + " error=" + JSON.stringify((evs || []).filter((e) => e && e.type === "error").map((e) => S(e.message).slice(0, 60))));

        const badLine = [];
        const badField = [];
        for (const ff of fileFindings) {
          const lc = Number(ff.lineCount) || Number(linesOf[S(ff.path)]) || 0;
          if (!Array.isArray(ff.issues)) { badLine.push(S(ff.path) + ": issues 不是数组"); continue; }
          for (const it of ff.issues) {
            const ln = Number(it && it.line), en = Number(it && it.endLine);
            if (!(ln >= 1 && ln <= lc && en >= ln && en <= lc)) badLine.push(S(ff.path) + " line=" + ln + " endLine=" + en + " lineCount=" + lc);
            if (!(it && ["error", "warn", "info"].includes(S(it.severity)) && S(it.title).trim().length > 0 &&
              typeof it.detail === "string" && typeof it.fix === "string" && typeof it.lineText === "string")) {
              badField.push(S(ff.path) + " " + JSON.stringify(it).slice(0, 80));
            }
          }
        }
        check("C7 每个 file-findings 的 issues 是数组且行号落在该文件行数内（1<=line<=endLine<=lineCount）",
          fileFindings.length === 2 && badLine.length === 0, badLine.slice(0, 4).join(" | "));
        check("C8 每条 issue 字段齐全（severity/title/detail/fix + lineText）",
          badField.length === 0, badField.slice(0, 3).join(" | "));

        check("C9 cross 事件在 file-findings 之后、done 之前，summary 字符串 + findings 数组（2 个文件不禁用跨文件）",
          at("cross") > at("file-findings") && at("cross") < at("done") &&
          typeof crossEv.summary === "string" && Array.isArray(crossEv.findings),
          JSON.stringify({ cross: at("cross"), findings: (crossEv.findings || []).length, summary: S(crossEv.summary).slice(0, 50) }));

        const badCross = (crossEv.findings || []).filter((f) => {
          if (!f) return true;
          const p = S(f.file);
          if (!planReviewable.includes(p)) return true;
          const lc = Number(linesOf[p]) || 0;
          return !(Number(f.line) >= 1 && (lc === 0 || Number(f.line) <= lc) && Number(f.endLine) >= Number(f.line));
        });
        check("C10 cross.findings 的 file ∈ 送审路径、line 落在该文件行数内（服务端 clamp）",
          badCross.length === 0, badCross.slice(0, 3).map((f) => JSON.stringify(f).slice(0, 100)).join(" | "));

        const ffIssues = fileFindings.flatMap((ff) => (Array.isArray(ff.issues) ? ff.issues : []));
        const sevCount = { error: 0, warn: 0, info: 0 };
        for (const it of ffIssues) sevCount[S(it.severity)] = (sevCount[S(it.severity)] || 0) + 1;
        const st1 = doneEv.stats || {};
        const cleanExpect = fileFindings.filter((ff) => !Array.isArray(ff.issues) || ff.issues.length === 0).length;
        check("C11 done.stats 自洽（files=2、issues=各文件之和、clean=0 问题文件数、bySeverity 合计=issues）",
          st1.files === 2 && st1.issues === ffIssues.length && st1.clean === cleanExpect &&
          st1.bySeverity && st1.bySeverity.error === sevCount.error && st1.bySeverity.warn === sevCount.warn && st1.bySeverity.info === sevCount.info,
          JSON.stringify({ stats: st1, issues: ffIssues.length, clean: cleanExpect, sev: sevCount }));

        check("C12 done.files / done.skipped 与 plan 一致、done.seconds > 0",
          doneEv.files === planReviewable.length && doneEv.skipped === (planEv.skipped || []).length && Number(doneEv.seconds) > 0,
          JSON.stringify({ files: doneEv.files, skipped: doneEv.skipped, seconds: doneEv.seconds }));

        const loadRes = loadDuring ? await loadDuring : null;
        check("C13 审查进行中并发 POST /api/load → 409（五流程共用 codeJobLocked 一把锁）",
          Boolean(loadRes) && loadRes.status === 409,
          loadRes ? "HTTP " + loadRes.status + " " + S(loadRes.data && loadRes.data.error && loadRes.data.error.message).slice(0, 70) : "没抓到并发窗口");

        const stAfter = await getJson("/api/state");
        check("C14 跑完服务仍 /api/state 200、模型仍是原来的",
          stAfter.status === 200 && S(stAfter.data && stAfter.data.loaded) === LOADED_C,
          "HTTP " + stAfter.status + " loaded=" + S(stAfter.data && stAfter.data.loaded));
      }
    }

    // ============================================================ D. 导出 kind=multi
    console.log("\n== D. 导出 kind=multi（不需要模型）==");
    const D_BODY = {
      kind: "multi",
      meta: {
        file: "workspace", intent: "多文件导出探针", at: Date.now(), model: "probe-model",
        skipped: [{ path: "code/probe-multi-big.js", reason: "too_large", chars: 6001 }],
      },
      files: [{
        path: "code/probe-multi-a.js", name: "a.js", lang: "javascript", lines: 10, summary: "有 1 个问题", seconds: 1.2, parsed: true,
        issues: [{ line: 2, endLine: 2, severity: "error", title: "越界", detail: "d", fix: "f", lineText: "for (let i = 0; i <= xs.length; i++)" }],
      }],
      cross: { summary: "跨文件总览（探针）", findings: [{ file: "code/probe-multi-a.js", line: 2, endLine: 2, severity: "warn", title: "跨文件提醒", detail: "x" }] },
    };
    const d1 = await postJson("/api/code/review/export", D_BODY, TOKEN);
    const dmd = S(d1.data && d1.data.markdown);
    const dfn = S(d1.data && d1.data.filename);
    check("D1 export kind=multi → 200", d1.status === 200,
      "HTTP " + d1.status + " " + S(d1.data && d1.data.error && d1.data.error.message).slice(0, 90));

    check("D2 文件名 <slug>-YYYYMMDD-HHmm.multi.review.md",
      /^[a-z0-9._-]+-\d{8}-\d{4}\.multi\.review\.md$/.test(dfn), dfn);

    const D_SECTIONS = ["## 一、总览", "## 二、逐文件结论", "## 三、跨文件问题", "## 四、跳过的文件", "## 说明"];
    check("D3 markdown 含四节 + 说明", D_SECTIONS.every((x) => dmd.includes(x)),
      "缺: " + D_SECTIONS.filter((x) => !dmd.includes(x)).join(","));

    check("D4 标题按文件数 + 逐文件结论里有路径与问题",
      dmd.startsWith("# 多文件审查 · 1 个文件") && dmd.includes("code/probe-multi-a.js") && dmd.includes("越界"),
      dmd.split("\n")[0]);

    check("D5 含跨文件总览与跨文件问题", dmd.includes("跨文件总览（探针）") && dmd.includes("跨文件提醒"), "");

    check("D6 跳过清单有内容（path + too_large + 6001 字符）",
      dmd.includes("code/probe-multi-big.js") && dmd.includes("too_large") && /6001\s*字符/.test(dmd),
      S(dmd.split("## 四、跳过的文件")[1] || "").slice(0, 140).replace(/\n/g, " / "));

    const d2 = await postJson("/api/code/review/export", { kind: "multi" }, "");
    check("D7 export 无令牌 → 403", d2.status === 403, "HTTP " + d2.status + " " + S(d2.data && d2.data.error && d2.data.error.message).slice(0, 60));

    check("D8 bytes 与 markdown UTF-8 长度一致 + 说明写明不含代码正文",
      d1.data && d1.data.bytes === Buffer.byteLength(dmd, "utf8") && dmd.includes("不含代码正文"),
      "bytes=" + S(d1.data && d1.data.bytes) + " vs " + Buffer.byteLength(dmd, "utf8"));

    // ============================================================ E. UI（CDP + 模型）
    console.log("\n== E. UI（CDP；cdp 不通 / 没模型 → skip）==");
    if (!(ROUTE_PLAN_OK && ROUTE_MULTI_OK)) {
      skipCheck("E 段（plan / multi 接口 404：后端未就绪）", "");
    } else if (!LOADED_C) {
      skipCheck("E 段（没有加载模型）", "");
    } else {
      let WS = null;
      try { WS = (await import("ws")).default; } catch (e) {
        skipCheck("E 段（ws 模块不可用）", S(e && e.message).slice(0, 80));
      }
      if (WS) {
        const E1_FIX = fx("e1.js");
        const E2_FIX = fx("e2.py");
        const E1_CODE = ["function add(a, b) {", "  // BUG: 这里应该是 a + b", "  return a - b;", "}", "", "console.log(add(1, 2));"].join("\n");
        const E2_CODE = ["def avg(nums):", "    total = sum(nums)", "    return total / len(nums)  # BUG: 空列表会除零", "", "print(avg([]))"].join("\n");
        const SKIP_REST = { skipRest: true };
        let ws = null;
        let sendFn = null;
        let evFn = null;
        let PREV_LAST = "";
        try {
          const listRes = await fetch(CDP + "/json/list", { signal: AbortSignal.timeout(8000) });
          const list = await listRes.json();
          const page = (Array.isArray(list) ? list : []).find((t) => t && t.type === "page" && S(t.url).includes("127.0.0.1:" + PORT));
          if (!page) throw new Error("CDP 里没有 " + BASE + " 的页面（先起 headless Edge 9333 打开它）");
          ws = new WS(page.webSocketDebuggerUrl, { perMessageDeflate: false });
          await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });
          let cid = 0;
          const pend = new Map();
          ws.on("message", (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
          sendFn = (m, p) => new Promise((res) => { const i = ++cid; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
          evFn = async (expr) => {
            const r = await sendFn("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
            if (r.result && r.result.exceptionDetails) throw new Error(S(r.result.exceptionDetails.text) + " " + S(r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description));
            return r.result && r.result.result ? r.result.result.value : undefined;
          };
          const ev = evFn;
          const send = sendFn;
          const click = (id) => ev("(() => { const el = document.getElementById(" + JSON.stringify(id) + "); if (!el) return 'no'; el.click(); return 'ok'; })()");
          const waitFor = async (expr, ms, step) => {
            const t0 = Date.now();
            let last;
            while (Date.now() - t0 < (ms || 8000)) { try { last = await ev(expr); if (last) return last; } catch {} await sleep(step || 250); }
            try { last = await ev(expr); } catch {}
            return last;
          };
          const shot = async (name) => {
            try {
              fs.mkdirSync(OUT, { recursive: true });
              const r = await send("Page.captureScreenshot", { format: "png" });
              fs.writeFileSync(path.join(OUT, name), Buffer.from(r.result.data, "base64"));
              console.log("    截图: " + path.join(OUT, name));
            } catch (e) { console.log("    截图失败: " + S(e && e.message)); }
          };

          await send("Page.enable");
          await send("Runtime.enable");
          await send("Page.reload", { ignoreCache: true });
          await sleep(3500);
          await ev("(() => { ['firstModal','readmeModal'].forEach((x) => { const el = document.getElementById(x); if (el) el.hidden = true; }); return 1; })()");
          PREV_LAST = S(await ev("(() => { try { return localStorage.getItem('localai.lastSession') || ''; } catch (e) { return ''; } })()"));

          const es1 = await saveFixture(E1_FIX, E1_CODE);
          const es2 = await saveFixture(E2_FIX, E2_CODE);
          if (!(es1.status === 200 && es2.status === 200)) {
            skipCheck("E 段（UI 夹具建不起来）", "HTTP " + es1.status + "/" + es2.status);
            throw SKIP_REST;
          }

          const ids = ["cwSelAll", "cwReviewSel", "cwReviewWs", "cwExportMulti"];
          const present = await ev("(() => { const out = {}; for (const id of " + JSON.stringify(ids) + ") out[id] = !!document.getElementById(id); return out; })()");
          const idsOk = present && ids.every((x) => present[x] === true);
          check("E1 多文件 UI 入口 id 齐全（" + ids.join(" / ") + "）", idsOk, JSON.stringify(present));
          if (!idsOk) { skipCheck("E2-E9（入口 id 缺失：前端未就绪）", ""); throw SKIP_REST; }

          await click("codeBtn");
          await waitFor("!document.getElementById('codeModal').hidden", 6000);
          await click("cwRefresh");
          await waitFor("document.querySelectorAll('#cwList .cwItem[data-path]').length > 0", 10000);
          const pickSel = (p) => "document.querySelector('.cwSel[data-path=' + JSON.stringify(" + JSON.stringify(p) + ") + ']')";
          const selBoth = await waitFor("(() => { const a = " + pickSel(E1_FIX) + "; const b = " + pickSel(E2_FIX) + "; return !!(a && b); })()", 10000);
          check("E2 代码面板打开、列表里能看到 2 个夹具的勾选框", Boolean(selBoth), "");
          if (!selBoth) { skipCheck("E3-E9（列表里没有夹具勾选框）", ""); throw SKIP_REST; }

          await ev("(() => { const el = " + pickSel(E1_FIX) + "; if (el) el.click(); return 1; })()");
          await ev("(() => { const el = " + pickSel(E2_FIX) + "; if (el) el.click(); return 1; })()");
          const selCount = await waitFor("(() => { const el = document.getElementById('cwSelCount'); const t = el ? String(el.textContent || '') : ''; return /已选\\s*2/.test(t) ? t : ''; })()", 8000);
          check("E3 勾选 2 个文件 → #cwSelCount 文案「已选 2」", Boolean(selCount), S(selCount));

          await click("cwReviewSel");
          const cardCount = await waitFor("document.querySelectorAll('#cwMultiFiles .cwMultiFile').length", 30000);
          check("E4 点「审查选中」→ #cwMultiFiles 出现 2 张文件卡", Number(cardCount) === 2, "cards=" + S(cardCount));

          // 注意用「完成：」（done 事件文案），别被跨文件阶段的「跨文件总览完成，正在收尾…」提前命中
          const multiState = await waitFor("(() => { const el = document.getElementById('cwMultiState'); const t = el ? String(el.textContent || '') : ''; return /完成：/.test(t) ? t : ''; })()", 300000);
          check("E5 多文件审查跑完 → #cwMultiState 含「完成：」", Boolean(multiState), S(multiState).slice(0, 120));
          await shot("probe-code-review-multi-ui.png");

          const cardPaths = await ev("(() => { return JSON.stringify([...document.querySelectorAll('#cwMultiFiles .cwMultiFile')].map((c) => c.dataset.path || '')); })()");
          let cardList = [];
          try { cardList = JSON.parse(S(cardPaths)); } catch {}
          check("E6 文件卡 data-path = 送审的 2 个夹具", eq(cardList.slice().sort(), [E1_FIX, E2_FIX].slice().sort()), JSON.stringify(cardList));

          const headPath = await ev("(() => { const c = document.querySelector('#cwMultiFiles .cwMultiFile'); if (!c) return ''; const h = c.querySelector('.cwMultiFileHead'); if (!h) return ''; const p = c.dataset.path || ''; h.click(); return p; })()");
          let opened = false;
          if (S(headPath)) {
            opened = Boolean(await waitFor("String((document.getElementById('cwFile') || {}).textContent || '').includes(" + JSON.stringify(S(headPath)) + ")", 10000));
          }
          check("E7 点文件卡头部 → 编辑器打开该文件（#cwFile 文案）", Boolean(S(headPath)) && opened, "path=" + S(headPath));

          await click("cwExportMulti");
          const exportState = await waitFor("(() => { const el = document.getElementById('cwExportState'); const t = el ? String(el.textContent || '') : ''; return /已导出/.test(t) ? t : ''; })()", 15000);
          check("E8 点「导出多文件复审」→ #cwExportState 含「已导出」", Boolean(exportState), S(exportState).slice(0, 120));

          // E9 收尾：删夹具 + 还原 localStorage['localai.lastSession']（硬约束）
          await deleteFixture(E1_FIX);
          await deleteFixture(E2_FIX);
          const gone1 = await getJson("/api/workspace/read?path=" + encodeURIComponent(E1_FIX));
          const gone2 = await getJson("/api/workspace/read?path=" + encodeURIComponent(E2_FIX));
          const goneOK = [gone1.status, gone2.status].every((s) => s === 400 || s === 404);
          const restored = await ev("(() => { try { const v = " + JSON.stringify(PREV_LAST) + "; if (v) localStorage.setItem('localai.lastSession', v); else localStorage.removeItem('localai.lastSession'); return localStorage.getItem('localai.lastSession') || ''; } catch (e) { return '__err__'; } })()");
          check("E9 收尾：UI 夹具已删、localStorage['localai.lastSession'] 已还原", goneOK && S(restored) === PREV_LAST,
            "gone=" + goneOK + " restored=" + JSON.stringify(S(restored).slice(0, 40)) + " prev=" + JSON.stringify(PREV_LAST.slice(0, 40)));
        } catch (e) {
          if (!(e && e.skipRest)) skipCheck("E 段（CDP 不可用或页面不对）", S(e && e.message).slice(0, 140));
        } finally {
          // 无论 E 段成败：还原 localStorage + reload 页面（硬约束），再断开 CDP
          try {
            if (ws && evFn && PREV_LAST !== undefined) {
              await evFn("(() => { try { const v = " + JSON.stringify(PREV_LAST) + "; if (v) localStorage.setItem('localai.lastSession', v); else localStorage.removeItem('localai.lastSession'); } catch (e) {} const m = document.getElementById('codeModal'); if (m) m.hidden = true; return 1; })()");
            }
          } catch {}
          try { if (sendFn) await sendFn("Page.reload", { ignoreCache: true }); } catch {}
          try { if (ws) ws.close(); } catch {}
        }
      }
    }
  } catch (e) {
    fail++;
    console.log("FAIL 探针异常中断: " + S((e && e.message) || e).slice(0, 220));
  }

  // ---------- 收尾：夹具清理（跑前清残留 + 跑后删，最后再核一遍）
  await cleanupFixtures();
  const leftList = await getJson("/api/workspace/list?dir=code");
  const left = ((leftList.data && leftList.data.entries) || []).filter((e) => e && !e.dir && S(e.name).startsWith(FIX_PREFIX)).map((e) => e.name);
  check("F1 夹具已全部清理（code/" + FIX_PREFIX + "-*）", left.length === 0, left.join(",") || "clean");
}

console.log("\n== 结果: " + pass + "/" + (pass + fail) + " 通过" + (skip ? ("，" + skip + " skip") : "") + " ==");
console.log("RESULT " + pass + "/" + (pass + fail));
process.exit(fail ? 1 : 0);

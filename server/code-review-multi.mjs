/**
 * 多文件 / 整工作区一起审查（v1.10.0）——纯函数模块
 *
 * 契约：server/docs/feature-review-multi-2026-11-19/contract.md §1
 * 约束：零依赖（不 import fs / node-llama-cpp / 任何本地模块），只导出纯函数与常量，
 *       探针可以直接 import 做确定性断言（A 段不需要模型）。
 * 约定：全部函数不抛异常；字符串一律 String(x ?? "") 归一。
 */

/** 一次最多审查 8 个文件（第 9 个起 skipped: limit） */
export const MULTI_MAX_FILES = 8;
/** 单文件超过 6000 字符不直接审（skipped: too_large），提示单独审查 */
export const MULTI_PER_FILE_CHARS = 6000;
/** 可审文件累计字符上限（按顺序，超出的 skipped: budget） */
export const MULTI_TOTAL_CHARS = 36000;
/** 请求里最多接受 40 个路径（超过由 API 层 400，模块不管） */
export const MULTI_MAX_INPUT_FILES = 40;

/**
 * 围栏（三个反引号常量）：与 app.mjs 的 FENCE 同款。
 * 这里用 \u0060 转义写，源文件里就不会出现真反引号（纯函数模块放进模板串/文档时更安全）。
 */
export const FENCE = "\u0060\u0060\u0060";

/**
 * 跨文件总览的 system 提示词（多行 JSON 约束文本，契约 §2.3 要求由模块导出）。
 * app.mjs 建跨文件 sequence 时把它当 systemPrompt，用户消息用 multiCrossPrompt()。
 */
export const MULTI_CROSS_SYSTEM = [
  "你是跨文件代码审查员。用户会给出本次一起审查的文件清单、每个文件的行数与已发现的问题标题。",
  "你只做跨文件分析：找出文件之间的不一致（同一约定不一致、调用与实现不匹配、重复定义、依赖方向错误、命名或接口不一致等），不要重复各文件内部已经列出的问题。",
  "只输出一个 JSON 对象，不要解释、不要客套、不要代码块，格式固定为：",
  '{"summary":"一句话跨文件总览","findings":[{"file":"code/a.js","line":3,"endLine":3,"severity":"error","title":"短标题","detail":"为什么是跨文件问题","fix":"具体怎么改"}]}',
  "约束：file 必须是给定路径之一（逐字复制）；line/endLine 必须落在该文件的行数范围内；severity 只能是 error / warn / info；没有跨文件问题就输出 findings: []。",
].join("\n");

// ---------------------------------------------------------------- 内部小工具（不导出）

/** 取元素里的路径：string 直接用，{path} 取 path，其他转字符串 */
function rawPathOf(v) {
  if (typeof v === "string") return v;
  if (v && typeof v === "object") return v.path;
  return v;
}

/** 归一相对路径：trim → \ 换 / → 去开头 ./ 与 / → 折叠连续 / → 去尾部 / */
function normalizeRelPath(v) {
  let s = String(v ?? "").trim().replace(/\\/g, "/");
  while (s.startsWith("./") || s.startsWith("/")) s = s.slice(s.startsWith("./") ? 2 : 1);
  s = s.replace(/\/{2,}/g, "/");
  s = s.replace(/\/+$/, "");
  return s;
}

/** basename（同时认 / 与 \，不依赖 node:path） */
function baseName(p) {
  const s = String(p ?? "").replace(/\\/g, "/");
  const i = s.lastIndexOf("/");
  return i >= 0 ? s.slice(i + 1) : s;
}

/** 扩展名 → 语言（契约定死的映射；认不出 → text） */
const LANG_BY_EXT = {
  js: "javascript", mjs: "javascript", cjs: "javascript",
  ts: "typescript",
  py: "python",
  html: "html",
  css: "css",
  json: "json",
  md: "markdown",
  ps1: "powershell",
  java: "java",
  cs: "csharp",
  cpp: "cpp", cc: "cpp", cxx: "cpp", h: "cpp",
  c: "c",
  go: "go",
  rs: "rust",
  sh: "shell",
  sql: "sql",
  yml: "yaml", yaml: "yaml",
  txt: "text",
};

function langOf(name) {
  const s = String(name ?? "");
  const dot = s.lastIndexOf(".");
  if (dot < 0) return "text";
  return LANG_BY_EXT[s.slice(dot + 1).toLowerCase()] || "text";
}

/** 正整数参数兜底 */
function numOr(v, dflt) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : dflt;
}

/** 数行数（空串算 0 行；CRLF 与 LF 同口径） */
function countLines(content) {
  const s = String(content ?? "");
  if (!s) return 0;
  return s.replace(/\r\n/g, "\n").split("\n").length;
}

/** 本地 ISO 时间（带时区偏移）；非法时间 → 未知 */
function localIso(ms) {
  const d = new Date(Number(ms));
  if (!Number.isFinite(d.getTime())) return "未知";
  const p = (n) => String(n).padStart(2, "0");
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const ah = Math.floor(Math.abs(off) / 60);
  const am = Math.abs(off) % 60;
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
    "T" + p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds()) +
    sign + p(ah) + ":" + p(am);
}

// ---------------------------------------------------------------- §1.1 归一 / 去重

/**
 * §1.1 normalizeMultiPaths(raw)
 * 返回 { paths, dropped }。丢弃 reason：invalid（空 / NUL / .. 段 / 盘符 / 以 / 开头）、duplicate（大小写不敏感）。
 * 保持原顺序；非数组或空数组 → 空结构。
 */
export function normalizeMultiPaths(raw) {
  if (!Array.isArray(raw)) return { paths: [], dropped: [] };
  const paths = [];
  const dropped = [];
  const seen = new Set();
  for (const item of raw) {
    const rawText = String(rawPathOf(item) ?? "");
    // 「绝对路径 / 盘符 / ..」判定要在去掉开头 / 之前做，否则 /etc/x 会被归一成相对路径
    const slashed = rawText.trim().replace(/\\/g, "/");
    const bad =
      !slashed ||
      slashed.includes("\0") ||
      /^[A-Za-z]:/.test(slashed) ||
      slashed.startsWith("/") ||
      slashed.split("/").some((seg) => seg === "..");
    if (bad) {
      dropped.push({ path: slashed, reason: "invalid" });
      continue;
    }
    const p = normalizeRelPath(slashed);
    if (!p) {
      dropped.push({ path: slashed, reason: "invalid" });
      continue;
    }
    const key = p.toLowerCase();
    if (seen.has(key)) {
      dropped.push({ path: p, reason: "duplicate" });
      continue;
    }
    seen.add(key);
    paths.push(p);
  }
  return { paths, dropped };
}

// ---------------------------------------------------------------- §1.2 是否在 code/ 下

/** §1.2 isUnderCodeDir(p)：归一后必须以 code/ 开头且长度 > 5（真正的越界由 API 层 wsResolve 兜底） */
export function isUnderCodeDir(p) {
  const s = String(p ?? "").trim().replace(/\\/g, "/");
  return s.length > 5 && s.startsWith("code/");
}

// ---------------------------------------------------------------- §1.3 计划

/**
 * §1.3 buildMultiPlan(entries, opts)
 * entries: [{ path, content, error? }]（content 已由调用方读好；读失败传 content:"" + error）
 * 判定顺序（契约定死的列举顺序）：unreadable → empty → too_large → budget → limit。
 * totals.chars / totals.lines 只统计 ok 的（真正会送审的）。
 */
export function buildMultiPlan(entries, opts) {
  const list = Array.isArray(entries) ? entries : [];
  const o = opts && typeof opts === "object" ? opts : {};
  const maxFiles = numOr(o.maxFiles, MULTI_MAX_FILES);
  const perFileChars = numOr(o.perFileChars, MULTI_PER_FILE_CHARS);
  const totalChars = numOr(o.totalChars, MULTI_TOTAL_CHARS);
  const files = [];
  const reviewable = [];
  const skipped = [];
  let okCount = 0;
  let sumChars = 0;
  let sumLines = 0;
  for (const e of list) {
    const p = normalizeRelPath(String(e?.path ?? ""));
    const content = String(e?.content ?? "");
    const chars = content.length;
    const lines = countLines(content);
    const name = baseName(p);
    const lang = langOf(name);
    let reason = "";
    if (e?.error) reason = "unreadable";
    else if (!content.trim()) reason = "empty";
    else if (chars > perFileChars) reason = "too_large";
    else if (sumChars + chars > totalChars) reason = "budget";
    else if (okCount >= maxFiles) reason = "limit";
    const ok = !reason;
    const row = { path: p, name, lang, chars, lines, ok };
    if (!ok) row.reason = reason;
    files.push(row);
    if (ok) {
      okCount += 1;
      sumChars += chars;
      sumLines += lines;
      reviewable.push(p);
    } else {
      skipped.push({ path: p, reason, chars });
    }
  }
  return {
    files,
    reviewable,
    skipped,
    totals: { input: list.length, reviewable: reviewable.length, skipped: skipped.length, chars: sumChars, lines: sumLines },
  };
}

// ---------------------------------------------------------------- §1.4 单文件提示词

/**
 * §1.4 multiReviewPrompt({ index, total, file, lang, intent, lineCount })
 * 第一行 【第 i/N 个文件】，其余沿用单文件审查结构（【用户意图】【文件】【语言】【代码行数】+ 围栏）。
 *
 * 契约 §2.3 直接把它当第一阶段 prompt（"promptWithMeta(multiReviewPrompt({...}))"），
 * 所以这里额外接受可选字段 code（缺省 ""）把正文放进围栏——只给契约列出的 6 个字段也不会抛错。
 */
export function multiReviewPrompt(payload) {
  const p = payload && typeof payload === "object" ? payload : {};
  const rawIndex = Math.round(Number(p.index) || 1);
  const index = Math.max(1, rawIndex);
  const total = Math.max(index, Math.round(Number(p.total) || index));
  const file = String(p.file ?? "").trim() || "未命名";
  const lang = String(p.lang ?? "").trim();
  const intent = String(p.intent ?? "").trim() || "（未提供，按代码本身判断）";
  const lineCount = Math.max(0, Math.round(Number(p.lineCount) || 0));
  const code = String(p.code ?? "");
  return [
    "【第 " + index + "/" + total + " 个文件】",
    "【用户意图】" + intent,
    "【文件】" + file,
    "【语言】" + (lang || "未知"),
    "【代码行数】" + lineCount,
    "",
    "代码：",
    FENCE + lang,
    code,
    FENCE,
  ].join("\n");
}

// ---------------------------------------------------------------- §1.5 问题行原文

/**
 * §1.5 issueLineTexts(issues, code)
 * 返回新数组（不改入参）：每条加 lineText = 该行 trim 后截断 80 字符（空行 ""）；
 * 行号先 clamp 到 [1, lines.length]，但**不改**入参里原来的 line/endLine。
 */
export function issueLineTexts(issues, code) {
  if (!Array.isArray(issues)) return [];
  const lines = String(code ?? "").replace(/\r\n/g, "\n").split("\n");
  const maxLine = Math.max(1, lines.length);
  const out = [];
  for (const it of issues) {
    if (!it || typeof it !== "object") continue;
    const line = Math.min(Math.max(1, Math.round(Number(it.line) || 1)), maxLine);
    const text = String(lines[line - 1] ?? "").trim();
    out.push({ ...it, lineText: text.slice(0, 80) });
  }
  return out;
}

// ---------------------------------------------------------------- §1.6 跨文件问题归一

/**
 * §1.6 normalizeCrossFindings(list, knownPaths, opts={maxFindings=12})
 * file 匹配：先全等 → 再 basename 唯一匹配（多个同名 → 丢弃）；匹配不到丢弃计数 +1，不抛错。
 * line/endLine 只做下行，不做上行 clamp（服务端按各文件行数再 clamp）。
 */
export function normalizeCrossFindings(list, knownPaths, opts) {
  const arr = Array.isArray(list) ? list : [];
  const known = Array.isArray(knownPaths) ? knownPaths.map((x) => String(x ?? "")) : [];
  const exact = new Set(known);
  const byBase = new Map();
  for (const p of known) {
    const b = baseName(p).toLowerCase();
    const bucket = byBase.get(b);
    if (bucket) bucket.push(p);
    else byBase.set(b, [p]);
  }
  const o = opts && typeof opts === "object" ? opts : {};
  const maxFindings = numOr(o.maxFindings, 12);
  const findings = [];
  let dropped = 0;
  for (const it of arr) {
    if (!it || typeof it !== "object") {
      dropped += 1;
      continue;
    }
    const raw = String(it.file ?? "").trim().replace(/\\/g, "/");
    let file = "";
    if (exact.has(raw)) file = raw;
    else {
      const bucket = byBase.get(baseName(raw).toLowerCase());
      if (bucket && bucket.length === 1) file = bucket[0];
    }
    if (!file) {
      dropped += 1;
      continue;
    }
    if (findings.length >= maxFindings) continue;
    const line = Math.max(1, Math.round(Number(it.line) || 1));
    const endLine = Math.max(line, Math.round(Number(it.endLine) || line));
    const sev = String(it.severity ?? "").toLowerCase();
    findings.push({
      file,
      line,
      endLine,
      severity: sev === "error" || sev === "warn" || sev === "info" ? sev : "info",
      title: String(it.title ?? "").slice(0, 120) || "问题",
      detail: String(it.detail ?? "").slice(0, 800),
      fix: String(it.fix ?? "").slice(0, 800),
    });
  }
  return { findings, dropped };
}

// ---------------------------------------------------------------- §1.7 跨文件提示词

/**
 * §1.7 multiCrossPrompt({ intent, files })
 * files = [{ path, name, lines, issues: [{ line, severity, title }] }]
 * 只放摘要与问题标题、不放代码正文（节省上下文）。
 */
export function multiCrossPrompt(payload) {
  const p = payload && typeof payload === "object" ? payload : {};
  const list = Array.isArray(p.files) ? p.files : [];
  const intent = String(p.intent ?? "").trim() || "（未提供，按代码本身判断）";
  const lines = [];
  lines.push("【用户意图】" + intent);
  lines.push("【本次一起审查的文件】共 " + list.length + " 个");
  for (const f of list) {
    const path = String(f?.path ?? "");
    const n = Math.max(0, Math.round(Number(f?.lines) || 0));
    const issues = Array.isArray(f?.issues) ? f.issues : [];
    lines.push("- " + path + "（" + n + " 行，已发现 " + issues.length + " 个问题）");
    for (const it of issues.slice(0, 20)) {
      lines.push("  行 " + Math.max(1, Math.round(Number(it?.line) || 1)) + "（" + String(it?.severity ?? "info") + "）" + String(it?.title ?? ""));
    }
  }
  lines.push("");
  lines.push("请你只做跨文件分析：找出文件之间的不一致（同一约定不一致、调用与实现不匹配、重复定义、依赖方向错误、命名或接口不一致等），不要重复各文件内部已经列出的问题。");
  lines.push("只输出一个 JSON 对象，不要解释、不要客套、不要代码块，格式固定为：");
  lines.push('{"summary":"一句话跨文件总览","findings":[{"file":"code/a.js","line":3,"endLine":3,"severity":"error","title":"短标题","detail":"为什么是跨文件问题","fix":"具体怎么改"}]}');
  lines.push("约束：file 必须是上面列出的路径之一（逐字复制）；line/endLine 必须落在该文件的行数范围内；severity 只能是 error / warn / info；没有跨文件问题就输出 findings: []。");
  return lines.join("\n");
}

// ---------------------------------------------------------------- §1.8 汇总

/** §1.8 aggregateMultiReview(files)：{ files, issues, clean, bySeverity:{error,warn,info} } */
export function aggregateMultiReview(files) {
  const list = Array.isArray(files) ? files : [];
  const bySeverity = { error: 0, warn: 0, info: 0 };
  let issues = 0;
  let clean = 0;
  for (const f of list) {
    const arr = Array.isArray(f?.issues) ? f.issues : [];
    issues += arr.length;
    if (!arr.length) clean += 1;
    for (const it of arr) {
      const sev = String(it?.severity ?? "").toLowerCase();
      if (sev === "error" || sev === "warn" || sev === "info") bySeverity[sev] += 1;
    }
  }
  return { files: list.length, issues, clean, bySeverity };
}

// ---------------------------------------------------------------- §1.9 导出 Markdown

/** 跳过原因说明表（导出「## 四、跳过的文件」用） */
const SKIP_REASON_TEXT = {
  too_large: "超过单文件 " + MULTI_PER_FILE_CHARS + " 字符上限，请单独审查",
  empty: "空文件（没有可审查的内容）",
  unreadable: "读不到文件（已跳过）",
  budget: "累计字符超出本次预算（" + MULTI_TOTAL_CHARS + " 字符）",
  limit: "超过一次最多 " + MULTI_MAX_FILES + " 个文件的上限",
  duplicate: "重复路径（同一文件重复提交）",
  invalid: "非法路径（只能是 code/ 下的相对路径）",
};

function skipReasonText(reason) {
  return SKIP_REASON_TEXT[String(reason ?? "")] || "已跳过";
}

/** 一行问题 / 一条跨文件问题共用的描述拼装（detail 里的换行压成空格） */
function oneLine(text) {
  return String(text ?? "").replace(/\s*\n\s*/g, " ").trim();
}

/**
 * §1.9 buildMultiReviewMarkdown(payload)
 * 固定四节 + 说明：一、总览 / 二、逐文件结论 / 三、跨文件问题 / 四、跳过的文件。
 * 标题文字逐字固定（探针会断言）。
 */
export function buildMultiReviewMarkdown(payload) {
  const p = payload && typeof payload === "object" ? payload : {};
  const meta = p.meta && typeof p.meta === "object" ? p.meta : {};
  const files = Array.isArray(p.files) ? p.files : [];
  const skipped = Array.isArray(meta.skipped) ? meta.skipped : [];
  const cross = p.cross && typeof p.cross === "object" ? p.cross : null;
  const crossFindings = cross && Array.isArray(cross.findings) ? cross.findings : [];
  const stats = aggregateMultiReview(files);
  const out = [];

  out.push("# 多文件审查 · " + stats.files + " 个文件");
  out.push("");
  const atNum = Number(meta.at);
  const atText =
    meta.at !== undefined && meta.at !== null && meta.at !== "" && Number.isFinite(atNum) && atNum > 0
      ? localIso(atNum)
      : "未知";
  out.push("- **审查时间**：" + atText);
  out.push("- **模型**：" + (String(meta.model ?? "").trim() || "未知"));
  out.push("- **用户意图**：" + (String(meta.intent ?? "").trim() || "（未提供，按代码本身判断）"));
  out.push("- **计划**：审查 " + stats.files + " 个 / 跳过 " + skipped.length + " 个");
  out.push("");

  // 一、总览
  out.push("## 一、总览");
  out.push("");
  out.push("- **文件**：" + stats.files + " 个（无问题 " + stats.clean + " 个）");
  out.push("- **问题**：" + stats.issues + " 个（error " + stats.bySeverity.error + " · warn " + stats.bySeverity.warn + " · info " + stats.bySeverity.info + "）");
  out.push("");

  // 二、逐文件结论
  out.push("## 二、逐文件结论");
  out.push("");
  if (!files.length) {
    out.push("（没有完成任何文件）");
    out.push("");
  } else {
    files.forEach((f, i) => {
      const path = String(f?.path ?? f?.name ?? "");
      const lineCount = Math.max(0, Math.round(Number(f?.lines) || 0));
      const issues = Array.isArray(f?.issues) ? f.issues : [];
      out.push("### " + (i + 1) + ". " + path + "（" + lineCount + " 行 · " + issues.length + " 个问题）");
      out.push("");
      out.push(String(f?.summary ?? "").trim().slice(0, 1000) || "（没有摘要）");
      out.push("");
      if (!issues.length) out.push("（没有发现问题）");
      else {
        for (const it of issues.slice(0, 60)) {
          const line = Math.round(Number(it?.line) || 1);
          const endLine = Math.round(Number(it?.endLine) || line);
          const range = endLine > line ? line + "-" + endLine : String(line);
          out.push(
            "- 行 " + range + "（" + String(it?.severity ?? "info") + "）" + String(it?.title ?? "") +
            (oneLine(it?.detail) ? " —— " + oneLine(it.detail) : "") +
            (oneLine(it?.fix) ? "（建议：" + oneLine(it.fix) + "）" : ""),
          );
        }
      }
      out.push("");
    });
  }

  // 三、跨文件问题
  out.push("## 三、跨文件问题");
  out.push("");
  if (!cross) {
    out.push("（没有生成跨文件总览）");
    out.push("");
  } else if (!crossFindings.length) {
    out.push(String(cross.summary ?? "").trim() || "（没有发现跨文件问题）");
    out.push("");
  } else {
    out.push(String(cross.summary ?? "").trim() || "（没有摘要）");
    out.push("");
    for (const it of crossFindings.slice(0, 40)) {
      const line = Math.round(Number(it?.line) || 1);
      const endLine = Math.round(Number(it?.endLine) || line);
      const range = endLine > line ? line + "-" + endLine : String(line);
      out.push(
        "- " + String(it?.file ?? "") + " 行 " + range + "（" + String(it?.severity ?? "info") + "）" + String(it?.title ?? "") +
        (oneLine(it?.detail) ? " —— " + oneLine(it.detail) : ""),
      );
    }
    out.push("");
  }

  // 四、跳过的文件
  out.push("## 四、跳过的文件");
  out.push("");
  if (!skipped.length) {
    out.push("（没有跳过的文件）");
    out.push("");
  } else {
    for (const s of skipped.slice(0, 100)) {
      const chars = Number(s?.chars);
      out.push(
        "- " + String(s?.path ?? "") + " —— " + (String(s?.reason ?? "") || "skip") +
        "（" + (Number.isFinite(chars) ? Math.max(0, Math.round(chars)) : 0) + " 字符）：" + skipReasonText(s?.reason),
      );
    }
    out.push("");
  }

  // 说明
  out.push("## 说明");
  out.push("");
  out.push("- 本文件由「审查面板 → 导出多文件复审」生成，只含结论与问题描述，**不含代码正文**。");
  return out.join("\n");
}

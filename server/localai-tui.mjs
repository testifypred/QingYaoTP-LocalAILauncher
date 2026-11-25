#!/usr/bin/env node
/**
 * localai-tui —— QingYaoTP AILauncher（本地 AI）的全屏终端界面（零依赖，纯 ANSI）
 *
 *   localai tui                                正常进入
 *   localai tui --model Phi-4-mini-instruct-Q4_K_M.gguf
 *   node localai-tui.mjs --hint-test "/to"     打印命令补全候选（每行 cmd<TAB>说明，不需要服务）
 *   node localai-tui.mjs --selftest            宽度/折行/补全/参数解析自检（不需要服务）
 *   node localai-tui.mjs --snapshot            把一帧渲染成纯文本打印出来（便于检查版面）
 *   node localai-tui.mjs --plain               （管道/重定向时自动）逐行模式，/tools /tool 也能跑
 *
 * 设计要点：
 *  - 内容先清洗再上屏：模型输出里的 ESC 序列一律剥掉，防止终端被注入控制码；
 *  - 中文按 2 列宽计算，折行/截断/补空格都走同一套 wcwidth，否则整屏会歪；
 *  - 宽度统计会跳过 ANSI 转义（ESC 序列零宽），否则彩色行会被截断/错位；
 *  - 命令提示：输入以 / 开头时行内灰字补全 + 输入框下方提示条（Tab 切换候选、→ 接受、Esc 收起）；
 *  - 非 TTY（被管道/重定向）自动降级成逐行模式，方便脚本里跑。
 */
import process from "node:process";

const VER = "2.0.0";
const DEFAULT_URL = "http://127.0.0.1:8099";
/** 主程序版本：启动后从 /api/version 取；终端版本自己走 VER（独立演进，见 /version） */
const MAIN = { version: "", commit: "", builtAt: 0 };

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d = null) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};
/** --hint-test 的值以 / 开头，也可能没有值（空串 = 列出全部命令） */
function flagValue(name) {
  const i = argv.indexOf(name);
  if (i < 0) return null;
  const v = argv[i + 1];
  return v === undefined || v.startsWith("--") ? "" : v;
}
const BASE = (val("--url", process.env.LOCALAI_URL || DEFAULT_URL)).replace(/\/+$/, "");
/** 颜色：--no-color 强制关；--color 强制开（绕过 NO_COLOR，调试/被上层环境污染时用） */
const NO_COLOR = has("--no-color") || (!has("--color") && Boolean(process.env.NO_COLOR));
const SELFTEST = has("--selftest");
const SNAPSHOT = has("--snapshot");
const HINT_TEST = has("--hint-test");
const HINT_INPUT = HINT_TEST ? flagValue("--hint-test") : null;
const PLAIN = has("--plain") || !process.stdout.isTTY;
const PRINT_VERSION = has("--version");
const FACES_TEST = has("--faces");
const BENCH = has("--bench");

// ---------------------------------------------------------------- 宽度
/** 中日韩全角字符按 2 列计。覆盖常用区段即可，不做完整 Unicode 表。 */
function charWidth(cp) {
  if (cp === 0x200b) return 0;
  if (cp < 32 || (cp >= 0x7f && cp < 0xa0)) return 0;
  if (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0x303e) ||
    (cp >= 0x3041 && cp <= 0x33ff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xa000 && cp <= 0xa4cf) ||
    (cp >= 0xa960 && cp <= 0xa97f) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe10 && cp <= 0xfe19) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1f64f) ||
    (cp >= 0x1f900 && cp <= 0x1f9ff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  ) return 2;
  return 1;
}
// ANSI 转义序列：ESC [ ... 终止字节 / 单字符 ESC 序列。统计宽度时必须当零宽跳过。
const ANSI_RE = /^\u001b(?:\[[0-9;?]*[ -/]*[@-~]|[@-Z\\-_])/;
function ansiLenAt(str, i) {
  if (str.charCodeAt(i) !== 0x1b) return 0;
  const m = ANSI_RE.exec(str.slice(i));
  return m ? m[0].length : 1;
}
function strWidth(s) {
  const str = String(s);
  let w = 0;
  let i = 0;
  while (i < str.length) {
    const n = ansiLenAt(str, i);
    if (n) { i += n; continue; }
    const cp = str.codePointAt(i);
    w += charWidth(cp);
    i += cp > 0xffff ? 2 : 1;
  }
  return w;
}
function truncWidth(s, max) {
  if (max <= 0) return "";
  const str = String(s);
  let w = 0, out = "", i = 0, sawAnsi = false, cut = false;
  while (i < str.length) {
    const n = ansiLenAt(str, i);
    if (n) { out += str.slice(i, i + n); i += n; sawAnsi = true; continue; }
    const cp = str.codePointAt(i);
    const cw = charWidth(cp);
    if (w + cw > max) { cut = true; break; }
    out += String.fromCodePoint(cp);
    w += cw;
    i += cp > 0xffff ? 2 : 1;
  }
  // 只有真截断时才可能丢掉结尾的 reset，补一个防止颜色漏到后面的补白
  if (cut && sawAnsi && C.reset) out += C.reset;
  return out;
}
function padWidth(s, max) {
  const w = strWidth(s);
  if (w > max) return truncWidth(s, max);
  return w === max ? s : s + " ".repeat(max - w);
}
/** 超宽就截断并补省略号（给人看的提示/说明都用它，别直接硬切） */
function clipWidth(s, max) {
  if (strWidth(s) <= max) return String(s);
  return truncWidth(s, Math.max(1, max - 1)) + "…";
}
/** 按显示宽度折行；保留原有换行；超长无空格串也能硬切。 */
function wrapText(text, width) {
  const out = [];
  for (const raw of String(text).split("\n")) {
    if (raw === "") { out.push(""); continue; }
    let line = "", w = 0;
    for (const ch of raw) {
      const cw = charWidth(ch.codePointAt(0));
      if (w + cw > width) { out.push(line); line = ""; w = 0; }
      line += ch; w += cw;
    }
    out.push(line);
  }
  return out;
}
// 模型/工具输出里可能夹带控制序列，上屏前全部剥掉
function stripAnsi(s) {
  return String(s).replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/\u001b[@-Z\\-_]/g, "");
}

// ---------------------------------------------------------------- 颜色
const C = NO_COLOR
  ? new Proxy({}, { get: () => "" })
  : {
      reset: "\u001b[0m", dim: "\u001b[2m", bold: "\u001b[1m",
      italic: "\u001b[3m", underline: "\u001b[4m",
      cyan: "\u001b[36m", green: "\u001b[32m", yellow: "\u001b[33m",
      red: "\u001b[31m", magenta: "\u001b[35m", gray: "\u001b[90m",
      inv: "\u001b[7m",
    };

// ---------------------------------------------------------------- HTTP
async function api(path, { method = "GET", body, headers, timeout = 0 } = {}) {
  let r;
  const opts = {
    method,
    headers: body ? { "content-type": "application/json", ...(headers || {}) } : headers,
    body: body ? JSON.stringify(body) : undefined,
  };
  if (timeout > 0 && typeof AbortSignal !== "undefined" && AbortSignal.timeout) {
    opts.signal = AbortSignal.timeout(timeout);
  }
  try {
    r = await fetch(BASE + path, opts);
  } catch (e) {
    const c = String(e?.cause?.code || e?.code || "");
    if (e?.name === "TimeoutError" || e?.name === "AbortError" || c.includes("UND_ERR_CONNECT_TIMEOUT")) {
      throw new Error("请求超时（" + BASE + "）：服务没起或端口被占");
    }
    throw new Error(c.includes("ECONNREFUSED")
      ? "连不上 " + BASE + "：先把 QingYaoTP AILauncher.exe 开起来"
      : "请求失败：" + (e?.message ?? e));
  }
  const t = await r.text();
  let d = null;
  try { d = t ? JSON.parse(t) : null; } catch { d = { raw: t }; }
  if (!r.ok) throw new Error("HTTP " + r.status + "：" + (d?.error?.message ?? t.slice(0, 200)));
  return d;
}

/** 退出回调：main() 里挂上 cleanup（离开 alt screen + 恢复 raw mode），--selftest 里为空 */
let quitApp = null;

// ---------------------------------------------------------------- 状态
const S = {
  model: val("--model"),
  ctx: 0,
  tools: has("--tools"),
  web: has("--web"),
  think: has("--think"),
  messages: [],
  log: [],            // {role, text, meta}
  input: "",
  cursor: 0,
  hist: [],
  histIdx: -1,
  scroll: 0,          // 0 = 贴底
  generating: false,
  abort: null,
  status: "",
  last: { tok: 0, ms: 0, tool: 0 },
  quitArmed: false,
  token: null,        // /api/state.localToken 缓存
  toolList: null,     // GET /api/tools 归一化后的缓存
  menu: null,         // 能力面板（输入 / 时打开）：{ idx }
  spin: { frame: 0, face: "", faceAt: 0, t0: 0, timer: null }, // 等待动画
  hints: { idx: -1, closed: false, cycle: null },
};

// ---------------------------------------------------------------- 工具命令辅助
/** 把 /api/tools 的两种形状（新 args[] / 老 params[]）归一化 */
function normalizeTools(data) {
  const list = Array.isArray(data?.tools) ? data.tools : [];
  return list.map((t) => {
    const name = String(t?.name ?? "");
    let args = [];
    if (Array.isArray(t?.args) && t.args.length) {
      args = t.args.map((a) => ({
        name: String(a?.name ?? ""),
        type: String(a?.type ?? ""),
        required: a?.required === true || (Array.isArray(t?.required) && t.required.includes(a?.name)),
        desc: String(a?.description ?? ""),
      }));
    } else {
      const names = Array.isArray(t?.params) ? t.params : [];
      const req = Array.isArray(t?.required) ? t.required : [];
      args = names.map((n) => ({ name: String(n), type: "", required: req.includes(n), desc: "" }));
    }
    const argsText = args.length ? args.map((a) => a.name + (a.required ? "*" : "")).join(" ") : "";
    return { name, desc: String(t?.description ?? ""), args, argsText };
  });
}
/** 终端里打印工具清单：名字 + 参数 + 一行说明（长说明截断） */
function formatTools(list) {
  const out = ["工具 " + list.length + " 个 · 调用：/tool <name> [key=value …] [--json '<json>']"];
  for (const t of list) {
    out.push("  " + t.name + (t.args.length ? "  " + t.args.map((a) => a.name + (a.required ? ":*" : "")).join(" ") : "  （无参数）"));
    out.push("    " + clipWidth(t.desc, 150));
    const detail = t.args.filter((a) => a.desc).map((a) => a.name + "：" + a.desc);
    if (detail.length) out.push("    · " + clipWidth(detail.join("；"), 180));
  }
  return out.join("\n");
}
/** key=value 的值类型推断：数字 / true / false / null / 其余字符串 */
function coerceValue(raw) {
  const s = String(raw);
  if (s === "true") return true;
  if (s === "false") return false;
  if (s === "null") return null;
  if (/^-?\d+$/.test(s)) return Number(s);
  if (/^-?\d+\.\d+$/.test(s) && Number.isFinite(Number(s))) return Number(s);
  return s;
}
/** 按空白切词，支持单双引号（引号内的空格保留；不做反斜杠转义，Windows 路径原样保留） */
function splitTokens(text) {
  const out = [];
  let cur = "", q = null, hasCur = false;
  for (const ch of String(text)) {
    if (q) {
      if (ch === q) q = null; else cur += ch;
      hasCur = true;
      continue;
    }
    if (ch === '"' || ch === "'") { q = ch; hasCur = true; continue; }
    if (/\s/.test(ch)) {
      if (hasCur) { out.push(cur); cur = ""; hasCur = false; }
      continue;
    }
    cur += ch;
    hasCur = true;
  }
  if (hasCur) out.push(cur);
  return out;
}
/**
 * /tool 参数解析：key=value 推断类型；--json 之后「整段」都当 JSON（优先，忽略前面的 key=value）。
 * 注意这里吃的是原始字符串而不是切好的词：切词会吃掉引号，把 {"a":"b"} 弄坏。
 */
function parseToolArgs(raw) {
  const s = String(raw ?? "");
  let jsonArg = null;
  let rest = s;
  const m = /(?:^|\s)--json(?==|\s|$)/.exec(s);
  if (m) {
    const start = m.index + m[0].length;
    rest = s.slice(0, m.index);
    let after = s.slice(start).trim();
    if (after.startsWith("=")) after = after.slice(1).trim();
    jsonArg = after;
  }
  const args = {};
  for (const t of splitTokens(rest)) {
    const eq = t.indexOf("=");
    if (eq > 0) { args[t.slice(0, eq)] = coerceValue(t.slice(eq + 1)); continue; }
    if (t !== "") args[t] = true;
  }
  if (jsonArg !== null) {
    if (!jsonArg) throw new Error("--json 后面缺少 JSON，例如 --json '{\"query\":\"天气\"}'");
    let parsed;
    try { parsed = JSON.parse(jsonArg); } catch (e) { throw new Error("--json 不是合法 JSON：" + (e?.message ?? e)); }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("--json 必须是 JSON 对象，例如 {\"query\":\"天气\"}");
    return { args: parsed, fromJson: true };
  }
  return { args, fromJson: false };
}
/** 深拷贝并把超长字符串/数组截断，避免一屏刷不完 */
function trimDeep(v) {
  if (typeof v === "string") {
    return v.length > 2000 ? v.slice(0, 2000) + "…（共 " + v.length + " 字，已截断）" : v;
  }
  if (Array.isArray(v)) {
    const arr = v.slice(0, 30).map((x) => trimDeep(x));
    if (v.length > 30) arr.push("…（还有 " + (v.length - 30) + " 项）");
    return arr;
  }
  if (v && typeof v === "object") {
    const keys = Object.keys(v);
    const o = {};
    for (const k of keys.slice(0, 60)) o[k] = trimDeep(v[k]);
    if (keys.length > 60) o["…"] = "还有 " + (keys.length - 60) + " 个字段";
    return o;
  }
  return v;
}
/** result → 美化 JSON，整体过长再截一刀 */
function formatJson(v) {
  if (v === undefined) return "（无返回）";
  let s;
  try { s = JSON.stringify(trimDeep(v), null, 2); } catch (e) { s = String(v); }
  if (s === undefined) s = String(v);
  if (s.length > 12000) s = s.slice(0, 12000) + "\n…（输出过长，已截断，共 " + s.length + " 字）";
  return s;
}
async function localToken(force = false) {
  if (!force && S.token) return S.token;
  const st = await api("/api/state", { timeout: 15000 });
  S.token = st?.localToken ?? null;
  return S.token;
}
/** 拉工具清单（/tools 与 /tool 提示条共用）；force=false 时用缓存 */
async function loadTools(force = false, timeout = 10000) {
  if (!force && S.toolList) return S.toolList;
  const data = await api("/api/tools", { timeout });
  S.toolList = normalizeTools(data);
  return S.toolList;
}
/** POST /api/tool：令牌失效（403）时刷一次令牌重试 */
async function callTool(name, args) {
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const tok = await localToken(attempt > 0);
    try {
      return await api("/api/tool", {
        method: "POST",
        body: { name, args },
        headers: { "x-local-token": tok ?? "" },
        timeout: 120000,
      });
    } catch (e) {
      lastErr = e;
      if (attempt === 0 && /HTTP 403/.test(String(e?.message ?? e))) continue;
      throw e;
    }
  }
  throw lastErr ?? new Error("调用工具失败");
}

// ---------------------------------------------------------------- 命令表 / 提示
const COMMANDS = [
  { cmd: "/help", desc: "命令与用法总览", usage: "/help" },
  { cmd: "/clear", desc: "清屏（保留上下文）", usage: "/clear" },
  { cmd: "/new", desc: "清空上下文（不删会话文件）", usage: "/new" },
  { cmd: "/model", desc: "换模型（不给参数列出候选）", usage: "/model <文件>" },
  { cmd: "/state", desc: "打印服务状态", usage: "/state" },
  { cmd: "/version", desc: "终端版本 + 主程序版本", usage: "/version" },
  { cmd: "/tools", desc: "列出软件工具；on|off 切换工具调用", usage: "/tools [on|off]" },
  { cmd: "/tool", desc: "调用软件工具（名称 + 参数）", usage: "/tool <name> [key=value …] [--json '<json>']" },
  { cmd: "/run", desc: "直接跑代码（python/js/c/cpp…）", usage: "/run <语言> <代码>" },
  { cmd: "/web", desc: "联网开关（打开时隐含工具开）", usage: "/web on|off" },
  { cmd: "/think", desc: "深度思考开关", usage: "/think on|off" },
  { cmd: "/exit", desc: "退出", usage: "/exit", aliases: ["/quit"] },
];
function findCommand(tok) {
  const t = String(tok).toLowerCase();
  return COMMANDS.find((c) => c.cmd === t || (c.aliases || []).includes(t)) || null;
}
/**
 * 补全候选：{ kind:"cmd"|"tool", cmd, desc, usage, insert }
 *  - 还没打空格：匹配命令前缀，短的排前（/to → /tool 再 /tools）
 *  - 已经打空格：/tool 列工具名（首个参数位），其它命令给一行用法
 */
function computeHints(input) {
  const s = String(input ?? "");
  if (!s.startsWith("/")) return [];
  const body = s.slice(1);
  const spaced = /\s/.test(body);
  const tok = "/" + (body.split(/\s+/)[0] ?? "");
  if (!spaced) {
    const q = tok.toLowerCase();
    const hits = COMMANDS.filter((c) => c.cmd.startsWith(q) || (c.aliases || []).some((a) => a.startsWith(q)));
    hits.sort((a, b) => a.cmd.length - b.cmd.length || a.cmd.localeCompare(b.cmd));
    return hits.map((c) => ({ kind: "cmd", cmd: c.cmd, desc: c.desc, usage: c.usage, insert: c.cmd }));
  }
  const cmd = findCommand(tok);
  if (!cmd) return [];
  const after = body.slice((tok.length - 1)).trim();
  if (cmd.cmd === "/tool") {
    const toks = after.split(/\s+/).filter(Boolean);
    const list = S.toolList || [];
    if (!list.length) {
      return [{ kind: "cmd", cmd: "/tool", desc: cmd.desc + "（清单需服务在线，输入后会自动拉取 /api/tools）", usage: cmd.usage, insert: "" }];
    }
    if (toks.length <= 1) {
      const p = toks[0] ?? "";
      return list
        .filter((t) => t.name.startsWith(p))
        .map((t) => ({ kind: "tool", cmd: t.name, desc: t.desc, usage: t.name + (t.argsText ? " " + t.argsText : ""), insert: "/tool " + t.name + " " }));
    }
    const t = list.find((x) => x.name === toks[0]);
    if (t) return [{ kind: "tool", cmd: t.name, desc: t.desc, usage: t.name + (t.argsText ? " " + t.argsText : ""), insert: "" }];
    return [];
  }
  return [{ kind: "cmd", cmd: cmd.cmd, desc: cmd.desc, usage: cmd.usage, insert: "" }];
}
/** 输入变化/提交后复位提示状态（cycle = 本轮 Tab 循环用的固定候选表） */
function resetHints() {
  S.hints = { idx: -1, closed: false, cycle: null };
}
/** 行内灰字补全：只在光标贴尾、命令首词、未按 Esc 时给首个候选的剩余部分 */
function inlineGhost() {
  if (S.hints.closed) return "";
  if (!S.input.startsWith("/") || /\s/.test(S.input)) return "";
  if (S.cursor !== S.input.length) return "";
  const c = computeHints(S.input)[0];
  if (!c || !c.insert) return "";
  if (!c.insert.startsWith(S.input) || c.insert === S.input) return "";
  return c.insert.slice(S.input.length);
}
/** 输入框下方的提示条（≤6 行，高亮当前候选） */
function hintBar(inner) {
  if (S.hints.closed) return [];
  let cands = computeHints(S.input);
  // Tab 循环期间用固定的候选表（否则补全成 /new 后候选只剩 /new，就没法"连按 Tab 切换"了）
  if (S.hints.cycle && S.hints.cycle.list.length && S.input.startsWith(S.hints.cycle.base)) {
    cands = S.hints.cycle.list;
  }
  if (!cands.length) return [];
  const active = S.hints.idx >= 0 && S.hints.idx < cands.length ? S.hints.idx : 0;
  const rows = [];
  // 最多 6 行；Tab 切到第 7 个以后把窗口滚过去，保证高亮那行永远看得见
  const shown = Math.min(6, cands.length);
  const from = cands.length > shown ? Math.min(Math.max(0, active - 2), cands.length - shown) : 0;
  for (let i = from; i < from + shown; i += 1) {
    const c = cands[i];
    const on = i === active;
    const marker = on ? C.bold + C.cyan + "▸ " + C.reset : C.gray + "  " + C.reset;
    const name = (on ? C.bold + C.cyan : C.gray) + c.cmd + C.reset;
    const use = c.usage && c.usage !== c.cmd ? "  · " + c.usage : "";
    const room = Math.max(8, inner - 4 - strWidth(c.cmd));
    rows.push(truncWidth(marker + name + "  " + clipWidth(c.desc + use, room), inner));
  }
  return rows;
}

// ---------------------------------------------------------------- Markdown / LaTeX（v2.0.0）
/**
 * 终端没有浏览器：Markdown 只能「降级渲染」——粗体 / 斜体 / 行内代码 / 代码块 / 标题 / 列表 /
 * 引用 / 链接各有自己的颜色与符号；LaTeX 折成 Unicode 近似（α β √ ≤ x² …）并染洋红。
 * 折行仍走 strWidth（中文 2 列），所以彩色行不会歪。
 * 流式：模型每来一段就把整段重铺一遍；mdLinesOf 按 entry + 文本长度缓存，长回答也只解析一次。
 */
const FENCE = "\u0060\u0060\u0060";
const BT = "\u0060";
const LATEX_SYMBOLS = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε",
  zeta: "ζ", eta: "η", theta: "θ", vartheta: "ϑ", iota: "ι", kappa: "κ", lambda: "λ",
  mu: "μ", nu: "ν", xi: "ξ", omicron: "ο", pi: "π", rho: "ρ", sigma: "σ", tau: "τ",
  upsilon: "υ", phi: "φ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω",
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ",
  Upsilon: "Υ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
  sum: "∑", prod: "∏", coprod: "∐", int: "∫", iint: "∬", oint: "∮",
  infty: "∞", partial: "∂", nabla: "∇", forall: "∀", exists: "∃", neg: "¬",
  pm: "±", mp: "∓", times: "×", div: "÷", cdot: "·", cdots: "⋯", ldots: "…", dots: "…",
  le: "≤", leq: "≤", ge: "≥", geq: "≥", ne: "≠", neq: "≠", approx: "≈", equiv: "≡",
  sim: "∼", propto: "∝", perp: "⊥", parallel: "∥", angle: "∠", degree: "°", circ: "∘",
  to: "→", rightarrow: "→", leftarrow: "←", leftrightarrow: "↔",
  Rightarrow: "⇒", Leftarrow: "⇐", implies: "⟹",
  in: "∈", notin: "∉", subset: "⊂", subseteq: "⊆", supset: "⊃", supseteq: "⊇",
  cup: "∪", cap: "∩", emptyset: "∅", varnothing: "∅", therefore: "∴", because: "∵",
};
const SUP_MAP = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾", n: "ⁿ", i: "ⁱ" };
const SUB_MAP = { "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉", "+": "₊", "-": "₋", "=": "₌", "(": "₍", ")": "₎", a: "ₐ", e: "ₑ", i: "ᵢ", j: "ⱼ", k: "ₖ", n: "ₙ", o: "ₒ", p: "ₚ", s: "ₛ", t: "ₜ", u: "ᵤ", v: "ᵥ", x: "ₓ" };

function toSup(text) {
  let ok = true;
  const out = [...String(text)].map((ch) => {
    const v = SUP_MAP[ch];
    if (v === undefined) ok = false;
    return v === undefined ? ch : v;
  }).join("");
  return ok ? out : "^(" + String(text) + ")";
}
function toSub(text) {
  let ok = true;
  const out = [...String(text)].map((ch) => {
    const v = SUB_MAP[ch];
    if (v === undefined) ok = false;
    return v === undefined ? ch : v;
  }).join("");
  return ok ? out : "_(" + String(text) + ")";
}

/** LaTeX → Unicode 近似文本（纯函数，selftest 直接断言；不追求排版，只求可读） */
function latexToText(src) {
  let s = String(src ?? "");
  s = s.replace(/\\(?:left|right|big|Big|bigg|Bigg)\b/g, "");
  s = s.replace(/\\(?:,|;|:|!|\s)/g, " ");
  s = s.replace(/\\quad\b/g, "  ").replace(/\\qquad\b/g, "    ");
  s = s.replace(/\\(?:text|mathrm|mathbf|mathit|operatorname|mathcal|mathbb)\s*\{([^{}]*)\}/g, "$1");
  for (let i = 0; i < 3; i += 1) s = s.replace(/\\(?:d|t)?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "($1)/($2)");
  s = s.replace(/\\sqrt\s*\[([^\]]+)\]\s*\{([^{}]*)\}/g, "($1)√($2)");
  s = s.replace(/\\sqrt\s*\{([^{}]*)\}/g, "√($1)");
  s = s.replace(/\^\s*\{([^{}]*)\}/g, (m, g) => toSup(g));
  s = s.replace(/\^(\w)/g, (m, g) => toSup(g));
  s = s.replace(/_\s*\{([^{}]*)\}/g, (m, g) => toSub(g));
  s = s.replace(/_(\w)/g, (m, g) => toSub(g));
  s = s.replace(/\\([A-Za-z]+)/g, (m, name) => (LATEX_SYMBOLS[name] !== undefined ? LATEX_SYMBOLS[name] : name));
  s = s.replace(/\\begin\{[^}]*\}/g, "").replace(/\\end\{[^}]*\}/g, "");
  s = s.replace(/\\\\/g, "；").replace(/&/g, " ");
  s = s.replace(/[{}]/g, "");
  return s.replace(/[ \t]{2,}/g, " ").trim();
}

/** 行内语法 → 段（{t:文本, s:样式前缀}），样式是 ANSI 前缀，NO_COLOR 下为空串 */
const INLINE_RE = /(\u0060[^\u0060\n]*\u0060|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^\n]+~~|\$\$[^$\n]+\$\$|\$[^$\n]+\$|\[[^\]\n]*\]\([^)\s]+\)|\*[^*\n]+\*|_[^_\n]+_)/g;
function inlineSegments(text) {
  const s = String(text ?? "");
  const segs = [];
  let last = 0;
  INLINE_RE.lastIndex = 0;
  let m;
  while ((m = INLINE_RE.exec(s)) !== null) {
    if (m.index > last) segs.push({ t: s.slice(last, m.index), s: "" });
    const tok = m[0];
    if (tok.startsWith(BT)) segs.push({ t: tok.slice(1, -1), s: C.cyan });
    else if (tok.startsWith("**")) segs.push({ t: tok.slice(2, -2), s: C.bold });
    else if (tok.startsWith("__")) segs.push({ t: tok.slice(2, -2), s: C.bold + C.underline });
    else if (tok.startsWith("~~")) segs.push({ t: tok.slice(2, -2), s: C.dim });
    else if (tok.startsWith("$$")) segs.push({ t: latexToText(tok.slice(2, -2)), s: C.magenta + C.bold });
    else if (tok.startsWith("$")) segs.push({ t: latexToText(tok.slice(1, -1)), s: C.magenta + C.bold });
    else if (tok.startsWith("[")) {
      const mm = /^\[([^\]]*)\]\(([^)]+)\)$/.exec(tok);
      const label = mm ? mm[1] : tok;
      const url = mm ? mm[2] : "";
      segs.push({ t: label, s: C.cyan + C.underline });
      if (url && url !== label) segs.push({ t: " (" + url + ")", s: C.dim });
    } else {
      segs.push({ t: tok.slice(1, -1), s: C.italic });
    }
    last = m.index + tok.length;
  }
  if (last < s.length) segs.push({ t: s.slice(last), s: "" });
  return segs;
}

/** 按显示宽度把段铺成多行；段内样式随断行重新施加，行尾统一 reset（padWidth 会补空格） */
function layoutSegments(segs, width) {
  const lines = [];
  let cur = "";
  let curW = 0;
  const push = () => { lines.push(cur + C.reset); cur = ""; curW = 0; };
  for (const seg of segs) {
    const style = seg.s || "";
    const text = String(seg.t ?? "");
    let piece = "";
    for (const ch of text) {
      if (ch === "\n") {
        if (piece) { cur += style + piece + C.reset; piece = ""; }
        push();
        continue;
      }
      const cw = charWidth(ch.codePointAt(0));
      if (curW + cw > width) {
        if (piece) { cur += style + piece + C.reset; piece = ""; }
        push();
      }
      piece += ch;
      curW += cw;
    }
    if (piece) cur += style + piece + C.reset;
  }
  lines.push(cur + C.reset);
  return lines;
}

/** 整段 Markdown → 每行都 ≤ width 的 ANSI 行（indent 为左侧缩进空格数） */
function markdownLines(text, width, indent) {
  const pad = " ".repeat(Math.max(0, indent || 0));
  const w = Math.max(10, width - (indent || 0));
  const out = [];
  let fence = null;
  let math = false;
  for (const raw of String(text ?? "").split("\n")) {
    const line = raw.replace(/\r$/, "");
    const trimmed = line.trim();
    if (fence !== null) {
      if (trimmed.startsWith(FENCE)) {
        fence = null;
        out.push(pad + C.gray + "  └" + C.reset);
        continue;
      }
      for (const p of wrapText(line.replace(/\t/g, "    "), Math.max(8, w - 4))) {
        out.push(pad + C.gray + "  │ " + C.reset + C.cyan + p + C.reset);
      }
      continue;
    }
    if (math) {
      if (trimmed === "$$") { math = false; out.push(pad + C.magenta + "  ∑ 公式" + C.reset); continue; }
      for (const p of wrapText(latexToText(trimmed), Math.max(8, w - 2))) out.push(pad + "  " + C.magenta + C.bold + p + C.reset);
      continue;
    }
    if (trimmed === "$$") { math = true; out.push(pad + C.magenta + "  ∑ 公式" + C.reset); continue; }
    if (trimmed.startsWith(FENCE)) {
      const lang = trimmed.slice(FENCE.length).trim() || "code";
      fence = lang;
      const dash = "─".repeat(Math.max(2, Math.min(18, w - 6 - strWidth(lang))));
      out.push(pad + C.gray + "  ┌─ " + lang + " " + dash + C.reset);
      continue;
    }
    if (!trimmed) { out.push(""); continue; }
    const h = /^(#{1,6})\s+(.*?)\s*#*$/.exec(trimmed);
    if (h) {
      const level = h[1].length;
      const color = level === 1 ? C.cyan : level === 2 ? C.green : level === 3 ? C.yellow : C.bold;
      for (const l of layoutSegments([{ t: "▌ ", s: C.cyan + C.bold }, { t: h[2], s: C.bold + color }], Math.max(8, w - 2))) out.push(pad + l);
      continue;
    }
    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      out.push(pad + C.gray + "  " + "─".repeat(Math.max(4, Math.min(w - 2, 60))) + C.reset);
      continue;
    }
    if (/^\|.*\|$/.test(trimmed)) {
      for (const p of wrapText(trimmed, w - 2)) out.push(pad + "  " + C.dim + p + C.reset);
      continue;
    }
    const q = /^>\s?(.*)$/.exec(trimmed);
    if (q) {
      for (const l of layoutSegments([{ t: "▎ ", s: C.gray }, ...inlineSegments(q[1])], Math.max(8, w - 2))) out.push(pad + l);
      continue;
    }
    const b = /^([-*+]|\d+[.)])\s+(.*)$/.exec(trimmed);
    if (b) {
      const mark = /^\d/.test(b[1]) ? b[1] + " " : "• ";
      for (const l of layoutSegments([{ t: "  " + mark, s: C.cyan }, ...inlineSegments(b[2])], Math.max(8, w - 1))) out.push(pad + l);
      continue;
    }
    for (const l of layoutSegments(inlineSegments(line), w)) out.push(pad + l);
  }
  return out;
}

const MD_CACHE = new WeakMap();
function mdLinesOf(entry, width) {
  const c = MD_CACHE.get(entry);
  if (c && c.w === width && c.len === entry.text.length) return c.lines;
  const lines = markdownLines(entry.text, Math.max(12, width - 2), 2);
  MD_CACHE.set(entry, { w: width, len: entry.text.length, lines });
  return lines;
}

// ---------------------------------------------------------------- 等待动画（v2.0.0）
/** 斜杠旋转：/ - \ |（契约要求），配随机原创颜文字，2 秒换一张脸 */
const SPIN_FRAMES = ["/", "-", "\\", "|"];
const SPIN_FACES = [
  "(∫_∫)", "∂(・_・)", "(⌁_⌁)", "(◔_◔)", "(￣ω￣)", "(·_·)", "(°_°)", "(¬_¬)",
  "(⌐_⌐)", "(๑_๑)", "(￣﹏￣)", "(⇀_↼)", "(⊙_⊙)", "(⌒_⌒)", "(￢_￢)", "(￣へ￣)",
  "∫(￣▽￣)", "(・ω・)∫", "(˙ᵕ˙)", "(⌬_⌬)", "(￣◇￣)", "(⌯_⌯)",
];
function pickFace(prev) {
  if (!SPIN_FACES.length) return "";
  let f = SPIN_FACES[Math.floor(Math.random() * SPIN_FACES.length)];
  if (SPIN_FACES.length > 1 && f === prev) f = SPIN_FACES[(SPIN_FACES.indexOf(f) + 1) % SPIN_FACES.length];
  return f;
}
function spinnerText() {
  const secs = ((Date.now() - (S.spin.t0 || Date.now())) / 1000).toFixed(1);
  return C.cyan + SPIN_FRAMES[S.spin.frame] + C.reset + " " + C.magenta + (S.spin.face || "(・_・)") + C.reset +
    C.gray + " 生成中 " + secs + "s · Ctrl+C 中断" + C.reset;
}
function startSpinner() {
  stopSpinner();
  S.spin.t0 = Date.now();
  S.spin.frame = 0;
  S.spin.face = pickFace(S.spin.face);
  S.spin.faceAt = Date.now();
  S.spin.timer = setInterval(() => {
    S.spin.frame = (S.spin.frame + 1) % SPIN_FRAMES.length;
    if (Date.now() - S.spin.faceAt > 2000) { S.spin.face = pickFace(S.spin.face); S.spin.faceAt = Date.now(); }
    requestRender();
  }, 90);
  if (S.spin.timer.unref) S.spin.timer.unref();
}
function stopSpinner() {
  if (S.spin.timer) clearInterval(S.spin.timer);
  S.spin.timer = null;
}

// ---------------------------------------------------------------- 能力面板（/）
/** 面板内容 = 命令 + 软件工具（来自 /api/tools）。工具名逐字来自服务端，不硬编码。 */
function menuItems() {
  const cmds = COMMANDS.map((c) => ({ kind: "cmd", label: c.cmd, desc: c.desc }));
  const tools = (S.toolList || []).map((t) => ({
    kind: "tool", label: "/tool " + t.name, desc: t.desc, name: t.name,
    needArgs: (t.args || []).some((a) => a.required),
  }));
  return cmds.concat(tools);
}
function menuOpen() { return S.menu !== null; }
/** 输入 / 时打开：先把缓存里的工具清单铺上，再静默刷新一次（/api/tools） */
function openMenu() {
  S.menu = { idx: 0 };
  if (!S.toolList) loadTools(true, 4000).then(() => requestRender()).catch(() => {});
  requestRender();
}
/** 执行面板选中项：命令直接跑；工具缺必填参数就先填进输入框，回车再发 */
async function runMenu() {
  const items = menuItems();
  const it = items[Math.max(0, Math.min(S.menu ? S.menu.idx : 0, items.length - 1))];
  S.menu = null;
  if (!it) return true;
  if (it.kind === "tool") {
    if (it.needArgs) {
      S.input = "/tool " + it.name + " ";
      S.cursor = S.input.length;
      resetHints();
      requestRender();
      return true;
    }
    S.input = ""; S.cursor = 0; resetHints();
    requestRender();
    return await handleSlash("/tool " + it.name);
  }
  S.input = ""; S.cursor = 0; resetHints();
  requestRender();
  return await handleSlash(it.label);
}

// ---------------------------------------------------------------- 日志
function entry(role, text, meta) {
  const t = stripAnsi(text);
  S.log.push({ role, text: t, meta: meta ?? null });
  S.scroll = 0;
  // 降级模式没有重绘循环，命令结果必须直接落到 stdout，否则 /state 之类会“静默”
  if (PLAIN) {
    const pre = role === "sys" ? "· " : role === "tool" ? "  🔧 " : "";
    process.stdout.write(pre + t + "\n");
  }
}

// ---------------------------------------------------------------- 直连聊天
async function streamChat(onDelta, onTool) {
  const payload = {
    model: S.model || undefined,
    messages: S.messages,
    stream: true,
    tools: S.tools,
    web: S.web,
    thinking: S.think,
  };
  const ctrl = new AbortController();
  S.abort = ctrl;
  const t0 = Date.now();
  const r = await fetch(BASE + "/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: ctrl.signal,
  });
  if (!r.ok) {
    const t = await r.text();
    let m = t.slice(0, 200);
    try { m = JSON.parse(t)?.error?.message ?? m; } catch {}
    throw new Error("HTTP " + r.status + "：" + m);
  }
  const dec = new TextDecoder();
  let buf = "", full = "", usage = null, tools = 0;
  for await (const piece of r.body) {
    buf += dec.decode(piece, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, i); buf = buf.slice(i + 2);
      const line = block.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      const raw = line.slice(5).trim();
      if (raw === "[DONE]") continue;
      let ev; try { ev = JSON.parse(raw); } catch { continue; }
      const d = ev.choices?.[0]?.delta ?? {};
      if (d.content) { full += d.content; onDelta(d.content); }
      if (d.tool) { tools += 1; onTool(d.tool); }
      if (ev.usage) usage = ev.usage;
    }
  }
  S.last = { tok: usage?.completion_tokens ?? 0, ms: Date.now() - t0, tool: tools };
  S.abort = null;
  return full;
}

// ---------------------------------------------------------------- 渲染
/** 线框顶：╭─ 标题 ─…─╮（宽度锚定 inner，中文按 2 列算） */
function boxTop(inner, title, right) {
  const t = " " + String(title || "") + " ";
  const r = right ? " " + String(right) : "";
  const dash = inner - 3 - strWidth(t) - strWidth(r);
  if (dash < 1) return C.gray + clipWidth("╭─" + t + r + "╮", inner) + C.reset;
  return C.gray + "╭─" + C.reset + C.bold + t + C.reset + C.gray + "─".repeat(dash) + r + "╮" + C.reset;
}
/** 线框底：╰─ 说明 ─…─╯ */
function boxBottom(inner, label) {
  const lab = label ? " " + String(label) + " " : "";
  const dash = inner - 3 - strWidth(lab);
  if (dash < 1) return C.gray + clipWidth("╰─" + lab + "╯", inner) + C.reset;
  return C.gray + "╰─" + C.reset + lab + C.gray + "─".repeat(dash) + "╯" + C.reset;
}

/** 输入区：线框 + 可见光标块（反显；NO_COLOR 降级成 ▏），多行时窗口跟着光标滚 */
function inputBoxLines(inner, maxLines) {
  const avail = Math.max(8, inner - 6);
  const chars = [...S.input];
  const cursorIdx = [...S.input.slice(0, S.cursor)].length;
  const raw = [];
  let text = "";
  let w = 0;
  let start = 0;
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i];
    const cw = charWidth(ch.codePointAt(0));
    if (w + cw > avail && text) {
      raw.push({ text, start });
      text = "";
      start = i;
      w = 0;
    }
    text += ch;
    w += cw;
  }
  raw.push({ text, start });
  let cl = raw.length - 1;
  for (let i = 0; i < raw.length; i += 1) {
    const arr = [...raw[i].text];
    if (cursorIdx >= raw[i].start && cursorIdx <= raw[i].start + arr.length) { cl = i; break; }
  }
  const maxL = Math.max(1, maxLines);
  let from = 0;
  if (raw.length > maxL) from = Math.min(Math.max(0, cl - maxL + 1), raw.length - maxL);
  const rows = [boxTop(inner, "输入" + (S.input ? " · " + [...S.input].length + " 字" : ""), S.generating ? "生成中" : "")];
  for (let i = from; i < Math.min(raw.length, from + maxL); i += 1) {
    const arr = [...raw[i].text];
    const off = cursorIdx >= raw[i].start && cursorIdx <= raw[i].start + arr.length ? cursorIdx - raw[i].start : -1;
    let bodyText = "";
    for (let k = 0; k < arr.length; k += 1) {
      if (k === off) bodyText += NO_COLOR ? arr[k] + "▏" : C.inv + arr[k] + C.reset;
      else bodyText += arr[k];
    }
    if (off === arr.length) bodyText += NO_COLOR ? "▏" : C.inv + " " + C.reset;
    const prompt = i === 0 ? C.cyan + "› " + C.reset : (from > 0 && i === from ? C.gray + "↑ " + C.reset : "  ");
    const curW = off === arr.length ? 1 : 0;
    const fill = " ".repeat(Math.max(0, avail - strWidth(raw[i].text) - curW));
    rows.push("│ " + prompt + bodyText + fill + " │");
  }
  rows.push(boxBottom(inner, S.generating ? spinnerText() : ""));
  return rows.map((r) => padWidth(r, inner));
}

function headerLine(inner) {
  // 左：产品名 + 终端版本 + 主程序版本（两者都要在，排障时一眼看到）
  const left = " QingYaoTP AILauncher" + C.gray + " · tui " + VER + " · 主程序 v" + (MAIN.version || "?") +
    (MAIN.commit ? " (" + String(MAIN.commit).slice(0, 7) + ")" : "") + C.reset;
  // 右：模型 / ctx / 工具 / 联网 —— 宽度不够就按优先级丢掉后面的，绝不把版本号挤掉
  const model = (S.model || "（未指定）").replace(/\.gguf$/i, "");
  const ctxText = S.ctx ? (S.ctx >= 1024 && S.ctx % 1024 === 0 ? S.ctx / 1024 + "k" : String(S.ctx)) : "?";
  const cands = [
    C.gray + model + C.reset,
    C.gray + "ctx " + ctxText + C.reset,
    S.tools ? C.green + "工具开" + C.reset : C.gray + "工具关" + C.reset,
    S.web ? C.green + "联网开" + C.reset : "",
  ].filter(Boolean);
  let right = "";
  for (const c of cands) {
    const w = strWidth(c) + (right ? 2 : 0);
    if (strWidth(left) + 1 + strWidth(right) + w > inner) break;
    right = right ? right + "  " + c : c;
  }
  const gap = inner - strWidth(left) - strWidth(right);
  const line = gap >= 1 ? left + " ".repeat(gap) + right : clipWidth(left, inner);
  return padWidth(line, inner);
}

/** 能力面板（输入 / 打开）：命令 + 工具，↑↓ 选、Enter 跑、Esc 收起 */
function menuRows(inner) {
  if (!menuOpen()) return [];
  const items = menuItems();
  if (!items.length) return [];
  const maxShown = 9;
  const shown = Math.min(maxShown, items.length);
  const idx = Math.max(0, Math.min(S.menu.idx, items.length - 1));
  const from = items.length > shown ? Math.min(Math.max(0, idx - Math.floor(shown / 2)), items.length - shown) : 0;
  const rows = [boxTop(inner, "能力面板", "↑↓ 选择 · Enter 执行 · Esc 收起")];
  for (let i = from; i < from + shown; i += 1) {
    const it = items[i];
    const on = i === idx;
    const label = padWidth(clipWidth(it.label, 26), 26);
    const room = Math.max(6, inner - 34);
    const row = C.gray + "│ " + C.reset + (on ? C.bold + C.cyan + "▸ " : C.gray + "  ") + C.reset +
      (on ? C.bold + C.cyan : C.gray) + label + C.reset + "  " + C.gray + padWidth(clipWidth(it.desc, room), room) + C.reset +
      " " + C.gray + "│" + C.reset;
    rows.push(padWidth(row, inner));
  }
  rows.push(boxBottom(inner, "工具来自 /api/tools · 共 " + items.length + " 项"));
  return rows;
}

/** 正文：assistant 走 Markdown 降级渲染，其余按角色着色的普通行 */
function bodyLines(inner) {
  const body = [];
  for (const e of S.log) {
    if (e.role === "user") {
      body.push("");
      const ls = wrapText(e.text, Math.max(8, inner - 2));
      for (let i = 0; i < ls.length; i += 1) body.push(i === 0 ? C.cyan + "› " + C.reset + ls[i] : "  " + ls[i]);
      continue;
    }
    if (e.role === "assistant") {
      for (const l of mdLinesOf(e, inner)) body.push(l);
      if (e.meta) body.push(C.gray + "  " + e.meta + C.reset);
      continue;
    }
    if (e.role === "tool") {
      for (const l of String(e.text).split("\n")) body.push(C.gray + "  🔧 " + l + C.reset);
      continue;
    }
    if (e.role === "error") {
      body.push("");
      for (const l of wrapText(String(e.text), Math.max(8, inner - 4))) body.push(C.red + "  " + l + C.reset);
      continue;
    }
    for (const l of String(e.text).split("\n")) body.push(C.magenta + "  " + l + C.reset);
  }
  if (!S.log.length) {
    body.push("");
    body.push(C.gray + "  直接输入问题回车发送；输入 " + C.cyan + "/" + C.gray + " 打开能力面板（命令 + 工具）。" + C.reset);
    body.push(C.gray + "  Tab 补全 · ↑↓ 历史 · PgUp/PgDn 滚动 · Ctrl+C 中断（再按一次退出）" + C.reset);
    body.push("");
    body.push(C.dim + "  localai tui " + VER + " · 主程序 v" + (MAIN.version || "?") + C.reset);
  }
  return body;
}

function frame(cols, rows) {
  const inner = Math.max(32, cols);
  const out = [headerLine(inner), C.gray + "─".repeat(inner) + C.reset];
  const menu = menuRows(inner);
  const box = inputBoxLines(inner, Math.max(1, Math.min(6, rows - 14)));
  let hints = menu.length ? [] : hintBar(inner);
  const room = rows - 2 - menu.length - box.length - 1;
  if (hints.length > Math.max(0, room - 2)) hints = hints.slice(0, Math.max(0, room - 2));
  const bodyH = Math.max(2, room - hints.length);
  const body = bodyLines(inner);
  const maxScroll = Math.max(0, body.length - bodyH);
  S.scroll = Math.min(S.scroll, maxScroll);
  const end = body.length - S.scroll;
  const slice = body.slice(Math.max(0, end - bodyH), end);
  while (slice.length < bodyH) slice.push("");
  out.push(...slice.map((l) => padWidth(l, inner)));
  out.push(...menu);
  out.push(...box);
  out.push(...hints.map((h) => padWidth(h, inner)));
  const stat = S.generating
    ? C.gray + " 生成中 · Ctrl+C 中断" + C.reset
    : S.status
      ? C.yellow + " " + S.status + C.reset
      : menu.length
        ? C.gray + " ↑↓/Tab 选择 · Enter 执行 · Esc 收起 · 也可以直接打 /tool 名字 调用" + C.reset
        : hints.length
          ? C.gray + " Tab 切换候选 · → 接受补全 · Esc 收起 · Enter 执行" + C.reset
          : C.gray + " Enter 发送 · / 能力面板 · Tab 补全 · ↑↓ 历史 · PgUp/PgDn 滚动" + C.reset;
  out.push(padWidth(stat, inner));
  // 极端小终端（menu + 多行输入把正文挤没）时也保证铺满 rows 行：否则底部会残留上一帧
  while (out.length < rows) out.push(" ".repeat(inner));
  return { lines: out.slice(0, rows) };
}

let renderTimer = null;
/** 16ms 合并（约 60fps）：SSE 每个 delta 都触发，但不逐字重绘整屏 */
function requestRender() {
  if (renderTimer || PLAIN || SNAPSHOT) return;
  renderTimer = setTimeout(() => { renderTimer = null; render(); }, 16);
}
function render() {
  if (PLAIN) return;
  const cols = process.stdout.columns || 100;
  const rows = process.stdout.rows || 30;
  const f = frame(cols, rows);
  let s = "\u001b[H";
  for (let i = 0; i < f.lines.length; i += 1) {
    s += padWidth(f.lines[i], cols) + (i === f.lines.length - 1 ? "" : "\n");
  }
  process.stdout.write(s);
}

// ---------------------------------------------------------------- 命令实现
function helpText() {
  const width = Math.max(...COMMANDS.map((c) => strWidth(c.usage)));
  const lines = [];
  lines.push("localai tui " + VER + " · 主程序 v" + (MAIN.version || "?") + "（详情 /version）");
  lines.push("");
  lines.push("命令（输入 / 开头可出现命令提示；Tab 补全、→ 接受、Esc 收起）：");
  for (const c of COMMANDS) lines.push("  " + padWidth(c.usage, width) + "  " + c.desc);
  lines.push("", "工具：/tools 看清单 · /tool <name> key=value … · /tool <name> --json '{\"k\":\"v\"}'");
  return lines.join("\n");
}
async function slashCommand(line) {
  const [cmd, ...rest] = line.slice(1).split(/\s+/);
  const arg = rest.join(" ");
  const onoff = (v) => (v === "on" ? true : v === "off" ? false : null);
  switch ((cmd || "").toLowerCase()) {
    case "help": entry("sys", helpText()); return true;
    case "exit": case "quit": return false;
    case "clear": S.log = []; return true;
    case "new": S.messages = []; entry("sys", "上下文已清空"); return true;
    case "tools": {
      const v = onoff(arg);
      if (arg && v === null) { entry("sys", "用法：/tools 看工具清单 · /tools on|off 切换工具调用"); return true; }
      if (v !== null) {
        S.tools = v; if (!v) S.web = false;
        entry("sys", "工具调用 " + (v ? "开" : "关"));
        return true;
      }
      const list = await loadTools(true);
      if (!list.length) { entry("sys", "服务端没有可用工具"); return true; }
      entry("sys", formatTools(list));
      return true;
    }
    case "tool": {
      const nm = /^(\S+)(?:\s+|$)/.exec(arg.trim());
      if (!nm) {
        entry("sys", "用法：/tool <name> [key=value …] [--json '<json>']\n先用 /tools 看可用工具（Tab 也能补全工具名）");
        return true;
      }
      const name = nm[1];
      const { args } = parseToolArgs(arg.trim().slice(nm[0].length));
      let r;
      try {
        r = await callTool(name, args);
      } catch (e) {
        const msg = String(e?.message ?? e);
        if (/HTTP 404/.test(msg) && /无此路由|not found/i.test(msg)) {
          throw new Error("/api/tool 还没上线（" + msg + "）：后端本轮新增该接口，服务更新后即可；先 /tools 看清单");
        }
        throw e;
      }
      const used = r?.tool ?? name;
      entry("tool", used + " → " + (r?.ms ?? "?") + "ms");
      const result = r?.result;
      const errText = result && typeof result === "object" ? result.error : null;
      if (errText) entry("error", "工具返回错误：" + String(errText));
      entry("assistant", formatJson(result));
      return true;
    }
    case "web": {
      const v = onoff(arg); if (v === null) { entry("sys", "用法：/web on|off"); return true; }
      S.web = v; if (v) S.tools = true; entry("sys", "联网 " + (v ? "开" : "关")); return true;
    }
    case "think": {
      const v = onoff(arg); if (v === null) { entry("sys", "用法：/think on|off"); return true; }
      S.think = v; entry("sys", "思考 " + (v ? "开" : "关")); return true;
    }
    case "state": {
      const st = await api("/api/state", { timeout: 15000 });
      entry("sys", "模型 " + (st.loaded ?? "无") + " · ctx " + st.context + " · " + st.layers + " 层 · " + st.gpu +
        (st.loading ? " · 加载中" : ""));
      return true;
    }
    case "model": {
      if (!arg) {
        const st = await api("/api/state", { timeout: 15000 });
        const ms = Array.isArray(st.models) ? st.models : [];
        entry("sys", ms.length
          ? "候选：" + ms.map((m) => m.file + (m.file === st.loaded ? "（当前）" : "")).join("\n      ")
          : "模型目录里没有 .gguf");
        return true;
      }
      await api("/api/load", { method: "POST", body: { file: arg } });
      S.model = arg; S.messages = [];
      entry("sys", "已切换到 " + arg + "，上下文已清空");
      return true;
    }
    case "run": {
      const lang = rest[0];
      const code = rest.slice(1).join(" ");
      if (!lang || !code) { entry("sys", "用法：/run python print(6*7)"); return true; }
      const st = await api("/api/state", { timeout: 15000 });
      const r = await api("/api/run", { method: "POST", body: { lang, code }, headers: { "x-local-token": st.localToken }, timeout: 60000 });
      entry("tool", lang + " → exit " + r.code + " · " + r.ms + "ms");
      if (r.stdout) entry("assistant", r.stdout.trimEnd());
      return true;
    }
    case "version": {
      let v = null;
      try { v = await api("/api/version", { timeout: 5000 }); } catch {}
      entry("sys", [
        "localai tui    " + VER,
        "主程序         v" + ((v && v.version) || MAIN.version || "?") + (v && v.commit ? " · commit " + String(v.commit).slice(0, 10) : ""),
        v && v.builtAt ? "构建           " + new Date(v.builtAt).toLocaleString() : "",
        "Node           " + process.version,
        "服务           " + BASE,
        "模型           " + (S.model || "未指定") + " · ctx " + (S.ctx || "?"),
      ].filter(Boolean).join("\n"));
      return true;
    }
    default:
      entry("sys", "未知命令 /" + cmd + "，输入 /help");
      return true;
  }
}
async function handleSlash(line) {
  try {
    return await slashCommand(line);
  } catch (e) {
    entry("error", String(e?.message ?? e));
    return true;
  }
}

// ---------------------------------------------------------------- 发送
async function send(text) {
  const trimmed = text.trim();
  if (!trimmed) return;
  S.hist.push(trimmed); S.histIdx = -1;
  entry("user", trimmed);
  S.messages.push({ role: "user", content: trimmed });
  S.generating = true;
  S.status = "";
  S.menu = null;
  startSpinner();
  const holder = { role: "assistant", text: "", meta: null };
  S.log.push(holder);
  let acc = "";
  try {
    await streamChat(
      (d) => { acc += d; holder.text = acc; requestRender(); },
      (t) => {
        const args = t.args && Object.keys(t.args).length ? JSON.stringify(t.args).slice(0, 50) : "{}";
        S.log.splice(S.log.indexOf(holder), 0, { role: "tool", text: t.name + " " + args + " → " + (t.ms ?? "?") + "ms" });
        requestRender();
      },
    );
    S.messages.push({ role: "assistant", content: acc });
    holder.meta = (S.last.tok || 0) + " tok · " + (S.last.tool ? S.last.tool + " 次工具 · " : "") + (S.last.ms / 1000).toFixed(1) + "s";
  } catch (e) {
    if (String(e?.name) === "AbortError") {
      holder.text = acc ? acc + "\n（已中断）" : "（已中断）";
    } else {
      holder.role = "error";
      holder.text = String(e?.message ?? e);
      holder.meta = null;
    }
  } finally {
    S.generating = false;
    S.abort = null;
    stopSpinner();
    requestRender();
  }
}

// ---------------------------------------------------------------- 主循环
async function ensureModel() {
  if (S.model) return;
  const st = await api("/api/state", { timeout: 15000 });
  S.ctx = st.context || 0;
  S.model = st.loaded || null;
  if (!S.model) {
    const pick = [...(st.models ?? [])].sort((a, b) => a.sizeGB - b.sizeGB)[0];
    if (!pick) throw new Error("模型目录里没有 .gguf");
    S.status = "正在加载 " + pick.file + " …"; requestRender();
    await api("/api/load", { method: "POST", body: { file: pick.file } });
    S.model = pick.file;
    S.status = "";
  }
}

let toolLoadTimer = null;
function maybeLoadTools() {
  if (S.toolList || toolLoadTimer) return;
  toolLoadTimer = setTimeout(async () => {
    toolLoadTimer = null;
    try { await loadTools(true, 4000); } catch {}
    requestRender();
  }, 150);
}

/** Tab：补全到当前候选；连按 Tab 在候选间切换 */
function completeHint() {
  if (!S.input) {
    S.input = "/"; S.cursor = 1; resetHints();
    render();
    return;
  }
  if (!S.input.startsWith("/")) return;
  let cycle = S.hints.cycle;
  if (!cycle || S.hints.idx < 0) {
    // 第一次 Tab：把当前输入对应的候选表固定下来，之后连按 Tab 只在这张表里循环
    const list = computeHints(S.input);
    if (!list.length) return;
    cycle = { base: S.input, list };
    S.hints.cycle = cycle;
    S.hints.idx = 0;
  } else {
    S.hints.idx = (S.hints.idx + 1) % cycle.list.length;
  }
  S.hints.closed = false;
  const c = cycle.list[S.hints.idx];
  if (c.insert) { S.input = c.insert; S.cursor = S.input.length; }
  render();
}

async function handleKey(s) {
    // Ctrl+C：生成中先中断；面板打开先收起；都没有才走「再按一次退出」
    if (s === "\u0003") {
      if (S.generating && S.abort) { S.abort.abort(); return; }
      if (menuOpen()) { S.menu = null; render(); return; }
      if (S.quitArmed) { if (quitApp) quitApp(0); return; }
      S.quitArmed = true;
      S.status = "再按一次 Ctrl+C 退出";
      requestRender();
      setTimeout(() => { S.quitArmed = false; S.status = ""; requestRender(); }, 2500);
      return;
    }
    if (s === "\u000c") { S.log = []; S.menu = null; render(); return; } // Ctrl+L
    // 能力面板：Tab/↑↓ 选、Enter 执行、Esc 收起、退格回空；打字即回输入区
    if (menuOpen()) {
      if (s === "\t" || s === "\u001b[B") {
        S.menu.idx = (S.menu.idx + 1) % Math.max(1, menuItems().length);
        render();
        return;
      }
      if (s === "\u001b[Z" || s === "\u001b[A") {
        const n = Math.max(1, menuItems().length);
        S.menu.idx = (S.menu.idx - 1 + n) % n;
        render();
        return;
      }
      if (s === "\u001b") { S.menu = null; render(); return; }
      if (s === "\u007f" || s === "\b") { S.input = ""; S.cursor = 0; S.menu = null; resetHints(); render(); return; }
      if (s === "\r" || s === "\n") {
        if (S.generating) { render(); return; }
        const keep = await runMenu();
        if (!keep) { if (quitApp) quitApp(0); return; }
        render();
        return;
      }
    }
    if (s === "\t") { completeHint(); return; }            // Tab 补全/切换候选
    if (s === "\r" || s === "\n") {
      // 生成中再回车不并发发问：服务端一次只跑一轮，并发只会让两边都卡
      if (S.generating) { S.status = "上一轮还在生成，Ctrl+C 可中断"; requestRender(); return; }
      let text = S.input;
      const head = text.trim();
      // 只打了「/」就回车：重开能力面板，绝不能补成 /new 把上下文清了
      if (head === "/") { S.input = "/"; S.cursor = 1; openMenu(); render(); return; }
      // 半截命令 + 回车：先补成首个候选（/he → /help），再执行
      if (head.startsWith("/") && !/\s/.test(head) && !findCommand(head)) {
        const c = computeHints(head)[0];
        if (c && c.insert) text = c.insert;
      }
      S.input = ""; S.cursor = 0; S.menu = null; resetHints();
      if (text.trim().startsWith("/")) {
        const keep = await handleSlash(text.trim());
        if (!keep) { if (quitApp) quitApp(0); return; }
        render();
      } else {
        render();
        await send(text);
      }
      return;
    }
    if (s === "\u007f" || s === "\b") {
      if (S.cursor > 0) {
        S.input = S.input.slice(0, S.cursor - 1) + S.input.slice(S.cursor);
        S.cursor -= 1;
        S.menu = null;
        resetHints();
        render();
      }
      return;
    }
    if (s === "\u001b[A") { // ↑ 历史
      if (S.hist.length) { S.histIdx = Math.min(S.hist.length - 1, S.histIdx + 1); S.input = S.hist[S.hist.length - 1 - S.histIdx]; S.cursor = S.input.length; resetHints(); render(); }
      return;
    }
    if (s === "\u001b[B") {
      if (S.histIdx >= 0) { S.histIdx -= 1; S.input = S.histIdx < 0 ? "" : S.hist[S.hist.length - 1 - S.histIdx]; S.cursor = S.input.length; resetHints(); render(); }
      return;
    }
    if (s === "\u001b[5~") { S.scroll = Math.min(S.scroll + 5, 9999); render(); return; }
    if (s === "\u001b[6~") { S.scroll = Math.max(0, S.scroll - 5); render(); return; }
    if (s === "\u001b[D") { S.cursor = Math.max(0, S.cursor - 1); render(); return; }
    if (s === "\u001b[C") { // → ：有行内补全就接受，否则右移光标
      const g = inlineGhost();
      if (g) { S.input += g; S.cursor = S.input.length; S.hints.closed = true; S.hints.cycle = null; render(); return; }
      S.cursor = Math.min(S.input.length, S.cursor + 1); render();
      return;
    }
    if (s === "\u001b") { // Esc 收起提示条
      if (!S.hints.closed) { S.hints.closed = true; S.hints.idx = -1; S.hints.cycle = null; render(); }
      return;
    }
    if (s.startsWith("\u001b")) return; // 其它转义序列忽略
    const printable = s.replace(/[\u0000-\u001f]/g, "");
    if (!printable) return;
    const wasEmpty = S.input === "" && S.cursor === 0;
    S.input = S.input.slice(0, S.cursor) + printable + S.input.slice(S.cursor);
    S.cursor += printable.length;
    S.quitArmed = false;
    if (wasEmpty && printable === "/") {
      openMenu(); // 空输入按 / 直接开能力面板
    } else {
      if (S.menu) S.menu = null;
      resetHints();
    }
    if (S.input.startsWith("/tool")) maybeLoadTools();
    render();
}


async function main() {
  if (HINT_TEST) return hintTest(HINT_INPUT ?? "");
  if (SELFTEST) return selftest();
  if (SNAPSHOT) return snapshot();
  if (PRINT_VERSION) return await printVersion();
  if (FACES_TEST) return facesTest();
  if (BENCH) return bench();
  if (PLAIN) return plainMode();
  await ensureModel();

  process.stdout.write("\u001b[?1049h\u001b[?25l\u001b[2J");
  const cleanup = () => {
    process.stdout.write("\u001b[?25h\u001b[?1049l");
    if (process.stdin.isTTY) { try { process.stdin.setRawMode(false); } catch {} }
    process.stdin.pause();
  };
  const bye = (code = 0) => { cleanup(); process.exit(code); };
  quitApp = bye;
  process.on("exit", () => { try { process.stdout.write("\u001b[?25h\u001b[?1049l"); } catch {} });
  process.on("SIGINT", () => bye(0));
  process.stdout.on("resize", () => render());

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  render();
  // 首帧先出来，再异步补版本号与工具清单（/ 面板与 /tool 提示条都靠它）
  loadVersion().then(() => requestRender()).catch(() => {});
  loadTools(true, 4000).catch(() => {});

  // 挂完处理器就进入事件循环：这里必须挂住，否则 main() 一返回外层就 process.exit，窗口秒关
  const done = new Promise(() => {});

  process.stdin.on("data", (chunk) => {
    Promise.resolve(handleKey(String(chunk))).catch(() => {});
  });

  return await done;
}

// ---------------------------------------------------------------- 降级：非 TTY
async function plainMode() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const lines = Buffer.concat(chunks).toString("utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  // 全是 / 命令时不必加载模型：/tools /tool 这类脚本用法要快
  const needModel = lines.some((l) => !l.startsWith("/"));
  if (needModel) await ensureModel();
  for (const line of lines) {
    if (line.startsWith("/")) { if (!(await handleSlash(line))) break; continue; }
    S.messages.push({ role: "user", content: line });
    let acc = "";
    const full = await streamChat((d) => { acc += d; process.stdout.write(d); }, (t) => {
      process.stderr.write("\n  🔧 " + t.name + " → " + (t.ms ?? "?") + "ms\n");
    });
    if (!acc) process.stdout.write(full);
    process.stdout.write("\n");
    S.messages.push({ role: "assistant", content: acc || full });
  }
  return 0;
}

// ---------------------------------------------------------------- 自检 / 快照 / 提示测试
async function hintTest(input) {
  const raw = String(input ?? "");
  if (raw.startsWith("/tool") && /\s/.test(raw)) {
    try { await loadTools(true, 4000); } catch {}
  }
  const cands = computeHints(raw || "/");
  if (!cands.length) {
    process.stdout.write("（无匹配：" + raw + "）\n");
    return 0;
  }
  for (const c of cands.slice(0, 40)) process.stdout.write(c.cmd + "\t" + c.desc + "\n");
  return 0;
}

function selftest() {
  let bad = 0, n = 0;
  const check = (ok, label, extra) => {
    n += 1;
    if (!ok) { bad += 1; console.log("FAIL " + label + (extra === undefined ? "" : " → " + JSON.stringify(extra))); }
  };
  // 1) 宽度
  for (const [s, w] of [["abc", 3], ["中文", 4], ["a中b", 4], ["", 0]]) check(strWidth(s) === w, "width " + JSON.stringify(s), strWidth(s));
  // 2) ANSI 序列零宽
  check(strWidth("\u001b[31m红\u001b[0m") === 2, "width ansi", strWidth("\u001b[31m红\u001b[0m"));
  // 3) 折行
  const w1 = wrapText("这是一段需要折行的中文文本", 10);
  check(w1.every((l) => strWidth(l) <= 10), "wrap 超宽", w1);
  check(wrapText("a\nb\n", 10).join("|") === "a|b|", "wrap 换行", wrapText("a\nb\n", 10));
  // 4) 补白 / 截断
  check(padWidth("中文", 6) === "中文  ", "pad", padWidth("中文", 6));
  check(truncWidth("中文字", 5) === "中文", "trunc", truncWidth("中文字", 5));
  check(truncWidth("\u001b[31m中文字\u001b[0m", 4).startsWith("\u001b[31m中文"), "trunc ansi", truncWidth("\u001b[31m中文字\u001b[0m", 4));
  // 5) 控制码清洗
  check(stripAnsi("\u001b[31m红\u001b[0m") === "红", "stripAnsi");
  // 6) 值类型推断
  check(coerceValue("42") === 42 && coerceValue("-3.5") === -3.5, "coerce 数字", coerceValue("42"));
  check(coerceValue("true") === true && coerceValue("false") === false && coerceValue("null") === null, "coerce 字面量");
  check(coerceValue("abc") === "abc" && coerceValue("0x10") === "0x10", "coerce 字符串");
  // 7) 切词（引号内空格保留）
  check(splitTokens("a \"b c\" 'd e'").join("|") === "a|b c|d e", "splitTokens", splitTokens("a \"b c\" 'd e'"));
  // 8) /tool 参数解析（原始串：key=value 推断 + --json 整段）
  const pa = parseToolArgs('query="天气 北京" k=3 raw=true');
  check(pa.args.query === "天气 北京" && pa.args.k === 3 && pa.args.raw === true, "parseToolArgs key=value", pa.args);
  const pj = parseToolArgs('--json {"query":"x","k":2}');
  check(pj.args.k === 2 && pj.fromJson === true, "parseToolArgs --json", pj.args);
  check(parseToolArgs('x=1 --json={"y":"z"}').args.y === "z", "parseToolArgs --json=");
  check(parseToolArgs("a=1 b=2").args.b === 2, "parseToolArgs 多键");
  // 9) 补全候选
  const h = computeHints("/to").map((c) => c.cmd);
  check(h[0] === "/tool" && h.includes("/tools"), "hints /to", h);
  check(computeHints("/")[0].insert.startsWith("/"), "hints /", computeHints("/").length);
  check(computeHints("/help")[0].cmd === "/help", "hints /help");
  check(computeHints("no-slash").length === 0, "hints 非命令");
  // 10) 行内灰字补全
  S.input = "/to"; S.cursor = S.input.length; resetHints();
  check(inlineGhost() === "ol", "ghost /to", inlineGhost());
  S.input = "/to "; S.cursor = S.input.length;
  check(inlineGhost() === "", "ghost 带空格", inlineGhost());
  S.input = ""; S.cursor = 0; resetHints();
  // 10b) Tab 连按在固定候选表里循环："" → "/" → /new → /run
  completeHint(); const tab1 = S.input;
  completeHint(); const tab2 = S.input;
  completeHint(); const tab3 = S.input;
  check(tab1 === "/" && tab2 === "/new" && tab3 === "/run", "Tab 循环候选", [tab1, tab2, tab3]);
  S.input = ""; S.cursor = 0; resetHints();
  // 11) 工具清单归一化（新 args[] 与老 params[] 两种形状）
  const norm = normalizeTools({ tools: [
    { name: "a", description: "da", args: [{ name: "x", type: "string", required: true, description: "dx" }], required: ["x"] },
    { name: "b", description: "db", params: ["p", "q"], required: ["p"] },
  ] });
  check(norm.length === 2 && norm[0].argsText === "x*" && norm[1].argsText === "p* q", "normalizeTools", norm.map((x) => x.argsText));
  check(formatTools(norm).includes("a") && formatTools(norm).includes("dx"), "formatTools");
  // 12) JSON 截断
  const big = formatJson({ s: "x".repeat(5000) });
  check(big.includes("已截断"), "formatJson 截断");
  // 13) v2.0.0：LaTeX 降级（纯函数，确定性断言）
  check(latexToText("\\frac{1}{2}") === "(1)/(2)", "latex frac", latexToText("\\frac{1}{2}"));
  check(latexToText("\\alpha+\\beta").includes("α") && latexToText("\\alpha+\\beta").includes("β"), "latex 希腊字母", latexToText("\\alpha+\\beta"));
  check(latexToText("x^2") === "x²", "latex 上标", latexToText("x^2"));
  check(latexToText("\\sqrt{2}").includes("√"), "latex 根号", latexToText("\\sqrt{2}"));
  check(latexToText("a \\le b").includes("≤"), "latex 关系符", latexToText("a \\le b"));
  // 14) Markdown 行内：标记被吃掉、换成样式
  const segs = inlineSegments("**粗** 与 " + BT + "码" + BT + " 与 $x^2$");
  const segText = segs.map((x) => x.t).join("");
  check(segText === "粗 与 码 与 x²", "inline 文本", segText);
  if (!NO_COLOR) {
    check(segs.some((x) => x.s === C.bold), "inline 粗体样式");
    check(segs.some((x) => x.s === C.cyan), "inline 行内代码样式");
    check(segs.some((x) => x.s === C.magenta + C.bold), "inline 公式样式");
  }
  // 15) Markdown 块：列表 / 标题 / 代码块 / 宽度
  const mdSample = "- 一\n- 二\n\n# 标题\n\n" + FENCE + "js\nconst a = 1;\n" + FENCE;
  const md = markdownLines(mdSample, 60, 2);
  const mdPlain = md.join("\n").replace(/\u001b\[[0-9;]*m/g, "");
  check(mdPlain.includes("•"), "md 列表");
  check(mdPlain.includes("标题") && mdPlain.includes("▌"), "md 标题");
  check(mdPlain.includes("const a = 1;") && mdPlain.indexOf("**") < 0, "md 代码块/无标记");
  check(md.every((l) => strWidth(l) <= 60), "md 不超宽", md.map((l) => strWidth(l)).filter((w) => w > 60).slice(0, 3));
  // 16) 等待动画：/ - \ | 顺序 + 原创颜文字
  check(SPIN_FRAMES.join("") === "/-\\|", "旋转帧顺序", SPIN_FRAMES.join(""));
  check(SPIN_FACES.length >= 12 && new Set(SPIN_FACES).size === SPIN_FACES.length, "颜文字数量/唯一", SPIN_FACES.length);
  check(SPIN_FACES.every((fc) => strWidth(fc) > 0 && fc.indexOf("\u001b") < 0), "颜文字无控制码");
  // 17) 线框：宽度必须精确等于终端宽度，否则右边框会歪
  check(strWidth(boxTop(40, "输入")) === 40 && boxTop(40, "输入").includes("╭") && boxTop(40, "输入").includes("╮"), "boxTop 宽度", strWidth(boxTop(40, "输入")));
  check(strWidth(boxBottom(40, "Enter 发送")) === 40, "boxBottom 宽度", strWidth(boxBottom(40, "Enter 发送")));
  // 18) 输入框：光标可见（反显块；NO_COLOR 降级 ▏），宽度不歪
  S.input = ""; S.cursor = 0; S.menu = null;
  const ib0 = inputBoxLines(46, 3);
  check(ib0.length >= 3 && ib0.some((l) => l.indexOf("▏") >= 0 || l.indexOf("\u001b[7m") >= 0), "输入框光标");
  check(ib0.every((l) => strWidth(l) === 46), "输入框宽度", ib0.map((l) => strWidth(l)));
  S.input = "你好世界"; S.cursor = 2;
  check(inputBoxLines(46, 3).some((l) => l.indexOf("▏") >= 0 || l.indexOf("\u001b[7m") >= 0), "输入框光标随文字");
  S.input = "x".repeat(200); S.cursor = 200;
  check(inputBoxLines(46, 3).every((l) => strWidth(l) === 46), "输入框长文本不超宽");
  S.input = ""; S.cursor = 0;
  // 19) 能力面板：命令 + 工具都在
  S.toolList = [{ name: "get_current_time", desc: "当前时间", args: [] }];
  const mi = menuItems();
  check(mi.length >= COMMANDS.length + 1 && mi.some((x) => x.label === "/tool get_current_time"), "菜单含命令与工具", mi.length);
  S.menu = { idx: 0 };
  const mr = menuRows(80);
  check(mr.length >= 3 && mr[0].includes("能力面板") && mr[0].includes("╭") && mr[mr.length - 1].includes("╯"), "菜单线框");
  S.menu = null; S.toolList = null;
  // 20) 头部版本：终端自己 + 主程序；整帧每行都必须是终端宽度
  const hd = frame(100, 26).lines;
  check(hd.join("\n").includes("localai tui " + VER) && hd.join("\n").includes("主程序 v"), "头部版本");
  check(hd.every((l) => strWidth(l) === 100), "整帧宽度", hd.map((l) => strWidth(l)).filter((w) => w !== 100).slice(0, 3));
  // 20b) 按键处理：/ 打开面板、↑↓ 选择、Esc 收起、打字回输入、Enter 执行命令
  const simKey = (k) => { try { const p = handleKey(k); if (p && p.catch) p.catch(() => {}); } catch {} };
  S.input = ""; S.cursor = 0; S.menu = null; S.toolList = null;
  simKey("/");
  check(S.menu !== null && S.input === "/", "按键 / 打开能力面板", S.menu && S.input);
  simKey("\u001b[B");
  check(S.menu && S.menu.idx === 1, "面板 ↓ 选择", S.menu && S.menu.idx);
  simKey("\u001b[A");
  check(S.menu && S.menu.idx === 0, "面板 ↑ 回到顶部", S.menu && S.menu.idx);
  simKey("\u001b");
  check(S.menu === null, "Esc 收起面板并回到对话");
  S.input = ""; S.cursor = 0;
  simKey("/");
  simKey("x");
  check(S.input === "/x" && S.menu === null, "面板里打字回到输入", S.input);
  S.input = ""; S.cursor = 0; S.menu = null;
  // 只打 / 就回车：应重开面板而不是执行 /new
  S.input = "/"; S.cursor = 1; S.menu = null;
  const logKeep = S.log.length;
  simKey("\r");
  check(S.menu !== null && S.log.length === logKeep, "回车在 / 上重开面板");
  S.menu = null; S.input = ""; S.cursor = 0;
  const logBefore = S.log.length;
  simKey("/");
  simKey("\r");
  check(S.menu === null && S.log.length > logBefore, "面板 Enter 执行命令（/help）", S.log.length - logBefore);
  S.log = [];
  // 21) Markdown 缓存 + 解析性能（流式每帧都要重铺，必须便宜）
  const e1 = { role: "assistant", text: "**粗** " + BT + "码" + BT + " $x^2$ 和一段中文补充说明。".repeat(300) };
  let cacheHit = true;
  for (let i = 0; i < 40; i += 1) { const a1 = mdLinesOf(e1, 100); const b1 = mdLinesOf(e1, 100); if (a1 !== b1) cacheHit = false; }
  check(cacheHit, "md 缓存命中");
  const tmd = Date.now();
  const bigLines = mdLinesOf({ role: "assistant", text: e1.text }, 100);
  check(bigLines.length > 0 && Date.now() - tmd < 2000, "md 解析 <2s", Date.now() - tmd);
  console.log(bad ? "SELFTEST 失败 " + bad + " 项（共 " + n + " 项）" : "SELFTEST 通过（" + n + " 项）");
  return bad ? 1 : 0;
}

async function snapshot() {
  S.model = "qwen3-5-4B-Q4_K_M.gguf";
  S.ctx = 16384; S.tools = true;
  if (!MAIN.version) MAIN.version = val("--main-ver", "1.11.1");
  S.log = [
    { role: "user", text: "用一句话说明 KV 缓存为什么能加速多轮对话" },
    { role: "tool", text: "get_current_time {} → 2ms" },
    {
      role: "assistant",
      text: "因为多轮对话的前缀完全一样，**KV 缓存**可以复用上一次算好的 K/V，只对新增 token 做前向计算。\n\n" +
        "- 首字延迟：16.7s → **0.97s**（约 94%）\n- 代价：显存随上下文线性增长\n\n" +
        FENCE + "js\nconst first = cached ? 0.97 : 16.7;\n" + FENCE + "\n\n" +
        "公式：$\\frac{\\Delta t}{t_0}$ 约 94%，$\\sum_{i=1}^{n} t_i$ 只剩新增 token。",
      meta: "38 tok · 1 次工具 · 3.2s",
    },
  ];
  S.input = val("--input") ?? "那它为什么会失效";
  S.cursor = S.input.length;
  S.hints = { idx: Number(val("--hint-idx", -1)), closed: false, cycle: null };
  S.menu = has("--menu") ? { idx: Number(val("--menu-idx", 0)) } : null;
  if (has("--gen")) {
    S.generating = true;
    S.spin.t0 = Date.now() - 3200;
    S.spin.face = SPIN_FACES[0];
    S.spin.frame = 2;
  }
  if (S.menu && !S.toolList) { try { await loadTools(true, 1500); } catch {} }
  // 版面自检时顺手把工具清单拉下来：/tool 的提示条才有真实内容（服务没起就退化成一行命令提示）
  if (S.input.startsWith("/tool")) { try { await loadTools(true, 1500); } catch {} }
  const cols = Number(val("--cols", 88));
  const rows = Number(val("--rows", 24));
  const f = frame(cols, rows);
  console.log("+" + "-".repeat(cols) + "+");
  for (const l of f.lines) {
    console.log("|" + padWidth(l, cols) + "|");
  }
  console.log("+" + "-".repeat(cols) + "+");
  return 0;
}

// ---------------------------------------------------------------- 一次性模式：版本 / 颜文字 / 基准
async function loadVersion() {
  try {
    const v = await api("/api/version", { timeout: 5000 });
    if (v && v.version) {
      MAIN.version = String(v.version);
      MAIN.commit = String(v.commit || "");
      MAIN.builtAt = Number(v.builtAt) || 0;
    }
  } catch {}
}

async function printVersion() {
  let v = null;
  try { v = await api("/api/version", { timeout: 5000 }); } catch {}
  const ver = (v && v.version) || MAIN.version || "?";
  process.stdout.write([
    "localai tui " + VER,
    "主程序      v" + ver + (v && v.commit ? " · " + String(v.commit).slice(0, 10) : ""),
    "Node        " + process.version,
    "服务        " + BASE,
  ].join("\n") + "\n");
  return 0;
}

function facesTest() {
  process.stdout.write(SPIN_FACES.join("\n") + "\n");
  return 0;
}

/** 渲染基准：用数字说明「终端为什么快」（Markdown 解析 + 整帧重绘），不靠感觉 */
function bench() {
  const text = ("**粗体** 与 " + BT + "code" + BT + " 和 $x^2$ 公式，还有一段中文说明文字。\n\n- 列表项一\n- 列表项二\n\n").repeat(120);
  const t0 = Date.now();
  let lines = 0;
  for (let i = 0; i < 20; i += 1) lines = markdownLines(text, 96, 2).length;
  const mdMs = (Date.now() - t0) / 20;
  S.model = "qwen3-5-4B";
  S.log = [{ role: "user", text: "基准" }, { role: "assistant", text }];
  const t1 = Date.now();
  let n = 0;
  for (let i = 0; i < 200; i += 1) n = frame(100, 30).lines.length;
  const frameMs = (Date.now() - t1) / 200;
  process.stdout.write("md " + text.length + " 字 → " + lines + " 行 / 每次 " + mdMs.toFixed(2) + "ms\n");
  process.stdout.write("frame 100x30 → " + n + " 行 / 每次 " + frameMs.toFixed(2) + "ms（约 " + Math.round(1000 / Math.max(0.001, frameMs)) + " fps 上限）\n");
  return 0;
}


main()
  .then(async (c) => {
    // 交互模式 main 永不 resolve；能走到这里说明是一次性模式，写完就退（顺带放掉 fetch 的 keep-alive 连接）
    await new Promise((r) => process.stdout.write("", r));
    process.exit(c ?? 0);
  })
  .catch((e) => {
    process.stdout.write("\u001b[?25h\u001b[?1049l");
    console.error("localai-tui: " + (e?.message ?? e));
    process.exit(1);
  });

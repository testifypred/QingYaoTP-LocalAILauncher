#!/usr/bin/env node
/**
 * localai-tui —— QingYaoTP AILauncher（本地 AI）的全屏终端界面（零依赖，纯 ANSI）
 *
 *   localai tui                    正常进入
 *   localai tui --model Phi-4-mini-instruct-Q4_K_M.gguf
 *   node localai-tui.mjs --selftest    宽度/折行自检（不需要服务）
 *   node localai-tui.mjs --snapshot    把一帧渲染成纯文本打印出来（便于检查版面）
 *
 * 设计要点：
 *  - 内容先清洗再上屏：模型输出里的 ESC 序列一律剥掉，防止终端被注入控制码；
 *  - 中文按 2 列宽计算，折行/截断/补空格都走同一套 wcwidth，否则整屏会歪；
 *  - 非 TTY（被管道/重定向）自动降级成逐行模式，方便脚本里跑。
 */
import process from "node:process";

const VER = "1.1.0";
const DEFAULT_URL = "http://127.0.0.1:8099";

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d = null) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};
const BASE = (val("--url", process.env.LOCALAI_URL || DEFAULT_URL)).replace(/\/+$/, "");
const NO_COLOR = has("--no-color") || Boolean(process.env.NO_COLOR);
const SELFTEST = has("--selftest");
const SNAPSHOT = has("--snapshot");
const PLAIN = has("--plain") || !process.stdout.isTTY;

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
function strWidth(s) {
  let w = 0;
  for (const ch of s) w += charWidth(ch.codePointAt(0));
  return w;
}
function truncWidth(s, max) {
  if (max <= 0) return "";
  let w = 0, out = "";
  for (const ch of s) {
    const cw = charWidth(ch.codePointAt(0));
    if (w + cw > max) break;
    out += ch; w += cw;
  }
  return out;
}
function padWidth(s, max) {
  const w = strWidth(s);
  return w >= max ? truncWidth(s, max) : s + " ".repeat(max - w);
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
      cyan: "\u001b[36m", green: "\u001b[32m", yellow: "\u001b[33m",
      red: "\u001b[31m", magenta: "\u001b[35m", gray: "\u001b[90m",
      inv: "\u001b[7m",
    };

// ---------------------------------------------------------------- HTTP
async function api(path, { method = "GET", body, headers } = {}) {
  let r;
  try {
    r = await fetch(BASE + path, {
      method,
      headers: body ? { "content-type": "application/json", ...(headers || {}) } : headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    const c = String(e?.cause?.code || e?.code || "");
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
};

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
function frame(cols, rows, opts = {}) {
  const inner = Math.max(20, cols);
  const out = [];
  const inputBar = 2, statusBar = 1, sep = 1;
  const bodyH = Math.max(3, rows - inputBar - statusBar - 2);

  const head = " QingYaoTP AILauncher " + VER + C.gray + "  " + (S.model || "（未指定）") + "  ctx " + (S.ctx || "?") +
    (S.tools ? "  " + C.green + "工具开" : "  " + C.gray + "工具关") +
    (S.web ? C.green + " 联网开" : "") + C.reset;
  out.push(padWidth(head, inner));

  const rule = C.gray + "─".repeat(inner) + C.reset;
  out.push(rule);

  // 正文：把 log 铺成行
  const body = [];
  for (const e of S.log) {
    if (e.role === "user") {
      body.push("");
      body.push(C.cyan + "› " + C.reset + truncWidth(e.text, inner - 2));
      const rest = wrapText(e.text, inner - 2).slice(1);
      for (const l of rest) body.push("  " + l);
    } else if (e.role === "tool") {
      body.push(C.gray + "  🔧 " + e.text + C.reset);
    } else if (e.role === "error") {
      body.push("");
      for (const l of wrapText(e.text, inner - 4)) body.push(C.red + "  " + l + C.reset);
    } else if (e.role === "sys") {
      body.push(C.magenta + "  " + e.text + C.reset);
    } else {
      for (const l of wrapText(e.text, inner)) body.push(l);
      if (e.meta) body.push(C.gray + "  " + e.meta + C.reset);
    }
  }
  if (!S.log.length) {
    body.push("");
    body.push(C.gray + "  直接输入问题回车发送。" + C.reset);
    body.push(C.gray + "  /help 看命令 · Ctrl+C 中断生成，再按一次退出" + C.reset);
  }

  const total = body.length;
  const maxScroll = Math.max(0, total - bodyH);
  S.scroll = Math.min(S.scroll, maxScroll);
  const end = total - S.scroll;
  const slice = body.slice(Math.max(0, end - bodyH), end);
  // 内容不足一屏时贴顶，多了才滚动；不能 unshift，否则历史短时正文全挤在屏幕底部
  while (slice.length < bodyH) slice.push("");
  out.push(...slice.map((l) => padWidth(l, inner)));

  out.push(rule);

  // 输入行：光标超宽时左移窗口，保证光标可见
  const promptW = 2;
  const avail = inner - promptW;
  const chars = [...S.input];
  const cursorChars = [...S.input.slice(0, S.cursor)].length;
  const beforeCursor = S.input.slice(0, S.cursor);
  const cw = strWidth(beforeCursor);
  // 光标超出可视宽度时，把窗口左移，保证光标始终停在行内
  let startIdx = 0;
  if (cw >= avail) {
    let w = 0, i = cursorChars;
    while (i > 0) {
      const ch = chars[i - 1];
      const cwid = charWidth(ch.codePointAt(0));
      if (w + cwid > avail - 1) break;
      w += cwid; i -= 1;
    }
    startIdx = i;
  }
  const shown = truncWidth(chars.slice(startIdx).join(""), avail);
  const cursorCol = promptW + strWidth(chars.slice(startIdx, cursorChars).join(""));
  const line = (S.generating ? C.yellow + "… " : C.cyan + "› ") + C.reset + shown;
  out.push(padWidth(line, inner));

  const hint = S.generating
    ? C.yellow + " 生成中 · Ctrl+C 中断" + C.reset
    : C.gray + " Enter 发送 · ↑↓ 历史 · PgUp/PgDn 滚动 · /help" + C.reset;
  const stat = S.status ? C.gray + " " + S.status + C.reset : hint;
  out.push(padWidth(stat, inner));

  // cursorRow 是 1-based：输入行是倒数第二行
  return { lines: out.slice(0, rows), cursorRow: rows - 1, cursorCol };
}

let renderTimer = null;
function requestRender() {
  if (renderTimer || PLAIN || SNAPSHOT) return;
  renderTimer = setTimeout(() => { renderTimer = null; render(); }, 40);
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
  s += "\u001b[" + f.cursorRow + ";" + (f.cursorCol + 1) + "H";
  process.stdout.write(s);
}

// ---------------------------------------------------------------- 命令
const HELP = [
  "/help            这份帮助",
  "/new             清空上下文（不删会话文件）",
  "/model <文件>     换模型（不给参数则列出候选）",
  "/tools on|off    工具调用开关",
  "/web on|off      联网开关（隐含 tools on）",
  "/think on|off    深度思考开关",
  "/state           打印服务状态",
  "/run <语言> <代码> 直接跑代码（python/js/c/cpp…）",
  "/clear           清屏",
  "/exit            退出",
].join("\n");

async function handleSlash(line) {
  const [cmd, ...rest] = line.slice(1).split(/\s+/);
  const arg = rest.join(" ");
  const onoff = (v) => (v === "on" ? true : v === "off" ? false : null);
  switch ((cmd || "").toLowerCase()) {
    case "help": entry("sys", HELP); return true;
    case "exit": case "quit": return false;
    case "clear": S.log = []; return true;
    case "new": S.messages = []; entry("sys", "上下文已清空"); return true;
    case "tools": {
      const v = onoff(arg); if (v === null) { entry("sys", "用法：/tools on|off"); return true; }
      S.tools = v; if (!v) S.web = false; entry("sys", "工具 " + (v ? "开" : "关")); return true;
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
      const st = await api("/api/state");
      entry("sys", "模型 " + (st.loaded ?? "无") + " · ctx " + st.context + " · " + st.layers + " 层 · " + st.gpu);
      return true;
    }
    case "model": {
      if (!arg) {
        const st = await api("/api/state");
        entry("sys", "候选：" + st.models.map((m) => m.file + (m.file === st.loaded ? "（当前）" : "")).join("\n      "));
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
      const st = await api("/api/state");
      const r = await api("/api/run", { method: "POST", body: { lang, code }, headers: { "x-local-token": st.localToken } });
      entry("tool", lang + " → exit " + r.code + " · " + r.ms + "ms");
      if (r.stdout) entry("assistant", r.stdout.trimEnd());
      return true;
    }
    default:
      entry("sys", "未知命令 /" + cmd + "，输入 /help");
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
    requestRender();
  }
}

// ---------------------------------------------------------------- 主循环
async function ensureModel() {
  if (S.model) return;
  const st = await api("/api/state");
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

async function main() {
  if (SELFTEST) return selftest();
  if (SNAPSHOT) return snapshot();
  if (PLAIN) return plainMode();
  await ensureModel();

  process.stdout.write("\u001b[?1049h\u001b[?25l\u001b[2J");
  const cleanup = () => {
    process.stdout.write("\u001b[?25h\u001b[?1049l");
    if (process.stdin.isTTY) { try { process.stdin.setRawMode(false); } catch {} }
    process.stdin.pause();
  };
  const bye = (code = 0) => { cleanup(); process.exit(code); };
  process.on("exit", () => { try { process.stdout.write("\u001b[?25h\u001b[?1049l"); } catch {} });
  process.on("SIGINT", () => bye(0));
  process.stdout.on("resize", () => render());

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  render();

  // 挂完处理器就进入事件循环：这里必须挂住，否则 main() 一返回外层就 process.exit，窗口秒关
  const done = new Promise(() => {});

  process.stdin.on("data", async (chunk) => {
    const s = String(chunk);
    // Ctrl+C
    if (s === "\u0003") {
      if (S.generating && S.abort) { S.abort.abort(); return; }
      if (S.quitArmed) return bye(0);
      S.quitArmed = true;
      S.status = "再按一次 Ctrl+C 退出";
      requestRender();
      setTimeout(() => { S.quitArmed = false; S.status = ""; requestRender(); }, 2500);
      return;
    }
    if (s === "\u000c") { S.log = []; render(); return; } // Ctrl+L
    if (s === "\r" || s === "\n") {
      // 生成中再回车不并发发问：服务端一次只跑一轮，并发只会让两边都卡
      if (S.generating) { S.status = "上一轮还在生成，Ctrl+C 可中断"; render(); return; }
      const text = S.input;
      S.input = ""; S.cursor = 0;
      if (text.trim().startsWith("/")) {
        const keep = await handleSlash(text.trim());
        if (!keep) return bye(0);
        render();
      } else {
        render();
        await send(text);
      }
      return;
    }
    if (s === "\u007f" || s === "\b") {
      if (S.cursor > 0) { S.input = S.input.slice(0, S.cursor - 1) + S.input.slice(S.cursor); S.cursor -= 1; render(); }
      return;
    }
    if (s === "\u001b[A") { // ↑ 历史
      if (S.hist.length) { S.histIdx = Math.min(S.hist.length - 1, S.histIdx + 1); S.input = S.hist[S.hist.length - 1 - S.histIdx]; S.cursor = S.input.length; render(); }
      return;
    }
    if (s === "\u001b[B") {
      if (S.histIdx >= 0) { S.histIdx -= 1; S.input = S.histIdx < 0 ? "" : S.hist[S.hist.length - 1 - S.histIdx]; S.cursor = S.input.length; render(); }
      return;
    }
    if (s === "\u001b[5~") { S.scroll = Math.min(S.scroll + 5, 9999); render(); return; }
    if (s === "\u001b[6~") { S.scroll = Math.max(0, S.scroll - 5); render(); return; }
    if (s === "\u001b[D") { S.cursor = Math.max(0, S.cursor - 1); render(); return; }
    if (s === "\u001b[C") { S.cursor = Math.min(S.input.length, S.cursor + 1); render(); return; }
    if (s.startsWith("\u001b")) return; // 其它转义序列忽略
    const printable = s.replace(/[\u0000-\u001f]/g, "");
    if (!printable) return;
    S.input = S.input.slice(0, S.cursor) + printable + S.input.slice(S.cursor);
    S.cursor += printable.length;
    S.quitArmed = false;
    render();
  });

  return await done;
}

// ---------------------------------------------------------------- 降级：非 TTY
async function plainMode() {
  await ensureModel();
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const lines = Buffer.concat(chunks).toString("utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
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

// ---------------------------------------------------------------- 自检 / 快照
function selftest() {
  const cases = [
    ["abc", 3], ["中文", 4], ["a中b", 4], ["", 0],
  ];
  let bad = 0;
  for (const [s, w] of cases) {
    const got = strWidth(s);
    if (got !== w) { console.log("FAIL width " + JSON.stringify(s) + " → " + got + " 期望 " + w); bad += 1; }
  }
  const w1 = wrapText("这是一段需要折行的中文文本", 10);
  if (!w1.every((l) => strWidth(l) <= 10)) { console.log("FAIL wrap 超宽", JSON.stringify(w1)); bad += 1; }
  const w2 = wrapText("a\nb\n", 10);
  if (w2.join("|") !== "a|b|") { console.log("FAIL wrap 换行", JSON.stringify(w2)); bad += 1; }
  if (padWidth("中文", 6) !== "中文  ") { console.log("FAIL pad", JSON.stringify(padWidth("中文", 6))); bad += 1; }
  if (truncWidth("中文字", 5) !== "中文") { console.log("FAIL trunc"); bad += 1; }
  if (stripAnsi("\u001b[31m红\u001b[0m") !== "红") { console.log("FAIL stripAnsi"); bad += 1; }
  console.log(bad ? "SELFTEST 失败 " + bad + " 项" : "SELFTEST 通过（7 组）");
  return bad ? 1 : 0;
}

function snapshot() {
  S.model = "qwen3-5-4B-Q4_K_M.gguf";
  S.ctx = 16384; S.tools = true;
  S.log = [
    { role: "user", text: "用一句话说明 KV 缓存为什么能加速多轮对话" },
    { role: "tool", text: "get_current_time {} → 2ms" },
    { role: "assistant", text: "因为多轮对话的前缀完全一样，模型可以复用上一次已经算好的 KV，只对新增的 token 做前向计算，所以首字延迟从十几秒降到一秒左右。", meta: "38 tok · 1 次工具 · 3.2s" },
  ];
  S.input = "那它为什么会失效";
  S.cursor = S.input.length;
  const cols = Number(val("--cols", 88));
  const rows = Number(val("--rows", 20));
  const f = frame(cols, rows);
  console.log("+" + "-".repeat(cols) + "+");
  for (const l of f.lines) {
    console.log("|" + padWidth(l, cols) + "|");
  }
  console.log("+" + "-".repeat(cols) + "+");
  return 0;
}

main().then((c) => { if (!PLAIN) process.exit(c ?? 0); }).catch((e) => {
  process.stdout.write("\u001b[?25h\u001b[?1049l");
  console.error("localai-tui: " + (e?.message ?? e));
  process.exit(1);
});

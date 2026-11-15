#!/usr/bin/env node
/**
 * localai —— QingYaoTP AILauncher（本地 AI）的命令行客户端（零依赖，只跟你本机 8099 上的服务说话）
 *
 *   localai "你好"                    一问一答，流式打印
 *   localai ask --tools "现在几点"     开工具（时间/计算/读文件/联网/跑代码）
 *   localai chat                      交互式，多轮上下文
 *   localai models | load <文件> | unload | state
 *   localai run python "print(6*7)"   跑一段代码
 *   echo "总结一下" | localai ask -     从 stdin 读提问
 *
 * 常用开关：--model <文件> --session <id> --save --json --no-stream
 *          --tools --web --think --max-tokens N --temp T --quiet
 * 服务地址：--url 或环境变量 LOCALAI_URL（默认 http://127.0.0.1:8099）
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const VERSION = "1.8.0";
const DEFAULT_URL = "http://127.0.0.1:8099";

// ---------- 参数解析 ----------
const argv = process.argv.slice(2);
const COMMANDS = new Set(["ask", "chat", "tui", "models", "load", "unload", "state", "run", "sessions", "help", "version"]);
let cmd = "ask";
if (argv[0] && COMMANDS.has(argv[0])) cmd = argv.shift();
else if (argv[0] === "-h" || argv[0] === "--help") { cmd = "help"; argv.shift(); }

const opt = {
  url: DEFAULT_URL,
  model: null,
  session: null,
  save: false,
  json: false,
  stream: true,
  tools: false,
  web: false,
  think: false,
  maxTokens: null,
  temp: null,
  quiet: false,
  system: null,
};
const positional = [];
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  const next = () => {
    const v = argv[i + 1];
    if (v === undefined) fatal(`参数 ${a} 缺少值`);
    i += 1;
    return v;
  };
  if (a === "--url") opt.url = next();
  else if (a === "--model") opt.model = next();
  else if (a === "--session") opt.session = next();
  else if (a === "--save") opt.save = true;
  else if (a === "--json") opt.json = true;
  else if (a === "--no-stream") opt.stream = false;
  else if (a === "--stream") opt.stream = true;
  else if (a === "--tools") opt.tools = true;
  else if (a === "--web") { opt.tools = true; opt.web = true; }
  else if (a === "--think") opt.think = true;
  else if (a === "--max-tokens") opt.maxTokens = Number(next());
  else if (a === "--temp") opt.temp = Number(next());
  else if (a === "--system") opt.system = next();
  else if (a === "--quiet" || a === "-q") opt.quiet = true;
  else if (a === "-h" || a === "--help") { cmd = "help"; }
  else if (a.startsWith("--")) fatal(`未知参数 ${a}（localai help 看用法）`);
  else positional.push(a);
}
const BASE = opt.url.replace(/\/+$/, "");

// ---------- 小工具 ----------
function fatal(msg, code = 1) {
  process.stderr.write(`localai: ${msg}\n`);
  process.exit(code);
}
function note(msg) {
  if (!opt.quiet) process.stderr.write(msg + "\n");
}
async function api(path, { method = "GET", body, headers } = {}) {
  let r;
  try {
    r = await fetch(BASE + path, {
      method,
      headers: body ? { "content-type": "application/json", ...(headers || {}) } : headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    if (String(e?.cause?.code || e?.code || "").includes("ECONNREFUSED")) {
      fatal(`连不上 ${BASE}——先把应用开起来（dist\\QingYaoTP AILauncher\\QingYaoTP AILauncher.exe），或用 --url 指定端口`, 3);
    }
    fatal("请求失败：" + (e?.message ?? e));
  }
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!r.ok) {
    const m = data?.error?.message ?? text.slice(0, 300);
    fatal(`HTTP ${r.status}：${m}`, 1);
  }
  return data;
}
async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8").trim();
}
const tty = () => Boolean(process.stdout.isTTY);

// ---------- 会话 ----------
async function loadSessionMessages(id) {
  const s = await api("/api/sessions/" + encodeURIComponent(id));
  return { messages: (s.messages || []).map((m) => ({ role: m.role, content: m.ctx ?? m.content })), title: s.title };
}
async function saveSession(id, messages, model) {
  await api("/api/sessions/" + encodeURIComponent(id), {
    method: "PUT",
    body: { messages, model },
  });
}

// ---------- 一次问答 ----------
async function chatOnce(messages, modelFile) {
  const payload = {
    model: modelFile || (await ensureModel()),
    messages,
    stream: opt.stream,
    tools: opt.tools,
    web: opt.web,
    thinking: opt.think,
  };
  if (opt.maxTokens != null) payload.max_tokens = opt.maxTokens;
  if (opt.temp != null) payload.temperature = opt.temp;

  const t0 = Date.now();
  if (!opt.stream) {
    const r = await api("/v1/chat/completions", { method: "POST", body: payload });
    const content = r.choices?.[0]?.message?.content ?? "";
    if (opt.json) process.stdout.write(JSON.stringify(r, null, 2) + "\n");
    else process.stdout.write(content + (content.endsWith("\n") ? "" : "\n"));
    note(`[${r.usage?.completion_tokens ?? "?"} tok · ${((Date.now() - t0) / 1000).toFixed(1)}s]`);
    return content;
  }

  let resp;
  try {
    resp = await fetch(BASE + "/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    fatal("请求失败：" + (e?.message ?? e), 3);
  }
  if (!resp.ok) {
    const t = await resp.text();
    let m = t.slice(0, 300);
    try { m = JSON.parse(t)?.error?.message ?? m; } catch {}
    fatal(`HTTP ${resp.status}：${m}`, 1);
  }

  const decoder = new TextDecoder();
  let buf = "";
  let full = "";
  let usage = null;
  let tools = 0;
  const out = opt.json ? () => {} : (s) => process.stdout.write(s);

  for await (const piece of resp.body) {
    buf += decoder.decode(piece, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const line = block.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      const raw = line.slice(5).trim();
      if (raw === "[DONE]") continue;
      let ev;
      try { ev = JSON.parse(raw); } catch { continue; }
      const d = ev.choices?.[0]?.delta ?? {};
      if (d.content) { full += d.content; out(d.content); }
      if (d.tool) {
        tools += 1;
        const args = d.tool.args && Object.keys(d.tool.args).length ? JSON.stringify(d.tool.args) : "{}";
        note(`  🔧 ${d.tool.name} ${args.slice(0, 60)} → ${d.tool.ms ?? "?"}ms`);
      }
      if (ev.usage) usage = ev.usage;
    }
  }
  if (!opt.json) process.stdout.write(full.endsWith("\n") ? "" : "\n");
  else process.stdout.write(JSON.stringify({ content: full, usage, toolCalls: tools }, null, 2) + "\n");
  note(`[${usage?.completion_tokens ?? "?"} tok · ${tools ? tools + " 次工具 · " : ""}${((Date.now() - t0) / 1000).toFixed(1)}s]`);
  return full;
}

async function ensureModel() {
  const st = await api("/api/state");
  if (st.loaded) return st.loaded;
  // 没加载时挑体积最小的那个：CLI 常用一次性提问，启动快比参数大重要；
  // 想指定就 --model，或先 localai load <文件>。
  const pick =
    st.models?.find((m) => m.file === process.env.LOCALAI_MODEL) ??
    [...(st.models ?? [])].sort((x, y) => x.sizeGB - y.sizeGB)[0];
  if (!pick) fatal("模型目录里没有 .gguf 文件");
  note(`没有已加载的模型，自动加载最小的 ${pick.file}（${pick.sizeGB}GB）…`);
  await api("/api/load", { method: "POST", body: { file: pick.file } });
  for (let i = 0; i < 120; i += 1) {
    await new Promise((r) => setTimeout(r, 500));
    const s = await api("/api/state");
    if (s.loaded && !s.loading) return s.loaded;
  }
  fatal("模型加载超时");
}

// ---------- 子命令 ----------
async function cmdAsk() {
  let prompt = positional.join(" ").trim();
  if (!prompt || prompt === "-") {
    if (process.stdin.isTTY && !prompt) fatal("没有提问（用法：localai \"你的问题\"）", 2);
    prompt = await readStdin();
  }
  if (!prompt) fatal("提问为空", 2);

  const messages = [];
  let history = [];
  if (opt.session) {
    const s = await loadSessionMessages(opt.session);
    history = s.messages;
    messages.push(...history);
  }
  if (opt.system) messages.unshift({ role: "system", content: opt.system });
  messages.push({ role: "user", content: prompt });

  const answer = await chatOnce(messages, opt.model);
  if (opt.session && opt.save) {
    const st = await api("/api/state");
    await saveSession(opt.session, [...history, { role: "user", content: prompt }, { role: "assistant", content: answer }], st.loaded);
    note(`（已写回会话 ${opt.session}）`);
  }
  return 0;
}

async function cmdChat() {
  // 交互式走 readline；一旦是管道/重定向，就先把行全读出来再逐条处理，
  // 否则 stdin 读完 readline 会立即关闭，长回答期间第二行就再也取不到了。
  const readline = await import("node:readline/promises");
  const piped = !process.stdin.isTTY;
  const pipeLines = piped ? (await readStdin()).split(/\r?\n/) : null;
  let lineCursor = 0;
  const rl = piped ? null : readline.createInterface({ input: process.stdin, output: process.stdout });
  const nextLine = async () => {
    if (pipeLines) return lineCursor < pipeLines.length ? pipeLines[lineCursor++] : null;
    try { return await rl.question("\n› "); } catch { return null; }
  };
  const messages = [];
  if (opt.session) {
    const s = await loadSessionMessages(opt.session);
    messages.push(...s.messages);
    note(`（接着会话 ${opt.session}，已有 ${s.messages.length} 条）`);
  }
  if (opt.system) messages.unshift({ role: "system", content: opt.system });
  note(`localai ${VERSION} · ${BASE} · 模型 ${opt.model ?? "已加载的那个"} · /help 看命令，/exit 退出`);

  for (;;) {
    const raw = await nextLine();
    if (raw === null) break;
    const line = raw.trim();
    if (!line) continue;
    if (line === "/exit" || line === "/quit") break;
    if (line === "/help") { note("  /exit 退出 · /new 清空上下文 · /model <文件> 换模型 · /state 看状态"); continue; }
    if (line === "/new") { messages.length = 0; note("（上下文已清空）"); continue; }
    if (line === "/state") { const s = await api("/api/state"); note(JSON.stringify({ loaded: s.loaded, ctx: s.context, models: s.models.length })); continue; }
    if (line.startsWith("/model ")) {
      const f = line.slice(7).trim();
      note(`加载 ${f} …`);
      await api("/api/load", { method: "POST", body: { file: f } });
      opt.model = f;
      messages.length = 0;
      note("（模型已切换，上下文清空）");
      continue;
    }
    messages.push({ role: "user", content: line });
    try {
      const answer = await chatOnce(messages, opt.model);
      messages.push({ role: "assistant", content: answer });
      if (opt.session && opt.save) await saveSession(opt.session, messages, opt.model);
    } catch (e) {
      note("出错：" + (e?.message ?? e));
      messages.pop();
    }
  }
  if (rl) rl.close();
  return 0;
}

/** 起全屏 TUI：同一个 node 跑 localai-tui.mjs，stdio 直接继承，raw mode 才拿得到 TTY */
async function cmdTui() {
  const f = fileURLToPath(new URL("./localai-tui.mjs", import.meta.url));
  const args = [f, ...process.argv.slice(3)];
  if (!args.includes("--url")) args.push("--url", BASE);
  const child = spawn(process.execPath, args, { stdio: "inherit" });
  return await new Promise((resolve) => child.on("exit", (code) => resolve(code ?? 0)));
}

async function cmdModels() {
  const st = await api("/api/state");
  if (opt.json) { process.stdout.write(JSON.stringify(st.models, null, 2) + "\n"); return 0; }
  for (const m of st.models) {
    const mark = m.file === st.loaded ? "*" : " ";
    process.stdout.write(`${mark} ${m.file}  ${m.sizeGB}GB${m.sharded ? "  (分片)" : ""}\n`);
  }
  note(`${st.models.length} 个模型，当前已加载：${st.loaded ?? "无"}`);
  return 0;
}

async function cmdState() {
  const st = await api("/api/state");
  if (opt.json) { process.stdout.write(JSON.stringify(st, null, 2) + "\n"); return 0; }
  process.stdout.write(
    [`服务      ${BASE}`,
     `已加载    ${st.loaded ?? "（无）"}`,
     `上下文    ${st.context} · ${st.layers} 层 · ${st.gpu}`,
     `思考支持  ${st.supportsThinking ? "是" : "否"} · KV 复用 ${st.kvReuse ? "开" : "关"}`,
     `预加载    ${st.extras?.files?.length ? st.extras.files.map((f) => f.file).join(", ") : "无"}`].join("\n") + "\n",
  );
  return 0;
}

async function cmdLoad() {
  const file = positional[0] ?? opt.model;
  if (!file) fatal("用法：localai load <模型文件名>（localai models 看清单）", 2);
  await api("/api/load", { method: "POST", body: { file } });
  note(`已加载 ${file}`);
  return 0;
}

async function cmdUnload() {
  await api("/api/unload", { method: "POST", body: {} });
  note("已卸载");
  return 0;
}

async function cmdRun() {
  const lang = positional[0];
  let code = positional.slice(1).join(" ");
  if (!lang) fatal("用法：localai run <语言> <代码>（语言：python/js/c/cpp/java/go/rust）", 2);
  if (!code || code === "-") code = await readStdin();
  if (!code) fatal("代码为空", 2);
  const st = await api("/api/state");
  const r = await api("/api/run", {
    method: "POST",
    body: { lang, code },
    headers: { "x-local-token": st.localToken },
  });
  if (opt.json) { process.stdout.write(JSON.stringify(r, null, 2) + "\n"); return 0; }
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  note(`[exit ${r.code} · ${r.ms}ms${r.truncated ? " · 输出被截断" : ""}]`);
  return r.code === 0 ? 0 : 1;
}

async function cmdSessions() {
  const r = await api("/api/sessions");
  if (opt.json) { process.stdout.write(JSON.stringify(r.sessions, null, 2) + "\n"); return 0; }
  for (const s of r.sessions) {
    process.stdout.write(`${s.id}  ${String(s.messageCount ?? s.messages ?? "").padStart(3)} 条  ${s.title || s.displayTitle || "（无标题）"}\n`);
  }
  return 0;
}

function help() {
  process.stdout.write(`localai ${VERSION} —— QingYaoTP AILauncher（本地 AI）命令行

用法：
  localai "你的问题"                  一问一答，流式输出
  localai ask --tools "现在几点"       开工具：时间/计算/读文件/联网/跑代码
  localai chat                        交互式多轮（/exit /new /model /state）
  localai tui                         全屏终端界面（彩色对话 + 斜杠命令）
  localai models                      列模型（* 是已加载的）
  localai load <文件> | unload        装卸模型
  localai state                       看服务状态
  localai run python "print(6*7)"     跑代码
  localai sessions                    列会话
  cat 文件 | localai ask -             从 stdin 读提问

开关：
  --model <文件>     指定模型（没加载会自动加载）
  --session <id>     带上这个会话的历史
  --save             把这一轮写回 --session 指定的会话
  --json             输出原始 JSON（给脚本用）
  --no-stream        等整段生成完再输出
  --tools --web --think   工具 / 联网 / 深度思考
  --max-tokens N --temp T 生成参数
  --system "..."     覆盖系统提示
  --quiet            不打印耗时等提示（只留正文）
  --url <地址>       默认 ${DEFAULT_URL}（或设 LOCALAI_URL）

退出码：0 成功 · 1 出错 · 2 用法错 · 3 连不上服务
`);
  return 0;
}

// ---------- 分发 ----------
try {
  let code = 0;
  if (cmd === "help") code = help();
  else if (cmd === "version") { process.stdout.write(VERSION + "\n"); }
  else if (cmd === "ask") code = await cmdAsk();
  else if (cmd === "chat") code = await cmdChat();
  else if (cmd === "tui") code = await cmdTui();
  else if (cmd === "models") code = await cmdModels();
  else if (cmd === "state") code = await cmdState();
  else if (cmd === "load") code = await cmdLoad();
  else if (cmd === "unload") code = await cmdUnload();
  else if (cmd === "run") code = await cmdRun();
  else if (cmd === "sessions") code = await cmdSessions();
  else code = help();
  process.exit(code);
} catch (e) {
  fatal(e?.message ?? String(e));
}

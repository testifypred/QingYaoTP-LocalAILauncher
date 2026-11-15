/**
 * QingYaoTP AILauncher（本地 AI）桌面应用 —— 模型管理器 + OpenAI 兼容服务 + 内置界面
 *
 * 设计要点：
 *  - 单进程管理一个模型目录（MODEL_DIR）下的所有 .gguf，一次只加载一个模型（显存/内存友好）
 *    开发态默认取 server 的上一级；发布包由 Launcher.cs 按 config.ini 注入 → 不写死盘符/绝对路径
 *  - 对外仍暴露 OpenAI 兼容接口 (/v1/chat/completions)，Cherry Studio / DSH 可直接接
 *  - 界面通过 /api/* 控制加载与卸载
 */
import http from "node:http";
import os from "node:os";
import { randomUUID, createHash } from "node:crypto";
import { readFile, readdir, stat, statfs, writeFile, mkdir, unlink, link, copyFile, open, mkdtemp, rm, rename, rmdir } from "node:fs/promises";
import { unlinkSync, existsSync, createWriteStream, watch, statSync, readdirSync } from "node:fs";
import https from "node:https";
import { spawn, spawnSync } from "node:child_process";
import { extractTextBuffer } from "./doc-extract.mjs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { getLlama, resolveChatWrapper, LlamaChatSession, TokenMeter, defineChatSessionFunction, DraftSequenceTokenPredictor } from "node-llama-cpp";
import { recommendConfig, CATALOG_MODELS } from "./config-recommend.mjs";
import { zipStore, sha256 as zipSha256 } from "./diag-zip.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/**
 * 模型目录：环境变量 MODEL_DIR 优先（发布包由 Launcher.cs 按 config.ini 注入，留空＝<安装目录>\models）；
 * 开发态退化成 server 的上一级（本仓库里就是仓库根）——不写死任何盘符或绝对路径。
 */
const MODEL_DIR = process.env.MODEL_DIR ?? path.resolve(HERE, "..");
const PORT = Number(process.env.PORT ?? 8099);
const AUTO_LOAD = process.env.AUTO_LOAD ?? "";
const DEFAULT_CONTEXT = Number(process.env.CONTEXT_SIZE ?? 16384);
/** 未提供 system 消息时使用的默认提示词，避免 node-llama-cpp 的英文默认提示词污染中文回答 */
const DEFAULT_SYSTEM =
  process.env.DEFAULT_SYSTEM ?? "你是一个乐于助人的中文助手。回答要准确、简洁，用中文回答。";

const UI = path.join(HERE, "app.html");
/** 调试面板：独立页面（Debugging Tool），由本服务托管，也可以被独立程序 localai-debug.mjs 拉起 */
const DEBUG_UI = path.join(HERE, "debug.html");
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

/** 版本号：发版只改这一处；server\package.json 的 version 必须与它一致（probe-version 会查） */
const APP_VERSION = "1.5.0";
/** 产品正式名（2026-11-01 起）：QingYaoTP AILauncher；QingYaoTP = QingYaoTestifypred */
const APP_NAME = "QingYaoTP AILauncher";
const APP_SUB = "本地 AI";
/** 进程启动时刻：配合版本号回答「你现在跑的到底是哪一版、几点起来的」 */
const STARTED_AT = new Date().toISOString();

// ---------------------------------------------------------------- 视觉 sidecar（图片入口）
/**
 * node-llama-cpp 3.22.x 没有视觉 API（mmproj/mtmd 只在 llama.cpp 底层层面上有），
 * 所以带图请求转给官方 llama-server.exe：独立进程、独立端口（默认 8101），主服务只做转发。
 *
 * 路径优先级：环境变量 LOCALAI_LLAMA_DIR → 发布包 app/llama → 开发目录 server/../tools/llama.cpp
 * （发布包里由 build-portable.ps1 把 tools/llama.cpp 拷成 app/llama）
 */
const LLAMA_DIR =
  process.env.LOCALAI_LLAMA_DIR ||
  (existsSync(path.join(HERE, "llama", "llama-server.exe"))
    ? path.join(HERE, "llama")
    : path.join(HERE, "..", "tools", "llama.cpp"));
const LLAMA_SERVER = path.join(LLAMA_DIR, "llama-server.exe");
/** 视觉 sidecar 监听端口：固定 8101（契约定死，状态接口也按这个显示） */
const VISION_PORT = Number(process.env.VISION_PORT ?? 8101);
const VISION_HOST = "127.0.0.1";
/**
 * sidecar 上下文：默认 32K（2026-11-08 起；8K 装不下「多图 / 长对话 + 图」）。
 * config.ini 的 visionContext 或环境变量 VISION_CTX 可改，范围 2048–131072。
 */
const VISION_CONTEXT_DEFAULT = 32768;
const VISION_CONTEXT_MIN = 2048;
const VISION_CONTEXT_MAX = 131072;

/** 实际使用的视觉上下文：环境变量 > config.ini > 默认（每次启动 sidecar 时读一遍） */
async function visionContextSize() {
  const fromEnv = Math.floor(Number(process.env.VISION_CTX));
  if (Number.isFinite(fromEnv) && fromEnv >= VISION_CONTEXT_MIN) return Math.min(VISION_CONTEXT_MAX, fromEnv);
  try {
    const cfg = await readConfigIni();
    const n = Math.floor(Number(cfg.visionContext));
    if (Number.isFinite(n) && n >= VISION_CONTEXT_MIN) return Math.min(VISION_CONTEXT_MAX, n);
  } catch {}
  return VISION_CONTEXT_DEFAULT;
}

/**
 * 闲置自动退出：sidecar 空闲这么久就停掉，把内存还回去（下一张图再自动拉起）。
 * config.ini 的 visionIdleSec / 环境变量 VISION_IDLE_SEC 可改；0 = 永不自动退出。
 */
const VISION_IDLE_DEFAULT_SEC = 300;

async function visionIdleSec() {
  const fromEnv = Number(process.env.VISION_IDLE_SEC);
  if (Number.isFinite(fromEnv) && fromEnv >= 0) return Math.min(3600, Math.floor(fromEnv));
  try {
    const cfg = await readConfigIni();
    const n = Number(cfg.visionIdleSec);
    if (Number.isFinite(n) && n >= 0) return Math.min(3600, Math.floor(n));
  } catch {}
  return VISION_IDLE_DEFAULT_SEC;
}

/**
 * 视觉编码线程数：config.ini 的 visionThreads 显式指定时才传 -t，否则 0 = 交给 llama.cpp 自己选。
 * 2026-11-08 实测（Qwen3.5-9B + 1036 image token，同机同图）：
 *   默认（程序自选 16 线程）25.2 tok/s ≈ 41s；强行 -t 20 → 18.7 tok/s ≈ 56s（慢 35%）。
 * 这台机器上多塞线程会抢核反而变慢，所以默认不传。
 */
async function visionThreads() {
  try {
    const cfg = await readConfigIni();
    const n = Math.floor(Number(cfg.visionThreads));
    if (Number.isFinite(n) && n >= 1) return Math.min(64, n);
  } catch {}
  return 0;
}
/**
 * offload 到 GPU 的层数：默认 0 = CPU。
 * 实测 Vulkan 后端在 mtmd 图像编码时会 device lost（0xC0000005，ggml_vulkan: device lost on Vulkan0），
 * 先默认 CPU 保全稳定；想开 GPU 对比用环境变量 VISION_NGL=99。
 */
const VISION_NGL = Math.max(0, Math.min(999, Math.floor(Number(process.env.VISION_NGL ?? 0)) || 0));
/**
 * mmproj（图像编码）用哪个设备：默认 "none" = 强制 CPU。
 * 关键：-ngl 只影响文本层，mmproj 不受它管；不显式给 -mmdev none 时图像编码会走 Vulkan。
 * 2026-11-08 实测：1440×900 截图（约 1036 image token）在核显上 ggml_vulkan: device lost
 * → mtmd_batch_encode 失败 → HTTP 500「failed to process mtmd chunk」。320×180 小图能糊过去，
 * 所以之前的小图探针一直没暴露。想再试 GPU 用 VISION_MMPROJ_DEVICE=vulkan0。
 */
const VISION_MMPROJ_DEVICE = String(process.env.VISION_MMPROJ_DEVICE ?? "none").trim() || "none";
/** 启动等待上限：模型加载约 16s，留足余量；超时杀进程回 504 */
const VISION_START_TIMEOUT_MS = 120000;
/** 单次视觉请求最长等 10 分钟（流式大回答兜底） */
const VISION_REQUEST_TIMEOUT_MS = 600000;
/** 视觉请求排队上限：同一时刻只允许一个请求进 sidecar，第二个最多等 180s */
const VISION_QUEUE_TIMEOUT_MS = 180000;
/** sidecar 日志：发布包 <安装目录>/logs/vision.log，开发目录 <工作目录>/logs/vision.log */
const VISION_LOG_DIR = path.resolve(HERE, "..", "logs");
const VISION_LOG = path.join(VISION_LOG_DIR, "vision.log");

/**
 * 构建标识。开发目录里有 .git 就取短哈希（报问题能直接对上哪次提交）；
 * 发布包里没有 .git，退回 app.mjs 自己的修改时间（≈打包那一刻）。
 * 拿不到也不报错：版本信息只用于对账，不该拦住启动。
 */
const BUILD = (() => {
  const git = (args) => spawnSync("git", args, { cwd: HERE, encoding: "utf8", timeout: 3000, windowsHide: true });
  try {
    const rev = git(["rev-parse", "--short", "HEAD"]);
    // 只有「这份文件本身被 git 跟踪」时才认这个哈希：
    // 发布包是拷贝出来的，它可能恰好躺在某个仓库子目录里（dist\ 就在本仓库下），
    // 那样 rev-parse 会报出仓库的提交，而包里跑的其实是另一份代码 —— 宁可报打包时间。
    const tracked = git(["ls-files", "--error-unmatch", "app.mjs"]);
    if (rev?.status === 0 && rev.stdout.trim() && tracked?.status === 0) {
      const at = git(["log", "-1", "--format=%cI"]);
      // 有未提交改动时也照样报哈希，但标出来 —— 免得拿「脏工作区」当发版依据
      const dirty = git(["diff", "--quiet", "HEAD", "--", "app.mjs"])?.status === 1;
      return {
        commit: rev.stdout.trim(),
        commitAt: at?.status === 0 ? at.stdout.trim() : "",
        builtAt: "",
        source: "git",
        dirty,
      };
    }
  } catch {}
  try {
    return { commit: "", commitAt: "", builtAt: statSync(fileURLToPath(import.meta.url)).mtime.toISOString(), source: "mtime", dirty: false };
  } catch {
    return { commit: "", commitAt: "", builtAt: "", source: "unknown", dirty: false };
  }
})();

/** 版本信息：界面「关于」页与排障共用这一份，避免多处各写一遍 */
function versionInfo() {
  return {
    version: APP_VERSION,
    commit: BUILD.commit,
    commitAt: BUILD.commitAt,
    builtAt: BUILD.builtAt,
    buildSource: BUILD.source,
    dirty: BUILD.dirty,
    startedAt: STARTED_AT,
    node: process.version,
    dir: HERE,
    pid: process.pid,
    port: PORT,
  };
}


// ---------------------------------------------------------------- 调试面板（Debugging Tool）
// 目标：一台机器上的 QingYaoTP AILauncher（本地 AI）出问题时，先在这里看清「哪一层坏了」，
// 而不是让用户去翻 app.log。检查项要能直接给出处置建议（fix 字段）。

/** 日志候选路径：发布包在 <root>\logs\app.log，开发目录常见 server\app.log */
function logCandidates() {
  return [
    path.join(HERE, "..", "logs", "app.log"),
    path.join(HERE, "app.log"),
    path.join(HERE, "logs", "app.log"),
  ].map((p) => path.resolve(p));
}

/** 诊断历史：每次体检落一行（节流），回答「这个问题从什么时候开始、是不是刚变坏」 */
const DIAG_HISTORY = path.join(HERE, "..", "logs", "diag-history.jsonl");
const DIAG_HISTORY_MAX = 500;
const DIAG_HISTORY_MIN_MS = 10 * 60 * 1000;
/** 检查项 → 分组（页面按这六组分节显示；新检查项忘了登记就落到「其他」） */
const DIAG_GROUP = {
  server: "服务", bind: "服务", busy: "服务", version: "服务",
  msvcp: "系统", node: "系统", mem: "系统", disk: "系统", logs: "系统", webview2: "系统", config: "系统",
  backend: "推理", vkdevices: "推理", crash: "推理", models: "推理", loaded: "推理", kv: "推理", kvquant: "推理", vision: "推理",
  sessions: "数据", backup: "数据", rag: "数据", ragfresh: "数据",
  plugins: "扩展",
  dist: "发布",
};
const LV_CODE = { ok: "o", warn: "w", error: "e" };
const CODE_LV = { o: "ok", w: "warn", e: "error" };
let diagTrack = new Map();       // id → { level, since, changedAt, count }
let diagLines = [];              // 历史记录（最近 DIAG_HISTORY_MAX 条）
let diagLoaded = false;
let diagLastSig = "";
let diagLastWriteAt = 0;
let diagHistoryWrite = Promise.resolve();
const diagTitles = new Map();    // id → title（历史变更列表用）

function lvOf(code) { return code ? (CODE_LV[code] || "ok") : null; }

/** 读历史尾部，恢复每项「当前 level 从什么时候开始」（重启后徽标不回零） */
async function loadDiagHistory() {
  if (diagLoaded) return;
  diagLoaded = true;
  try {
    const raw = await readFile(DIAG_HISTORY, "utf8");
    const parsed = [];
    for (const line of raw.split(/\r?\n/).filter(Boolean).slice(-DIAG_HISTORY_MAX)) {
      try { const r = JSON.parse(line); if (r && r.t && r.l && typeof r.l === "object") parsed.push(r); } catch {}
    }
    diagLines = parsed;
    const cur = new Map();
    for (let i = diagLines.length - 1; i >= 0; i--) {
      const rec = diagLines[i];
      for (const [id, code] of Object.entries(rec.l)) {
        const level = lvOf(code);
        if (!level) continue;
        const prev = cur.get(id);
        if (!prev) { cur.set(id, { level, since: rec.t, changedAt: rec.t, count: 0 }); continue; }
        if (prev.level === level) { prev.since = rec.t; prev.changedAt = rec.t; }
      }
    }
    diagTrack = cur;
  } catch { diagLines = []; }
}

/** 相邻两次体检对比出来的 level 变化（只报 ok↔warn↔error，不报新增/消失） */
function diagHistoryChanges(points) {
  const out = [];
  let prev = null;
  for (const r of points) {
    const l = r.l || {};
    if (prev) {
      for (const id of new Set([...Object.keys(prev), ...Object.keys(l)])) {
        const from = lvOf(prev[id]);
        const to = lvOf(l[id]);
        if (!from || !to || from === to) continue;
        out.push({ t: r.t, id, title: diagTitles.get(id) || id, from, to });
      }
    }
    prev = l;
  }
  return out.slice(-8);
}

function diagHistoryView(hours = 24, limit = 200) {
  const h = Math.max(1, Math.min(24 * 30, Number(hours) || 24));
  const n = Math.max(1, Math.min(DIAG_HISTORY_MAX, Number(limit) || 200));
  const cut = Date.now() - h * 3600 * 1000;
  const points = diagLines.filter((r) => Date.parse(r.t) >= cut).slice(-n);
  return { file: DIAG_HISTORY, exists: diagLines.length > 0, total: diagLines.length, hours: h, points, changes: diagHistoryChanges(points) };
}

/**
 * 落一条历史：启动后首次 / 任一检查项 level 变化 / 距上次 ≥10 分钟，三者之一才写。
 * 页面 5 秒轮询一次，不节流的话一天能写两万行。
 */
async function recordDiagHistory(checks, summary) {
  const sig = checks.map((c) => c.id + ":" + c.level).join("|");
  const now = Date.now();
  if (sig === diagLastSig && now - diagLastWriteAt < DIAG_HISTORY_MIN_MS) return;
  diagLastSig = sig;
  diagLastWriteAt = now;
  diagLines.push({
    t: new Date(now).toISOString(),
    e: summary.error, w: summary.warn, o: summary.ok,
    l: Object.fromEntries(checks.map((c) => [c.id, LV_CODE[c.level] || "o"])),
  });
  if (diagLines.length > DIAG_HISTORY_MAX) diagLines = diagLines.slice(-DIAG_HISTORY_MAX);
  diagHistoryWrite = diagHistoryWrite.then(async () => {
    try {
      await mkdir(path.dirname(DIAG_HISTORY), { recursive: true });
      await writeFile(DIAG_HISTORY, diagLines.map((x) => JSON.stringify(x)).join("\n") + "\n", "utf8");
    } catch {}
  });
  await diagHistoryWrite;
}

/** 「12 分钟前」这种人话；时间戳缺失/未来时间都归到「刚刚」 */
function fmtAgo(ts) {
  const t = Number(ts);
  if (!Number.isFinite(t) || t <= 0) return "—";
  const ms = Date.now() - t;
  if (ms < 60 * 1000) return "刚刚";
  const m = Math.floor(ms / 60000);
  if (m < 60) return m + " 分钟前";
  const h = Math.floor(m / 60);
  if (h < 24) return h + " 小时前";
  return Math.floor(h / 24) + " 天前";
}

/** 时长人话：「12 分钟」「3.2 小时」「2.1 天」 */
function fmtSpan(ms) {
  const v = Math.max(0, Number(ms) || 0);
  if (v < 60 * 1000) return "不到 1 分钟";
  const m = Math.round(v / 60000);
  if (m < 60) return m + " 分钟";
  const h = v / 3600000;
  if (h < 48) return h.toFixed(1) + " 小时";
  return (h / 24).toFixed(1) + " 天";
}

/** WebView2 运行时（主界面窗口和调试窗口都靠它；没装时只能退化成浏览器标签页） */
function webview2Runtime() {
  const roots = [process.env["ProgramFiles(x86)"], process.env.ProgramFiles].filter(Boolean);
  for (const root of roots) {
    const dir = path.join(root, "Microsoft", "EdgeWebView", "Application");
    try {
      const vs = readdirSync(dir).filter((v) => /^\d+\.\d+\.\d+\.\d+$/.test(v));
      if (vs.length) {
        vs.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        return { dir, version: vs[vs.length - 1] };
      }
    } catch {}
  }
  return { dir: "", version: "" };
}

/** RAG 新鲜度：workspace 里可索引文件的最新 mtime（节流 60 秒，别每 5 秒扫一遍盘） */
const ragFreshCache = { at: 0, val: null };
async function ragFreshness() {
  // 空结果只缓存 15 秒：服务刚起时索引可能还没从磁盘加载完，别把「0 个文件」缓存一分钟导致 ragfresh 短暂消失
  if (ragFreshCache.val && Date.now() - ragFreshCache.at < (ragFreshCache.val.files ? 60000 : 15000)) return ragFreshCache.val;
  try { await ragLoadPersisted(); } catch {} // 索引是从磁盘懒加载的，先确保读进来再报「有几个文件」
  const rs = ragStatus();
  let newest = 0;
  try {
    for (const f of await ragWalk()) if (f.mtimeMs > newest) newest = f.mtimeMs;
  } catch {}
  const val = { files: rs.files, chunks: rs.chunks, builtAt: rs.builtAt, newest };
  ragFreshCache.at = Date.now();
  ragFreshCache.val = val;
  return val;
}

/**
 * 读文件尾部：只读最后 128KB，别把几百 MB 的日志整份读进内存。
 * 编码要嗅探：启动器写的是 UTF-8，但 PowerShell 重定向（run-server.cmd）写的是 UTF-16LE，
 * 一律按 UTF-8 解会得到一堆夹着空字符的乱码——日志面板就废了。
 */
async function tailText(file, lines = 200) {
  let fh;
  try {
    fh = await open(file, "r");
    const st = await fh.stat();
    const CHUNK = 128 * 1024;
    const head = Buffer.alloc(2);
    if (Number(st.size) >= 2) await fh.read(head, 0, 2, 0);
    const utf16 = (head[0] === 0xff && head[1] === 0xfe) || (head[0] === 0xfe && head[1] === 0xff) || (head[0] !== 0 && head[1] === 0);
    let start = Math.max(0, Number(st.size) - CHUNK);
    if (utf16) start -= start % 2; // 从偶数偏移读，避免把一个 UTF-16 字符切成两半
    const len = Number(st.size) - start;
    const buf = Buffer.alloc(Math.max(0, len));
    if (len > 0) await fh.read(buf, 0, len, start);
    let text;
    if (utf16) {
      const le = !(head[0] === 0xfe && head[1] === 0xff);
      text = (le ? buf.toString("utf16le") : Buffer.from(buf).swap16().toString("utf16le")).replace(/^\uFEFF/, "");
    } else {
      text = buf.toString("utf8").replace(/^\uFEFF/, "");
    }
    const arr = text.split(/\r?\n/);
    return { text: arr.slice(-lines).join("\n"), size: Number(st.size), truncated: start > 0, encoding: utf16 ? "utf-16" : "utf-8" };
  } catch (e) {
    return { text: "", size: 0, truncated: false, error: String(e?.message ?? e) };
  } finally {
    try { await fh?.close(); } catch {}
  }
}

async function fileHash(p) {
  try {
    const buf = await readFile(p);
    return createHash("sha256").update(buf).digest("hex");
  } catch {
    return "";
  }
}

/** 诊断快照：一次扫完，返回「人话结论 + 机器可读字段」 */
async function buildDiag() {
  const checks = [];
  const add = (id, level, title, detail, fix) =>
    checks.push({ id, level, title, detail: detail == null ? "" : String(detail), fix: fix || "", group: DIAG_GROUP[id] || "其他" });
  // 返回体里给页面的三块汇总（检查项里也会重复显示关键信息）
  let visPublic = null, bkPublic = null, cfgPublic = null;

  const totalGB = Number((os.totalmem() / 2 ** 30).toFixed(1));
  const freeGB = Number((os.freemem() / 2 ** 30).toFixed(1));

  // ---- 服务 ----
  const upMin = Number(((Date.now() - process.uptime() * 1000) / 60000).toFixed(0));
  add("server", "ok", "服务在跑", `127.0.0.1:${PORT} · pid ${process.pid} · 运行 ${process.uptime() < 3600 ? Math.max(1, Math.round(process.uptime() / 60)) + " 分钟" : upMin + " 分钟"}`);
  add("bind", "ok", "只绑回环地址", "127.0.0.1（外部机器连不进来）");
  add("busy", activeChats > 0 ? "warn" : "ok", "并发对话", activeChats > 0 ? `${activeChats} 个进行中（此时切模型/卸载会被拒绝）` : "空闲（0 个进行中）");

  // ---- 版本 ----
  add("version", "ok", "版本", `v${APP_VERSION}${BUILD.commit ? " · " + BUILD.commit + (BUILD.dirty ? "（有未提交改动）" : "") : BUILD.builtAt ? " · 打包 " + BUILD.builtAt.slice(0, 16).replace("T", " ") : ""}`);

  // ---- 运行库 / 系统 ----
  add("msvcp", hasMsvcp() ? "ok" : "error", "VC++ 运行库",
    hasMsvcp() ? "msvcp140.dll 已安装" : "System32 里找不到 msvcp140.dll",
    hasMsvcp() ? "" : "装安装目录里的 vc_redist.x64.exe（或 aka.ms/vs/17/release/vc_redist.x64.exe），否则 llama 原生模块加载会失败");
  add("node", "ok", "运行时", `node ${process.version} · ${os.platform()} ${os.arch()} · ${os.cpus().length} 核`);
  add("mem", freeGB < 2 ? "error" : freeGB < 5 ? "warn" : "ok", "内存", `共 ${totalGB} GB · 可用 ${freeGB} GB`,
    freeGB < 2 ? "可用内存太少，加载 7B 级模型会失败；先卸载模型（/api/unload）或关掉其它程序" : freeGB < 5 ? "可用内存偏紧，尽量别同时预加载第二个模型" : "");

  // ---- 磁盘 ----
  try {
    const st = await statfs(MODEL_DIR);
    const freeDestGB = Number(((st.bavail * st.bsize) / 2 ** 30).toFixed(1));
    add("disk", freeDestGB < 2 ? "error" : freeDestGB < 5 ? "warn" : "ok", "磁盘余量", `${MODEL_DIR} · 剩 ${freeDestGB} GB`,
      freeDestGB < 2 ? "剩余不足 2GB：下载模型会失败，会话快照也可能写不进去" : "");
  } catch (e) {
    add("disk", "warn", "磁盘余量", "读不到模型目录: " + String(e?.message ?? e));
  }

  // ---- 后端 / 崩溃 ----
  const gpu = state.gpu || "?";
  const crashInfo = await recentCrashes();
  if (gpu === "vulkan") {
    add("backend", "ok", "推理后端", "Vulkan（核显加速）");
  } else {
    add("backend", "warn", "推理后端", `CPU（慢，但稳定）${backendNote.text ? " · " + backendNote.text : ""}`,
      crashInfo.length >= 2 ? "最近 10 分钟 Vulkan 崩过 ≥2 次，程序自己切了 CPU；确认稳定后可删掉 server\\vulkan-crash.log 再重启恢复 Vulkan" : "");
  }
  {
    const vis = String(process.env.GGML_VK_VISIBLE_DEVICES ?? "").trim();
    const names = gpuDeviceNames;
    if (!names.length) add("vkdevices", "warn", "显卡选择", "没有可选的 Vulkan 设备（CPU 后端）");
    else add("vkdevices", "ok", "显卡选择",
      vis ? `只用设备 ${vis}：${names.join(" / ")}` : `自动：全部 ${names.length} 个设备（${names.join(" / ")}）`,
      vis ? "" : "核显+独显的机器可在「设置 → 显卡」里指定独显（写 config.ini 的 vkDevices，重启生效）");
  }
  if (crashInfo.length) {
    add("crash", "warn", "崩溃记录", `最近 ${crashInfo.length} 次（10 分钟内计数）`,
      "生成中途断开（点停止/关窗口）会触发 Vulkan device lost；这也是「崩两次自动切 CPU」的依据");
  } else {
    add("crash", "ok", "崩溃记录", "最近 10 分钟没有崩溃");
  }

  // ---- 模型 ----
  let models = [];
  try { models = await scanModels(); } catch (e) { add("models", "error", "模型扫描", String(e?.message ?? e)); }
  add("models", models.length ? "ok" : "warn", "模型库", `${models.length} 个 .gguf · ${MODEL_DIR}`,
    models.length ? "" : "模型目录里没有 .gguf：用「模型 → 添加模型」嗅探，或下载一个入门模型");
  const kvActual = kvCacheInfo();
  if (state.file) {
    const ok = existsSync(path.join(MODEL_DIR, state.file));
    add("loaded", ok ? "ok" : "error", "已加载模型",
      `${state.file} · 上下文 ${state.contextSize} · ${state.layers} 层`,
      ok ? "" : "文件不见了：模型目录被移动/删除，请重新加载");
    const cached = state.sequence?.nextTokenIndex ?? 0;
    add("kv", "ok", "KV 缓存", `常驻序列 ${Number(cached) || 0} token · 复用 ${KV_REUSE ? "开" : "关"}`,
      KV_REUSE ? "" : "KV 复用关着（kvReuse=0）：每轮都会整段重算，慢但不影响正确性");
    const kvQ = state.kvQuant;
    const kvOk = kvQ === "q8_0" && kvActual.key === "q8_0";
    add("kvquant",
      kvOk ? "ok" : KV_QUANT_ON && kvActual.key === "f16" ? "warn" : "ok",
      "KV 缓存量化",
      kvActual.key ? `实际 ${kvActual.key}（请求 ${kvQ || "—"}）${kvActual.flashAttention === true ? " · flash attention 开" : ""}` : "未加载",
      !kvOk && KV_QUANT_ON
        ? (state.kvQuantFallback ? "量化没生效：" + state.kvQuantFallback : "请求 q8_0 但实际是 " + (kvActual.key || "未知") + "（后端可能不支持 flash attention）") + "；可试 KV_QUANT=q4_0"
        : "");
  } else {
    add("loaded", "warn", "已加载模型", "未加载（连界面都不能问答）", "点左上角「∫ 模型」选一个加载，或看「模型」页");
  }

  // ---- 会话 ----
  let files = [];
  try { files = (await readdir(SESSION_DIR)).filter((x) => x.endsWith(".json")); } catch {}
  let bad = 0, bytes = 0, maxBytes = 0;
  for (const f of files) {
    try {
      const st = await stat(path.join(SESSION_DIR, f));
      bytes += st.size;
      if (st.size > maxBytes) maxBytes = st.size;
      JSON.parse(await readFile(path.join(SESSION_DIR, f), "utf8"));
    } catch { bad++; }
  }
  add("sessions", bad ? "error" : "ok", "会话",
    `${files.length} 个 · ${(bytes / 1024).toFixed(0)} KB${bad ? ` · ${bad} 个损坏` : ""}`,
    bad ? "有会话文件不是合法 JSON（多半是写盘时被打断）：坏的会被列表跳过，建议先备份再删" : "");

  // ---- 备份 ----
  try {
    const bk = await backupConfig();
    add("backup", bk.enabled && bk.dir ? "ok" : "warn", "会话备份",
      bk.enabled && bk.dir ? `开 · ${bk.dir}` : "未开启（会话只在这台机器上）",
      bk.enabled ? "" : "设置 → 工具 → 会话备份：指向另一块盘/U 盘，防整盘坏");
  } catch {}

  // ---- 文档检索 ----
  try {
    const rs = ragStatus();
    add("rag", rs.files ? "ok" : "warn", "文档检索",
      `${rs.files} 个文件 / ${rs.chunks} 段`,
      rs.files ? "" : "workspace 里还没有可索引的文档（md/txt/docx/pdf）");
  } catch {}

  // ---- 插件 ----
  try {
    const items = pluginState.items || [];
    const errs = items.filter((x) => !x.ok);
    add("plugins", errs.length ? "error" : "ok", "插件",
      `${activePlugins().length} 个可用 / ${items.length} 个文件${errs.length ? " · " + errs.length + " 个加载失败" : ""}`,
      errs.length ? errs.map((x) => x.file + ": " + x.error).join(" | ") : "");
  } catch {}


  // ---- 日志体积（日志只增不减，跑几个月能到几百 MB；调试包只取尾部）----
  try {
    const lf = logCandidates().find((p) => existsSync(p));
    if (!lf) {
      add("logs", "ok", "日志体积", "还没有 app.log（服务启动后才写第一行）");
    } else {
      const st = await stat(lf);
      const mb = st.size / 1024 / 1024;
      add("logs", mb > 200 ? "error" : mb > 50 ? "warn" : "ok", "日志体积",
        lf + " · " + (mb < 1 ? Math.max(1, Math.round(st.size / 1024)) + " KB" : mb.toFixed(1) + " MB") +
        " · 最后写入 " + new Date(st.mtimeMs).toISOString().slice(0, 16).replace("T", " "),
        mb > 50 ? "日志偏大：确认没有要回查的内容后可以删掉这个文件（服务重启会新建）；调试工具导出诊断包只取尾部 500 行" : "");
    }
  } catch (e) {
    add("logs", "warn", "日志体积", "读不到日志：" + String(e?.message ?? e));
  }

  // ---- WebView2 运行时（主界面窗口、调试窗口都靠它）----
  {
    const wv2 = webview2Runtime();
    add("webview2", wv2.version ? "ok" : "warn", "WebView2 运行时",
      wv2.version ? "v" + wv2.version + " · " + wv2.dir : "没找到 WebView2 运行时（Microsoft Edge WebView2 Runtime）",
      wv2.version ? "" : "装 Evergreen WebView2 Runtime（aka.ms/webview2）；缺了它主界面窗口和调试窗口都开不了，只能退化成浏览器标签页");
  }

  // ---- config.ini（便携包的关键配置都在这里；写错了只会表现为「怎么老是 CPU / 端口不对」）----
  {
    const cfgFile = path.join(HERE, "..", "config.ini");
    let cfg = {};
    try { cfg = await readConfigIni(); } catch {}
    const problems = [];
    const notes = [];
    const exists = existsSync(cfgFile);
    if (!exists) {
      notes.push("开发目录没有 config.ini（走环境变量/默认值，模型目录 " + MODEL_DIR + "）");
    } else {
      notes.push("modelDir=" + (String(cfg.modelDir || "").trim() || "（空 = 便携默认，实际 " + MODEL_DIR + "）"));
      notes.push("port=" + (cfg.port || PORT));
      if (cfg.gpu) notes.push("gpu=" + cfg.gpu);
      if (cfg.vkDevices) notes.push("vkDevices=" + cfg.vkDevices);
      const cfgPort = Number(cfg.port);
      if (Number.isFinite(cfgPort) && cfgPort !== PORT) problems.push("port=" + cfg.port + " 与实际监听 " + PORT + " 不一致（启动器或环境变量覆盖了它）");
      for (const [k, label] of [["visionModel", "视觉模型"], ["visionMmproj", "视觉投影"]]) {
        const v = String(cfg[k] || "").trim();
        if (!v) continue;
        const abs = path.isAbsolute(v) ? v : path.join(MODEL_DIR, v);
        if (!existsSync(abs)) problems.push(label + "（config.ini 的 " + k + "）指向不存在的文件：" + v);
      }
      const devs = Array.isArray(gpuDeviceNames) ? gpuDeviceNames.length : 0;
      const picked = String(cfg.vkDevices || "").split(",").map((x) => Number(x.trim())).filter((n) => Number.isFinite(n));
      if (devs && picked.some((n) => n < 0 || n >= devs)) problems.push("vkDevices=" + cfg.vkDevices + " 超出可用设备（共 " + devs + " 个）");
    }
    const missingFile = problems.some((p) => p.indexOf("不存在的文件") >= 0);
    add("config", missingFile ? "error" : problems.length ? "warn" : "ok", "配置",
      cfgFile + " · " + notes.join(" · "),
      problems.length ? problems.join("；") + "（改完要重启应用才生效）" : "");
    cfgPublic = {
      file: cfgFile, exists,
      modelDir: String(cfg.modelDir || ""), port: String(cfg.port || ""), gpu: String(cfg.gpu || ""),
      vkDevices: String(cfg.vkDevices || ""), visionModel: String(cfg.visionModel || ""), visionMmproj: String(cfg.visionMmproj || ""),
    };
  }

  // ---- 视觉 sidecar（v1.3.x 的主打能力；发图 500 时这里是第一现场）----
  try {
    const vis = await visionState();
    const comp = existsSync(LLAMA_SERVER);
    const pair = vis.selected ? vis.selected.model + " + " + vis.selected.mmproj : "";
    const detail = "8101 · " +
      (vis.running ? "运行中 pid " + vis.pid + (vis.model ? " · " + path.basename(vis.model) : "") : "未运行（发图时自动拉起，首图 6–12s）") +
      " · 配对 " + (pair || "无") + " · 上下文 " + vis.context +
      (vis.idleExitSec ? " · 闲置 " + vis.idleExitSec + " 秒退出" : " · 闲置不退出") +
      (vis.autoRestoreSec ? " · 看完图 " + vis.autoRestoreSec + " 秒装回文本模型" : "");
    let level = "ok", fix = "";
    if (!comp) {
      level = "error";
      fix = "视觉组件缺失：找不到 " + LLAMA_SERVER + "；重装发布包，或把 llama.cpp（llama-server.exe + 同目录 DLL）放进 app\\llama。不看图可以忽略";
    } else if (!pair) {
      level = "warn";
      fix = "没有可用的「模型 + mmproj」组合：把 mmproj 放到 " + path.join(MODEL_DIR, "mmproj") + " 下，或在 config.ini 指定 visionModel / visionMmproj";
    } else if (vis.error) {
      level = "warn";
      fix = "上次视觉启动/请求失败：" + String(vis.error).slice(0, 160) + "；点「重读」或查看日志尾部（vision.log）";
    }
    add("vision", level, "视觉 sidecar", detail, fix);
    visPublic = {
      running: vis.running, port: vis.port, pid: vis.pid || null, model: vis.model, mmproj: vis.mmproj,
      pairs: Array.isArray(vis.pairs) ? vis.pairs.length : 0, selected: vis.selected || null,
      context: vis.context, idleExitSec: vis.idleExitSec, autoRestoreSec: vis.autoRestoreSec,
      error: vis.error || "", component: comp, note: vis.note || "",
    };
  } catch (e) {
    add("vision", "warn", "视觉 sidecar", "读不到状态：" + String(e?.message ?? e));
  }

  // ---- 会话备份（2026-11-10 修：这里原来调用了不存在的 backupConfig()，
  //      异常被空 catch 吞掉，导致「会话备份」这项从 11-04 起就没出现在页面上）----
  try {
    const bk = await readBackupConfig();
    let lastAt = backupState.lastRunAt || 0;
    if (bk.enabled && bk.dir) {
      try {
        const meta = JSON.parse(await readFile(path.join(resolveBackupDir(bk.dir), "backup.json"), "utf8"));
        if (Number(meta.updatedAt) > lastAt) lastAt = Number(meta.updatedAt);
      } catch {}
    }
    const last = backupState.lastResult;
    if (!bk.enabled || !bk.dir) {
      add("backup", "warn", "会话备份", "未开启（会话只在这台机器上）",
        "设置 → 工具 → 会话备份：指向另一块盘/U 盘，防整盘坏或误删");
    } else if (last && last.ok === false) {
      add("backup", "warn", "会话备份",
        bk.dir + " · 上次失败：" + String(last.error || last.skipped || "未知") + (lastAt ? " · " + fmtAgo(lastAt) : ""),
        "检查备份目录是否可写、网络盘是否在线；备份失败不会打断对话");
    } else {
      add("backup", lastAt ? "ok" : "warn", "会话备份",
        bk.dir + (lastAt ? " · 最近成功 " + fmtAgo(lastAt) : " · 还没跑过第一次") + " · 每 " + bk.intervalMin + " 分钟",
        lastAt ? "" : "启动后 1 分钟内会自动跑第一次；也可以在设置里点「立即备份」");
    }
    bkPublic = { enabled: !!bk.enabled, dir: bk.dir || "", lastRunAt: lastAt, lastOk: last ? last.ok !== false : null, error: String(last?.error || ""), intervalMin: bk.intervalMin };
  } catch (e) {
    add("backup", "warn", "会话备份", "读备份配置失败：" + String(e?.message ?? e));
  }

  // ---- 文档索引新鲜度（有索引才报；ragWalk 结果缓存 60 秒）----
  try {
    const fr = await ragFreshness();
    if (fr.files > 0) {
      const lag = Number(fr.newest) - Number(fr.builtAt);
      add("ragfresh", lag > 60 * 1000 ? "warn" : "ok", "索引新鲜度",
        (fr.builtAt ? "索引 " + new Date(fr.builtAt).toISOString().slice(0, 16).replace("T", " ") : "索引时间未知") +
        " · 最新文档 " + (fr.newest ? new Date(fr.newest).toISOString().slice(0, 16).replace("T", " ") : "—") +
        " · " + fr.files + " 文件 / " + fr.chunks + " 段",
        lag > 60 * 1000 ? "workspace 里有比索引更新的文档（新了 " + fmtSpan(lag) + "）：点「重建文档索引」，或等下一次检索自动增量同步" : "");
    }
  } catch (e) {
    add("ragfresh", "warn", "索引新鲜度", "算不出来：" + String(e?.message ?? e));
  }

  // ---- 源码与发布包一致性 ----
  const distApp = path.join(MODEL_DIR, "dist", "QingYaoTP AILauncher", "app");
  if (existsSync(distApp)) {
    const pairs = ["app.mjs", "app.html", "doc-extract.mjs", "debug.html", "localai-debug.mjs", "diag-zip.mjs"];
    const drifted = [];
    for (const name of pairs) {
      const a = await fileHash(path.join(HERE, name));
      const b = await fileHash(path.join(distApp, name));
      if (a && b && a !== b) drifted.push(name);
    }
    add("dist", drifted.length ? "warn" : "ok", "发布包与源码",
      drifted.length ? `${drifted.join("、")} 与 dist 不一致` : "六份文件哈希一致",
      drifted.length ? "改完源码要拷进 dist\\QingYaoTP AILauncher\\app\\，否则发布包跑的是旧代码" : "");
  }

  const summary = {
    error: checks.filter((c) => c.level === "error").length,
    warn: checks.filter((c) => c.level === "warn").length,
    ok: checks.filter((c) => c.level === "ok").length,
  };
  // 「这项从什么时候开始坏/好」：进程内追踪 + 历史文件恢复（重启后徽标不回零）
  await loadDiagHistory();
  const nowIso = new Date().toISOString();
  for (const c of checks) {
    diagTitles.set(c.id, c.title);
    const prev = diagTrack.get(c.id);
    if (!prev) diagTrack.set(c.id, { level: c.level, since: nowIso, changedAt: nowIso, count: 1 });
    else if (prev.level !== c.level) { prev.level = c.level; prev.since = nowIso; prev.changedAt = nowIso; prev.count = 1; }
    else prev.count = (Number(prev.count) || 0) + 1;
    const tr = diagTrack.get(c.id);
    c.since = tr.since;
    c.changedAt = tr.changedAt;
    c.streak = tr.count;
  }
  await recordDiagHistory(checks, summary);
  const hist = diagHistoryView(24, 200);

  return {
    now: new Date().toISOString(),
    version: { version: APP_VERSION, commit: BUILD.commit, dirty: BUILD.dirty, builtAt: BUILD.builtAt },
    server: { port: PORT, pid: process.pid, uptimeSec: Math.round(process.uptime()), activeChats, gpu, backendNote: backendNote.text },
    model: { file: state.file || "", context: state.contextSize || 0, layers: state.layers || 0, cachedTokens: state.sequence?.nextTokenIndex ?? 0, kvReuse: KV_REUSE, kvQuant: state.kvQuant, kvQuantFallback: state.kvQuantFallback, kvQuantActual: kvActual, count: models.length },
    system: { totalGB, freeGB, cpus: os.cpus().length, platform: os.platform(), arch: os.arch(), node: process.version },
    paths: { dir: HERE, modelDir: MODEL_DIR, sessions: SESSION_DIR, logs: logCandidates().find((p) => existsSync(p)) || logCandidates()[0], crashLog: CRASH_LOG },
    checks,
    summary,
    history: { points: diagLines.length, since: diagLines.length ? diagLines[0].t : null, changes: hist.changes },
    vision: visPublic,
    backup: bkPublic,
    config: cfgPublic,
  };
}


/**
 * 人话诊断报告：调试页「复制报告」的文本版 + 导出包里 REPORT.txt 用同一份格式。
 * 重点是每条检查都带 fix —— 拿到报告的人不用再问「那我该怎么办」。
 */
function diagReportText(diag, res) {
  const L = [];
  const lm = (ts) => new Date(ts).toISOString().slice(0, 16).replace("T", " ");
  L.push("QingYaoTP AILauncher（本地 AI）· Debugging Tool 诊断报告");
  L.push("生成时间: " + lm(Date.now()));
  L.push("版本: v" + diag.version.version + (diag.version.commit ? " (" + diag.version.commit + (diag.version.dirty ? " 未提交" : "") + ")" : diag.version.builtAt ? " 打包 " + diag.version.builtAt.slice(0, 16).replace("T", " ") : ""));
  L.push("服务: 127.0.0.1:" + diag.server.port + " · pid " + diag.server.pid + " · 已运行 " + fmtSpan((diag.server.uptimeSec || 0) * 1000) + " · 后端 " + diag.server.gpu);
  L.push("系统: " + diag.system.platform + " " + diag.system.arch + " · " + diag.system.cpus + " 核 · 内存 " + diag.system.totalGB + " GB（可用 " + diag.system.freeGB + "） · node " + diag.system.node);
  L.push("模型: " + (diag.model.file || "未加载") + " · 上下文 " + diag.model.context + " · " + diag.model.layers + " 层 · KV 常驻 " + diag.model.cachedTokens + " token");
  if (res) {
    const c = res.cpu || {}, m = res.mem || {}, p = res.proc || {}, d = res.disk;
    L.push("实时资源: CPU " + (typeof c.usagePct === "number" ? c.usagePct + "%" : "—") +
      " · 内存 " + m.usedGB + "/" + m.totalGB + " GB (" + m.usedPct + "%)" +
      " · 进程 RSS " + p.rssMB + " MB · 磁盘剩余 " + (d && d.path ? d.freeGB + " GB" : "—"));
  }
  if (diag.config) L.push("配置: " + diag.config.file + (diag.config.exists ? "（modelDir=" + (diag.config.modelDir || "空=便携默认") + "）" : "（不存在，用默认值）"));
  if (diag.vision) L.push("视觉: 8101 " + (diag.vision.running ? "运行中 pid " + diag.vision.pid : "未运行") + " · 配对 " + (diag.vision.selected ? diag.vision.selected.model + " + " + diag.vision.selected.mmproj : "无") + " · 上下文 " + diag.vision.context);
  if (diag.backup) L.push("备份: " + (diag.backup.enabled ? diag.backup.dir + (diag.backup.lastRunAt ? " · 最近成功 " + fmtAgo(diag.backup.lastRunAt) : " · 还没跑过") : "未开启"));
  L.push("");
  L.push("--- 检查（错误 " + diag.summary.error + " / 警告 " + diag.summary.warn + " / 正常 " + diag.summary.ok + "）---");
  for (const c of diag.checks) {
    const tag = c.level === "error" ? "[错误]" : c.level === "warn" ? "[警告]" : "[正常]";
    L.push(tag + " " + c.title + " — " + c.detail + (c.fix ? "\n      → " + c.fix : ""));
  }
  L.push("");
  L.push("--- 说明 ---");
  L.push("这个包由 QingYaoTP AILauncher 的 Debugging Tool 生成，内容：本报告、diag.json（原始数据）、");
  L.push("app.log/崩溃日志/视觉日志的尾部、消毒后的 config.ini（模型目录替换成 <MODEL_DIR>）。");
  L.push("排查够用；如果要把包发给别人，自己再看一眼 logs 里有没有私人内容。");
  return L.join("\n");
}

/** 导出诊断包：REPORT + diag.json + 日志尾部 + 消毒 config，打成零依赖 store zip */
async function buildDiagBundle() {
  const diag = await buildDiag();
  let resources = null;
  try { resources = await buildResources(); } catch {}
  const pad = (n) => String(n).padStart(2, "0");
  const now = new Date();
  const stamp = now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) + "-" + pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds());
  const entries = [];
  const push = (name, data) => entries.push({ name, data: Buffer.isBuffer(data) ? data : Buffer.from(String(data ?? ""), "utf8") });

  push("README.txt", [
    "QingYaoTP AILauncher · 诊断包",
    "生成时间: " + now.toISOString(),
    "版本: v" + APP_VERSION + (BUILD.commit ? " (" + BUILD.commit + ")" : ""),
    "",
    "怎么用：把整个 zip 交给维护者（或自己留着回溯）。",
    "  REPORT.txt   人话报告（先看这个）",
    "  diag.json    机器可读的完整诊断（检查项 + 实时资源）",
    "  logs/        应用日志 / 崩溃记录 / 视觉 sidecar 日志的尾部",
    "  config.ini.sanitized  当前 config.ini（模型目录已替换成 <MODEL_DIR>，本机绝对路径不外泄）",
    "  manifest.json 文件清单与 sha256",
    "",
    "隐私：日志里可能有你的提问片段；发出去前先扫一眼。",
  ].join("\n"));

  push("REPORT.txt", diagReportText(diag, resources));
  push("diag.json", JSON.stringify({ diag, resources }, null, 2));

  const appLog = logCandidates().find((p) => existsSync(p));
  if (appLog) {
    const t = await tailText(appLog, 500);
    push("logs/app.tail.txt", "# " + (t.file || appLog) + "\n" + (t.text || ""));
  }
  if (existsSync(CRASH_LOG)) {
    try { push("logs/crash.log", await readFile(CRASH_LOG)); } catch {}
  }
  if (existsSync(VISION_LOG)) {
    const t = await tailText(VISION_LOG, 200);
    push("logs/vision.tail.txt", "# " + VISION_LOG + "\n" + (t.text || ""));
  }
  {
    const cfgFile = path.join(HERE, "..", "config.ini");
    if (existsSync(cfgFile)) {
      let text = await readFile(cfgFile, "utf8");
      text = text.split(MODEL_DIR).join("<MODEL_DIR>");
      try { text = text.split(os.homedir()).join("<HOME>"); } catch {}
      push("config.ini.sanitized", text);
    } else {
      push("config.ini.sanitized", "（这份程序目录里没有 config.ini：开发目录或尚未生成）\n实际模型目录: <MODEL_DIR>\n");
    }
  }

  const manifest = {
    app: "QingYaoTP AILauncher",
    kind: "diagnostics",
    version: APP_VERSION,
    commit: BUILD.commit || "",
    createdAt: now.toISOString(),
    summary: diag.summary,
    files: entries.map((e) => ({ name: e.name, bytes: e.data.length, sha256: zipSha256(e.data) })),
  };
  push("manifest.json", JSON.stringify(manifest, null, 2));

  return { zip: zipStore(entries, now), name: "qy-diagnostics-" + stamp + ".zip", stamp, entries: entries.length };
}

/**
 * 实时资源快照（Debugging Tool 的「实时资源」卡用，2 秒轮询）。
 * CPU 占用率用两次 os.cpus() 的 delta 计算；服务刚起来第一次调用没有基准，usagePct 为 null。
 */
let cpuPrev = null;
function cpuUsagePct() {
  const cpus = os.cpus();
  let idle = 0, total = 0;
  for (const c of cpus) {
    const t = c.times || {};
    idle += t.idle || 0;
    total += (t.user || 0) + (t.nice || 0) + (t.sys || 0) + (t.idle || 0) + (t.irq || 0);
  }
  let pct = null;
  if (cpuPrev) {
    const dTotal = total - cpuPrev.total;
    const dIdle = idle - cpuPrev.idle;
    if (dTotal > 0) pct = Math.min(100, Math.max(0, Math.round((1 - dIdle / dTotal) * 100)));
  }
  cpuPrev = { idle, total };
  return { pct, model: (cpus[0]?.model || "").trim(), cores: cpus.length };
}

/** 进程 + 系统 + 模型的实时占用：给调试页画条、给 CLI 看数字 */
async function buildResources() {
  const memTotal = os.totalmem();
  const memFree = os.freemem();
  const used = Math.max(0, memTotal - memFree);
  const cpu = cpuUsagePct();
  const proc = process.memoryUsage();
  let disk = null;
  try {
    const st = await statfs(MODEL_DIR);
    disk = {
      path: MODEL_DIR,
      totalGB: +((st.blocks * st.bsize) / 2 ** 30).toFixed(1),
      freeGB: +((st.bavail * st.bsize) / 2 ** 30).toFixed(1),
    };
  } catch {}
  return {
    now: new Date().toISOString(),
    cpu: { usagePct: cpu.pct, cores: cpu.cores, model: cpu.model },
    mem: {
      totalGB: +(memTotal / 2 ** 30).toFixed(2),
      usedGB: +(used / 2 ** 30).toFixed(2),
      freeGB: +(memFree / 2 ** 30).toFixed(2),
      usedPct: Math.round((used / memTotal) * 100),
    },
    proc: {
      pid: process.pid,
      uptimeSec: Math.round(process.uptime()),
      rssMB: Math.round(proc.rss / 2 ** 20),
      heapUsedMB: Math.round(proc.heapUsed / 2 ** 20),
      externalMB: Math.round(proc.external / 2 ** 20),
    },
    disk,
    model: {
      file: state.file || "",
      context: state.contextSize || 0,
      layers: state.layers || 0,
      gpu: state.gpu || "",
      kvQuant: state.kvQuant || "",
      kvQuantActual: kvCacheInfo(),
      kvReuse: KV_REUSE,
      cachedTokens: state.sequence?.nextTokenIndex ?? 0,
      activeChats,
    },
    crash: (await recentCrashes()).length,
  };
}

// ---------------------------------------------------------------- 首次启动：自动检查用户配置
let gpuCache = null;
/** GPU 列表（名称 + 显存）：Windows 用 CIM 查；只查一次，失败返回空数组 */
function detectGpus() {
  if (gpuCache) return gpuCache;
  gpuCache = [];
  try {
    const ps = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command",
      "Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM | ConvertTo-Json -Compress"],
      { encoding: "utf8", timeout: 6000, windowsHide: true });
    const raw = String(ps.stdout || "").trim();
    if (raw) {
      const arr = JSON.parse(raw);
      for (const g of Array.isArray(arr) ? arr : [arr]) {
        const name = String(g?.Name || "").trim();
        if (!name) continue;
        const bytes = Number(g?.AdapterRAM) || 0;
        gpuCache.push({ name, vramGB: bytes > 0 ? +(bytes / 1024 ** 3).toFixed(1) : null });
      }
    }
  } catch {}
  return gpuCache;
}

/** 读 config.ini 的 key=value（没有该文件时返回 {}；开发目录就是这样） */
async function readConfigIni() {
  const file = path.join(HERE, "..", "config.ini");
  if (!existsSync(file)) return {};
  try {
    const out = {};
    for (const line of (await readFile(file, "utf8")).split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m) out[m[1]] = m[2];
    }
    return out;
  } catch { return {}; }
}

/** 写 config.ini：只更新已知 key，保留注释；没有该文件（开发目录）就不写 */
async function updateConfigFile(file, patch) {
  if (!existsSync(file)) return { wrote: false, reason: "没有 config.ini（开发目录），跳过" };
  const text = await readFile(file, "utf8");
  const lines = text.split(/\r?\n/);
  const want = new Map(Object.entries(patch));
  const out = lines.map((line) => {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=/);
    if (m && want.has(m[1])) {
      const val = String(want.get(m[1]));
      want.delete(m[1]);
      return m[1] + "=" + val;
    }
    return line;
  });
  for (const [k, v] of want) out.push(k + "=" + v);
  while (out.length && out[out.length - 1].trim() === "") out.pop();
  await writeFile(file, out.join("\r\n") + "\r\n", "utf8");
  return { wrote: true, path: file };
}

async function buildSysinfo() {
  const totalGB = os.totalmem() / 1024 ** 3;
  const freeGB = os.freemem() / 1024 ** 3;
  const cpus = os.cpus();
  const models = await scanModels().catch(() => []);
  const gpus = detectGpus();
  const gpuVramGB = gpus.reduce((m, g) => Math.max(m, Number(g.vramGB) || 0), 0) || null;
  let disk = null;
  try {
    const st = await statfs(MODEL_DIR);
    disk = {
      path: MODEL_DIR,
      freeGB: +((st.bavail * st.bsize) / 2 ** 30).toFixed(1),
      totalGB: +((st.blocks * st.bsize) / 2 ** 30).toFixed(1),
    };
  } catch {}
  const rec = recommendConfig({
    ramTotalGB: +totalGB.toFixed(1),
    ramFreeGB: +freeGB.toFixed(1),
    vramGB: gpuVramGB || 0,
    hasVulkan: state.gpu === "vulkan",
    cpuCores: cpus.length,
    models,
  });
  const vc = hasMsvcp();
  const checks = [
    { id: "cpu", level: "ok", title: "CPU", detail: `${(cpus[0]?.model ?? "unknown").trim()} · ${cpus.length} 核` },
    { id: "ram", level: totalGB < 8 ? "error" : totalGB < 12 ? "warn" : "ok", title: "内存", detail: `共 ${totalGB.toFixed(1)}GB · 可用 ${freeGB.toFixed(1)}GB`, fix: totalGB < 8 ? "低于 8GB 只能跑 0.5B 级小模型" : "" },
    { id: "gpu", level: gpus.length ? "ok" : "warn", title: "显卡", detail: gpus.length ? gpus.map((g) => g.name + (g.vramGB ? "（" + g.vramGB + "GB）" : "（共享内存）")).join(" / ") : "没读到显卡信息", fix: "" },
    { id: "vulkan", level: state.gpu === "vulkan" ? "ok" : "warn", title: "推理后端", detail: state.gpu === "vulkan" ? "Vulkan 可用（GPU 加速）" : `CPU（${backendNote.text || "Vulkan 不可用"}）`, fix: "" },
    { id: "vc", level: vc ? "ok" : "error", title: "VC++ 运行库", detail: vc ? "msvcp140.dll 已安装" : "缺少 msvcp140.dll", fix: vc ? "" : "装安装目录里的 vc_redist.x64.exe（或 aka.ms/vs/17/release/vc_redist.x64.exe）" },
    { id: "disk", level: !disk ? "warn" : disk.freeGB < 2 ? "error" : disk.freeGB < 5 ? "warn" : "ok", title: "磁盘", detail: disk ? `${disk.path} · 剩 ${disk.freeGB}GB` : "读不到模型目录", fix: disk && disk.freeGB < 2 ? "剩余不足 2GB：模型下载会失败" : "" },
    { id: "models", level: models.length ? "ok" : "warn", title: "已有模型", detail: `${models.length} 个 .gguf`, fix: models.length ? "" : "本机还没有模型，推荐先下载 " + rec.model.label },
    (() => {
      const vis = String(process.env.GGML_VK_VISIBLE_DEVICES ?? "").trim();
      const names = gpuDeviceNames;
      if (!names.length) return { id: "vkdevices", level: "warn", title: "显卡选择", detail: "CPU 后端：没有可选的 Vulkan 设备", fix: "" };
      return { id: "vkdevices", level: "ok", title: "显卡选择", detail: vis ? `只用设备 ${vis}（${names.join(" / ")}）` : `自动：全部 ${names.length} 个设备（${names.join(" / ")}）`, fix: "" };
    })(),
  ];
  const onboarding = await readOnboarding().catch(() => ({ done: false }));
  return {
    app: { name: APP_NAME, sub: APP_SUB, version: APP_VERSION },
    cpu: (cpus[0]?.model ?? "unknown").trim(),
    cores: cpus.length,
    ramTotalGB: +totalGB.toFixed(1),
    ramFreeGB: +freeGB.toFixed(1),
    gpus,
    gpuVramGB,
    hasVulkan: state.gpu === "vulkan",
    backend: state.gpu ?? "未初始化",
    backendNote: backendNote.text,
    vcRuntime: vc,
    disk,
    modelDir: MODEL_DIR,
    modelCount: models.length,
    models: models.map((m) => m.file),
    checks,
    recommend: { ...rec, id: rec.model.id, reason: rec.reason },
    catalog: CATALOG_MODELS,
    firstRunDone: onboarding.done === true,
  };
}

async function applyFirstRunConfig(body = {}) {
  const info = await buildSysinfo();
  const rec = info.recommend;
  if (body && body.dryRun === true) {
    // 探针/演练用：只回建议，不写 config.ini、不加载模型
    const present = rec.model.existing || existsSync(path.join(MODEL_DIR, rec.model.file));
    return { ok: true, dryRun: true, recommended: rec, present, loaded: false, applied: null, needRestart: false, note: "dry-run：只给建议，未写 config.ini、未加载模型" };
  }
  const configPath = path.join(HERE, "..", "config.ini");
  const patch = {
    autoLoad: rec.model.file,
    contextSize: String(rec.contextSize),
    kvReuse: "1",
    kvQuant: rec.kvQuant,
    gpu: "auto",
  };
  let wrote = false;
  let writeNote = "";
  try {
    const r = await updateConfigFile(configPath, patch);
    wrote = r.wrote === true;
    writeNote = r.wrote ? "已写入 config.ini（下次启动生效）" : "开发目录没有 config.ini，跳过写配置";
  } catch (e) {
    writeNote = "写 config.ini 失败：" + String(e?.message ?? e).slice(0, 160);
  }
  try {
    await mkdir(path.dirname(ONBOARD_FILE), { recursive: true });
    await writeFile(ONBOARD_FILE, JSON.stringify({ done: true, appliedAt: Date.now() }, null, 2), "utf8");
  } catch {}
  // 模型已经在本地就立即按推荐上下文加载，省得用户再点一次
  let loaded = false;
  let loadError = "";
  const present = rec.model.existing || existsSync(path.join(MODEL_DIR, rec.model.file));
  if (present && !state.loading && activeChats === 0) {
    try {
      await loadModel(rec.model.file, rec.contextSize);
      loaded = true;
    } catch (e) {
      loadError = String(e?.message ?? e).slice(0, 200);
    }
  }
  return {
    ok: true,
    applied: { ...patch, configPath, wrote },
    recommended: rec,
    present,
    loaded,
    loadError,
    needRestart: true,
    note: writeNote + (present ? (loaded ? "；模型已按建议加载" : "；模型已存在，加载失败：" + loadError) : "；模型还没下载，请先下载 " + rec.model.label),
  };
}

/** 请求体上限：防止超大 POST 撑爆内存 */
const MAX_BODY_BYTES = 4 * 1024 * 1024;

// ---------------------------------------------------------------- 语音合成（TTS）
/**
 * 两套引擎，按顺序尝试：
 *  - piper：离线神经网络 TTS（TTS_DIR\piper\piper.exe + TTS_DIR\voices\*.onnx）
 *           中文实测约 4 倍实时，音质明显好于系统语音
 *  - sapi ：Windows 自带语音（Huihui），piper 缺失或失败时兜底，保证"至少能出声"
 *
 * 目录约定与模型一致：默认 <MODEL_DIR>\tts，可用 TTS_DIR 覆盖。
 */
const TTS_DIR = process.env.TTS_DIR ?? path.join(MODEL_DIR, "tts");
const TTS_PIPER = path.join(TTS_DIR, "piper", "piper.exe");
const TTS_VOICES_DIR = path.join(TTS_DIR, "voices");
const TTS_CACHE_DIR = path.join(TTS_DIR, "cache");
/** 单次朗读的文本上限：超了截断，避免一口气合成十几分钟音频 */
const TTS_MAX_CHARS = 2000;
/** 每段送进 piper 的字数（按句号切，控制单次推理时长） */
const TTS_CHUNK = 260;


/** 在线引擎：Edge 神经语音（免费、无需 key，音质远好于离线模型，但需要联网） */
let MsEdgeTTS = null;
let EDGE_OUTPUT = null;
try {
  const m = await import("msedge-tts");
  MsEdgeTTS = m.MsEdgeTTS;
  EDGE_OUTPUT = m.OUTPUT_FORMAT;
} catch (e) {
  log("未启用 Edge 神经语音（msedge-tts 未安装）:", e.message);
}

const EDGE_VOICES = [
  { id: "zh-CN-XiaoxiaoNeural", label: "晓晓 · 自然女声" },
  { id: "zh-CN-XiaoyiNeural", label: "晓伊 · 活泼女声" },
  { id: "zh-CN-YunxiNeural", label: "云希 · 年轻男声" },
  { id: "zh-CN-YunjianNeural", label: "云健 · 沉稳男声" },
  { id: "zh-CN-YunyangNeural", label: "云扬 · 播报男声" },
];

/** 只列 phoneme_type=espeak 的 piper 音色：pinyin 模式的（chaowen/xiao_ya）会让 2023 版二进制崩 */
async function piperVoices() {
  try {
    const files = (await readdir(TTS_VOICES_DIR)).filter((f) => f.toLowerCase().endsWith(".onnx")).sort();
    const out = [];
    for (const f of files) {
      const id = f.replace(/\.onnx$/i, "");
      let usable = true;
      try {
        const cfg = JSON.parse(await readFile(path.join(TTS_VOICES_DIR, `${f}.json`), "utf8"));
        if (cfg.phoneme_type && cfg.phoneme_type !== "espeak") usable = false;
      } catch {}
      if (!usable) continue;
      out.push({ id, label: `${id.replace(/^zh_CN-/i, "").replace(/-medium$/i, "")}（离线）` });
    }
    return out;
  } catch {
    return [];
  }
}

async function ttsVoices() {
  const out = [];
  if (MsEdgeTTS) {
    for (const v of EDGE_VOICES) out.push({ id: `edge:${v.id}`, label: `${v.label}（在线）`, engine: "edge", online: true });
  }
  for (const v of await piperVoices()) out.push({ id: `piper:${v.id}`, label: v.label, engine: "piper", online: false });
  out.push({ id: "sapi:huihui", label: "Windows 内置 Huihui（离线兜底）", engine: "sapi", online: false });
  return out;
}

async function ttsState() {
  const voices = await ttsVoices();
  const piperOk = await stat(TTS_PIPER).then((s) => s.isFile()).catch(() => false);
  return {
    engine: MsEdgeTTS ? "edge" : piperOk ? "piper" : "sapi",
    edge: Boolean(MsEdgeTTS),
    piper: piperOk,
    voices,
    fallbackVoices: [{ id: "sapi:huihui", label: "Windows 内置（Huihui）", engine: "sapi", online: false }],
  };
}

/** 把 "edge:zh-CN-XiaoxiaoNeural" 拆成 ["edge", "zh-CN-XiaoxiaoNeural"] */
function splitVoice(voice) {
  const s = String(voice ?? "");
  const i = s.indexOf(":");
  return i < 0 ? ["", s] : [s.slice(0, i), s.slice(i + 1)];
}

/** Edge 神经语音合成，返回 MP3 */
async function edgeToMp3(text, voiceId, speed) {
  if (!MsEdgeTTS) throw new Error("Edge 引擎未加载");
  const tts = new MsEdgeTTS();
  try {
    await tts.setMetadata(voiceId, EDGE_OUTPUT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const rate = `${speed >= 1 ? "+" : ""}${Math.round((speed - 1) * 100)}%`;
    const chunks = [];
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Edge 合成超时")), 30000);
      const { audioStream } = tts.toStream(text, { rate });
      audioStream.on("data", (c) => chunks.push(c));
      audioStream.on("end", () => {
        clearTimeout(timer);
        resolve();
      });
      audioStream.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
    });
    const buf = Buffer.concat(chunks);
    if (!buf.length) throw new Error("Edge 返回空音频");
    return buf;
  } finally {
    try {
      tts.close();
    } catch {}
  }
}

/** 按标点切成小段，保证每段不超过 limit 个字 */
function splitForTts(text, limit = TTS_CHUNK) {
  const s = String(text).replace(/```[\s\S]*?```/g, "（代码块略）").replace(/[`*_#>]/g, "").trim();
  const parts = s.split(/(?<=[。！？!?；;\n])/);
  const out = [];
  let buf = "";
  for (const p of parts) {
    if ((buf + p).length > limit && buf) {
      out.push(buf);
      buf = "";
    }
    if (p.length > limit) {
      // 超长无标点：硬切
      for (let i = 0; i < p.length; i += limit) out.push(p.slice(i, i + limit));
    } else {
      buf += p;
    }
  }
  if (buf) out.push(buf);
  return out.length ? out : [s.slice(0, limit)];
}

/** 解析 WAV：取出 fmt 块与 data 块 */
function parseWav(buf) {
  let i = 12;
  let fmt = null;
  while (i + 8 <= buf.length) {
    const id = buf.toString("ascii", i, i + 4);
    const size = buf.readUInt32LE(i + 4);
    if (id === "fmt ") fmt = buf.subarray(i + 8, i + 8 + size);
    if (id === "data") return { fmt, data: buf.subarray(i + 8, i + 8 + size) };
    i += 8 + size + (size % 2);
  }
  return { fmt, data: buf.subarray(44) };
}

/** 把多段同格式音频拼成一个 WAV */
function buildWav(fmt, data) {
  const head = Buffer.alloc(20 + fmt.length + 8);
  head.write("RIFF", 0, "ascii");
  head.writeUInt32LE(head.length - 8 + data.length, 4); // RIFF size = 文件长度 - 8
  head.write("WAVE", 8, "ascii");
  head.write("fmt ", 12, "ascii");
  head.writeUInt32LE(fmt.length, 16);
  fmt.copy(head, 20);
  head.write("data", 20 + fmt.length, "ascii");
  head.writeUInt32LE(data.length, 24 + fmt.length);
  return Buffer.concat([head, data]);
}

/** 调 piper 合成一段文字到一个 wav 文件 */
function piperToWav(text, modelPath, lengthScale, outFile) {
  return new Promise((resolve, reject) => {
    const args = [
      "--model", modelPath,
      "--output_file", outFile,
      "--length_scale", String(lengthScale),
      "--sentence_silence", "0.15",
      "-q",
    ];
    const p = spawn(TTS_PIPER, args, { windowsHide: true });
    let err = "";
    p.stderr.on("data", (d) => {
      err += d.toString();
    });
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(err.trim() || `piper 退出码 ${code}`))));
    // 文字统一以 UTF-8 走 stdin，绕开 Windows 控制台代码页
    p.stdin.end(Buffer.from(text, "utf8"));
  });
}

/** 用 Windows 自带语音合成（兜底） */
function sapiToWav(text, speed, outFile) {
  return new Promise((resolve, reject) => {
    const txt = path.join(TTS_CACHE_DIR, `sapi-${randomUUID()}.txt`);
    const rate = Math.max(-10, Math.min(10, Math.round((speed - 1) * 10)));
    const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
    const ps = [
      "$ErrorActionPreference = 'Stop'",
      "Add-Type -AssemblyName System.Speech",
      "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer",
      `$s.Rate = ${rate}`,
      `$t = [System.IO.File]::ReadAllText(${q(txt)}, [System.Text.Encoding]::UTF8)`,
      // 读不到文本时必须显式失败：否则 Speak 什么都不做，会产出"只有文件头"的空音频
      "if (-not $t) { Write-Error 'TTS 文本为空'; exit 3 }",
      `$s.SetOutputToWaveFile(${q(outFile)})`,
      "$s.Speak($t)",
      "$s.Dispose()",
    ].join("; ");
    writeFile(txt, text, "utf8")
      .then(() => {
        const p = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { windowsHide: true });
        let err = "";
        p.stderr.on("data", (d) => {
          err += d.toString();
        });
        p.on("error", reject);
        p.on("close", async (code) => {
          await unlink(txt).catch(() => {});
          code === 0 ? resolve() : reject(new Error(err.trim() || `sapi 退出码 ${code}`));
        });
      })
      .catch(reject);
  });
}

// 合成串行化：piper 是 CPU 密集型，并发只会互相拖慢
let ttsChain = Promise.resolve();

/**
 * 合成整段文本，返回 WAV 的 Buffer。
 * 命中缓存直接返回；多段按句子切开分别合成再拼接（首段出声更快、单段不超时）。
 */
/**
 * 合成整段文本。返回 { buf, mime, engine }。
 * 引擎链：用户选的引擎优先，失败依次降级（Edge 在线 → Piper 离线 → 系统内置）。
 * 缓存按「实际用的引擎」分开存，降级结果不会污染正常结果。
 */
async function synthesize(text, voice, speed) {
  const src = String(text ?? "").slice(0, TTS_MAX_CHARS).trim();
  if (!src) throw new Error("文本为空");
  const [wantEngine, wantVoice] = splitVoice(voice);
  const pv = await piperVoices();

  const chain = [];
  if (wantEngine === "edge" && MsEdgeTTS) chain.push(["edge", wantVoice]);
  if (wantEngine === "piper") chain.push(["piper", wantVoice]);
  if (wantEngine === "sapi") chain.push(["sapi", "huihui"]);
  if (MsEdgeTTS && !chain.some((c) => c[0] === "edge")) chain.push(["edge", EDGE_VOICES[0].id]);
  if (pv.length && !chain.some((c) => c[0] === "piper")) chain.push(["piper", pv[0].id]);
  if (!chain.some((c) => c[0] === "sapi")) chain.push(["sapi", "huihui"]);

  await mkdir(TTS_CACHE_DIR, { recursive: true });
  let lastErr = null;

  for (const [engine, vid] of chain) {
    const key = createHash("sha1").update(`${engine}|${vid}|${speed}|${src}`).digest("hex");
    const ext = engine === "edge" ? "mp3" : "wav";
    const cached = path.join(TTS_CACHE_DIR, `${key}.${ext}`);
    const mime = engine === "edge" ? "audio/mpeg" : "audio/wav";

    const hit = await readFile(cached).catch(() => null);
    if (hit) return { buf: hit, mime, engine };

    try {
      const run = () => renderAudio(engine, vid, src, speed, key);
      const buf = await ttsChain.then(run, run).finally(() => {});
      await writeFile(cached, buf);
      return { buf, mime, engine };
    } catch (e) {
      lastErr = e;
      log(`TTS ${engine} 失败，降级到下一个引擎:`, e.message);
    }
  }
  throw lastErr ?? new Error("没有可用的 TTS 引擎");
}

/** 真正调用某个引擎产出音频（piper/sapi 按句切片后拼接，edge 一次成篇） */
async function renderAudio(engine, vid, src, speed, key) {
  if (engine === "edge") return edgeToMp3(src, vid, speed);

  const lengthScale = Math.max(0.6, Math.min(1.8, 1 / speed));
  const chunks = splitForTts(src);
  const tmp = [];
  try {
    for (let i = 0; i < chunks.length; i += 1) {
      const out = path.join(TTS_CACHE_DIR, `${key}-${i}.wav`);
      tmp.push(out);
      if (engine === "piper") await piperToWav(chunks[i], path.join(TTS_VOICES_DIR, `${vid}.onnx`), lengthScale, out);
      else await sapiToWav(chunks[i], speed, out);
    }
    const bufs = await Promise.all(tmp.map((f) => readFile(f)));
    const parts = bufs.map(parseWav);
    const fmt = parts[0].fmt ?? bufs[0].subarray(20, 36);
    return buildWav(fmt, Buffer.concat(parts.map((p) => p.data)));
  } finally {
    await Promise.all(tmp.map((f) => unlink(f).catch(() => {})));
  }
}

/** 缓存太大就清理（按修改时间留最近 200MB） */
async function pruneTtsCache() {
  try {
    const files = await readdir(TTS_CACHE_DIR);
    const list = [];
    for (const f of files) {
      const full = path.join(TTS_CACHE_DIR, f);
      const st = await stat(full).catch(() => null);
      if (st && st.isFile() && /\.(wav|mp3)$/i.test(f)) list.push({ full, size: st.size, mtime: st.mtimeMs });
    }
    let total = list.reduce((a, b) => a + b.size, 0);
    if (total < 200 * 1024 * 1024) return;
    list.sort((a, b) => a.mtime - b.mtime);
    for (const item of list) {
      if (total < 150 * 1024 * 1024) break;
      await unlink(item.full).catch(() => {});
      total -= item.size;
    }
  } catch {}
}

/**
 * 本地控制令牌：/api/shutdown 等破坏性接口需要它。
 * 只有同源页面能通过 /api/state 读到（浏览器同源策略会挡住跨站读取），
 * 因此外部网页无法伪造。每次启动重新生成。
 */
const LOCAL_TOKEN = randomUUID();

/** 进行中的对话数：为 0 才允许加载/卸载/退出，避免销毁正在使用的 context */
let activeChats = 0;

// ---------------------------------------------------------------- 投机解码
/**
 * 投机解码配置：草稿模型先猜若干个 token，主模型一次批量验证。
 * 带宽不变、产出翻倍——这正是本机 31% 带宽利用率下最划算的优化。
 */
const DRAFT_MODEL = process.env.DRAFT_MODEL ?? "";          // 指定文件名或子串；留空则自动挑
const DRAFT_TOKENS = Math.max(1, Math.min(32, Number(process.env.DRAFT_TOKENS ?? 8)));

// ---------------------------------------------------------------- KV 缓存复用
/**
 * 是否跨请求复用已评估的 KV 缓存。默认开启；设 KV_REUSE=0 可退回旧行为做对照。
 *
 * 原理：node-llama-cpp 的 evaluate() 会先把新窗口的 token 与序列里已评估的
 * token 逐位比对，只解码「从第一个不同点开始」的后缀
 *（LlamaContextSequence.adaptStateToTokens）。所以复用的唯一前提是
 * **同一个序列对象一直活着**——序列一 dispose，KV 缓存连同比对基准就没了。
 *
 * 旧代码每个请求 getSequence() 再 dispose()，等于每轮都把系统提示 + 全部历史
 * 重新预填充一遍；这就是多轮对话首字要等几秒的原因。
 */
const KV_REUSE = (process.env.KV_REUSE ?? "1") !== "0";

// ---------------------------------------------------------------- KV 缓存量化
/**
 * 默认开：KV 缓存用 q8_0（每个元素 ~1 字节，f16 是 2 字节），同样内存下上下文翻倍。
 *   - 7B 级模型：16K 约 0.9GB → 0.45GB；128K 约 7.3GB → 3.7GB
 *   - 需要 flash attention；后端不支持时会自动回退 f16（只记日志，不影响启动）
 * 关掉：KV_QUANT=f16（精度优先/排障）；设为 other 也可试 q4_0 等（llama.cpp 的 ggml type 名）。
 */
/** ggml 类型表：node-llama-cpp 只认枚举名（Q8_0）或数字（8），**小写字符串 "q8_0" 会被静默忽略**（实测退回 f16） */
const GGML_KV_TYPES = {
  f32: 0, f16: 1, q4_0: 2, q4_1: 3, q5_0: 6, q5_1: 7, q8_0: 8, q8_1: 9,
  q2_k: 10, q3_k: 11, q4_k: 12, q5_k: 13, q6_k: 14, q8_k: 15,
};
const GGML_KV_NAMES = Object.fromEntries(Object.entries(GGML_KV_TYPES).map(([name, num]) => [num, name]));
const kvTypeName = (num) => (typeof num === "number" ? GGML_KV_NAMES[num] || String(num) : null);

const KV_QUANT = String(process.env.KV_QUANT ?? "q8_0").toLowerCase().trim();
const KV_QUANT_NUM = GGML_KV_TYPES[KV_QUANT] ?? null;
const KV_QUANT_ON = KV_QUANT !== "" && KV_QUANT !== "0" && KV_QUANT !== "off" && KV_QUANT !== "f16" && KV_QUANT_NUM != null;

/**
 * 创建主上下文：KV 量化开就先按量化建（传数字，别传小写字符串），失败自动回退 f16。
 * 返回 { context, kvQuant }：kvQuant 用 LlamaContext 的实际类型，不拿「请求值」谎报。
 */
async function createMainContext(model, contextSize) {
  if (!KV_QUANT_ON) {
    const context = await model.createContext({ contextSize });
    return { context, kvQuant: "f16" };
  }
  try {
    const context = await model.createContext({
      contextSize,
      experimentalKvCacheKeyType: KV_QUANT_NUM,
      experimentalKvCacheValueType: KV_QUANT_NUM,
      flashAttention: "auto",
    });
    const actual = kvTypeName(context.kvCacheKeyType) || "f16";
    if (actual !== KV_QUANT) {
      // 库没按请求生效：按实际类型记录（宁可显示 f16，也不谎报 q8_0）
      log(`KV 缓存量化请求 ${KV_QUANT}（${KV_QUANT_NUM}）但实际是 ${actual}，按实际类型记录`);
      return { context, kvQuant: actual, kvQuantFallback: `库未按请求生效（请求 ${KV_QUANT} → 实际 ${actual}）` };
    }
    return { context, kvQuant: actual };
  } catch (e) {
    log(`KV 缓存量化（${KV_QUANT}）不可用，回退 f16：${String(e?.message ?? e).slice(0, 160)}`);
    const context = await model.createContext({ contextSize });
    return { context, kvQuant: "f16", kvQuantFallback: String(e?.message ?? e).slice(0, 160) };
  }
}
/** 实际生效的 KV 缓存类型：直接读 LlamaContext 的 getter，别只信我们请求的值 */
function kvCacheInfo() {
  const c = state.context;
  const k = c?.kvCacheKeyType;
  const v = c?.kvCacheValueType;
  return {
    key: typeof k === "number" ? GGML_KV_NAMES[k] || String(k) : null,
    value: typeof v === "number" ? GGML_KV_NAMES[v] || String(v) : null,
    flashAttention: c?.flashAttention ?? null,
  };
}

/** 粗略判断模型家族，用于避免跨家族草稿模型（tokenizer 不同会直接产出乱码） */
function modelFamily(name) {
  const n = String(name).toLowerCase();
  for (const k of ["qwen3.5", "qwen3", "qwen2.5", "qwen2", "phi-4", "phi-3", "llama-3", "llama", "gemma", "glm"]) {
    if (n.includes(k)) return k;
  }
  return n.replace(/[^a-z0-9.]/g, "").slice(0, 10);
}

/** 取 GGUF 里的词表数组，用来校验草稿模型能否与主模型配合 */
function tokenArrayOf(model) {
  try {
    const toks = model.fileInfo?.metadata?.tokenizer?.ggml?.tokens;
    return Array.isArray(toks) ? toks : null;
  } catch {
    return null;
  }
}
function vocabSizeOf(model) {
  return tokenArrayOf(model)?.length ?? null;
}

/**
 * 判断两个模型的 tokenizer 是否可共用（投机解码的硬要求）。
 *
 * 不能直接比长度是否相等：同族模型的 GGUF 常因「附加特殊 token」写法不同而长度不一，
 * 例如 Qwen2.5 基础词表 151936，7B 的 GGUF 里是 152064（多 128 个附加 token）。
 * 真正该校验的是共享前缀里的 token 字符串是否一致。
 */
function tokenizersCompatible(a, b) {
  const ta = tokenArrayOf(a);
  const tb = tokenArrayOf(b);
  if (!ta || !tb) return { ok: true, reason: "读不到词表，按家族名放行" };
  const diff = Math.abs(ta.length - tb.length);
  if (diff > 256) return { ok: false, reason: `词表长度差 ${diff}，过大` };
  const n = Math.min(ta.length, tb.length);
  const probes = [0, 1, 100, 1000, 5000, 20000, 50000, 100000, n - 1].filter((i) => i >= 0 && i < n);
  for (const i of probes) {
    if (String(ta[i]) !== String(tb[i])) {
      return { ok: false, reason: `词表第 ${i} 项不一致` };
    }
  }
  return { ok: true, reason: `共享前缀 ${n} 项抽样一致（长度 ${ta.length} vs ${tb.length}）` };
}

/**
 * 挑一个能与主模型配套的草稿模型；不匹配就返回 null（宁可不加速，也不出乱码）。
 *
 * 默认**不启用**：本机实测草稿模型是净亏损——
 * 7B 4.36GB + 0.5B 0.47GB 同时驻留共享内存核显，草稿每次预猜都要多读 0.47GB 权重，
 * 而带宽是固定的，等于往同一条窄路上再加车。实测：
 *   基线（无草稿）10.85 tok/s
 *   草稿预猜 8 个 → 5.65 tok/s（0.52x）
 *   草稿预猜 3 个 → 3.34 tok/s（0.31x）
 * 输出内容三题完全一致，即质量无损、只是更慢。故改为 opt-in：设 DRAFT_MODEL 才启用。
 */
function pickDraft(models, targetFile, targetModel) {
  if (!DRAFT_MODEL) return null;
  const others = models.filter((m) => m.file !== targetFile);
  if (!others.length) return null;
  const cand =
    others.find((m) => m.file === DRAFT_MODEL) ??
    others.find((m) => m.label.toLowerCase().includes(DRAFT_MODEL.toLowerCase())) ??
    null;
  if (!cand) return null;
  // 校验 1：家族名
  if (modelFamily(cand.file) !== modelFamily(targetFile)) {
    log(`草稿模型跳过：家族不匹配（${modelFamily(cand.file)} vs ${modelFamily(targetFile)}）`);
    return null;
  }
  return cand;
}

// ---------------------------------------------------------------- 模型状态
let llama = null;
const state = {
  model: null,
  context: null,
  file: null,
  contextSize: 0,
  layers: 0,
  gpu: null,
  loading: false,
  error: null,
  wrapperThink: null,
  wrapperNoThink: null,
  hasJinja: false,
  supportsThinking: false,
  draftModel: null,
  draftContext: null,
  draftFile: null,
  draftDisabledReason: null,
  restarting: false, // 已决定退出重启（避免重复触发）
  // ---- KV 缓存复用用到的常驻对象 ----
  sequence: null, // 常驻上下文序列：KV 缓存就活在这里
  meter: null, // 常驻令牌计量器（跨请求累计，用差值算单次请求）
  kvQuant: null, // 实际生效的 KV 缓存类型（q8_0 / f16）
  kvQuantFallback: "", // 量化不可用时的回退原因（用于调试页解释「为什么没省内存」）
  session: null, // 常驻会话：保留自己的历史与上次评估窗口
  sessionKey: null, // 会话对应的配置指纹（模型/上下文/思考/工具/系统提示）
  sessionSig: null, // 会话已知历史的指纹，与客户端回传一致才可直接续聊
  draftSeq: null, // 草稿模型的序列（投机解码，默认关闭）
  predictor: null, // 草稿预测器（挂在常驻序列上）
};

/** 会话配置指纹：任何一项变化都必须重建会话，否则聊天模板/系统提示会串味 */
function sessionKeyOf({ file, contextSize, thinking, tools, system }) {
  return JSON.stringify([file, contextSize, thinking, tools, system]);
}

/**
 * 历史指纹：只比对语义文本（忽略首尾空白）。
 * 客户端把上一轮回复原样带回来时命中，服务端就可以省掉 setChatHistory 与整段重算。
 */
function historySignature(history) {
  return JSON.stringify(
    history.map((h) =>
      h.type === "user"
        ? ["u", String(h.text ?? "").trim()]
        : ["m", (Array.isArray(h.response) ? h.response : []).filter((x) => typeof x === "string").join("").trim()],
    ),
  );
}

/**
 * 会话的初始历史（系统提示所在的那些条目）。
 *
 * 关键：`setChatHistory()` 是**整体替换**，不是追加。旧代码先给构造函数传 systemPrompt
 * 拿一份 [system]，再 setChatHistory(priorHistory) 顶掉它——于是从第二轮起系统提示
 * 就悄悄消失了。所以替换历史时必须把初始条目拼回去。
 */
function initialHistory(chatWrapper, system) {
  try {
    if (chatWrapper && typeof chatWrapper !== "string") {
      const h = chatWrapper.generateInitialChatHistory({ systemPrompt: system || undefined });
      if (Array.isArray(h)) return h;
    }
  } catch {}
  return system ? [{ type: "system", text: system }] : [];
}

/**
 * 估算「完整提示」的 token 数，用于区分「真正解码了多少」与「复用了多少」。
 *
 * 直接让聊天模板渲染一遍再分词——和库内部构造窗口的方式一致，
 * 因此 prefillTokens 与它的差值就是这次从 KV 缓存里省下的 token。
 * 模板不可用（没有 Jinja）时返回 null，退化为只报实际预填充量。
 */
function estimatePromptTokens(chatWrapper, chatHistory, model) {
  if (!chatWrapper || typeof chatWrapper === "string") return null;
  try {
    const rendered = chatWrapper.generateContextState({ chatHistory }).contextText;
    const n = rendered.tokenize(model.tokenizer).length;
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- 请求串行化
// 一个上下文序列同时只能承载一个对话：两个请求并行会互相踩 KV 缓存。
// 旧代码靠「序列用完就 dispose」自然互斥（第二个请求直接撞 No sequences left），
// 现在序列是常驻的，所以必须显式排队。
let chatChain = Promise.resolve();

/** 取排队号：等到前一个请求收尾。signal 已断则立刻放弃，不占位。 */
function acquireChatSlot(signal) {
  const prev = chatChain;
  let release;
  chatChain = new Promise((resolve) => {
    release = resolve;
  });
  return new Promise((resolve, reject) => {
    const fail = () => {
      signal.removeEventListener("abort", fail);
      // 没占到位置，但链条顺序要维持：等前一个请求收尾再放行后一个，
      // 绝不能在这里直接 release，否则下一个请求会和仍在跑的那个并行。
      prev.then(release, release);
      reject(signal.reason ?? new Error("请求已取消"));
    };
    if (signal.aborted) return fail();
    signal.addEventListener("abort", fail, { once: true });
    const go = () => {
      signal.removeEventListener("abort", fail);
      resolve(release);
    };
    prev.then(go, go);
  });
}

/**
 * 为模型解析两套 chat wrapper：开启 / 关闭思考。
 *
 * 思考型模型（Qwen3 / Qwen3.5 / Qwen3.8 等）默认会把全部 token 花在 thought 段上，
 * node-llama-cpp 又把 thought 段排除在 responseText 之外，结果就是"空回复"。
 * reasoning:false 让模板直接作答——实测既修好了空回复，也快了约 6 倍。
 */
function buildWrappers(model) {
  const make = (reasoning) => {
    try {
      return (
        resolveChatWrapper(model, {
          type: "jinjaTemplate",
          customWrapperSettings: { jinjaTemplate: { reasoning } },
          warningLogs: false,
        }) ?? null
      );
    } catch {
      return null;
    }
  };
  const think = make(true);
  const noThink = make(false);
  return { think, noThink, hasJinja: Boolean(think || noThink) };
}

const isShard = (name) => /-0000\d-of-0000\d\.gguf$/i.test(name);
const isFirstShard = (name) => /-00001-of-0000\d\.gguf$/i.test(name);

async function scanModels() {
  let entries = [];
  try {
    entries = await readdir(MODEL_DIR, { withFileTypes: true });
  } catch (err) {
    log("无法读取模型目录:", err.message);
    return [];
  }
  const out = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    const n = e.name;
    if (!/\.gguf$/i.test(n)) continue;
    if (/mmproj/i.test(n)) continue; // 视觉投影（mmproj）不是可加载的文本模型，别列进模型库
    if (isShard(n) && !isFirstShard(n)) continue; // 分片只列第一片
    const full = path.join(MODEL_DIR, n);
    let sizeGB = 0;
    try {
      sizeGB = +((await stat(full)).size / 1024 ** 3).toFixed(2);
    } catch {}
    out.push({
      file: n,
      path: full,
      sizeGB,
      label: n.replace(/\.gguf$/i, ""),
      sharded: isFirstShard(n),
    });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

// ---------------------------------------------------------------- 模型删除（破坏性）
/**
 * 删除模型文件。设计要点：
 *  - 只允许删 MODEL_DIR 里、名字不带路径的 .gguf（防目录穿越；mmproj 不在模型库里，也删不到）；
 *  - 分片模型（xxx-00001-of-00002.gguf）删任意一片就把整组删掉，否则会留下「缺片」的残骸；
 *  - 正在加载的模型 / 视觉 sidecar 在用的模型 / 正在下载的文件，一律拒绝（让用户先卸载/停视觉/取消下载）；
 *  - 默认走 Windows 回收站（误删能还原），回收站不可用时才永久删除，并在响应里如实告诉前端。
 */
function shardGroupOf(name) {
  const m = /^(.*)-0000\d-of-0000(\d)\.gguf$/i.exec(String(name));
  if (!m) return [String(name)];
  const prefix = m[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp("^" + prefix + "-0000\\d-of-0000" + m[2] + "\\.gguf$", "i");
  return re;
}

/** 路径 → 回收站（Windows）。返回 true 表示全部成功；失败由调用方回退成永久删除。 */
function recycleToRecycleBin(paths) {
  if (process.platform !== "win32" || !paths.length) return false;
  try {
    const script = [
      "$ErrorActionPreference = 'Stop'",
      "Add-Type -AssemblyName Microsoft.VisualBasic",
      "$paths = ConvertFrom-Json $env:LOCALAI_RECYCLE_PATHS",
      "foreach ($p in $paths) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, 'OnlyErrorDialogs', 'SendToRecycleBin') }",
    ].join("; ");
    const r = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
      env: { ...process.env, LOCALAI_RECYCLE_PATHS: JSON.stringify(paths) },
      windowsHide: true,
      encoding: "utf8",
      timeout: 30000,
    });
    if (r.status === 0) return true;
    log("回收站删除失败，将回退永久删除：" + String(r.stderr || r.error || "").slice(0, 200));
  } catch (e) {
    log("回收站删除异常，将回退永久删除：" + String(e?.message ?? e));
  }
  return false;
}

const deleteFail = (status, message) => Object.assign(new Error(message), { status });

async function deleteModelFiles(rawFile, opts = {}) {
  const file = String(rawFile || "").trim();
  if (!file) throw deleteFail(400, "缺少 file 参数（要删除的模型文件名）");
  if (file.includes("/") || file.includes("\\") || file.includes("..")) {
    throw deleteFail(400, "只接受模型目录里的文件名，不能带路径：" + file);
  }
  if (!/\.gguf$/i.test(file)) throw deleteFail(400, "只支持删除 .gguf 模型文件：" + file);

  let names;
  const re = shardGroupOf(file);
  if (re instanceof RegExp) {
    const all = (await readdir(MODEL_DIR).catch(() => [])).filter((n) => re.test(n));
    names = all.length ? all.sort() : [file];
  } else {
    names = re;
  }

  const files = [];
  let totalBytes = 0;
  for (const name of names) {
    if (name.includes("/") || name.includes("\\") || name.includes("..")) throw deleteFail(400, "非法文件名：" + name);
    const full = path.join(MODEL_DIR, name);
    const rel = path.relative(MODEL_DIR, full);
    if (rel.startsWith("..") || path.isAbsolute(rel)) throw deleteFail(400, "路径越界：" + name);
    let st;
    try { st = await stat(full); } catch { throw deleteFail(404, "文件不存在（可能已经被删了）：" + name); }
    if (!st.isFile()) throw deleteFail(400, "不是普通文件，拒绝删除：" + name);
    files.push({ name, path: full, bytes: st.size });
    totalBytes += st.size;
  }

  // 正在用的不能删：文本模型 / 视觉 sidecar / 下载中
  const loaded = String(state.file || "");
  if (loaded && files.some((f) => f.name === loaded)) {
    throw deleteFail(409, "这个模型正在运行（已加载），先点「卸载」或换成别的模型再删");
  }
  if (visionRunning() && vision.model) {
    const visName = path.basename(vision.model);
    if (files.some((f) => f.name === visName)) {
      throw deleteFail(409, "视觉 sidecar 正在用这个模型，先去「设置 → 视觉」停掉看图模型再删");
    }
  }
  if (dl.active && dl.file && files.some((f) => f.name === dl.file)) {
    throw deleteFail(409, "这个文件正在下载中，先取消下载再删");
  }

  const payload = {
    file,
    files: files.map((f) => ({ name: f.name, bytes: f.bytes, mb: Number((f.bytes / 1048576).toFixed(1)) })),
    shardCount: files.length,
    totalBytes,
    totalMB: Number((totalBytes / 1048576).toFixed(1)),
    totalGB: Number((totalBytes / 1024 ** 3).toFixed(2)),
  };
  if (opts.dryRun) return { ok: true, dryRun: true, ...payload };

  let recycled = recycleToRecycleBin(files.map((f) => f.path));
  if (!recycled) {
    for (const f of files) {
      try { await unlink(f.path); } catch (e) { throw deleteFail(500, "删除失败：" + f.name + "（" + String(e?.message ?? e) + "）"); }
    }
  }
  log(`删除模型 ${files.map((f) => f.name).join(", ")}（${(totalBytes / 1024 ** 3).toFixed(2)} GB，${recycled ? "已移入回收站" : "永久删除"}）`);
  return { ok: true, dryRun: false, ...payload, recycled };
}



async function unloadModel() {
  // 常驻会话先放手：它持有序列的引用，顺序错了会碰到已销毁的序列
  if (state.session) {
    try {
      state.session.dispose(); // 不 dispose 序列，序列单独处理
    } catch (e) {
      log("dispose session:", e.message);
    }
    state.session = null;
  }
  state.sessionKey = null;
  state.sessionSig = null;
  // 序列一销毁，KV 缓存与 token 比对基准一起消失——下次请求只能整段重算
  if (state.sequence) {
    try {
      await state.sequence.dispose(); // 连挂在序列上的草稿预测器一起释放
    } catch (e) {
      log("dispose sequence:", e.message);
    }
    state.sequence = null;
  }
  state.meter = null;
  state.predictor = null;
  if (state.draftSeq) {
    try {
      await state.draftSeq.dispose();
    } catch (e) {
      log("dispose draft sequence:", e.message);
    }
    state.draftSeq = null;
  }
  // 草稿模型先释放：投机解码的 predictor 依赖它的 context
  if (state.draftContext) {
    try {
      await state.draftContext.dispose();
    } catch (e) {
      log("dispose draft context:", e.message);
    }
    state.draftContext = null;
  }
  if (state.draftModel) {
    try {
      await state.draftModel.dispose();
    } catch (e) {
      log("dispose draft model:", e.message);
    }
    state.draftModel = null;
  }
  state.draftFile = null;
  state.draftDisabledReason = null;
  if (state.context) {
    try {
      await state.context.dispose();
    } catch (e) {
      log("dispose context:", e.message);
    }
    state.context = null;
  }
  if (state.model) {
    try {
      await state.model.dispose();
    } catch (e) {
      log("dispose model:", e.message);
    }
    state.model = null;
  }
  state.file = state.layers = state.contextSize = 0;
  state.file = null;
  state.kvQuant = null;
  state.kvQuantFallback = "";
  state.wrapperThink = state.wrapperNoThink = null;
  state.hasJinja = false;
  state.supportsThinking = false;
}

async function loadModel(file, contextSize) {
  if (state.loading) throw new Error("已有模型正在加载，请稍候");
  state.loading = true;
  state.error = null;
  const t0 = Date.now();
  try {
    await unloadModel();
    // 同一个文件如果正被预加载常驻，先释放，避免同一份权重在内存里装两遍
    if (extras.has(file)) await disposeExtra(file);
    const full = path.join(MODEL_DIR, file);
    log(`加载 ${file} (context ${contextSize}) ...`);
    state.model = await llama.loadModel({ modelPath: full });
    const mainCtx = await createMainContext(state.model, contextSize);
    state.context = mainCtx.context;
    state.kvQuant = mainCtx.kvQuant;
    state.kvQuantFallback = mainCtx.kvQuantFallback || "";
    const w = buildWrappers(state.model);
    state.wrapperThink = w.think;
    state.wrapperNoThink = w.noThink;
    state.hasJinja = w.hasJinja;
    state.supportsThinking = detectThinkingSupport(state.model);

    // ---- 投机解码：加载配套草稿模型（失败不影响主流程）----
    state.draftModel = null;
    state.draftContext = null;
    state.draftFile = null;
    state.draftDisabledReason = null;
    state.predictor = null;
    state.draftSeq = null;
    try {
      const models = await scanModels();
      const cand = pickDraft(models, file, state.model);
      if (!cand) {
        state.draftDisabledReason = DRAFT_MODEL
          ? `指定的草稿模型不可用：${DRAFT_MODEL}`
          : "默认关闭（未设置 DRAFT_MODEL）：本机实测草稿模型更慢";
      } else {
        log(`加载草稿模型 ${cand.file} ...`);
        const dm = await llama.loadModel({ modelPath: cand.path });
        const compat = tokenizersCompatible(state.model, dm);
        if (!compat.ok) {
          state.draftDisabledReason = `词表不兼容：${compat.reason}`;
          log(`草稿模型跳过：${state.draftDisabledReason}`);
          try {
            await dm.dispose();
          } catch {}
        } else {
          state.draftContext = await dm.createContext({ contextSize });
          state.draftModel = dm;
          state.draftFile = cand.file;
          log(`草稿模型就绪：${cand.file}（${compat.reason}，最多预猜 ${DRAFT_TOKENS} token）`);
        }
      }
    } catch (e) {
      state.draftDisabledReason = `草稿模型加载失败：${e.message}`;
      log("草稿模型加载失败（不影响主流程）:", e.message);
    }

    // ---- 常驻序列：KV 缓存的唯一载体 ----
    // 序列在整个模型生命周期里只创建一次，请求之间绝不 dispose，
    // 下一次请求才比得上「新窗口 vs 已评估 token」的前缀差异，只解码新增部分。
    state.meter = new TokenMeter();
    if (KV_REUSE) {
      if (state.draftContext) {
        try {
          state.draftSeq = state.draftContext.getSequence();
          state.predictor = new DraftSequenceTokenPredictor(state.draftSeq, {
            maxTokens: DRAFT_TOKENS,
            minConfidence: 0.6,
          });
        } catch (e) {
          log("草稿预测器创建失败，退回普通解码:", e.message);
          state.predictor = null;
        }
      }
      try {
        state.sequence = state.context.getSequence({
          _tokenMeter: state.meter,
          ...(state.predictor ? { tokenPredictor: state.predictor } : {}),
        });
      } catch (e) {
        log("带草稿预测器的序列创建失败，退回普通解码:", e.message);
        state.predictor = null;
        state.sequence = state.context.getSequence({ _tokenMeter: state.meter });
      }
    } else {
      // 对照模式：不占用常驻序列，每个请求自己 getSequence/dispose（旧行为）
      log("KV_REUSE=0：每请求独立序列，仅供对照测试；草稿预测器随之停用");
    }

    state.file = file;
    state.contextSize = state.context.contextSize ?? contextSize;
    state.layers = state.model.gpuLayers ?? 0;
    log(
      `就绪: ${file} | context ${state.contextSize} | layers ${state.layers} | KV ${state.kvQuant} | 思考能力${state.supportsThinking ? "支持" : "不支持"} | ${((Date.now() - t0) / 1000).toFixed(1)}s`,
    );
    return { ok: true, seconds: +((Date.now() - t0) / 1000).toFixed(1) };
  } catch (err) {
    state.error = String(err?.message ?? err);
    log("加载失败:", state.error);
    await unloadModel();
    throw err;
  } finally {
    state.loading = false;
  }
}

/**
 * 上下文损坏后的处理：**干净退出进程**，由启动器把它重新拉起来。
 *
 * 为什么不能原地恢复：Vulkan 一旦报 ErrorDeviceLost，整个设备失效，此时
 * 无论 dispose 旧模型还是重建 llama 实例，都会在原生层直接崩溃（实测进程被杀）。
 * 让进程正常退出、由守护它的启动器重启，是唯一稳的路子。
 */
function exitForRestart(reason) {
  if (state.restarting) return;
  state.restarting = true;
  state.error = "推理引擎损坏，服务正在自动重启…";
  // 记一笔崩溃时间，供下次启动判断是否要放弃 Vulkan
  writeFile(path.join(HERE, "vulkan-crash.log"), "\n" + Date.now(), { flag: "a" }).catch(() => {});
  log(`上下文已损坏（${String(reason).slice(0, 60)}），退出进程交由启动器重启`);
  setTimeout(() => process.exit(42), 300);
}
// ---------------------------------------------------------------- HTTP 工具
function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

async function readBody(req) {
  let raw = "";
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY_BYTES) {
      const err = new Error(`请求体超过 ${MAX_BODY_BYTES / 1024 / 1024} MB 上限`);
      err.code = "BODY_TOO_LARGE";
      throw err;
    }
    raw += c;
  }
  return JSON.parse(raw || "{}");
}

// ---------------------------------------------------------------- 视觉（图片入口）实现
/**
 * sidecar 进程状态：一次只跑一个 llama-server.exe（端口 8101）。
 * lock 把 start/stop 串行化：两个请求同时点「启动」不会起出两个进程。
 */
const vision = {
  proc: null,
  pid: null,
  model: "", // 正在运行的视觉模型绝对路径
  mmproj: "", // 正在运行的 mmproj 绝对路径
  startedAt: 0,
  starting: false,
  error: "",
  active: 0, // 正在转发的视觉请求数（>0 时不允许加载文本模型）
  lastText: null, // 视觉启动前被卸载的文本模型 {file, context}：看完图自动装回来
  restoreTimer: null, // 自动装回文本模型的定时器
  contextUsed: 0, // 本次 sidecar 实际启动时用的上下文（0 = 还没起过）
  idleSec: 0, // 本次 sidecar 的闲置退出秒数（0 = 不自动退出）
  idleAt: 0, // 最近一次视觉活动时刻
  idleTimer: null, // 闲置退出定时器
  lock: Promise.resolve(),
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 带 HTTP 状态码的错误：路由层据此回 409/400/500/504 */
function visionFail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/** start/stop 串行：上一个动作（可能等 120s 启动）结束后才开始下一个 */
function runVisionLocked(fn) {
  const run = vision.lock.then(fn, fn);
  vision.lock = run.catch(() => {});
  return run;
}

function visionRunning() {
  return Boolean(vision.proc && vision.proc.exitCode === null && !vision.proc.killed);
}

function resetVisionState() {
  clearVisionIdle();
  vision.proc = null;
  vision.pid = null;
  vision.model = "";
  vision.mmproj = "";
  vision.startedAt = 0;
  vision.starting = false;
  vision.contextUsed = 0;
}

/**
 * 看完图自动装回文本模型：视觉 start 前记下当时的 {file, context}，
 * 最后一帧图结束后等 N 秒（默认 15s，期间再来图就不装），把文本模型装回去。
 * config.ini 的 visionAutoRestore（默认 1）/ visionAutoRestoreSec（默认 15）可改。
 */
async function visionAutoRestoreConfig() {
  let enabled = true;
  let sec = 15;
  try {
    const cfg = await readConfigIni();
    if (cfg.visionAutoRestore !== undefined) enabled = !/^(0|false|off|no)$/i.test(String(cfg.visionAutoRestore).trim());
    const n = Math.floor(Number(cfg.visionAutoRestoreSec));
    if (Number.isFinite(n) && n >= 0) sec = Math.min(600, n);
  } catch {}
  return { enabled, sec };
}

function clearVisionRestore() {
  if (vision.restoreTimer) {
    clearTimeout(vision.restoreTimer);
    vision.restoreTimer = null;
  }
}

/** 每次视觉请求结束后调用：空闲 N 秒把文本模型装回去 */
function scheduleVisionRestore() {
  clearVisionRestore();
  const last = vision.lastText;
  if (!last || !last.file) return;
  if (state.file) { vision.lastText = null; return; }
  (async () => {
    const { enabled, sec } = await visionAutoRestoreConfig();
    if (!enabled) return;
    if (sec <= 0) { await restoreTextNow(last, 0); return; }
    vision.restoreTimer = setTimeout(() => {
      vision.restoreTimer = null;
      restoreTextNow(last, sec).catch(() => {});
    }, sec * 1000);
    if (vision.restoreTimer.unref) vision.restoreTimer.unref();
  })();
}

async function restoreTextNow(last, sec) {
  if (vision.active > 0 || visionRequests.busy || state.loading || state.file) return;
  try {
    if (visionRunning()) {
      log("视觉：自动装回文本模型前先停 sidecar（内存互斥）");
      await stopVision();
    }
    log("视觉：闲置" + (sec ? " " + sec + "s" : "") + "，自动装回文本模型 " + last.file);
    await loadModel(last.file, last.context || 16384);
    log("视觉：文本模型已自动装回 " + last.file);
  } catch (err) {
    log("视觉：自动装回文本模型失败 " + String(err?.message ?? err));
  }
}

/** 取消闲置计时（停止 / 崩溃 / 重新启动时都要取消，否则会对着空进程发 stop） */
function clearVisionIdle() {
  if (vision.idleTimer) {
    clearTimeout(vision.idleTimer);
    vision.idleTimer = null;
  }
  vision.idleAt = 0;
}

/**
 * 重新开始闲置计时：启动成功、每次转发结束都调用。
 * 计时到期时若还有请求在跑（排队 / 转发中）就顺延，不打断正在识图的那一张。
 */
function touchVisionIdle() {
  clearVisionIdle();
  if (!visionRunning() || !vision.idleSec) return;
  vision.idleAt = Date.now();
  vision.idleTimer = setTimeout(() => {
    vision.idleTimer = null;
    if (!visionRunning()) return;
    if (vision.active > 0 || visionRequests.busy) {
      touchVisionIdle();
      return;
    }
    log("视觉：闲置 " + vision.idleSec + "s，自动停止 sidecar 释放内存（下一张图会自动再拉起）");
    stopVision().catch((e) => log("视觉：闲置自动停止失败 " + String(e?.message ?? e)));
  }, vision.idleSec * 1000);
  if (vision.idleTimer.unref) vision.idleTimer.unref();
}

/** 杀进程树：llama-server 可能拉子进程；Windows 用 taskkill /T /F */
function killPidTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, encoding: "utf8", timeout: 5000 });
    } else {
      process.kill(pid, "SIGKILL");
    }
  } catch (err) {
    log("视觉：杀 sidecar 失败:", err?.message ?? err);
  }
}

/** 绝对路径 → 模型目录内的相对名（pairs 用相对名，方便写进 config.ini / localStorage） */
function relativeToModelDir(abs) {
  const root = path.resolve(MODEL_DIR);
  const rel = path.relative(root, path.resolve(abs));
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? rel : path.resolve(abs);
}

/** 量化/精度后缀：Q4_K_M、Q8_0、IQ4_XS、BF16、MXFP4……剥离后得到「模型家族名」 */
const VISION_QUANT_SUFFIX = /[-_.](?:iq[0-9]+[a-z0-9_]*(?:_[a-z0-9]+)*|q[0-9]+[a-z0-9_]*(?:_[a-z0-9]+)*|bf16|f16|f32|fp16|mxfp4)$/i;

/**
 * 模型家族名：Qwen3.5-9B-Q4_K_M → Qwen3.5-9B；Qwen3.5-9B-mmproj-F16 → Qwen3.5-9B。
 * mmproj 与模型的配对就靠它：名字族一致才可能是同一个视觉模型。
 */
function visionFamily(name) {
  let s = String(name).replace(/\.gguf$/i, "");
  s = s.replace(/[-_.]?mmproj.*$/i, "");
  for (let i = 0; i < 4; i++) {
    const next = s.replace(VISION_QUANT_SUFFIX, "");
    if (next === s) break;
    s = next;
  }
  return s.trim();
}

/** 给界面看的参数量提示：Qwen3.5-9B-... → 9B */
function visionExpect(name) {
  const m = String(name).match(/([0-9]+(?:\.[0-9]+)?B)/i);
  return m ? m[1] : "";
}

/**
 * 扫描「模型 + mmproj」组合。
 * 模型 = MODEL_DIR 顶层 *.gguf（跳过名字含 mmproj 的、分片只留第一片）；
 * mmproj = MODEL_DIR/mmproj/*.gguf 以及顶层名字含 mmproj 的 *.gguf。
 * 配对优先级：config.ini 的 visionModel/visionMmproj → 文件名族匹配 → 只给候选 + note。
 */
async function scanVisionPairs() {
  const models = [];
  const mmprojs = [];
  let entries = [];
  try {
    entries = await readdir(MODEL_DIR, { withFileTypes: true });
  } catch (err) {
    log("视觉：无法读取模型目录:", err?.message ?? err);
  }
  for (const e of entries) {
    if (!e.isFile() || !/\.gguf$/i.test(e.name)) continue;
    if (/mmproj/i.test(e.name)) {
      mmprojs.push({ name: e.name, rel: e.name }); // 顶层放 mmproj 也认（契约允许）
      continue;
    }
    if (isShard(e.name) && !isFirstShard(e.name)) continue;
    models.push({ name: e.name, rel: e.name });
  }
  try {
    const sub = await readdir(path.join(MODEL_DIR, "mmproj"), { withFileTypes: true });
    for (const e of sub) {
      if (e.isFile() && /\.gguf$/i.test(e.name)) mmprojs.push({ name: e.name, rel: path.join("mmproj", e.name) });
    }
  } catch {
    // 没有 mmproj 子目录是常态（只有纯文本模型时）
  }
  models.sort((a, b) => a.name.localeCompare(b.name));
  mmprojs.sort((a, b) => a.name.localeCompare(b.name));

  // 1) config.ini 指定的组合优先
  const cfg = await readConfigIni();
  const cfgModel = String(cfg.visionModel ?? "").trim();
  const cfgMmproj = String(cfg.visionMmproj ?? "").trim();
  let configPair = null;
  if (cfgModel && cfgMmproj) {
    const mAbs = path.isAbsolute(cfgModel) ? path.resolve(cfgModel) : path.resolve(MODEL_DIR, cfgModel);
    const pAbs = path.isAbsolute(cfgMmproj) ? path.resolve(cfgMmproj) : path.resolve(MODEL_DIR, cfgMmproj);
    if (existsSync(mAbs) && existsSync(pAbs)) {
      configPair = { model: relativeToModelDir(mAbs), mmproj: relativeToModelDir(pAbs) };
    }
  }

  const pairs = [];
  const seen = new Set();
  const addPair = (model, mmproj, expect) => {
    const key = model + "|" + mmproj;
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push({ model, mmproj, expect });
  };
  if (configPair) addPair(configPair.model, configPair.mmproj, visionExpect(configPair.model));

  // 2) 文件名族匹配：mmproj 名字里含模型名主体才算一对（如 Qwen3.5-9B-mmproj-F16 ↔ Qwen3.5-9B-Q4_K_M）
  let matched = 0;
  for (const m of models) {
    const fam = visionFamily(m.name).toLowerCase();
    if (!fam) continue;
    let hit = mmprojs.find((p) => visionFamily(p.name).toLowerCase() === fam);
    if (!hit && fam.length >= 6) {
      hit = mmprojs.find((p) => {
        const pf = visionFamily(p.name).toLowerCase();
        return pf.length >= 6 && (pf.includes(fam) || fam.includes(pf));
      });
    }
    if (hit) {
      addPair(m.rel, hit.rel, visionExpect(m.name));
      matched++;
    }
  }

  let selected = configPair;
  let note = "";
  if (!selected && pairs.length) {
    selected = { model: pairs[0].model, mmproj: pairs[0].mmproj };
    note = "按文件名族自动配对：" + selected.model + " + " + selected.mmproj;
  } else if (selected) {
    note = "当前组合来自 config.ini（visionModel / visionMmproj）";
  }
  if (!selected) {
    // 3) 配不上：只给候选，让用户自己挑（或在 config.ini 定死）
    if (!models.length) {
      note = "模型目录里没有可用模型：请先把 .gguf 放到 " + MODEL_DIR;
    } else if (!mmprojs.length) {
      note = "没有可用的视觉模型：请把 mmproj 文件放到 " + path.join(MODEL_DIR, "mmproj") + " 下（或在 config.ini 指定 visionModel / visionMmproj）";
    } else {
      for (const m of models) {
        for (const p of mmprojs) {
          if (pairs.length >= 20) break;
          addPair(m.rel, p.rel, visionExpect(m.name));
        }
      }
      note = "没有按文件名匹配到「模型 + mmproj」组合：请从候选中选择，或在 config.ini 指定 visionModel / visionMmproj";
    }
  }
  return { pairs, selected, note };
}

/** /health：加载中返回 503，只有 status=ok 才算就绪 */
async function visionHealthOk() {
  try {
    const r = await fetch("http://" + VISION_HOST + ":" + VISION_PORT + "/health", { signal: AbortSignal.timeout(1500) });
    if (!r.ok) return false;
    const j = await r.json().catch(() => null);
    return Boolean(j && j.status === "ok");
  } catch {
    return false;
  }
}

/** 8101 上有没有进程在听（不管是不是我们起的）：启动前用来报告端口占用 */
async function visionPortInUse() {
  try {
    await fetch("http://" + VISION_HOST + ":" + VISION_PORT + "/health", { signal: AbortSignal.timeout(800) });
    return true;
  } catch {
    return false;
  }
}

function visionPublicState(scan, ctx = VISION_CONTEXT_DEFAULT, idleSec = VISION_IDLE_DEFAULT_SEC, autoRestore = { enabled: true, sec: 15 }) {
  const running = visionRunning();
  let note = scan.note || "";
  if (!existsSync(LLAMA_SERVER)) {
    note = (note ? note + "；" : "") + "视觉组件缺失：找不到 " + LLAMA_SERVER;
  }
  return {
    ok: true,
    running,
    port: VISION_PORT,
    pid: running ? vision.pid : null,
    model: running ? vision.model : "",
    mmproj: running ? vision.mmproj : "",
    startedAt: running ? vision.startedAt : 0,
    logPath: VISION_LOG,
    pairs: scan.pairs,
    selected: scan.selected,
    note,
    starting: vision.starting,
    error: vision.error,
    // 视觉模式的可观测参数（设置页直接显示，用户不用翻 config.ini）
    context: running ? (vision.contextUsed || ctx) : ctx,
    idleExitSec: running ? (vision.idleSec || 0) : (idleSec || 0),
    idleAt: running ? vision.idleAt : 0,
    mmprojDevice: VISION_MMPROJ_DEVICE,
    // 看完图自动装回文本模型：设置页/界面据此显示提示（0 = 关闭）
    autoRestoreSec: autoRestore.enabled ? autoRestore.sec : 0,
    lastTextModel: vision.lastText ? vision.lastText.file : "",
  };
}

async function visionState() {
  return visionPublicState(
    await scanVisionPairs(),
    await visionContextSize(),
    await visionIdleSec(),
    await visionAutoRestoreConfig(),
  );
}

/**
 * 解析启动组合：显式 {model, mmproj} 优先（相对模型目录或绝对路径都行），
 * 否则用扫描出的 selected；文件不存在 → 400，没有可用组合 → 409。
 */
function resolveVisionTarget(reqModel, reqMmproj, scan) {
  let modelRel = reqModel;
  let mmRel = reqMmproj;
  if (!modelRel && !mmRel) {
    if (!scan.selected) {
      throw visionFail(409, "没有可用的视觉模型：请把 mmproj 放到模型目录 mmproj" + path.sep + " 下，或在 config.ini 指定 visionModel / visionMmproj");
    }
    modelRel = scan.selected.model;
    mmRel = scan.selected.mmproj;
  } else {
    // 只给了一半就用 selected 的另一半补齐（前端可能只传变化的那个）
    if (!modelRel && scan.selected) modelRel = scan.selected.model;
    if (!mmRel && scan.selected) mmRel = scan.selected.mmproj;
    if (!modelRel) throw visionFail(400, "缺少 model 参数（视觉模型文件名）");
    if (!mmRel) throw visionFail(400, "缺少 mmproj 参数（视觉投影文件名）");
  }
  const toAbs = (rel, label) => {
    const abs = path.isAbsolute(rel) ? path.resolve(rel) : path.resolve(MODEL_DIR, rel);
    if (!/\.gguf$/i.test(abs)) throw visionFail(400, label + "不是 .gguf 文件：" + rel);
    if (!existsSync(abs)) throw visionFail(400, label + "文件不存在：" + abs);
    return abs;
  };
  return { model: toAbs(modelRel, "视觉模型"), mmproj: toAbs(mmRel, "视觉投影（mmproj）") };
}

/**
 * 启动视觉 sidecar：同一组合幂等；换组合先 stop；启动前释放 nlc 文本模型（内存互斥）。
 * 等 /health 就绪（≤120s），超时杀进程回 504。
 */
async function startVision(opts) {
  const reqModel = String((opts && opts.model) || "").trim();
  const reqMmproj = String((opts && opts.mmproj) || "").trim();
  return runVisionLocked(async () => {
    clearVisionRestore(); // 又要用视觉了，取消待执行的「装回文本模型」
    const scan = await scanVisionPairs();
    const want = resolveVisionTarget(reqModel, reqMmproj, scan);

    if (visionRunning()) {
      if (want.model === vision.model && want.mmproj === vision.mmproj) return visionPublicState(scan);
      log("视觉：切换组合，先停止旧 sidecar");
      await stopVisionLocked();
    }

    if (!existsSync(LLAMA_SERVER)) {
      throw visionFail(500, "没有视觉组件：找不到 " + LLAMA_SERVER + "（发布包应带 app/llama/llama-server.exe，开发目录用 tools/llama.cpp）");
    }
    // 内存互斥：文本模型（含预加载常驻）先全部释放，再起 sidecar
    if (activeChats > 0) throw visionFail(409, "有文本对话正在进行，无法启动视觉模型，请等它结束（或点停止）");
    if (state.loading) throw visionFail(409, "文本模型正在加载，请稍后再试");
    if (state.model || state.context) {
      // 记下要装回的模型：最后一帧图结束后 visionAutoRestoreSec 秒自动装回来
      if (state.file) {
        vision.lastText = { file: state.file, context: state.contextSize || 16384 };
        clearVisionRestore();
        const ar = await visionAutoRestoreConfig();
        log("视觉：先卸载文本模型（内存互斥；看完图" + (ar.enabled && ar.sec ? " " + ar.sec + "s 后" : "") + "自动装回 " + state.file + "）");
      } else {
        log("视觉：先卸载文本模型（内存互斥）");
      }
      await unloadModel();
    }
    const freed = await clearExtras();
    if (freed.length) log("视觉：释放预加载模型 " + freed.length + " 个（内存互斥）");
    if (await visionPortInUse()) {
      throw visionFail(500, "端口 " + VISION_PORT + " 已被其他程序占用，请先关闭它");
    }

    await mkdir(VISION_LOG_DIR, { recursive: true }).catch(() => {});
    // 参数要点：
    //  -c      上下文（默认 32K，可配）
    //  -ngl    文本层 offload 数（默认 0 = CPU）
    //  -mmdev  mmproj 图像编码设备（默认 none = CPU；不写就跟着 Vulkan 走，大图会 device lost）
    //  -t      编码线程数（默认核数-2，封顶 20）
    const ctx = await visionContextSize();
    const threads = await visionThreads();
    const args = ["-m", want.model, "--mmproj", want.mmproj, "-c", String(ctx), "-ngl", String(VISION_NGL), "-mmdev", VISION_MMPROJ_DEVICE, "--host", VISION_HOST, "--port", String(VISION_PORT), "--jinja", "--no-webui", "-np", "1"];
    if (threads > 0) args.push("-t", String(threads));
    let out = null;
    try {
      out = createWriteStream(VISION_LOG, { flags: "a" });
      out.on("error", () => {});
      out.write("\n===== " + new Date().toISOString() + " 启动视觉 sidecar =====\n" + LLAMA_SERVER + " " + args.join(" ") + "\n");
    } catch {
      out = null;
    }

    vision.starting = true;
    vision.error = "";
    let child;
    try {
      child = spawn(LLAMA_SERVER, args, { cwd: LLAMA_DIR, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      vision.starting = false;
      if (out) out.end();
      throw visionFail(500, "启动视觉 sidecar 失败：" + String(err?.message ?? err) + "（检查 llama-server.exe 是否完整、是否被杀毒软件拦截）；详见 " + VISION_LOG);
    }
    let exited = null;
    vision.proc = child;
    vision.pid = child.pid || null;
    if (child.stdout) child.stdout.on("data", (buf) => { try { if (out) out.write(buf); } catch {} });
    if (child.stderr) child.stderr.on("data", (buf) => { try { if (out) out.write(buf); } catch {} });
    child.on("error", (err) => {
      exited = exited || { code: null, signal: null, error: err };
      if (vision.proc === child) {
        vision.proc = null;
        vision.pid = null;
        vision.starting = false;
        vision.error = String(err?.message ?? err);
      }
      if (out) {
        try { out.end(); } catch {}
      }
      log("视觉：spawn 失败 " + String(err?.message ?? err));
    });
    child.on("exit", (code, signal) => {
      exited = exited || { code, signal };
      if (out) {
        try { out.end(); } catch {}
      }
      // vision.proc 还指着它 = 不是我们主动 stop 的：那就是崩溃，明确记下来（下次转发会自动重启）
      if (vision.proc === child) {
        resetVisionState();
        log("视觉：sidecar 崩溃（code=" + code + (signal ? " signal=" + signal : "") + "），下次转发会崩溃重启；详见 " + VISION_LOG);
      } else {
        log("视觉 sidecar 退出（code=" + code + (signal ? " signal=" + signal : "") + "）");
      }
    });

    log("视觉：启动 " + path.basename(want.model) + " + " + path.basename(want.mmproj) + "（-ngl " + VISION_NGL + (VISION_NGL ? " GPU" : " CPU") + "，pid " + vision.pid + "），等待 /health ...");
    const t0 = Date.now();
    let ready = false;
    while (Date.now() - t0 < VISION_START_TIMEOUT_MS) {
      if (exited) break;
      if (await visionHealthOk()) {
        ready = true;
        break;
      }
      await sleep(500);
    }
    if (!ready) {
      let status = 504;
      let why = "等待 /health 超时（" + Math.round(VISION_START_TIMEOUT_MS / 1000) + "s）";
      if (exited) {
        status = 500;
        why = exited.error ? String(exited.error.message || exited.error) : "进程已退出（code=" + exited.code + "）";
      }
      const pid = vision.pid;
      killPidTree(pid);
      resetVisionState();
      vision.error = why;
      throw visionFail(status, "视觉 sidecar 启动失败：" + why + "；详见 " + VISION_LOG);
    }
    vision.starting = false;
    vision.model = want.model;
    vision.mmproj = want.mmproj;
    vision.startedAt = Date.now();
    vision.contextUsed = ctx;
    vision.idleSec = await visionIdleSec();
    touchVisionIdle();
    log("视觉 sidecar 就绪（" + path.basename(want.model) + " + " + path.basename(want.mmproj) + "，ctx " + ctx + " / " + (threads > 0 ? threads + " 线程" : "线程自动") + " / mmproj " + VISION_MMPROJ_DEVICE + "，" + ((Date.now() - t0) / 1000).toFixed(1) + "s，pid " + vision.pid + "）");
    return visionPublicState(await scanVisionPairs(), ctx, vision.idleSec);
  });
}

/** 停止视觉 sidecar：杀进程树 + 等端口释放（供 /api/vision/stop 与 /api/load 使用） */
async function stopVision() {
  return runVisionLocked(stopVisionLocked);
}

async function stopVisionLocked() {
  const child = vision.proc;
  const pid = vision.pid || (child && child.pid) || null;
  if (!child && !pid) {
    resetVisionState();
    return { ok: true, running: false };
  }
  clearVisionIdle();
  log("视觉：停止 sidecar（pid " + pid + "）");
  killPidTree(pid);
  try {
    if (child && child.exitCode === null) child.kill();
  } catch {}
  resetVisionState();
  // 等端口真正释放：否则紧接着 start 会撞上「端口占用」
  const t0 = Date.now();
  while (Date.now() - t0 < 10000) {
    if (!(await visionPortInUse())) break;
    await sleep(200);
  }
  return { ok: true, running: false };
}

/** 收集请求里的图片：应用级 images 数组 + messages 里已有的 image_url */
function collectVisionImages(payload) {
  const images = [];
  if (Array.isArray(payload?.images)) {
    for (const im of payload.images) {
      if (typeof im === "string" && im.trim()) images.push(im.trim());
      else if (im && typeof im.url === "string" && im.url.trim()) images.push(im.url.trim());
    }
  }
  const messages = Array.isArray(payload?.messages) ? payload.messages : [];
  let hasContentImage = false;
  for (const m of messages) {
    if (Array.isArray(m?.content) && m.content.some((p) => p && p.type === "image_url")) hasContentImage = true;
  }
  return { images, hasContentImage };
}

/** 视觉转发串行队列：同一时刻只允许一个请求进 sidecar（Vulkan 并发会 device lost） */
const visionRequests = { busy: false, waiters: [] };

/** 排队等一个视觉转发槽位：FIFO，等太久（180s）就失败 */
function acquireVisionSlot() {
  return new Promise((resolve, reject) => {
    const waiter = { resolve, reject, timer: null, settled: false };
    waiter.timer = setTimeout(() => {
      if (waiter.settled) return;
      const i = visionRequests.waiters.indexOf(waiter);
      if (i >= 0) visionRequests.waiters.splice(i, 1);
      waiter.settled = true;
      reject(visionFail(503, "视觉请求排队超时（" + Math.round(VISION_QUEUE_TIMEOUT_MS / 1000) + "s）：上一个视觉请求还没结束，请稍后再试"));
    }, VISION_QUEUE_TIMEOUT_MS);
    visionRequests.waiters.push(waiter);
    dispatchVisionSlot();
  });
}

/** 叫号：空闲时取队首，resolve 一个只生效一次的 release */
function dispatchVisionSlot() {
  if (visionRequests.busy) return;
  const waiter = visionRequests.waiters.shift();
  if (!waiter) return;
  visionRequests.busy = true;
  clearTimeout(waiter.timer);
  if (waiter.settled) {
    // 已经超时/放弃的排队者，直接跳过
    visionRequests.busy = false;
    return dispatchVisionSlot();
  }
  waiter.settled = true;
  let released = false;
  waiter.resolve(() => {
    if (released) return;
    released = true;
    visionRequests.busy = false;
    dispatchVisionSlot();
  });
}

/** 写一块 SSE；客户端断开时别卡在 drain 上 */
function writeVisionChunk(res, chunk) {
  return new Promise((resolve) => {
    if (res.write(chunk)) return resolve();
    const done = () => {
      res.removeListener("drain", done);
      res.removeListener("close", done);
      resolve();
    };
    res.once("drain", done);
    res.once("close", done);
  });
}

/**
 * 转发前确认 sidecar 真的活着（进程存在 + /health ok）；崩了就自动重新拉起。
 * 转发瞬间仍可能再崩，由调用方重试一次兜底。
 */
async function ensureVisionReadyForChat(afterFailure) {
  if (visionRunning() && (await visionHealthOk())) return;
  if (visionRunning()) {
    log("视觉：sidecar 进程在但 /health 异常" + (afterFailure ? "（上次请求失败）" : "") + "，崩溃重启");
    await stopVision();
  } else if (afterFailure) {
    log("视觉：sidecar 崩溃重启（上次请求失败，进程已退出）");
  } else {
    log("视觉：sidecar 未运行（可能已崩溃），启动");
  }
  await startVision({});
}

/**
 * 带图聊天：确保 sidecar 就绪 → 把 images 拼进最后一条 user 的 content（text 在前、图在后）
 * → 补 enable_thinking=false → 转发 8101；stream 原样透传（SSE 逐块写回），非流式直接回 JSON。
 */
async function handleVisionChat(payload, res) {
  const messages = (Array.isArray(payload.messages) ? payload.messages : [])
    .filter((m) => m && typeof m === "object")
    .map((m) => Object.assign({}, m));
  if (!messages.length) return sendJson(res, 400, { error: { message: "缺少 messages" } });
  const { images } = collectVisionImages(payload);

  const userIdx = messages.map((m, i) => (m.role === "user" ? i : -1)).filter((i) => i >= 0).pop();
  if (userIdx === undefined) return sendJson(res, 400, { error: { message: "缺少 user 消息" } });
  const last = messages[userIdx];
  const parts = [];
  const addText = (t) => {
    const s = t == null ? "" : String(t);
    if (s.trim()) parts.push({ type: "text", text: s });
  };
  const addImage = (url) => {
    if (typeof url === "string" && url) parts.push({ type: "image_url", image_url: { url } });
  };
  if (typeof last.content === "string") {
    addText(last.content);
  } else if (Array.isArray(last.content)) {
    const texts = [];
    for (const p of last.content) {
      if (typeof p === "string") texts.push(p);
      else if (p && p.type === "text" && p.text != null) texts.push(String(p.text));
      else if (p && (p.type === "image_url" || p.type === "image")) addImage(typeof p.image_url === "string" ? p.image_url : p.image_url && p.image_url.url);
    }
    if (texts.length) addText(texts.join("\n"));
  }
  for (const url of images) addImage(url);
  last.content = parts;
  const imageCount = parts.filter((p) => p.type === "image_url").length;

  const fwd = Object.assign({}, payload, { messages });
  delete fwd.images;
  delete fwd.web;
  delete fwd.thinking;
  if (fwd.tools === true) delete fwd.tools; // 应用级开关（boolean），llama-server 只认工具数组
  if (!fwd.chat_template_kwargs || typeof fwd.chat_template_kwargs !== "object") fwd.chat_template_kwargs = {};
  // Qwen3.5 不带这个会把 token 全烧在思考上、content 为空（Lead 实测）
  if (fwd.chat_template_kwargs.enable_thinking === undefined) fwd.chat_template_kwargs.enable_thinking = false;
  if (fwd.max_tokens == null) fwd.max_tokens = 1024;
  const stream = Boolean(fwd.stream);

  const t0 = Date.now();
  // 串行锁：sidecar 的图像编码后端并发跑两个 mtmd 请求会崩（实测 Vulkan device lost / 0xC0000005），
  // 所以同一时刻只放一个请求进 sidecar；后来的排队（上限 180s）。
  vision.active++; // 排队中也算「有视觉请求」：这期间不允许加载文本模型
  const controller = new AbortController();
  let clientGone = false;
  res.on("close", () => {
    if (!res.writableEnded) {
      clientGone = true;
      controller.abort();
    }
  });
  let release = null;
  try {
    const queuedAt = Date.now();
    try {
      release = await acquireVisionSlot();
    } catch (err) {
      if (clientGone) return;
      return sendJson(res, err?.status || 503, { error: { message: String(err?.message ?? err) } });
    }
    const waited = Date.now() - queuedAt;
    if (waited >= 500) log("视觉：排队 " + waited + "ms 后开始转发（同一时刻只允许一个视觉请求）");
    if (clientGone) {
      log("视觉：客户端在排队时断开，放弃本次请求");
      return;
    }

    // 转发失败（多半是 sidecar 崩了）自动重启一次再重试；只允许在响应头/首块发出前重试
    for (let attempt = 1; ; attempt++) {
      try {
        await ensureVisionReadyForChat(attempt > 1);
      } catch (err) {
        if (clientGone) return;
        return sendJson(res, err?.status || 500, { error: { message: String(err?.message ?? err) } });
      }
      if (clientGone) return;

      let upstream = null;
      try {
        upstream = await fetch("http://" + VISION_HOST + ":" + VISION_PORT + "/v1/chat/completions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(fwd),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(VISION_REQUEST_TIMEOUT_MS)]),
        });
      } catch (err) {
        if (clientGone) return;
        if (attempt === 1) {
          log("视觉：转发失败（" + String(err?.message ?? err) + "），sidecar 崩溃重启后重试一次");
          continue;
        }
        log("视觉请求失败：" + String(err?.message ?? err));
        return sendJson(res, 502, { error: { message: "视觉 sidecar 请求失败：" + String(err?.message ?? err) + "（详见 " + VISION_LOG + "）" } });
      }

      if (!upstream.ok) {
        // sidecar 自己的 4xx/5xx（参数错、上下文不足……）：不管 stream 与否都按 JSON 原样回，别硬套 SSE
        let text = "";
        try {
          text = await upstream.text();
        } catch (err) {
          if (clientGone) return;
          if (attempt === 1) {
            log("视觉：读取错误响应失败（" + String(err?.message ?? err) + "），sidecar 崩溃重启后重试一次");
            continue;
          }
          return sendJson(res, 502, { error: { message: "视觉 sidecar 响应读取失败：" + String(err?.message ?? err) + "（详见 " + VISION_LOG + "）" } });
        }
        res.writeHead(upstream.status, {
          "content-type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
          "x-local-vision": "1",
        });
        res.end(text);
        log("视觉请求失败 " + upstream.status + "（" + imageCount + " 张图）" + (Date.now() - t0) + "ms");
        return;
      }

      if (!stream) {
        let text;
        try {
          text = await upstream.text();
        } catch (err) {
          if (clientGone) return;
          if (attempt === 1) {
            log("视觉：非流式响应中断（" + String(err?.message ?? err) + "），sidecar 崩溃重启后重试一次");
            continue;
          }
          log("视觉请求失败：" + String(err?.message ?? err));
          return sendJson(res, 502, { error: { message: "视觉 sidecar 响应中断：" + String(err?.message ?? err) + "（详见 " + VISION_LOG + "）" } });
        }
        res.writeHead(upstream.status, {
          "content-type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
          "x-local-vision": "1",
        });
        res.end(text);
        log("视觉请求 " + imageCount + " 张图 json " + upstream.status + " " + (Date.now() - t0) + "ms");
        return;
      }

      // 流式：先读到第一块再发响应头，这样「开头还没发出去」时崩了仍可重试一次
      const reader = upstream.body.getReader();
      let first;
      try {
        first = await reader.read();
      } catch (err) {
        if (clientGone) return;
        if (attempt === 1) {
          log("视觉：流式响应开头中断（" + String(err?.message ?? err) + "），sidecar 崩溃重启后重试一次");
          continue;
        }
        log("视觉请求失败：" + String(err?.message ?? err));
        return sendJson(res, 502, { error: { message: "视觉 sidecar 流式响应中断：" + String(err?.message ?? err) + "（详见 " + VISION_LOG + "）" } });
      }
      const sseHeaders = {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        "x-accel-buffering": "no",
        "x-local-vision": "1",
      };
      if (first.done) {
        res.writeHead(200, sseHeaders);
        res.end();
        log("视觉请求 " + imageCount + " 张图 stream " + upstream.status + " " + (Date.now() - t0) + "ms（空流）");
        return;
      }
      res.writeHead(200, sseHeaders);
      try {
        await writeVisionChunk(res, first.value);
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          await writeVisionChunk(res, value);
        }
      } catch (err) {
        if (!clientGone) log("视觉流中断：" + String(err?.message ?? err));
      }
      try { res.end(); } catch {}
      log("视觉请求 " + imageCount + " 张图 stream " + upstream.status + " " + (Date.now() - t0) + "ms");
      return;
    }
  } catch (err) {
    log("视觉请求异常：" + String(err?.message ?? err));
    if (!res.headersSent && !clientGone) sendJson(res, 500, { error: { message: "视觉请求异常：" + String(err?.message ?? err) } });
    else {
      try { res.end(); } catch {}
    }
  } finally {
    if (release) release();
    vision.active = Math.max(0, vision.active - 1);
    touchVisionIdle(); // 每次请求结束重新计时：还在用就不停
    scheduleVisionRestore(); // 看完图把文本模型装回来（默认 15s 后，期间再来图就顺延）
  }
}

/** 估算一段文本的 token 数，带兜底 */
function tokenCount(model, text) {
  const s = String(text ?? "");
  try {
    return model.tokenize(s).length;
  } catch {
    return Math.ceil(s.length / 2);
  }
}

/**
 * 按 token 预算裁掉最老的历史。
 *
 * 估算上乘了 1.15 安全系数并计入每条的模板开销——低估的代价是把上下文撑爆，
 * 实测会触发 `vk::Device::getFenceStatus: ErrorDeviceLost` 并直接让进程退出。
 */
function trimHistory(history, model, budgetTokens) {
  if (!history.length) return { kept: history, dropped: 0, remaining: 0 };
  const PER_ITEM_OVERHEAD = 12;
  const costs = history.map((h) => {
    const text = h.type === "user" ? h.text : Array.isArray(h.response) ? h.response.join(" ") : "";
    return Math.ceil(tokenCount(model, text) * 1.15) + PER_ITEM_OVERHEAD;
  });
  let total = costs.reduce((a, b) => a + b, 0);
  let start = 0;
  // 至少保留最后一条
  while (total > budgetTokens && start < history.length - 1) {
    total -= costs[start];
    start += 1;
  }
  return { kept: history.slice(start), dropped: start, remaining: total };
}

function toHistory(messages) {
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => {
      const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");
      return m.role === "user" ? { type: "user", text } : { type: "model", response: [text] };
    });
}

/** 从会话历史里取出思考段文本（node-llama-cpp 不把 thought 段放进 responseText）。 */
function extractThoughts(session) {
  try {
    return session
      .getChatHistory()
      .filter((h) => h.type === "model")
      .flatMap((h) => h.response ?? [])
      .filter((s) => s && typeof s === "object" && s.segmentType === "thought")
      .map((s) => s.text)
      .join("\n")
      .trim();
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------- 思考段拆分
/**
 * 把 ` thinking…<｜end▁of▁thinking｜>` 从正文里拆出来（流式安全）。
 *
 * 有些推理模型（DeepSeek-R1 蒸馏、gpt-oss）的聊天模板并不声明思考机制，
 * 于是这些标签会作为普通文本出现在回复里。这里按「先猜测、后确认」的方式做增量切分：
 * 每次只把可能是标签前缀的尾巴留住，其余立刻发出去，所以流式不会卡顿。
 */
const THINK_OPEN_TAG = String.fromCharCode(60) + "think" + String.fromCharCode(62); // 开标签，逐字符拼出来，避免源码里出现会被改写的字面量
const THINK_CLOSE_TAGS = [String.fromCharCode(60) + "/think" + String.fromCharCode(62), "<｜end▁of▁thinking｜>", "<|end▁of▁thinking|>"];

/** buf 末尾是最长「标签前缀」的长度（用于避免把半个标签当正文发出去） */
function partialSuffixLen(buf, tag) {
  const max = Math.min(buf.length, tag.length - 1);
  for (let n = max; n > 0; n -= 1) {
    if (buf.endsWith(tag.slice(0, n))) return n;
  }
  return 0;
}

/**
 * 创建一个流式拆分器：onThought 收思考段，onText 收正文。
 * 返回 { feed(chunk), finish() }，finish 时把残留按当前状态吐出去。
 */
function createThoughtSplitter(onThought, onText) {
  let mode = "text";
  let buf = "";

  const emitOut = (text) => {
    if (!text) return;
    if (mode === "think") onThought(text);
    else onText(text);
  };

  return {
    feed(chunk) {
      buf += chunk;
      for (;;) {
        if (mode === "text") {
          const i = buf.indexOf(THINK_OPEN_TAG);
          if (i >= 0) {
            if (i > 0) onText(buf.slice(0, i));
            buf = buf.slice(i + THINK_OPEN_TAG.length);
            mode = "think";
            continue;
          }
          const holdN = partialSuffixLen(buf, THINK_OPEN_TAG);
          const emit = buf.slice(0, buf.length - holdN);
          if (emit) onText(emit);
          buf = buf.slice(buf.length - holdN);
          return;
        }
        // 思考段：找最近的闭合标签
        let hit = -1;
        let hitLen = 0;
        for (const tag of THINK_CLOSE_TAGS) {
          const idx = buf.indexOf(tag);
          if (idx >= 0 && (hit < 0 || idx < hit)) {
            hit = idx;
            hitLen = tag.length;
          }
        }
        if (hit >= 0) {
          onThought(buf.slice(0, hit));
          buf = buf.slice(hit + hitLen);
          mode = "text";
          continue;
        }
        let holdN = 0;
        for (const tag of THINK_CLOSE_TAGS) holdN = Math.max(holdN, partialSuffixLen(buf, tag));
        const emit = buf.slice(0, buf.length - holdN);
        if (emit) onThought(emit);
        buf = buf.slice(buf.length - holdN);
        return;
      }
    },
    finish() {
      if (!buf) return;
      emitOut(buf);
      buf = "";
    },
  };
}

/** 一次性拆分（非流式用）：返回 { content, thought } */
function splitThinking(text) {
  let content = "";
  let thought = "";
  const sp = createThoughtSplitter(
    (t) => {
      thought += t;
    },
    (t) => {
      content += t;
    },
  );
  sp.feed(String(text ?? ""));
  sp.finish();
  return { content, thought: thought.trim() };
}

const EMPTY_HINT = "（模型没有产出任何内容——可以试试调大 max_tokens，或关闭深度思考）";

/**
 * 判断该模型是否**真的**支持思考。
 *
 * 只看聊天模板里有没有思考机制，而不是看有没有 Jinja 模板——
 * Qwen2.5、Phi-4-mini 都有 Jinja 模板，但模板里连 think 字样都没有。
 * Qwen3 系列用 `enable_thinking` 变量 + `<think>` 标签。
 */
function detectThinkingSupport(model) {
  try {
    const tpl = model.fileInfo?.metadata?.tokenizer?.chat_template;
    const s = typeof tpl === "string" ? tpl : Array.isArray(tpl) ? tpl.join("\n") : "";
    return /enable_thinking|<think>/i.test(s);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- 内置工具（演示 Agent）
const WORKSPACE = path.join(MODEL_DIR, "workspace");

// ---------------------------------------------------------------- 工作区（文件管理）
/**
 * 页面里的「文件」面板和模型工具共用这套读写。
 * 所有路径都限制在 <MODEL_DIR>\workspace 内，越界一律拒绝。
 */
const WS_MAX_READ = 512 * 1024;
const WS_MAX_WRITE = 512 * 1024;
const WS_MAX_UPLOAD = 10 * 1024 * 1024;

function wsResolve(rel) {
  const clean = String(rel ?? "").replace(/\\/g, "/").replace(/^\/+/, "");
  const root = path.resolve(WORKSPACE);
  const full = path.resolve(root, clean);
  if (full !== root && !full.startsWith(root + path.sep)) throw new Error("路径越界");
  return full;
}

function wsRel(full) {
  return path.relative(WORKSPACE, full).replace(/\\/g, "/");
}

async function wsList(rel) {
  const dir = wsResolve(rel);
  await mkdir(dir, { recursive: true });
  const items = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const it of items) {
    if (it.name === "sessions") continue; // 会话存档不对用户展示
    const full = path.join(dir, it.name);
    let size = 0;
    let mtime = 0;
    try {
      const st = await stat(full);
      size = st.size;
      mtime = st.mtimeMs;
    } catch {}
    out.push({ name: it.name, path: wsRel(full), dir: it.isDirectory(), size, mtime });
  }
  out.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
  const parent = path.dirname(dir) === dir ? null : (wsRel(path.dirname(dir)) || "");
  return { dir: wsRel(dir), parent, entries: out };
}

async function wsRead(rel) {
  const full = wsResolve(rel);
  const st = await stat(full);
  if (!st.isFile()) throw new Error("不是文件");
  if (st.size > WS_MAX_READ) throw new Error("文件超过 " + Math.round(WS_MAX_READ / 1024) + "KB，拒绝打开");
  const buf = await readFile(full);
  if (buf.includes(0)) throw new Error("这是二进制文件，不支持在面板里编辑");
  return { path: wsRel(full), size: st.size, content: buf.toString("utf8") };
}

async function wsSave(rel, content) {
  const full = wsResolve(rel);
  if (!wsRel(full)) throw new Error("不能写工作区根目录");
  const text = String(content ?? "");
  if (Buffer.byteLength(text) > WS_MAX_WRITE) throw new Error("内容超过 " + Math.round(WS_MAX_WRITE / 1024) + "KB");
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, text, "utf8");
  const st = await stat(full);
  return { path: wsRel(full), size: st.size };
}

// ---------------------------------------------------------------- 代码工作区（Agent 模式代码收录 / 模型审查）
/**
 * Agent 模式下助手回复里的围栏代码块由前端提取后 POST 到 /api/code/capture，
 * 统一落到工作区 code/ 子目录；这里只做清洗、限量与落盘，路径复用上面的 ws* 函数。
 */
const CODE_CAPTURE_MAX_FILES = 20;
const CODE_FILE_MAX_CHARS = 200000;
const CODE_TOTAL_MAX_CHARS = 400000;
const CODE_REVIEW_MAX_CHARS = 20000;
/** 审查用小上下文的档位：首选 8192，模型训练上下文小就逐档回退（4096 → 2048） */
const CODE_REVIEW_CONTEXT_SIZES = [8192, 4096, 2048];
/** 代码审查的 system prompt（契约第三节 3.2 逐字）：四节固定标题，先结论后问题 */
const CODE_REVIEW_SYSTEM =
  "你是严格的代码审查员。结合用户给出的意图，判断这段代码的实现是否合理：先给结论，再列主要问题（按严重度排序，指出具体位置或片段），再给可执行的改进建议，最后说明风险与边界。用中文、Markdown，四节标题固定为：## 结论 / ## 主要问题 / ## 改进建议 / ## 风险与边界。不要复述整段代码，不要客套。";

/**
 * 把前端/模型给的文件名洗成安全的 basename：
 * 剥掉路径（/ 与 \）、折叠 ..、只留 [A-Za-z0-9._-] 与中文；
 * 空名 → snippet，无扩展名 → 补 .txt。
 */
function codeSafeName(raw) {
  let name = String(raw ?? "").split(/[\\/]/).pop() ?? "";
  name = name.replace(/[^\w.\-\u4e00-\u9fa5]/g, "");
  name = name.replace(/\.{2,}/g, ".");
  name = name.replace(/^\.+/, "").replace(/\.+$/, "");
  if (!name) return "snippet.txt";
  // 超长文件名在 Windows 上会直接 ENAMETOOLONG，扩展名之前最多留 60 个字符
  const ext = path.extname(name).slice(0, 12);
  if (!ext) return name.slice(0, 60) + ".txt";
  const stem = name.slice(0, -ext.length).slice(0, 60) || "snippet";
  return stem + ext;
}

/**
 * 以「不覆盖」的方式写文件：同名时依次退到 name-2.ext、name-3.ext…
 * 用 open(…, "wx") 判断是否已存在，避免先 exists 再写之间的竞态。
 */
async function codeWriteUnique(dirRel, baseName, content) {
  const ext = path.extname(baseName);
  const stem = baseName.slice(0, baseName.length - ext.length) || "snippet";
  for (let n = 1; n <= 999; n++) {
    const name = n === 1 ? baseName : stem + "-" + n + ext;
    const full = wsResolve(dirRel + "/" + name);
    let fh = null;
    try {
      fh = await open(full, "wx");
    } catch (e) {
      if (e?.code === "EEXIST") continue;
      throw e;
    }
    try {
      await fh.writeFile(content, "utf8");
    } finally {
      await fh.close().catch(() => {});
    }
    const st = await stat(full);
    return { name, path: wsRel(full), bytes: st.size };
  }
  throw new Error("同名文件过多");
}

/** POST /api/code/capture：收录 1–20 段代码到 code/，返回落盘清单 */
async function handleCodeCapture(req, res) {
  let body;
  try {
    body = await readBody(req);
  } catch (e) {
    const status = e?.code === "BODY_TOO_LARGE" ? 413 : 400;
    return sendJson(res, status, { error: { message: e?.message ?? "JSON 解析失败" } });
  }
  const files = Array.isArray(body?.files) ? body.files : [];
  if (!files.length) return sendJson(res, 400, { error: { message: "缺少 files" } });
  if (files.length > CODE_CAPTURE_MAX_FILES) {
    return sendJson(res, 400, { error: { message: "一次最多收录 " + CODE_CAPTURE_MAX_FILES + " 个文件" } });
  }
  let total = 0;
  const prepared = [];
  for (const f of files) {
    const content = typeof f?.content === "string" ? f.content : "";
    if (!content) return sendJson(res, 400, { error: { message: "文件的 content 必须是非空字符串" } });
    if (content.length > CODE_FILE_MAX_CHARS) {
      return sendJson(res, 413, { error: { message: "单个文件超过 " + CODE_FILE_MAX_CHARS + " 字符" } });
    }
    total += content.length;
    prepared.push({ name: codeSafeName(f?.name), content });
  }
  if (total > CODE_TOTAL_MAX_CHARS) {
    return sendJson(res, 413, { error: { message: "合计超过 " + CODE_TOTAL_MAX_CHARS + " 字符" } });
  }
  try {
    await mkdir(wsResolve("code"), { recursive: true });
    const saved = [];
    for (const p of prepared) saved.push(await codeWriteUnique("code", p.name, p.content));
    log("代码收录 " + saved.length + " 个 → code/：" + saved.map((s) => s.name).join("、"));
    return sendJson(res, 200, { ok: true, dir: "code", saved });
  } catch (err) {
    return sendJson(res, 500, { error: { message: String(err?.message ?? err) } });
  }
}

/**
 * POST /api/code/review：结合用户意图审查一段代码。
 * 照 generateTitleWithModel() 的写法单开一个 8192 的小 context，
 * 不往主会话的 sequence 里塞 token，因此不会破坏下一轮复用的 KV 缓存；用完即 dispose。
 */
async function handleCodeReview(req, res) {
  let body;
  try {
    body = await readBody(req);
  } catch (e) {
    const status = e?.code === "BODY_TOO_LARGE" ? 413 : 400;
    return sendJson(res, status, { error: { message: e?.message ?? "JSON 解析失败" } });
  }
  const code = typeof body?.code === "string" ? body.code : "";
  if (!code.trim()) return sendJson(res, 400, { error: { message: "缺少 code" } });
  if (code.length > CODE_REVIEW_MAX_CHARS) {
    return sendJson(res, 413, { error: { message: "代码太长（上限 " + CODE_REVIEW_MAX_CHARS + " 字符）" } });
  }
  if (!state.model) return sendJson(res, 409, { error: { message: "先加载一个模型" } });
  if (activeChats > 0) return sendJson(res, 409, { error: { message: "模型正忙，稍后再试" } });

  const file = String(body.file ?? "").trim().slice(0, 120) || "未命名";
  const lang = String(body.lang ?? "").trim().slice(0, 40) || "未知";
  const intent = String(body.intent ?? "").trim().slice(0, 500) || "（未提供，按代码本身判断）";
  const rawMax = Number(body.max_tokens);
  const maxTokens = Math.max(128, Math.min(1600, Number.isFinite(rawMax) && rawMax > 0 ? Math.round(rawMax) : 900));
  const prompt =
    "【用户意图】" + intent + "\n" +
    "【文件】" + file + "\n" +
    "【语言】" + lang + "\n\n" +
    "```" + (lang === "未知" ? "" : lang) + "\n" + code + "\n```";

  const t0 = Date.now();
  let ctx = null;
  let ctxSize = 0;
  let ctxErr = null;
  try {
    // 档位回退：8192 在 2048/4096 训练上下文的模型上建不起来（createContext 抛错），
    // 依次降档；实际用到的档位写进日志和响应，探针/排错能一眼看出。
    for (const size of CODE_REVIEW_CONTEXT_SIZES) {
      try {
        ctx = await state.model.createContext({ contextSize: size });
        ctxSize = size;
        break;
      } catch (e) {
        ctxErr = e;
        log("代码审查上下文 " + size + " 建不起来，降到下一档：" + String(e?.message ?? e).slice(0, 80));
      }
    }
    if (!ctx) throw ctxErr ?? new Error("无法创建代码审查用的上下文");
    const session = new LlamaChatSession({
      contextSequence: ctx.getSequence(),
      // 必须和主聊天路径用同一个「不思考」模板，否则思考模型会先写满思维链
      chatWrapper: state.wrapperNoThink ?? "auto",
      systemPrompt: CODE_REVIEW_SYSTEM,
    });
    const review = String(await session.prompt(prompt, { maxTokens, temperature: 0.2 })).trim();
    const seconds = +((Date.now() - t0) / 1000).toFixed(1);
    log("代码审查 " + file + " " + (review ? "ok" : "空输出") + " 上下文 " + ctxSize + " " + seconds + "s");
    return sendJson(res, 200, { ok: true, review, seconds, model: state.file, maxTokens, contextSize: ctxSize });
  } catch (e) {
    const seconds = +((Date.now() - t0) / 1000).toFixed(1);
    log("代码审查 " + file + " 失败 " + (ctxSize ? "上下文 " + ctxSize + " " : "") + seconds + "s: " + String(e?.message ?? e));
    return sendJson(res, 500, { error: { message: String(e?.message ?? e) } });
  } finally {
    if (ctx) await ctx.dispose().catch(() => {});
  }
}


// ---------------------------------------------------------------- 文档检索（RAG：workspace 文档 → BM25）
/**
 * 目标：让模型能回答"我的资料里怎么说"，而不是只能读单个文件。
 * 做法刻意保持零依赖、全本地：
 *  - 只索引 workspace 里的文本类文档（md/txt/log/csv/rst），二进制与超大文件跳过；
 *  - 按空行切段落、超长段落再滑窗切开，每段约 560 字；
 *  - 检索用 BM25：英文按词、中文按相邻两字（bigram）——不需要分词词典，也能召回；
 *  - 索引落 workspace\rag\index.json，按 mtime+size 增量更新，删文件会清掉它的片段。
 */
const RAG_DIR = path.join(WORKSPACE, "rag");
const RAG_INDEX = path.join(RAG_DIR, "index.json");
// .docx/.pdf 走 doc-extract.mjs 抽文本；其余按 UTF-8 直读
const RAG_EXTS = new Set([".md", ".markdown", ".txt", ".log", ".rst", ".csv", ".docx", ".pdf"]);
const RAG_SKIP_DIRS = new Set(["sessions", "session-snapshots", "rag"]);
const RAG_MAX_FILES = 800;
const RAG_MAX_FILE_BYTES = 1024 * 1024;
const RAG_MAX_CHUNKS = 8000;
const RAG_CHUNK_CHARS = 560;

const rag = { ready: false, loading: null, chunks: [], files: {}, builtAt: 0, df: new Map(), avgLen: 0, checkedAt: 0 };

/** 中英混排的粗糙分词：英文按词，中文按 bigram */
function ragTerms(text) {
  const s = String(text ?? "").toLowerCase();
  const out = [];
  const latin = s.match(/[a-z0-9_]{2,}/g) || [];
  for (const w of latin) out.push(w);
  const cjk = s.replace(/[^\u4e00-\u9fa5]+/g, " ");
  for (const seg of cjk.split(/\s+/)) {
    if (seg.length < 2) continue;
    for (let i = 0; i + 1 < seg.length; i++) out.push(seg.slice(i, i + 2));
  }
  return out;
}

function ragChunkText(text) {
  const paras = String(text).replace(/\r\n/g, "\n").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const chunks = [];
  let buf = "";
  const flush = () => { if (buf) { chunks.push(buf); buf = ""; } };
  for (const p of paras) {
    if (p.length > RAG_CHUNK_CHARS) {
      flush();
      const step = RAG_CHUNK_CHARS - 60;
      for (let i = 0; i < p.length; i += step) {
        chunks.push(p.slice(i, i + RAG_CHUNK_CHARS));
        if (i + RAG_CHUNK_CHARS >= p.length) break;
      }
      continue;
    }
    if (buf && buf.length + p.length + 2 > RAG_CHUNK_CHARS) flush();
    buf = buf ? buf + "\n\n" + p : p;
  }
  flush();
  return chunks.slice(0, 400);
}

function ragRebuildPostings() {
  const df = new Map();
  const chunks = [];
  for (const c of rag.chunks) {
    const tf = new Map();
    for (const t of ragTerms(c.text)) tf.set(t, (tf.get(t) || 0) + 1);
    for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
    chunks.push({ file: c.file, text: c.text, tf, len: Math.max(1, c.text.length) });
  }
  rag.chunks = chunks;
  rag.df = df;
  rag.avgLen = chunks.length ? chunks.reduce((a, c) => a + c.len, 0) / chunks.length : 0;
}

async function ragWalk() {
  const out = [];
  const walk = async (dir, rel, depth) => {
    if (depth > 4 || out.length >= RAG_MAX_FILES) return;
    let items = [];
    try { items = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const it of items) {
      if (out.length >= RAG_MAX_FILES) return;
      if (it.name.startsWith(".")) continue;
      const full = path.join(dir, it.name);
      const r = rel ? rel + "/" + it.name : it.name;
      if (it.isDirectory()) {
        if (RAG_SKIP_DIRS.has(it.name)) continue;
        await walk(full, r, depth + 1);
        continue;
      }
      if (!it.isFile()) continue;
      if (!RAG_EXTS.has(path.extname(it.name).toLowerCase())) continue;
      let st;
      try { st = await stat(full); } catch { continue; }
      if (st.size > RAG_MAX_FILE_BYTES) continue;
      out.push({ rel: r, full, size: st.size, mtimeMs: Math.round(st.mtimeMs) });
    }
  };
  await walk(WORKSPACE, "", 0);
  return out;
}

async function ragLoadPersisted() {
  if (rag.ready) return;
  try {
    const j = JSON.parse(await readFile(RAG_INDEX, "utf8"));
    if (Array.isArray(j.chunks) && j.files) {
      rag.chunks = j.chunks.map((c) => ({ file: String(c.file || ""), text: String(c.text || "") })).filter((c) => c.file && c.text);
      rag.files = j.files || {};
      rag.builtAt = Number(j.builtAt) || 0;
      ragRebuildPostings();
    }
  } catch {}
  rag.ready = true;
}

async function ragSave() {
  try {
    await mkdir(RAG_DIR, { recursive: true });
    const body = {
      version: 1,
      builtAt: rag.builtAt,
      files: rag.files,
      chunks: rag.chunks.map((c) => ({ file: c.file, text: c.text })),
    };
    const text = JSON.stringify(body);
    await writeFile(RAG_INDEX + ".tmp", text, "utf8");
    await rename(RAG_INDEX + ".tmp", RAG_INDEX).catch(async () => { await writeFile(RAG_INDEX, text, "utf8").catch(() => {}); });
  } catch (e) {
    log("文档索引写盘失败:", e?.message ?? e);
  }
}

/** 增量同步：没变的文件直接复用旧片段，省掉重复切词 */
async function ragSync(force) {
  await ragLoadPersisted();
  const files = await ragWalk();
  const prevFiles = rag.files || {};
  const byFile = new Map();
  if (!force) {
    for (const c of rag.chunks) {
      if (!byFile.has(c.file)) byFile.set(c.file, []);
      byFile.get(c.file).push(c);
    }
  }
  const next = {};
  const chunks = [];
  let changed = Boolean(force);
  for (const f of files) {
    const prev = prevFiles[f.rel];
    const reuse = !force && prev && prev.size === f.size && prev.mtimeMs === f.mtimeMs && byFile.has(f.rel);
    if (reuse) {
      for (const c of byFile.get(f.rel)) chunks.push(c);
      next[f.rel] = prev;
      continue;
    }
    try {
      const ext = path.extname(f.rel).toLowerCase();
      let text;
      if (ext === ".pdf" || ext === ".docx") {
        // 二进制文档：先抽成纯文本；抽不出来就跳过（别把二进制当文本塞进索引）
        text = extractTextBuffer(await readFile(f.full), ext) || "";
        if (!text.trim()) continue;
      } else {
        text = await readFile(f.full, "utf8");
        if (text.includes("\u0000")) continue; // 二进制冒充文本，跳过
      }
      const parts = ragChunkText(text);
      for (const t of parts) chunks.push({ file: f.rel, text: t });
      next[f.rel] = { size: f.size, mtimeMs: f.mtimeMs };
      changed = true;
    } catch {
      changed = true;
    }
  }
  if (Object.keys(prevFiles).length !== Object.keys(next).length) changed = true;
  rag.files = next;
  rag.chunks = chunks.slice(0, RAG_MAX_CHUNKS);
  ragRebuildPostings();
  if (changed) rag.builtAt = Date.now();
  rag.checkedAt = Date.now();
  if (changed) await ragSave();
  return { changed, files: Object.keys(next).length, chunks: rag.chunks.length };
}

function ragEnsure(force = false) {
  if (rag.loading) return rag.loading;
  const fresh = !force && rag.ready && Date.now() - rag.checkedAt < 60000;
  if (fresh) return Promise.resolve({ changed: false, files: Object.keys(rag.files).length, chunks: rag.chunks.length });
  rag.loading = ragSync(force)
    .catch((e) => { log("文档索引失败:", e?.message ?? e); return { changed: false, files: 0, chunks: 0 }; })
    .finally(() => { rag.loading = null; });
  return rag.loading;
}

function ragStatus() {
  return {
    files: Object.keys(rag.files || {}).length,
    chunks: (rag.chunks || []).length,
    builtAt: rag.builtAt || 0,
    dir: RAG_DIR,
    indexBytes: 0,
    exts: [...RAG_EXTS],
  };
}

/** BM25（k1=1.5, b=0.75）；同一个文件最多出 2 段，避免结果被一份文档占满 */
function ragSearch(query, k = 5) {
  const terms = [...new Set(ragTerms(query))];
  if (!terms.length || !rag.chunks.length) return [];
  const N = rag.chunks.length;
  const avg = rag.avgLen || 1;
  const k1 = 1.5;
  const b = 0.75;
  const scored = [];
  for (const c of rag.chunks) {
    let score = 0;
    for (const t of terms) {
      const f = c.tf.get(t) || 0;
      if (!f) continue;
      const df = rag.df.get(t) || 0;
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      score += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * (c.len / avg)));
    }
    if (score > 0) scored.push({ file: c.file, text: c.text, score });
  }
  scored.sort((a, b2) => b2.score - a.score);
  const perFile = new Map();
  const out = [];
  for (const r of scored) {
    const n = perFile.get(r.file) || 0;
    if (n >= 2) continue;
    perFile.set(r.file, n + 1);
    out.push(r);
    if (out.length >= k) break;
  }
  return out;
}

/**
 * 只允许数字、运算符、小数点、括号和空白的表达式求值。
 * 白名单里没有任何字母/下划线/方括号，因此不可能注入代码。
 */
function safeEval(expr) {
  const s = String(expr ?? "").trim();
  if (!s) throw new Error("表达式为空");
  if (s.length > 200) throw new Error("表达式过长");
  if (!/^[0-9+\-*/%.() \t]+$/.test(s)) throw new Error("表达式含非法字符（只允许数字和 + - * / % ** ( )）");
  // eslint-disable-next-line no-new-func
  const v = Function(`"use strict"; return (${s});`)();
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error("结果不是有限数值");
  return v;
}

// ---------------------------------------------------------------- 联网工具（搜索 / 抓取）
/**
 * 两条实测结论决定了这里怎么写：
 *
 * 1) **百度按 UA 拦人，不是按 IP**。同一个 IP 下桌面 Chrome UA 拿到 1438 字节的
 *    「百度安全验证」页，换成移动 Chrome UA 就是 1.85MB 正常结果。所以百度一律走
 *    m.baidu.com + 移动 UA。
 * 2) 百度移动版**没有可直接抓的 href**：标题在 `<h3 class="cosc-title">`，真实地址
 *    藏在页面属性里编码过的 JSON（`dataUrl&quot;:&quot;https://…&quot;`）。实测一页能取到
 *    8 个标题 / 7 个地址，按出现顺序配对，缺地址的条目明确标出来。
 *
 * Bing 反而规整：10 个 `b_algo` 块，title/url/snippet 都好取，作为回落引擎。
 */
const WEB_UA_DESKTOP =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const WEB_UA_MOBILE =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
const WEB_TIMEOUT_MS = Number(process.env.WEB_TIMEOUT_MS ?? 12000);
const WEB_MAX_BYTES = Number(process.env.WEB_MAX_BYTES ?? 2 * 1024 * 1024);
const WEB_TEXT_LIMIT = Number(process.env.WEB_TEXT_LIMIT ?? 6000);
const WEB_RESULT_LIMIT = Number(process.env.WEB_RESULT_LIMIT ?? 8);

/** 从 Content-Type 或页面头部猜字符集；百度偶尔是 gbk */
function decodeBody(buf, contentType) {
  let charset = (String(contentType).match(/charset=([\w-]+)/i) || [])[1] || "";
  if (!charset) {
    const head = buf.subarray(0, 2048).toString("latin1");
    charset = (head.match(/charset=["']?([\w-]+)/i) || [])[1] || "utf-8";
  }
  try {
    return new TextDecoder(charset.toLowerCase()).decode(buf);
  } catch {
    return buf.toString("utf8");
  }
}

/** 私网 / 本机地址一律拒绝，避免模型被诱导去探内网 */
function isPrivateHost(hostRaw) {
  const h = String(hostRaw ?? "").toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!h) return true;
  if (h === "localhost" || h === "::1" || h === "0.0.0.0") return true;
  if (/\.(local|internal|localhost|lan|home)$/.test(h)) return true;
  if (/^127\./.test(h) || /^10\./.test(h) || /^0\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  const m = h.match(/^172\.(\d{1,3})\./);
  if (m) {
    const n = Number(m[1]);
    if (n >= 16 && n <= 31) return true;
  }
  return false;
}

/** 只允许 http/https，且拒绝私网主机 */
function checkUrl(raw) {
  let u;
  try {
    u = new URL(String(raw ?? "").trim());
  } catch {
    throw new Error("网址不合法");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("只支持 http/https");
  if (isPrivateHost(u.hostname)) throw new Error("拒绝访问本机/内网地址");
  return u;
}

/** 手动跟随跳转，每一跳都重新做私网校验（否则 302 就能绕过） */
async function fetchPage(rawUrl, { mobile = false, maxBytes = WEB_MAX_BYTES } = {}) {
  let url = checkUrl(rawUrl).toString();
  const ua = mobile ? WEB_UA_MOBILE : WEB_UA_DESKTOP;
  for (let hop = 0; hop < 4; hop += 1) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), WEB_TIMEOUT_MS);
    let r;
    try {
      r = await fetch(url, {
        headers: {
          "user-agent": ua,
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
        },
        redirect: "manual",
        signal: ctrl.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      const msg = String(err?.message ?? err);
      throw new Error(/abort/i.test(msg) ? "请求超时" : `请求失败：${msg}`);
    }
    clearTimeout(timer);

    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get("location");
      if (!loc) throw new Error(`跳转没有 Location（HTTP ${r.status}）`);
      url = checkUrl(new URL(loc, url).toString()).toString();
      continue;
    }
    const buf = Buffer.from(await r.arrayBuffer());
    const slice = buf.length > maxBytes ? buf.subarray(0, maxBytes) : buf;
    const contentType = r.headers.get("content-type") || "";
    return {
      status: r.status,
      url,
      contentType,
      bytes: buf.length,
      truncated: buf.length > maxBytes,
      text: decodeBody(slice, contentType),
    };
  }
  throw new Error("跳转次数过多");
}

/** 去标签取正文，保留段落换行；脚本样式注释一律丢掉 */
function htmlToText(html) {
  return String(html ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // 数字实体必须解：Bing 的标题里用 &#183; 表示「·」，不解码就会原样显示给用户
    .replace(/&#(\d{1,6});/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]{1,5});/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&[a-z]+;/gi, " ")
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

function stripTags(s) {
  return htmlToText(String(s ?? "").replace(/<!--[\s\S]*?-->/g, "")).replace(/\s+/g, " ").trim();
}

/** 百度：移动 UA + m.baidu.com；标题与 dataUrl 按出现顺序配对 */
async function searchBaidu(query, limit) {
  const url = `https://m.baidu.com/s?word=${encodeURIComponent(query)}`;
  const page = await fetchPage(url, { mobile: true });
  if (page.bytes < 20000 || /百度安全验证|wappass\.baidu\.com\/passport/.test(page.text)) {
    throw new Error("百度返回安全验证页（反爬）");
  }
  const html = page.text;

  // 标题：<h3 class="...cosc-title...">
  const titles = [];
  const h3Re = /<h3[^>]*class="[^"]*cosc-title[^"]*"[^>]*>([\s\S]{0,400}?)<\/h3>/g;
  let m;
  while ((m = h3Re.exec(html)) !== null) {
    const text = stripTags(m[1].replace(/<!--[\s\S]*?-->/g, ""));
    if (text) titles.push({ title: text, index: m.index });
  }
  // 真实地址：属性里编码过的 JSON
  const urls = [];
  const uRe = /dataUrl&quot;:&quot;(https?:\/\/[^&]{6,300}?)&quot;/g;
  while ((m = uRe.exec(html)) !== null) urls.push({ url: m[1], index: m.index });

  const results = [];
  let used = 0;
  for (const t of titles) {
    // 取「在标题之前、且还没被用过」的最后一个地址
    let pick = null;
    for (let i = urls.length - 1; i >= 0; i -= 1) {
      if (urls[i].index < t.index && i >= used) {
        pick = urls[i];
        used = i + 1;
        break;
      }
    }
    results.push({
      title: t.title,
      url: pick ? pick.url : "",
      ...(pick ? {} : { note: "该条没有可直接访问的地址" }),
    });
    if (results.length >= limit) break;
  }
  if (!results.length) throw new Error("百度没有解析出结果（页面结构可能变了）");
  return { engine: "baidu", query, results };
}

/** Bing：结构规整，按 b_algo 块取 h2/a 与摘要 */
async function searchBing(query, limit) {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=zh-CN&count=10`;
  const page = await fetchPage(url);
  const html = page.text;
  const blocks = html.split(/<li class="b_algo"/).slice(1);
  const results = [];
  for (const b of blocks) {
    const a = b.match(/<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!a) continue;
    const link = a[1];
    if (/bing\.com|go\.microsoft\.com|microsofttranslator/.test(link)) continue;
    const title = stripTags(a[2]);
    const cap = b.match(/<p[^>]*class="[^"]*b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>/)
      || b.match(/<div[^>]*class="[^"]*b_caption[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    const snippet = cap ? stripTags(cap[1]).slice(0, 300) : "";
    if (!title) continue;
    results.push({ title, url: link, snippet });
    if (results.length >= limit) break;
  }
  if (!results.length) throw new Error("Bing 没有解析出结果（页面结构可能变了）");
  return { engine: "bing", query, results };
}

/**
 * 搜索入口：中文查询优先百度，被反爬挡下来就自动回落 Bing，并把回落原因写进结果，
 * 让模型和用户都知道「这次结果来自谁、为什么换人」。
 */
async function webSearch(query, enginePref) {
  const q = String(query ?? "").trim().slice(0, 200);
  if (!q) throw new Error("查询词为空");
  const limit = WEB_RESULT_LIMIT;
  const pref = String(enginePref ?? "auto").toLowerCase();
  const chinese = /[\u4e00-\u9fa5]/.test(q);
  const order = pref === "bing"
    ? ["bing"]
    : pref === "baidu"
      ? ["baidu"]
      : chinese
        ? ["baidu", "bing"]
        : ["bing", "baidu"];

  const tried = [];
  for (const engine of order) {
    try {
      const out = engine === "baidu" ? await searchBaidu(q, limit) : await searchBing(q, limit);
      return {
        ...out,
        ...(tried.length ? { fallbackFrom: tried.join("、"), fallbackReason: "前一个引擎被反爬拦截或没解析出结果" } : {}),
      };
    } catch (err) {
      tried.push(`${engine}（${String(err?.message ?? err)}）`);
    }
  }
  throw new Error(`搜索失败：${tried.join("；")}`);
}

/** 抓网页正文 */
async function fetchUrlText(rawUrl) {
  const page = await fetchPage(rawUrl, { mobile: false, maxBytes: WEB_MAX_BYTES });
  if (page.status >= 400) throw new Error(`HTTP ${page.status}`);
  const ct = String(page.contentType).toLowerCase();
  const isText = !ct || /text\/|json|xml|xhtml|javascript/.test(ct);
  const raw = isText ? page.text : "";
  const title = (raw.match(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i) || [])[1];
  const body = /html|xml/.test(ct) || /<html/i.test(raw) ? htmlToText(raw) : raw.trim();
  const text = body.slice(0, WEB_TEXT_LIMIT);
  return {
    url: page.url,
    status: page.status,
    title: title ? stripTags(title) : "",
    contentType: ct || "未知",
    bytes: page.bytes,
    truncated: page.truncated || body.length > WEB_TEXT_LIMIT,
    chars: text.length,
    text,
    ...(isText ? {} : { note: "不是文本类内容，未提取正文" }),
  };
}

/**
 * 工具的纯数据注册表。
 *
 * 为什么不再用 `defineChatSessionFunction`：那套要 node-llama-cpp 从 jinja 模板里
 * **探测**出函数调用语法才算数，探不到就把 functions 静默丢掉
 * （`_requireFunctionCallSettingsExtraction` 默认 false），模型于是自己吐出
 * <tool_call> 文本，而没人解析——这就是工具调用一直失效的根因。
 *
 * 现在改成自己定协议：系统提示里给工具清单与格式，模型输出 <tool_call> 块，
 * 我们自己解析、执行、以 <tool_response> 回填，再让它续答。格式完全可控，
 * 也不依赖任何模板探测结果。
 */
// ---------------------------------------------------------------- 插件
/**
 * 插件 = plugins\ 目录下的一个 .mjs 文件，导出：
 *   export const name = "工具名";              // 必填，字母/下划线开头
 *   export const description = "什么时候用";     // 必填，模型靠它决定调不调
 *   export const params = { type:"object", properties:{...} };  // 可选
 *   export async function run(args, ctx) { return 任意可 JSON 化的结果; }
 *
 * 加载后会和内置工具一起出现在系统提示里，模型能直接调用；
 * 改文件即热重载（fs.watch 防抖 400ms），不用重启服务。
 *
 * 注意：插件在主进程里跑，拥有和本程序一样的权限。只放你自己信得过的插件。
 */
const PLUGIN_DIR = process.env.PLUGIN_DIR ?? path.join(HERE, "..", "plugins");
/** 启用/禁用状态存 workspace\plugins.json：只记被禁用的文件名，新增插件默认启用 */
const PLUGIN_CONFIG = path.join(WORKSPACE, "plugins.json");
const pluginState = { items: [], loadedAt: 0 };
let pluginWatcher = null;
let pluginWatchTimer = null;

async function readPluginConfig() {
  try {
    const j = JSON.parse(await readFile(PLUGIN_CONFIG, "utf8"));
    return { disabled: Array.isArray(j.disabled) ? j.disabled.map(String) : [] };
  } catch {
    return { disabled: [] };
  }
}

async function writePluginConfig(cfg) {
  await mkdir(WORKSPACE, { recursive: true });
  await writeFile(PLUGIN_CONFIG, JSON.stringify({ disabled: cfg.disabled || [] }, null, 2), "utf8");
}

async function loadPlugins() {
  const items = [];
  let files = [];
  try {
    await mkdir(PLUGIN_DIR, { recursive: true });
    files = (await readdir(PLUGIN_DIR)).filter((f) => /\.(mjs|js)$/i.test(f));
  } catch {
    pluginState.items = [];
    pluginState.loadedAt = Date.now();
    return pluginState;
  }
  const cfg = await readPluginConfig();
  for (const file of files.sort()) {
    const full = path.join(PLUGIN_DIR, file);
    if (cfg.disabled.includes(file)) {
      // 禁用的插件不 import、不注册，但要在列表里看得见，用户才能再打开
      items.push({ file, name: file.replace(/\.(mjs|js)$/i, ""), ok: true, disabled: true, description: "已禁用", params: { type: "object", properties: {} } });
      continue;
    }
    try {
      // 带时间戳导入：同一路径重复 import 会命中模块缓存，热重载就失效了
      const mod = await import(pathToFileURL(full).href + "?t=" + Date.now());
      const def = (mod && mod.default && mod.default.name) ? mod.default : mod;
      const rawName = String(def?.name ?? "");
      if (!rawName) throw new Error("没有导出 name");
      if (typeof def.run !== "function") throw new Error("没有导出 run 函数");
      const name = rawName.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 40);
      if (!/^[A-Za-z_]/.test(name)) throw new Error("name 必须以字母或下划线开头");
      items.push({
        file,
        name,
        ok: true,
        description: String(def.description ?? "（未写说明）"),
        params: def.params ?? { type: "object", properties: {} },
        run: (args, ctx) => def.run(args, ctx),
      });
    } catch (e) {
      items.push({ file, name: file, ok: false, error: String(e?.message ?? e) });
      log(`插件加载失败 ${file}: ${e?.message ?? e}`);
    }
  }
  // 重名就加后缀，避免两个插件互相顶掉
  const seen = new Set();
  for (const it of items) {
    if (!it.ok) continue;
    while (seen.has(it.name)) it.name += "_2";
    seen.add(it.name);
  }
  pluginState.items = items;
  pluginState.loadedAt = Date.now();
  const bad = items.filter((x) => !x.ok).length;
  const off = items.filter((x) => x.disabled).length;
  log(`插件：${items.length - bad - off} 个可用${off ? `，${off} 个已禁用` : ""}${bad ? `，${bad} 个失败` : ""}（${PLUGIN_DIR}）`);
  return pluginState;
}

function activePlugins() {
  return pluginState.items.filter((x) => x.ok && !x.disabled);
}

function watchPlugins() {
  try {
    if (pluginWatcher) pluginWatcher.close();
    pluginWatcher = watch(PLUGIN_DIR, { persistent: false }, () => {
      if (pluginWatchTimer) clearTimeout(pluginWatchTimer);
      pluginWatchTimer = setTimeout(() => {
        loadPlugins().catch(() => {});
      }, 400);
    });
  } catch {}
}

/** 给插件用的上下文：目录、日志，够写大部分工具了 */
function pluginContext() {
  return { workspace: WORKSPACE, modelDir: MODEL_DIR, log };
}

function buildToolRegistry(journal, onCall, options = {}) {
  const record = async (name, args, fn) => {
    const t0 = Date.now();
    let result;
    try {
      result = await fn();
    } catch (err) {
      result = { error: String(err?.message ?? err) };
    }
    const entry = { name, args, result, ms: Date.now() - t0 };
    journal.push(entry);
    try {
      onCall?.(entry);
    } catch {}
    return entry;
  };

  const defs = [
    {
      name: "get_current_time",
      description: "获取当前本地日期与时间。凡是问「现在几点」「今天几号」「今天星期几」都必须调用，不要凭记忆回答。",
      params: { type: "object", properties: {} },
      run: () =>
        record("get_current_time", {}, () => {
          const now = new Date();
          return {
            localTime: now.toLocaleString("zh-CN", { hour12: false }),
            iso: now.toISOString(),
            weekday: now.toLocaleDateString("zh-CN", { weekday: "long" }),
          };
        }),
    },
    {
      name: "calculate",
      description: "精确计算一个数学表达式，支持 + - * / % ** 和括号。涉及具体数值计算时必须调用，不要心算。",
      params: {
        type: "object",
        properties: { expression: { type: "string", description: "要计算的数学表达式，例如 (1234*56)+78" } },
        required: ["expression"],
      },
      run: (args) => {
        const expression = String(args?.expression ?? "");
        return record("calculate", { expression }, () => ({ expression, value: safeEval(expression) }));
      },
    },
    {
      name: "list_local_models",
      description: "列出本机已下载的可用模型文件及其大小（GB）。",
      params: { type: "object", properties: {} },
      run: () =>
        record("list_local_models", {}, async () => {
          const ms = await scanModels();
          return { count: ms.length, models: ms.map((m) => ({ file: m.file, sizeGB: m.sizeGB })) };
        }),
    },
    {
      name: "read_workspace_file",
      description: "只读取、不修改：读取 workspace 根目录下一个文本文件的内容（只接受文件名，不要带目录）。要看文件内容就用它，绝不要用 write_workspace_file。",
      params: {
        type: "object",
        properties: {
          name: { type: "string", description: "文件名，例如 note.txt" },
          path: { type: "string", description: "同 name（两种字段名都接受）" },
        },
        required: [],
      },
      run: (args) => {
        const name = String(args?.name ?? args?.path ?? "");
        return record("read_workspace_file", { name }, async () => {
          if (!name || name.includes("/") || name.includes("\\") || name.includes("..")) {
            throw new Error("非法文件名");
          }
          const full = path.join(WORKSPACE, name);
          const st = await stat(full);
          if (!st.isFile()) throw new Error("不是文件");
          if (st.size > 256 * 1024) throw new Error("文件超过 256KB，拒绝读取");
          const text = await readFile(full, "utf8");
          return { name, sizeBytes: st.size, content: text.slice(0, 8000) };
        });
      },
    },
    {
      name: "list_workspace_files",
      description: "列出工作目录 workspace 下的文件与子目录（相对路径），用于查看有哪些资料可读。",
      params: { type: "object", properties: { dir: { type: "string", description: "子目录，留空列根目录" } }, required: [] },
      run: (args) =>
        record("list_workspace_files", { dir: String(args?.dir ?? "") }, async () => {
          const r = await wsList(String(args?.dir ?? ""));
          return { dir: r.dir, entries: r.entries.map((e) => ({ name: e.name, path: e.path, dir: e.dir, size: e.size })) };
        }),
    },
    {
      name: "write_workspace_file",
      description: "新建或覆盖一个文本文件（相对路径，最大 256KB），只在需要把结果保存成文件时用。它会写入/覆盖同名文件；只是要看内容请用 read_workspace_file。content 要精简，不要重复行，单次不超过 200 行。",
      params: {
        type: "object",
        properties: { path: { type: "string", description: "相对路径，例如 notes/todo.md" }, content: { type: "string" } },
        required: ["path", "content"],
      },
      run: (args) =>
        record("write_workspace_file", { path: String(args?.path ?? "") }, async () => {
          const content = String(args?.content ?? "");
          if (Buffer.byteLength(content) > 256 * 1024) throw new Error("内容超过 256KB");
          return await wsSave(String(args?.path ?? ""), content);
        }),
    },
    {
      name: "run_code",
      description: "在本机运行一段代码（javascript/python/c/cpp/java/go/rust），返回 stdout、stderr 与退出码；10 秒超时、输出上限 64KB。适合写完文件后立刻验证。",
      params: {
        type: "object",
        properties: {
          language: { type: "string", description: "语言：javascript / python / c / cpp / java / go / rust" },
          code: { type: "string", description: "完整源码" },
        },
        required: ["language", "code"],
      },
      run: (args) =>
        record("run_code", { language: String(args?.language ?? "") }, async () => {
          const alias = { js: "javascript", node: "javascript", py: "python", "c++": "cpp", cxx: "cpp", golang: "go", rs: "rust" };
          const key = String(args?.language ?? "").toLowerCase().trim();
          const lang = alias[key] || key;
          const supported = new Set(["javascript", "python", "c", "cpp", "java", "go", "rust"]);
          if (!supported.has(lang)) throw new Error("不支持的语言：" + key);
          const r = await runCode(lang, String(args?.code ?? ""));
          return {
            exitCode: r.code,
            stdout: String(r.stdout ?? "").slice(0, 4000),
            stderr: String(r.stderr ?? "").slice(0, 2000),
            timedOut: !!r.timedOut,
            ms: r.ms,
          };
        }),
    },
    {
      name: "search_documents",
      description:
        "检索本机 workspace 里的文档（md / txt / log / csv / Word 的 docx / PDF），按相关度返回片段与出处文件。问「我的资料里怎么说」「文档/笔记里有没有提到」时先调用它；拿到 file 之后可以用 read_workspace_file 读全文。",
      params: {
        type: "object",
        properties: {
          query: { type: "string", description: "要检索的关键词或短句，中文英文都行" },
          k: { type: "number", description: "返回几段，默认 5，最多 8" },
        },
        required: ["query"],
      },
      run: (args) =>
        record("search_documents", { query: String(args?.query ?? "") }, async () => {
          const q = String(args?.query ?? "").trim();
          if (!q) throw new Error("query 不能为空");
          await ragEnsure();
          const k = Math.min(8, Math.max(1, Number(args?.k) || 5));
          const hits = ragSearch(q, k);
          if (!hits.length) {
            return { query: q, hits: [], note: "文档里没有匹配内容；可以换关键词，或如实说没找到" };
          }
          return {
            query: q,
            count: hits.length,
            hits: hits.map((h) => ({ file: h.file, score: Math.round(h.score * 100) / 100, text: h.text.slice(0, 500) })),
          };
        }),
    },
  ];

  // 联网工具默认不注册：关着的时候模型连"有搜索"都不知道，不会去编
  if (options.web) {
    defs.push(
      {
        name: "web_search",
        description:
          "联网搜索网页（中文查询优先百度，被反爬拦截时自动改用 Bing）。适合查时效性信息、新闻、文档入口。返回标题、地址与摘要。",
        params: {
          type: "object",
          properties: {
            query: { type: "string", description: "搜索关键词，尽量具体" },
            engine: { type: "string", description: "可选：baidu / bing / auto，默认 auto" },
          },
          required: ["query"],
        },
        run: (args) => {
          const query = String(args?.query ?? "");
          const engine = String(args?.engine ?? "auto");
          return record("web_search", { query, engine }, () => webSearch(query, engine));
        },
      },
      {
        name: "fetch_url",
        description:
          "读取一个网页的正文（已去标签）。只支持 http/https，拒绝本机与内网地址。适合在搜索之后打开具体页面看细节。",
        params: {
          type: "object",
          properties: { url: { type: "string", description: "完整网址，必须以 http:// 或 https:// 开头" } },
          required: ["url"],
        },
        run: (args) => {
          const url = String(args?.url ?? "");
          return record("fetch_url", { url }, () => fetchUrlText(url));
        },
      },
    );
  }

  // 插件工具：和内置的用同一套 record()，所以界面上的卡片、耗时、journal 表现完全一致
  for (const plugin of activePlugins()) {
    if (defs.some((d) => d.name === plugin.name)) continue;
    defs.push({
      name: plugin.name,
      description: plugin.description,
      params: plugin.params,
      run: (args) => record(plugin.name, args ?? {}, () => plugin.run(args ?? {}, pluginContext())),
    });
  }

  const byName = new Map(defs.map((d) => [d.name, d]));
  return {
    defs,
    /** 拼成塞进系统提示的说明书 */
    describe() {
      return defs
        .map((d) => {
          const props = (d.params && d.params.properties) || {};
          const keys = Object.keys(props);
          const args = keys.length
            ? keys.map((k) => `${k}（${props[k].description || props[k].type || "任意"}）`).join("、")
            : "无";
          return `- ${d.name}：${d.description}\n  参数：${args}`;
        })
        .join("\n");
    },
    run(name, args) {
      const d = byName.get(name);
      if (!d) {
        // 明确列出「现在到底有哪些工具」：模型凭训练记忆瞎猜工具名时，
        // 只有这句能把它拉回来，否则它会顺着猜测继续编结果
        return record(name, args ?? {}, async () => ({
          error: `没有这个工具：${name}`,
          availableTools: defs.map((x) => x.name).join("、"),
          hint: "只能使用 availableTools 里的工具。如果确实需要联网或别能力，请如实告诉用户当前没有这个工具，不要编造结果。",
        }));
      }
      return d.run(args ?? {});
    },
  };
}

/** 一轮对话里最多允许几次「工具往返」，防止模型来回刷 */
const TOOL_ROUND_LIMIT = Math.max(1, Number(process.env.TOOL_ROUNDS ?? 4));

function buildToolInstructions(registry) {
  return [
    "你可以调用本机工具来获取自己无法知道、或需要精确计算的信息。",
    "",
    "可用工具：",
    registry.describe(),
    "",
    "调用规则（必须严格遵守）：",
    "1. 需要工具时，只输出下面这样的调用块，前面不要写任何解释文字：",
    "<tool_call>",
    '{"name": "工具名", "arguments": {"参数名": "参数值"}}',
    "</tool_call>",
    "2. 一次可以输出多个 <tool_call> 块。",
    "3. 我会用 <tool_response> 把结果给你；拿到结果后再用中文正常回答用户，不要复述 JSON、不要编造结果。",
    "4. 不需要工具时直接回答，绝对不要输出 <tool_call>。",
    "5. 时间、日期、星期、具体数值计算、本机文件与模型列表，一律用工具，不要凭记忆。",
    "6. 读文件用 read_workspace_file；write_workspace_file 会写入或覆盖文件，只在用户要求保存结果时才用。",
  ].join("\n");
}

/** 从模型输出里抽出所有 <tool_call> 块；JSON 坏了就退一步截首尾花括号再试 */
function parseToolCalls(text) {
  const src = String(text ?? "");
  const calls = [];
  // 也接受「没有闭合标签」的块：模型在调用块中间被 max_tokens 截断时就是这种
  const re = /<tool_call>([\s\S]*?)(?:<\/tool_call>|$)/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    let obj = null;
    const body = m[1].trim();
    try {
      obj = JSON.parse(body);
    } catch {
      const s = body.indexOf("{");
      const e = body.lastIndexOf("}");
      if (s >= 0 && e > s) {
        try {
          obj = JSON.parse(body.slice(s, e + 1));
        } catch {}
      }
    }
    if (obj && obj.name) {
      const args = obj.arguments ?? obj.params ?? obj.args ?? {};
      calls.push({ name: String(obj.name), args: typeof args === "string" ? safeJson(args) : args });
    }
  }
  return calls;
}

function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

/** 给用户看的正文里不该出现原始调用块 */
function stripToolCalls(text) {
  return String(text ?? "")
    .replace(/<tool_call>[\s\S]*?(?:<\/tool_call>|$)/g, "")
    .replace(/<tool_response>[\s\S]*?<\/tool_response>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------------------------------------------------------------- 聊天
async function handleChat(payload, res) {
  if (!state.context) {
    return sendJson(res, 409, { error: { message: "当前没有已加载的模型，请先在界面上点「加载」" } });
  }
  const toolsEnabled = payload.tools === true;
  // 工具日志与实时推送：界面靠它证明"工具真的跑了"，而不是模型编造执行过
  const toolJournal = [];
  let emitTool = () => {};
  const webEnabled = payload.web === true;
  // 联网工具挂在"调用工具"之下：没有工具循环，光有搜索能力也没人会用
  const toolRegistry = toolsEnabled
    ? buildToolRegistry(toolJournal, (e) => emitTool(e), { web: webEnabled })
    : null;
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  let system =
    messages
      .filter((m) => m.role === "system")
      .map((m) => (typeof m.content === "string" ? m.content : ""))
      .join("\n")
      .trim() || DEFAULT_SYSTEM;
  // 工具说明书拼进系统提示：必须放在 sessionKey / initialHistory 之前，
  // 这样开关工具会让会话指纹变化、重建会话，而不是复用带旧提示的会话。
  if (toolRegistry) system = `${system}\n\n${buildToolInstructions(toolRegistry)}`;
  const history = toHistory(messages);
  const lastUser = history.filter((h) => h.type === "user").pop();
  if (!lastUser) return sendJson(res, 400, { error: { message: "缺少 user 消息" } });
  let priorHistory = history.slice(0, history.length - 1);

  const maxTokens = Number(payload.max_tokens ?? 1024);
  const temperature = Number(payload.temperature ?? 0.7);

  // 上下文预算：为系统提示、末条用户消息、生成长度和模板误差都留出空间。
  // 低估会撑爆上下文——实测会触发 Vulkan ErrorDeviceLost 并让进程退出，所以宁严勿松。
  {
    const ctxSize = state.contextSize || 8192;
    const reserve = 512;
    const fixedCost =
      tokenCount(state.model, system) + tokenCount(state.model, lastUser.text) + reserve;
    const available = ctxSize - maxTokens - fixedCost;
    if (available < 256) {
      return sendJson(res, 413, {
        error: {
          message:
            `上下文空间不足：上下文 ${ctxSize} tok − max_tokens ${maxTokens} − 固定开销约 ` +
            `${fixedCost} tok，历史已无可用空间。请调小 max_tokens 或换更大上下文。`,
        },
      });
    }
    const target = Math.floor(available * 0.9);
    const { kept, dropped, remaining } = trimHistory(priorHistory, state.model, target);
    priorHistory = kept;
    if (dropped > 0) {
      log(`历史超预算（预算 ${target} tok），裁掉最老 ${dropped} 条，保留约 ${remaining} tok`);
    }
  }
  const modelId = state.file?.replace(/\.gguf$/i, "") ?? "local";
  const id = "chatcmpl-" + Math.random().toString(36).slice(2, 12);
  const created = Math.floor(Date.now() / 1000);

  // ---- 序列与常驻会话：KV 缓存能不能复用，全看这两件事 ----
  // 1) 序列必须一直活着——dispose 就等于把 KV 缓存和比对基准一起丢掉；
  // 2) 客户端回传的历史和上一轮会话已知的历史一致时，连 setChatHistory 都不做，
  //    直接在原会话上续问：库只会解码「新用户消息 + 模板尾巴」这几个 token。
  let persistent = false;
  let sequence = null;
  let meter = new TokenMeter();
  if (KV_REUSE && state.sequence) {
    sequence = state.sequence;
    meter = state.meter;
    persistent = true;
  } else {
    try {
      sequence = state.context.getSequence({ _tokenMeter: meter });
    } catch (err) {
      return sendJson(res, 503, { error: { message: `上下文序列暂时用尽，请稍后重试（${err.message}）` } });
    }
  }

  let released = false;
  const release = async () => {
    if (released) return;
    released = true;
    if (!persistent) {
      try {
        await sequence.dispose();
      } catch {}
    }
  };

  // 客户端断开（关窗口/刷新/断网）就中止生成，别让核显白跑满 max_tokens
  const ac = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) {
      log("客户端断开，中止生成");
      ac.abort();
    }
  });

  // 一个序列同时只能承载一个对话：先排队，免得两个请求互相踩 KV 缓存
  let releaseSlot = null;
  try {
    releaseSlot = await acquireChatSlot(ac.signal);
  } catch {
    log("请求在排队时被取消，直接放弃");
    return;
  }

  activeChats += 1;
  let session = null;
  try {
    // thinking=true 走"允许思考"的 wrapper；默认关闭思考（思考模型的空回复问题由它解决）
    const useThinking = payload.thinking === true;
    const chatWrapper = (useThinking ? state.wrapperThink : state.wrapperNoThink) ?? "auto";
    const key = sessionKeyOf({
      file: state.file,
      contextSize: state.contextSize,
      thinking: useThinking,
      tools: toolsEnabled,
      system,
    });
    const clientSig = historySignature(priorHistory);

    let resumed = false;
    if (persistent && state.session && state.sessionKey === key && state.sessionSig === clientSig) {
      session = state.session; // 命中：历史分毫未变，直接续问
      resumed = true;
    } else {
      if (persistent && state.session && state.sessionKey !== key) {
        // 换了模型/上下文/思考开关/系统提示：旧会话的模板上下文已经作废
        try {
          state.session.dispose();
        } catch {}
        state.session = null;
      }
      session = persistent ? state.session : null;
      if (!session) {
        session = new LlamaChatSession({
          contextSequence: sequence,
          chatWrapper,
          systemPrompt: system || undefined,
        });
        if (persistent) {
          state.session = session;
          state.sessionKey = key;
        }
      }
      if (priorHistory.length) {
        try {
          session.setChatHistory([...initialHistory(chatWrapper, system), ...priorHistory]);
        } catch (e) {
          log("setChatHistory 失败，忽略历史:", e.message);
        }
      } else {
        // 新会话：恢复成「只有系统提示」的初始状态
        try {
          session.resetChatHistory();
        } catch (e) {
          log("resetChatHistory 失败:", e.message);
        }
      }
      if (persistent) state.sessionSig = clientSig;
    }

    // 只把中止信号交给库；工具调用由我们自己的循环负责（见下方 toolsEnabled 分支）
    const toolOpts = { signal: ac.signal, stopOnAbortSignal: true };

    // ---- 计时 / 计量 ----
    // 一次请求拆成三段：预填充(首个 token 之前) / 工具执行 / 生成。
    // 关键作用：Agent 多轮调用时工具耗时混进总时长会拉低 tok/s，这里把它剔除。
    // KV 复用生效后 prefillMs 只包含「新增 token」的解码时间，首字延迟因此掉一个数量级。
    const t0 = Date.now();
    const meterBefore = meter.getState();
    const kvBefore = persistent ? sequence.nextTokenIndex : 0;
    const dbg = (tag) => {
      if (process.env.KV_DEBUG) log(`[kv] ${tag} +${Date.now() - t0}ms`);
    };
    dbg(`准备完成 resumed=${resumed} kv=${kvBefore}`);
    let ttftMs = null;
    const onToken = () => {
      if (ttftMs === null) {
        ttftMs = Date.now() - t0;
        dbg("首个 token");
      }
    };

    /**
     * 记下「这一轮结束后客户端应该带回的历史」的指纹。
     * 指纹覆盖 历史 + 本轮提问 + 本轮回复——正好等于客户端下一次发来的 priorHistory。
     * 只有「回复正文原样回到客户端」时才记；思考段、空回复兜底文案、被中止的半截内容
     * 客户端的下一轮历史都对不上，一律置空，下一轮老老实实重放历史（KV 仍按前缀复用）。
     */
    const commitSession = (text, trustworthy) => {
      if (!persistent) return;
      state.sessionSig =
        trustworthy && text
          ? historySignature([
              ...priorHistory,
              { type: "user", text: lastUser.text },
              { type: "model", response: [text] },
            ])
          : null;
    };

    const finishMetrics = () => {
      const st = meter.diff(meterBefore); // 本请求真正解码的 token（复用部分不在内）
      dbg("prompt 返回");
      const prefillTokens = st.usedInputTokens;
      const completionTokens = st.usedOutputTokens;
      // 完整提示长度：把模板渲染一遍再分词（含系统提示），与 prefillTokens 的差就是复用量
      const windowHistory = [
        ...initialHistory(chatWrapper, system),
        ...priorHistory,
        { type: "user", text: lastUser.text },
      ];
      const promptTokens = estimatePromptTokens(chatWrapper, windowHistory, state.model) ?? prefillTokens + kvBefore;
      const reusedTokens = Math.max(0, Math.min(kvBefore, promptTokens - prefillTokens));
      const totalMs = Date.now() - t0;
      const toolMs = toolJournal.reduce((sum, t) => sum + (Number(t.ms) || 0), 0);
      const prefillMs = ttftMs ?? totalMs;
      // ttft 没记到 = 一个 token 都没出：别拿 1ms 兜底去算速度（会得出几十万 tok/s）
      const genMs = ttftMs === null ? 0 : Math.max(0, totalMs - prefillMs - toolMs);
      return {
        promptTokens,
        // —— KV 缓存复用 ——
        prefillTokens, // 本次实际送去解码的输入 token
        reusedTokens, // 直接从 KV 缓存里复用的 token
        cacheHit: promptTokens > 0 ? +(reusedTokens / promptTokens).toFixed(3) : 0,
        resumed, // 是否命中「原会话续聊」
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        // —— 计时明细（毫秒）——
        ttftMs: ttftMs ?? null,
        prefillMs,
        toolMs,
        genMs,
        totalMs,
        // —— 派生速度 ——
        tokPerSec: genMs > 0 ? +(completionTokens / (genMs / 1000)).toFixed(2) : 0,
        promptTokPerSec: prefillMs > 0 ? +(prefillTokens / (prefillMs / 1000)).toFixed(1) : 0,
        // —— 工具统计 ——
        toolCalls: toolJournal.length,
        rounds: toolJournal.length + 1,
      };
    };

    // ---------------------------------------------------------------- 工具调用（Agent 循环）
    //
    // 这条分支完全绕开 node-llama-cpp 的 functions 支持，自己跑「模型要工具 → 我们执行 →
    // 结果回填 → 模型续答」。库要从模板里探测函数调用语法，探不到就静默丢弃 functions，
    // 模型于是只吐一堆 <tool_call> 文本而没人解析——工具调用一直失效就是这么来的。
    //
    // 注意：这条分支不逐 token 流式。调用块的标记可能被拆在两个 token 之间，
    // 边流边滤会把 <tool_call> 漏给用户；改成「每轮跑完再一次性推正文」，正确性优先。
    if (toolsEnabled) {
      const streaming = payload.stream === true;
      let chunk = null;
      if (streaming) {
        res.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        chunk = (delta, finish = null, extra = undefined) =>
          res.write(
            `data: ${JSON.stringify({
              id,
              object: "chat.completion.chunk",
              created,
              model: modelId,
              choices: [{ index: 0, delta, finish_reason: finish }],
              ...(extra ?? {}),
            })}\n\n`,
          );
        chunk({ role: "assistant", content: "" });
        // 工具真正执行时立刻推给界面，证明"确实跑了"而不是模型编的
        emitTool = (t) => chunk({ tool: { name: t.name, args: t.args, result: t.result, ms: t.ms } });
      }

      let visible = "";
      let round = 0;
      let rawCallSeen = false;
      let turnText = await session.prompt(lastUser.text, {
        maxTokens,
        temperature,
        // 计时用：首个 token 到达才算预填充结束。少了这个，单轮直接作答时
        // ttft 会在整段生成完之后才补记，生成时间被算进预填充，速度算出几十万 tok/s。
        onToken,
        ...toolOpts,
      });
      if (ttftMs === null) ttftMs = Date.now() - t0;
      if (/<tool_call>/i.test(turnText)) rawCallSeen = true;
      visible += stripToolCalls(turnText);

      while (round < TOOL_ROUND_LIMIT) {
        const calls = parseToolCalls(turnText);
        if (!calls.length) break;
        const feedback = [];
        for (const c of calls) {
          const entry = await toolRegistry.run(c.name, c.args);
          feedback.push(
            `<tool_response>\n${JSON.stringify({ name: c.name, result: entry.result })}\n</tool_response>`,
          );
        }
        round += 1;
        turnText = await session.prompt(feedback.join("\n"), {
          maxTokens,
          temperature,
          onToken,
          ...toolOpts,
        });
        if (/<tool_call>/i.test(turnText)) rawCallSeen = true;
        visible += stripToolCalls(turnText);
      }
      if (parseToolCalls(turnText).length) {
        visible += `\n\n（已达到 ${TOOL_ROUND_LIMIT} 轮工具调用上限，先答到这里）`;
      }

      // 思考段照旧拆开：Qwen3 这类走模板段，R1 那类把  thinking 混在正文里
      const split = splitThinking(visible);
      const templateThoughts = extractThoughts(session);
      const reasoning = [templateThoughts, split.thought].filter(Boolean).join("\n\n").trim();
      let text = split.content.trim();
      if (!text) {
        if (rawCallSeen) {
          text = "（工具调用没有完整生成：输出在调用块中间被截断了。把「最大生成长度」调大，或先让它只给代码、再分步写文件。）";
        } else {
          text = reasoning
            ? `（全部 token 都用在了思考上，没有得出最终结论。以下是它的推理过程）\n\n${reasoning}`
            : EMPTY_HINT;
        }
      }
      // 工具往返后会话内部历史 ≠ 客户端看到的历史，下一轮必须重放（sig 置空）
      commitSession(text, false);
      const metrics = finishMetrics();
      metrics.rounds = round + 1;
      await release();

      const usage = {
        prompt_tokens: metrics.promptTokens,
        completion_tokens: metrics.completionTokens,
        total_tokens: metrics.totalTokens,
      };
      if (streaming) {
        if (reasoning) chunk({ reasoning_content: reasoning });
        chunk({ content: text });
        chunk({}, "stop", { usage, metrics, tools: toolJournal });
        res.write("data: [DONE]\n\n");
        res.end();
      } else {
        sendJson(res, 200, {
          id,
          object: "chat.completion",
          created,
          model: modelId,
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: text,
                ...(reasoning ? { reasoning_content: reasoning } : {}),
              },
              finish_reason: "stop",
            },
          ],
          usage,
          metrics,
          tools: toolJournal,
        });
      }
      return;
    }

    if (payload.stream === true) {
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      const chunk = (delta, finish = null, extra = undefined) =>
        res.write(
          `data: ${JSON.stringify({
            id,
            object: "chat.completion.chunk",
            created,
            model: modelId,
            choices: [{ index: 0, delta, finish_reason: finish }],
            ...(extra ?? {}),
          })}\n\n`,
        );
      chunk({ role: "assistant", content: "" });
      // 工具真正执行时立刻推给界面，证明"确实跑了"而不是模型编的
      emitTool = (t) =>
        chunk({
          tool: { name: t.name, args: t.args, result: t.result, ms: t.ms },
        });

      let mainChars = 0;
      let thinkChars = 0;
      let contentAcc = ""; // 客户端实际收到的正文（不含思考段），用于记历史指纹
      // 模板没声明思考机制的推理模型会把  thinking 当正文吐出来，这里实时拆开
      const splitter = createThoughtSplitter(
        (t) => {
          thinkChars += t.length;
          chunk({ reasoning_content: t });
        },
        (t) => {
          mainChars += t.length;
          contentAcc += t;
          chunk({ content: t });
        },
      );
      const meta = await session.promptWithMeta(lastUser.text, {
        maxTokens,
        temperature,
        onToken,
        ...toolOpts,
        // 按 segmentType 分流：thought → reasoning_content（DeepSeek 风格字段），其余 → content
        onResponseChunk: (c) => {
          if (!c || !c.text) return;
          if (ttftMs === null) ttftMs = Date.now() - t0;
          if (c.segmentType === "thought") {
            thinkChars += c.text.length;
            chunk({ reasoning_content: c.text });
          } else {
            splitter.feed(c.text);
          }
        },
      });
      splitter.finish();

      if (mainChars === 0) {
        // 思考型模型在慢机器上可能把整个 token 预算用在 thought 段上。
        chunk({
          content:
            thinkChars > 0
              ? "（推理过程已在上方输出，但模型没来得及给出最终结论——可以把 max_tokens 调大，或关闭深度思考）"
              : EMPTY_HINT,
        });
      }
      commitSession(contentAcc || (meta.responseText ?? ""), mainChars > 0 && thinkChars === 0);

      const metrics = finishMetrics();
      // 归还序列（常驻模式下 release 什么都不做，序列要留给下一轮复用）
      await release();
      chunk({}, "stop", {
        usage: {
          prompt_tokens: metrics.promptTokens,
          completion_tokens: metrics.completionTokens,
          total_tokens: metrics.totalTokens,
        },
        metrics,
        tools: toolJournal,
      });
      res.write("data: [DONE]\n\n");
      res.end();
    } else {
      const meta = await session.promptWithMeta(lastUser.text, {
        maxTokens,
        temperature,
        onToken,
        ...toolOpts,
      });
      // 模板声明了思考段的模型（Qwen3 等）走 extractThoughts；
      // 模板没声明的推理模型（DeepSeek-R1 蒸馏、gpt-oss）把  thinking 当正文吐，这里拆开
      const split = splitThinking(meta.responseText ?? "");
      const templateThoughts = extractThoughts(session);
      const reasoning = [templateThoughts, split.thought].filter(Boolean).join("\n\n").trim();
      let text = split.content.trim();
      commitSession(split.content.trim(), Boolean(text) && !reasoning);
      if (!text) {
        text = reasoning
          ? `（全部 token 都用在了思考上，没有得出最终结论。以下是它的推理过程）\n\n${reasoning}`
          : EMPTY_HINT;
      }
      const metrics = finishMetrics();
      await release();
      sendJson(res, 200, {
        id,
        object: "chat.completion",
        created,
        model: modelId,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: text,
              ...(reasoning ? { reasoning_content: reasoning } : {}),
            },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: metrics.promptTokens,
          completion_tokens: metrics.completionTokens,
          total_tokens: metrics.totalTokens,
        },
        metrics,
        tools: toolJournal,
      });
    }
  } catch (err) {
    const msg = String(err?.message ?? err);
    log("聊天错误:", msg);
    // 出错后会话内部状态不可信，下一轮强制重放历史
    if (persistent) state.sessionSig = null;
    await release();
    // 中止生成（点停止/关窗口）在 Vulkan 后端上可能把上下文搞坏：
    // llama.cpp 会报 ErrorDeviceLost 或 KV 位置错乱，之后所有请求都会 500。
    // 这种情况只能重载模型，所以这里自动重载，别让用户以为坏了。
    const fatal = /ErrorDeviceLost|Eval has failed|failed to initialize batch|inconsistent sequence positions|llama_decode failed/i.test(msg);
    if (fatal && !state.restarting) exitForRestart(msg);
    if (!res.headersSent) {
      sendJson(res, 500, {
        error: {
          message: fatal
            ? `生成被中断后推理引擎损坏，服务正在自动重启（约 15 秒），稍后直接再发即可（${msg.slice(0, 50)}）`
            : msg,
        },
      });
    } else res.end();
  } finally {
    activeChats -= 1;
    if (!persistent && session) {
      try {
        session.dispose();
      } catch {}
    }
    await release();
    releaseSlot?.();
  }
}

// ---------------------------------------------------------------- 路由
// ---------------------------------------------------------------- 多会话（对话列表）
/**
 * 每个会话一个 JSON 文件：<MODEL_DIR>\workspace\sessions\<id>.json
 *
 * 为什么落在服务端磁盘而不是 localStorage：便携包换机器、清 WebView2 缓存、
 * 换浏览器都不该把对话弄丢；而且和 /api/export 的落盘目录一致，便于备份。
 */
const SESSION_DIR = path.join(MODEL_DIR, "workspace", "sessions");
/** 会话 id 要直接拼进文件名，必须严格校验字符集，顺便防住目录穿越 */
const SESSION_ID_RE = /^[A-Za-z0-9_-]{6,64}$/;
// 会话快照：每次覆盖写之前把旧内容整份留一份，按天分目录。
// 2026-10-25 丢过一次 13 条会话（探针 wipe 直接 unlink，回收站与卷影都没有），这层是兜底。
const SNAPSHOT_DIR = path.join(MODEL_DIR, "workspace", "session-snapshots");
const SNAPSHOT_DAYS = 30;          // 按天目录，超过就整目录删
const SNAPSHOT_PER_SESSION = 20;   // 单会话最多留 20 个版本，防止频繁写把盘吃满
/** 单会话文件上限：异常数据别把磁盘写满 */
const SESSION_MAX_BYTES = 24 * 1024 * 1024;
const SESSION_TITLE_MAX = 60;

function sessionFile(id) {
  const s = String(id ?? "");
  return SESSION_ID_RE.test(s) ? path.join(SESSION_DIR, `${s}.json`) : null;
}

/** 用第一条用户消息当标题：足够区分，也不必额外让模型起名 */
function deriveTitle(messages) {
  const list = Array.isArray(messages) ? messages : [];
  const first = list.find((m) => m && m.role === "user" && String(m.content ?? "").trim());
  const raw = first ? String(first.content).replace(/\s+/g, " ").trim() : "";
  return raw ? raw.slice(0, SESSION_TITLE_MAX) : "新对话";
}

async function listSessions() {
  await mkdir(SESSION_DIR, { recursive: true });
  let names = [];
  try {
    names = (await readdir(SESSION_DIR)).filter((f) => f.toLowerCase().endsWith(".json"));
  } catch {
    return [];
  }
  const out = [];
  for (const f of names.slice(0, 400)) {
    try {
      const j = JSON.parse(await readFile(path.join(SESSION_DIR, f), "utf8"));
      const id = String(j.id ?? f.replace(/\.json$/i, ""));
      if (!SESSION_ID_RE.test(id)) continue;
      const messages = Array.isArray(j.messages) ? j.messages : [];
      out.push({
        id,
        title: String(j.title ?? "").trim() || deriveTitle(messages),
        renamed: Boolean(j.renamed),
        model: String(j.model ?? ""),
        createdAt: Number(j.createdAt) || 0,
        updatedAt: Number(j.updatedAt) || 0,
        turns: messages.filter((m) => m && m.role === "user").length,
        count: messages.length,
      });
    } catch {
      // 单个文件坏了就跳过，别让它拖垮整个列表
    }
  }
  out.sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
  return out;
}

async function readSession(id) {
  const full = sessionFile(id);
  if (!full) return null;
  try {
    const j = JSON.parse(await readFile(full, "utf8"));
    const messages = Array.isArray(j.messages) ? j.messages : [];
    // title 只存「用户手动起的名字」：空表示还没起过，展示时用首句兜底。
    // 这样客户端拿回空 title 就不会把自动标题误当成自定义标题钉死。
    const raw = String(j.title ?? "").trim();
    return {
      id: String(j.id ?? id),
      title: raw,
      renamed: Boolean(j.renamed),
      displayTitle: raw || deriveTitle(messages),
      model: String(j.model ?? ""),
      createdAt: Number(j.createdAt) || 0,
      updatedAt: Number(j.updatedAt) || 0,
      messages,
    };
  } catch {
    return null;
  }
}

/** 自动标题的清洗：去掉引号、句末标点、前缀，压成一行短标题 */
function cleanTitle(raw) {
  let s = String(raw ?? "").split("\n").map((x) => x.trim()).filter(Boolean)[0] ?? "";
  s = s.replace(/^(标题|题目|对话标题)\s*[:：]\s*/, "");
  s = s.replace(/^["'“”‘’《「『]+|["'“”‘’》」』]+$/g, "");
  s = s.replace(/[。！？!?，,、；;：:.]+$/g, "");
  s = s.replace(/\s+/g, " ").trim();
  return s.slice(0, 20);
}

/**
 * 用主模型生成标题。
 * 单独开一个 512 上下文的小 context：不往对话的 sequence 里塞 token，
 * 也就不会破坏下一轮要复用的 KV 缓存（首字 0.97s 靠的就是它）。
 */
async function generateTitleWithModel(prompt) {
  const ctx = await state.model.createContext({ contextSize: 512 });
  try {
    const session = new LlamaChatSession({
      contextSequence: ctx.getSequence(),
      // 必须和聊天主路径用同一个「不思考」模板：Qwen3 这类思考模型默认会先写 <think>，
      // 24 个 token 全被思维链吃掉后正文为空，cleanTitle 拿到空串 → 自动标题静默失效。
      chatWrapper: state.wrapperNoThink ?? "auto",
      systemPrompt: "你是标题生成器。只输出标题，不要解释。",
    });
    return await session.prompt(prompt, { maxTokens: 32, temperature: 0.2 });
  } finally {
    await ctx.dispose().catch(() => {});
  }
}

async function handleAutoTitle(res, url) {
  const id = url.slice("/api/sessions/".length, -"/auto-title".length);
  if (!sessionFile(id)) return sendJson(res, 400, { error: { message: "非法的会话 id" } });
  const s = await readSession(id);
  if (!s) return sendJson(res, 404, { error: { message: "会话不存在" } });
  if (s.renamed) return sendJson(res, 200, { skipped: "renamed" });
  const msgs = Array.isArray(s.messages) ? s.messages : [];
  const asks = msgs.filter((m) => m && m.role === "user" && String(m.content ?? "").trim()).slice(0, 2);
  const answers = msgs
    .filter((m) => m && m.role === "assistant" && m.kind !== "second" && String(m.content ?? "").trim())
    .slice(0, 2);
  if (asks.length < 2 || answers.length < 2) return sendJson(res, 200, { skipped: "too-early" });
  if (!state.model) return sendJson(res, 200, { skipped: "no-model" });
  if (activeChats > 0) return sendJson(res, 409, { error: { message: "模型正忙，稍后再试" } });
  const clip = (t, n) => String(t).replace(/\s+/g, " ").trim().slice(0, n);
  const prompt = [
    "根据下面这轮对话，起一个 6–12 个汉字的中文标题。只输出标题本身，不要引号、标点、换行和解释。",
    `用户1：${clip(asks[0].content, 160)}`,
    `助手1：${clip(answers[0].content, 160)}`,
    `用户2：${clip(asks[1].content, 160)}`,
  ].join("\n");
  let raw;
  try {
    raw = await generateTitleWithModel(prompt);
  } catch (e) {
    log("自动标题失败:", e?.message ?? e);
    return sendJson(res, 500, { error: { message: String(e?.message ?? e) } });
  }
  const title = cleanTitle(raw);
  if (!title) {
    // 静默失败最难查：把原始输出留一行日志，下次一眼看出是空串、模板跑偏还是截断。
    log(`自动标题为空 ${id}；原始输出=${JSON.stringify(String(raw ?? "").slice(0, 120))}`);
    return sendJson(res, 200, { skipped: "empty" });
  }
  const again = await readSession(id);
  if (!again || again.renamed) return sendJson(res, 200, { skipped: "renamed" });
  await writeSession(id, { title });
  log(`自动标题 ${id} → ${title}`);
  return sendJson(res, 200, { id, title });
}

function snapshotDayDir(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return path.join(SNAPSHOT_DIR, y + "-" + m + "-" + day);
}

/** 单会话版本数封顶：按天目录 + 文件名时间戳排序，超了就删最老的 */
async function pruneSessionSnapshots(id) {
  const days = await readdir(SNAPSHOT_DIR).catch(() => []);
  const mine = [];
  for (const d of days.sort()) {
    const files = await readdir(path.join(SNAPSHOT_DIR, d)).catch(() => []);
    for (const f of files.sort()) if (f.startsWith(id + ".")) mine.push(path.join(SNAPSHOT_DIR, d, f));
  }
  while (mine.length > SNAPSHOT_PER_SESSION) {
    const oldest = mine.shift();
    await unlink(oldest).catch(() => {});
  }
}

/** 超过保留天数的快照整目录清掉；启动时与每次快照后各跑一次，成本只有几次 readdir */
async function pruneOldSnapshotDirs() {
  const days = await readdir(SNAPSHOT_DIR).catch(() => []);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - SNAPSHOT_DAYS);
  const cut = cutoff.toISOString().slice(0, 10);
  for (const d of days) {
    if (/^d{4}-d{2}-d{2}$/.test(d) && d < cut) {
      await rm(path.join(SNAPSHOT_DIR, d), { recursive: true, force: true }).catch(() => {});
      log("清理过期会话快照 " + d);
    }
  }
}

/** 写盘前留档。prevRaw 是即将被覆盖的那份原文；没有旧文件（新建）就不留。 */
async function snapshotBeforeWrite(id, prevRaw) {
  if (!prevRaw) return;
  try {
    const dir = snapshotDayDir();
    await mkdir(dir, { recursive: true });
    const now = new Date();
    // 到毫秒：同一秒里连写两次（比如"回滚"紧接着又存一次）不会互相覆盖
    const stamp =
      [now.getHours(), now.getMinutes(), now.getSeconds()]
        .map((n) => String(n).padStart(2, "0")).join("-") +
      "-" + String(now.getMilliseconds()).padStart(3, "0");
    await writeFile(path.join(dir, id + "." + stamp + ".json"), prevRaw, "utf8");
    await pruneSessionSnapshots(id);
  } catch (e) {
    log("会话快照失败（不影响主流程）:", e?.message ?? e);
  }
}

async function writeSession(id, patch = {}) {
  const full = sessionFile(id);
  if (!full) throw new Error("非法的会话 id");
  await mkdir(SESSION_DIR, { recursive: true });
  // 覆盖前先读原文留档：解析出来的对象可能丢字段，快照要的是字节级原样
  let prevRaw = null;
  try { prevRaw = await readFile(full, "utf8"); } catch {}
  const existing = await readSession(id);
  const prev = existing ?? { title: "", model: "", createdAt: Date.now(), messages: [], renamed: false };
  const messages = Array.isArray(patch.messages) ? patch.messages : prev.messages;
  const title = String(patch.title ?? prev.title ?? "").replace(/\s+/g, " ").trim().slice(0, SESSION_TITLE_MAX);
  // 用户手改过就置 true：自动标题从此不再覆盖（策略与界面上报一致）
  const renamed = Boolean(patch.renamed ?? prev.renamed ?? false);
  const model = String(patch.model ?? prev.model ?? "");
  // 内容一模一样就别抬 updatedAt：否则「只是切了个对话」也会让侧栏顺序乱跳
  if (
    existing &&
    title === prev.title &&
    model === prev.model &&
    renamed === prev.renamed &&
    JSON.stringify(messages) === JSON.stringify(prev.messages)
  ) {
    return existing;
  }
  const body = {
    id,
    title,
    renamed,
    model,
    createdAt: prev.createdAt || Date.now(),
    updatedAt: Date.now(),
    messages,
  };
  const text = JSON.stringify(body);
  if (Buffer.byteLength(text) > SESSION_MAX_BYTES) throw new Error("会话过大，无法保存");
  await snapshotBeforeWrite(id, prevRaw);
  await writeFile(full, text, "utf8");
  // 落盘成功后顺手排一次异地备份（关闭时这里是空操作）
  scheduleBackup("write");
  return { ...body, displayTitle: body.title || deriveTitle(messages) };
}

/** 时间前缀让文件名天然按时间排序，uuid 后缀保证唯一 */
function newSessionId() {
  return `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
}


// ---------------------------------------------------------------- 会话备份（镜像到另一块盘/网络盘）
/**
 * 会话与它的历史版本都在 <MODEL_DIR>\workspace 下，也就是同一块盘。
 * 这块盘坏了、目录被误删，快照一起没了——所以再往外镜像一份。
 *
 * 约定：
 *  - 只往用户指定的目录里写 sessions\、daily\<日期>\、backup.json，不碰目录里其它东西；
 *  - 只拷贝「有变化」的文件（比对上次写的清单，不信 mtime，因为 copyFile 不保留时间）；
 *  - 源里没有、备份里有的会话**不删**：那可能正是事故删掉的，留着还能捞；
 *  - 备份失败只记状态、写日志，绝不打断对话。
 */
const BACKUP_FILE = path.join(WORKSPACE, "backup.json");
const BACKUP_DEFAULT = { enabled: false, dir: "", keepDays: 14, intervalMin: 30 };
const BACKUP_VERSION = 1;
const backupState = { running: false, lastRunAt: 0, lastResult: null, timer: null, loop: null };

async function readBackupConfig() {
  try {
    const j = JSON.parse(await readFile(BACKUP_FILE, "utf8"));
    return { ...BACKUP_DEFAULT, ...j, enabled: Boolean(j.enabled) };
  } catch {
    return { ...BACKUP_DEFAULT };
  }
}

async function writeBackupConfig(patch = {}) {
  const cur = await readBackupConfig();
  const next = { ...cur, ...patch };
  next.enabled = Boolean(next.enabled);
  next.keepDays = Math.max(1, Math.min(365, Number(next.keepDays) || BACKUP_DEFAULT.keepDays));
  next.intervalMin = Math.max(5, Math.min(240, Number(next.intervalMin) || BACKUP_DEFAULT.intervalMin));
  await mkdir(WORKSPACE, { recursive: true });
  await writeFile(BACKUP_FILE, JSON.stringify(next, null, 2), "utf8");
  return next;
}

/** 校验备份目录：必须是绝对路径，且不能是会话目录本身/它的上级（那等于原地复制） */
function resolveBackupDir(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  if (s.length > 400) throw new Error("路径太长了");
  if (!path.isAbsolute(s)) throw new Error("请填绝对路径，例如 E:\\LocalAI-Backup 或 \\\\NAS\\share\\LocalAI");
  const full = path.resolve(s);
  const sessRoot = path.resolve(SESSION_DIR).toLowerCase();
  const low = full.toLowerCase();
  if (low === sessRoot || low.startsWith(sessRoot + path.sep)) throw new Error("备份目录不能放在会话目录里");
  if (sessRoot.startsWith(low + path.sep)) throw new Error("备份目录不能是会话目录的上级，请另建一个子目录");
  return full;
}

/** 备份目录和模型目录是不是同一块盘：是的话只能防误删，防不了整盘损坏，界面要说明白 */
function sameDriveAsModel(dir) {
  if (!dir) return false;
  try {
    return path.parse(path.resolve(dir)).root.toLowerCase() === path.parse(path.resolve(MODEL_DIR)).root.toLowerCase();
  } catch {
    return false;
  }
}

/** 真建一次目录并写一个探针文件：盘没插、路径写错、没权限，在这个阶段就报出来 */
async function ensureDirWritable(dir) {
  await mkdir(dir, { recursive: true });
  const probe = path.join(dir, ".localai-write-test");
  await writeFile(probe, "ok", "utf8");
  await unlink(probe).catch(() => {});
}

function dayStamp(d = new Date()) {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return d.getFullYear() + "-" + m + "-" + day;
}

async function listSessionFiles() {
  const names = await readdir(SESSION_DIR).catch(() => []);
  return names.filter((f) => f.toLowerCase().endsWith(".json"));
}

async function listDrives() {
  const out = [];
  for (const letter of "CDEFGHIJKLMNOPQRSTUVWXYZ") {
    const root = letter + ":\\";
    try {
      const s = await statfs(root);
      const bsize = Number(s.bsize) || 0;
      const total = bsize * Number(s.blocks || 0);
      const free = bsize * Number(s.bavail || 0);
      if (!total) continue;
      out.push({ root, totalGB: Math.round((total / 1024 ** 3) * 10) / 10, freeGB: Math.round((free / 1024 ** 3) * 10) / 10 });
    } catch {}
  }
  return out;
}

async function pruneBackupDays(dir, keepDays) {
  const dailyRoot = path.join(dir, "daily");
  const days = await readdir(dailyRoot).catch(() => []);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - keepDays);
  const cut = dayStamp(cutoff);
  for (const d of days) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d >= cut) continue;
    await rm(path.join(dailyRoot, d), { recursive: true, force: true }).catch(() => {});
    log("清理过期会话备份 " + d);
  }
}

async function runBackup(reason = "manual") {
  const cfg = await readBackupConfig();
  if (!cfg.dir) return { ok: false, skipped: "no-dir", reason };
  if (backupState.running) return { ok: false, skipped: "busy", reason };
  let dir;
  try {
    dir = resolveBackupDir(cfg.dir);
  } catch (e) {
    backupState.lastResult = { ok: false, error: String(e?.message ?? e), reason, at: Date.now() };
    return backupState.lastResult;
  }
  backupState.running = true;
  const startedAt = Date.now();
  const result = { reason, dir, at: startedAt, sessions: 0, copied: 0, bytes: 0, daily: "", errors: [] };
  try {
    await ensureDirWritable(dir);
    const mirror = path.join(dir, "sessions");
    await mkdir(mirror, { recursive: true });
    const metaFile = path.join(dir, "backup.json");
    let meta = {};
    try { meta = JSON.parse(await readFile(metaFile, "utf8")); } catch {}
    const known = meta && meta.sessions && typeof meta.sessions === "object" ? meta.sessions : {};
    const next = {};
    const day = dayStamp();
    const dailyDir = path.join(dir, "daily", day);
    for (const f of await listSessionFiles()) {
      const src = path.join(SESSION_DIR, f);
      let st;
      try { st = await stat(src); } catch { continue; }
      const id = f.replace(/\.json$/i, "");
      next[id] = { size: st.size, mtimeMs: Math.round(st.mtimeMs) };
      const prev = known[id];
      // 清单判断"变没变"：文件大小或 mtime 变了才复制，避免每次备份把整目录重写一遍
      const changed = !prev || prev.size !== st.size || Math.abs((Number(prev.mtimeMs) || 0) - st.mtimeMs) > 500;
      if (changed) {
        try {
          await copyFile(src, path.join(mirror, f));
          result.copied += 1;
          result.bytes += st.size;
        } catch (e) {
          result.errors.push(f + ": " + String(e?.message ?? e));
        }
      }
      result.sessions += 1;
      // 当日快照：当天第一次备份时每个会话留一份完整拷贝，日后能回答"昨天这时候是什么样"
      const dfile = path.join(dailyDir, f);
      const exists = await stat(dfile).then((x) => x.isFile()).catch(() => false);
      if (!exists) {
        try {
          await mkdir(dailyDir, { recursive: true });
          await copyFile(src, dfile);
          result.copied += 1;
          result.bytes += st.size;
          result.daily = day;
        } catch (e) {
          result.errors.push("daily/" + day + "/" + f + ": " + String(e?.message ?? e));
        }
      }
    }
    // 历史版本快照也一起镜像：快照是"写一次就不变"的文件，缺了才拷
    {
      const snapMirror = path.join(dir, "snapshots");
      let total = 0;
      let copiedSnap = 0;
      const days = await readdir(SNAPSHOT_DIR).catch(() => []);
      for (const day of days.sort()) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
        const files = (await readdir(path.join(SNAPSHOT_DIR, day)).catch(() => [])).filter((f) => f.toLowerCase().endsWith(".json"));
        for (const f of files.sort()) {
          total += 1;
          if (total > 5000) break;
          const dst = path.join(snapMirror, day, f);
          if (await stat(dst).then((s) => s.isFile()).catch(() => false)) continue;
          try {
            await mkdir(path.dirname(dst), { recursive: true });
            await copyFile(path.join(SNAPSHOT_DIR, day, f), dst);
            copiedSnap += 1;
          } catch (e) {
            result.errors.push("snapshots/" + day + "/" + f + ": " + String(e?.message ?? e));
          }
        }
        if (total > 5000) break;
      }
      result.snapshots = total;
      result.snapshotsCopied = copiedSnap;
    }
    const manifest = {
      app: "LocalAI",
      kind: "session-backup",
      version: BACKUP_VERSION,
      dir,
      updatedAt: Date.now(),
      sessions: next,
      note: "sessions\\ 是会话镜像，snapshots\\ 是历史版本；把 json 拷回 workspace\\sessions 或 workspace\\session-snapshots 即可恢复。",
    };
    // 原子写：先写 .tmp 再改名，半截文件不会被下次读到
    await writeFile(metaFile + ".tmp", JSON.stringify(manifest, null, 2), "utf8");
    await rename(metaFile + ".tmp", metaFile).catch(async () => {
      await writeFile(metaFile, JSON.stringify(manifest, null, 2), "utf8").catch(() => {});
    });
    await pruneBackupDays(dir, cfg.keepDays);
    const seconds = Math.round((Date.now() - startedAt) / 100) / 10;
    backupState.lastRunAt = Date.now();
    backupState.lastResult = { ...result, ok: result.errors.length === 0, seconds };
    log("会话备份 " + reason + "：" + result.sessions + " 个会话 / 复制 " + result.copied + " 个文件 / 历史版本 " + (result.snapshots || 0) + " 份（新增 " + (result.snapshotsCopied || 0) + "）/ " + (result.bytes / 1024).toFixed(0) + " KB → " + dir);
  } catch (e) {
    backupState.lastRunAt = Date.now();
    backupState.lastResult = { ...result, ok: false, error: String(e?.message ?? e), seconds: Math.round((Date.now() - startedAt) / 100) / 10 };
    log("会话备份失败（不影响对话）:", e?.message ?? e);
  } finally {
    backupState.running = false;
  }
  return backupState.lastResult;
}

/** 写盘之后顺手排一次：15 秒内的多次改动合并成一次，别每敲一句就全量比对 */
function scheduleBackup(reason = "write", delay = 15000) {
  try {
    if (backupState.timer) return;
    backupState.timer = setTimeout(() => {
      backupState.timer = null;
      readBackupConfig()
        .then((cfg) => (cfg.enabled && cfg.dir ? runBackup(reason) : null))
        .catch(() => {});
    }, delay);
    backupState.timer.unref?.();
  } catch {}
}

async function backupTick() {
  const cfg = await readBackupConfig();
  if (!cfg.enabled || !cfg.dir || backupState.running) return;
  const due = !backupState.lastRunAt || Date.now() - backupState.lastRunAt >= cfg.intervalMin * 60000;
  if (due) await runBackup("interval");
}

/** 启动就查一次（上次可能是隔夜跑的），之后每分钟看一次是否到点 */
function startBackupLoop() {
  try {
    backupState.loop = setInterval(() => { backupTick().catch(() => {}); }, 60000);
    backupState.loop.unref?.();
  } catch {}
  backupTick().catch(() => {});
}

// ---------------------------------------------------------------- 模型下载（首次使用引导用）
const DOWNLOAD_DIR = path.join(MODEL_DIR, ".downloads");
const ONBOARD_FILE = path.join(MODEL_DIR, "workspace", "onboarding.json");

async function readOnboarding() {
  try { return JSON.parse(await readFile(ONBOARD_FILE, "utf8")); } catch { return { done: false, scannedAt: 0 }; }
}

/**
 * 使用说明（README）从哪儿读：发布包在 app\README.md，开发态在仓库根目录 README.md。
 * 首启弹窗、设置里的「使用说明…」都走同一份内容，不复制文案。
 */
const README_CANDIDATES = [path.join(HERE, "README.md"), path.join(HERE, "..", "README.md")];
async function loadReadme() {
  for (const p of README_CANDIDATES) {
    try {
      const md = await readFile(p, "utf8");
      if (md.trim()) return { markdown: md, source: p };
    } catch {}
  }
  return { markdown: "", source: "" };
}
// ModelScope 会按 UA 拦人：默认的 Node UA 拿 Range 会 403，换成浏览器 UA 才通（实测 5.8MB/s）
const DOWNLOAD_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const MS = "https://modelscope.cn/api/v1/models/Qwen/Qwen2.5-0.5B-Instruct-GGUF/repo?Revision=master&FilePath=";
// 1.5B 是「能单文件下完」的最大档（7B 在 ModelScope 是 -00001-of-00002 分片，当前下载器只吃单文件）
const MS15 = "https://modelscope.cn/api/v1/models/Qwen/Qwen2.5-1.5B-Instruct-GGUF/repo?Revision=master&FilePath=";
const DOWNLOAD_CATALOG = [
  {
    id: "qwen25-05b-q4km",
    channel: "modelscope",
    label: "Qwen2.5-0.5B-Instruct · Q4_K_M",
    file: "qwen2.5-0.5b-instruct-q4_k_m.gguf",
    sizeMB: 469,
    note: "推荐：0.5B，中文对话够用，约 470MB",
    url: MS + "qwen2.5-0.5b-instruct-q4_k_m.gguf",
  },
  {
    id: "qwen25-05b-q2k",
    channel: "modelscope",
    label: "Qwen2.5-0.5B-Instruct · Q2_K",
    file: "qwen2.5-0.5b-instruct-q2_k.gguf",
    sizeMB: 396,
    note: "最小：加载最快，质量略有下降",
    url: MS + "qwen2.5-0.5b-instruct-q2_k.gguf",
  },
  {
    id: "qwen25-05b-q8",
    channel: "modelscope",
    label: "Qwen2.5-0.5B-Instruct · Q8_0",
    file: "qwen2.5-0.5b-instruct-q8_0.gguf",
    sizeMB: 644,
    note: "更准：体积与解码开销都更大",
    url: MS + "qwen2.5-0.5b-instruct-q8_0.gguf",
  },
  {
    id: "qwen25-15b-q4km",
    channel: "modelscope",
    label: "Qwen2.5-1.5B-Instruct · Q4_K_M",
    file: "qwen2.5-1.5b-instruct-q4_k_m.gguf",
    sizeMB: 1066,
    note: "更聪明：1.5B，8GB 机器也跑得动；约 1.1GB（已实测可下）",
    url: MS15 + "qwen2.5-1.5b-instruct-q4_k_m.gguf",
  },
];

const dl = {
  active: false, file: "", id: "", received: 0, total: 0,
  error: null, startedAt: 0, finishedAt: 0, done: false,
  samples: [], sampleAt: 0, lastDataAt: 0, req: null, res: null, part: "",
};

/** 速度窗口：只用最近 4 秒的采样（否则限速/卡住时旧样本会让速度虚高、ETA 偏乐观） */
function dlSpeedMBs() {
  if (!dl.active) return 0;
  const now = Date.now();
  const recent = dl.samples.filter((s) => now - s.t <= 4000);
  if (recent.length < 2) return 0;
  const a = recent[0], b = recent[recent.length - 1];
  const sec = (b.t - a.t) / 1000;
  return sec > 0.2 ? Math.max(0, (b.b - a.b) / 1048576 / sec) : 0;
}

/**
 * 下载状态（顶栏进度条 + 首启弹窗共用）。
 * 除了百分比，还要给出「总量/已下/剩余/速度/预计剩余」——顶栏收起时只显示速度和百分比，
 * 展开后才有余量明细。所有字节字段都同时保留 bytes 与 MB 两种口径，前端不用自己换单位。
 */
function downloadState() {
  const speed = dlSpeedMBs();
  const eta = dl.active && speed > 0.05 && dl.total > 0 ? Math.max(1, Math.round((dl.total - dl.received) / 1048576 / speed)) : null;
  const remainingBytes = dl.total > 0 ? Math.max(0, dl.total - dl.received) : 0;
  const now = Date.now();
  return {
    active: dl.active, done: dl.done, file: dl.file, id: dl.id,
    received: dl.received, total: dl.total,
    receivedBytes: dl.received, totalBytes: dl.total, remainingBytes,
    receivedMB: Number((dl.received / 1048576).toFixed(1)),
    totalMB: Number((dl.total / 1048576).toFixed(1)),
    remainingMB: Number((remainingBytes / 1048576).toFixed(1)),
    pct: dl.total ? Math.min(100, Math.round((dl.received / dl.total) * 100)) : 0,
    speedMBs: Number(speed.toFixed(2)), speedBytes: Math.round(speed * 1048576),
    etaSec: eta, error: dl.error,
    elapsedSec: dl.startedAt ? Math.round((now - dl.startedAt) / 1000) : 0,
    startedAt: dl.startedAt || 0, finishedAt: dl.finishedAt || 0, updatedAt: now,
    // 卡住检测：超过 2.5 秒没有新数据，界面应显示「连接中…」而不是一个不动的速度
    lastDataAt: dl.lastDataAt || 0,
    stallSec: dl.active && dl.lastDataAt ? Number(((now - dl.lastDataAt) / 1000).toFixed(1)) : 0,
    elapsedTotalSec: dl.startedAt && dl.finishedAt ? Math.round((dl.finishedAt - dl.startedAt) / 1000) : 0,
  };
}

function cancelDownload() {
  // 没有进行中的下载时不要「假取消」：早期实现会在这里把 error 改成「已取消」，
  // 于是「刚下完」的状态会变成 done=true 同时又 error=已取消，顶栏不知道该显示完成还是失败。
  if (!dl.active) {
    log("下载取消：当前没有进行中的下载（忽略）");
    return { cancelled: false, reason: "no-active-download" };
  }
  try { dl.req?.destroy(new Error("用户取消")); } catch {}
  try { dl.res?.destroy(); } catch {}
  dl.active = false;
  dl.error = "已取消";
  try { if (dl.part && existsSync(dl.part)) unlinkSync(dl.part); } catch {}
  log("下载已取消");
  return { cancelled: true };
}

/** 跟随重定向取流。ModelScope 会 302 到 CDN，跳转必须手动跟随并保留 UA。 */
function followGet(url, headers, depth = 0) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https:") ? https : http;
    const req = lib.get(url, { headers }, (res) => {
      const code = res.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(code) && res.headers.location && depth < 6) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        resolve(followGet(next, headers, depth + 1));
        return;
      }
      resolve({ req, res });
    });
    req.on("error", reject);
    req.setTimeout(30000, () => req.destroy(new Error("连接超时")));
  });
}

async function startDownload(target) {
  if (dl.active) throw new Error("已有下载正在进行");
  if (existsSync(path.join(MODEL_DIR, target.file))) throw new Error("这个文件已经在模型目录里了");
  await mkdir(DOWNLOAD_DIR, { recursive: true });
  const part = path.join(DOWNLOAD_DIR, target.file + ".part");
  try { if (existsSync(part)) unlinkSync(part); } catch {}

  Object.assign(dl, {
    active: true, file: target.file, id: target.id, received: 0, total: 0,
    error: null, startedAt: Date.now(), finishedAt: 0, done: false,
    samples: [], sampleAt: 0, lastDataAt: 0, part,
  });

  const { req, res } = await followGet(target.url, { "user-agent": DOWNLOAD_UA, accept: "*/*" });
  dl.req = req; dl.res = res;
  if ((res.statusCode || 0) !== 200) {
    res.resume();
    dl.active = false; dl.error = "HTTP " + res.statusCode;
    throw new Error("下载失败：HTTP " + res.statusCode);
  }
  dl.total = Number(res.headers["content-length"] || 0);
  log(`开始下载 ${target.file}（${(dl.total / 1048576).toFixed(1)}MB）`);

  const ws = createWriteStream(part);
  res.pipe(ws);
  res.on("data", (chunk) => {
    dl.received += chunk.length;
    const now = Date.now();
    dl.lastDataAt = now;
    // 顶栏进度条要 1 秒刷新一次，400ms 一采就够平滑；只留最近 20 个样本（见 dlSpeedMBs 的 4 秒窗口）
    if (now - dl.sampleAt > 400) {
      dl.samples.push({ t: now, b: dl.received });
      dl.sampleAt = now;
      if (dl.samples.length > 20) dl.samples.shift();
    }
  });

  try {
    await new Promise((resolve, reject) => {
      ws.on("finish", resolve);
      ws.on("error", reject);
      res.on("error", reject);
      res.on("aborted", () => reject(new Error("连接被中断")));
    });
    await rename(part, path.join(MODEL_DIR, target.file));
    Object.assign(dl, { active: false, done: true, finishedAt: Date.now() });
    log(`下载完成 ${target.file}，用时 ${Math.round((dl.finishedAt - dl.startedAt) / 1000)}s`);
    return { file: target.file, total: dl.total };
  } catch (e) {
    dl.active = false;
    dl.error = String(e?.message ?? e);
    try { if (existsSync(part)) unlinkSync(part); } catch {}
    throw e;
  }
}

// ---------------------------------------------------------------- 第二意见（@ 另一个模型）
/**
 * 内部转调用用的「假响应」：把 handleChat 的输出收进内存再解析。
 *
 * 为什么要绕这一圈：handleChat 里已经写好了提示词模板、思考段拆分、上下文预算、
 * KV 复用排队、工具调用——第二意见必须走同一条路，否则迟早两套实现不一致。
 */
function makeMemoryResponse() {
  const chunks = [];
  const mem = {
    headersSent: false,
    statusCode: 200,
    ended: false,
    writeHead(code) {
      mem.statusCode = code;
      mem.headersSent = true;
      return mem;
    },
    setHeader() {},
    getHeader() {
      return undefined;
    },
    removeHeader() {},
    flushHeaders() {},
    write(chunk) {
      mem.headersSent = true;
      if (chunk != null) chunks.push(String(chunk));
      return true;
    },
    end(chunk) {
      mem.headersSent = true;
      if (chunk != null) chunks.push(String(chunk));
      mem.ended = true;
      return mem;
    },
    on() {
      return mem;
    },
    once() {
      return mem;
    },
    emit() {
      return false;
    },
  };
  return { res: mem, text: () => chunks.join("") };
}

// ---------------------------------------------------------------- 常驻额外模型（多回答预加载）
/**
 * 「多回答预加载」：在你发问之前就把被 @ 的模型装好并常驻，第二意见不必再装卸。
 *
 * 这是唯一能既快又保住主模型 KV 缓存的做法——代价是**同时驻留多份权重**，
 * 所以必须先用 /api/capacity 算账，UI 在开启前弹窗警告并出示这份账单。
 *
 * 约定：extras 与 state.* 完全独立。主模型切换/卸载不会顺手把它们清掉
 * （否则用户刚预热的模型会在切模型时静默消失），只有显式 clear 或文件同名冲突才释放。
 */
const extras = new Map(); // file -> { file, model, context, wrappers, bytes, loadedAt, busy }
/** 预加载用的上下文：第二意见是短回答，4K 足够，能给内存留出余量 */
const PRELOAD_CONTEXT = Number(process.env.PRELOAD_CONTEXT ?? 4096);
/** 每个模型除了权重之外的运行时开销（上下文、临时缓冲），粗估 0.8GB */
const RUNTIME_OVERHEAD_BYTES = 0.8 * 1024 ** 3;
/** 权重之外还要乘以的系数：加载期会有拷贝、量化对齐等临时占用 */
const WEIGHT_INFLATE = 1.15;
/** 判定「余量充足」的门槛 */
const COMFORT_MARGIN_BYTES = 2 * 1024 ** 3;

function extrasSummary() {
  const list = [];
  let bytes = 0;
  for (const [file, ex] of extras) {
    list.push({ file, sizeGB: +(ex.bytes / 1024 ** 3).toFixed(2), loadedAt: ex.loadedAt, busy: ex.busy });
    bytes += ex.bytes;
  }
  return { files: list, totalGB: +(bytes / 1024 ** 3).toFixed(2), contextSize: PRELOAD_CONTEXT };
}

/**
 * 能力核算：主模型 + 目标模型同时驻留还够不够内存。
 * 用 os.freemem 而不是 commit，是因为 Windows 的 standby 会被回收，
 * freemem 偏保守——宁可低估余量，也别把机器拖进换页。
 */
async function capacityReport(files) {
  const models = await scanModels();
  const byFile = new Map(models.map((m) => [m.file, m]));
  const ramTotal = os.totalmem();
  const ramFree = os.freemem();

  const main = state.file && byFile.has(state.file) ? byFile.get(state.file) : null;
  const targets = [];
  for (const f of files) {
    const m = byFile.get(f);
    if (!m) {
      targets.push({ file: f, missing: true, resident: false, costGB: 0, marginGB: 0, verdict: "insufficient" });
      continue;
    }
    const resident = extras.has(f);
    const bytes = Math.round(m.sizeGB * 1024 ** 3);
    // 已驻留的不再算增量，只作为"已经在账上"列出
    const costBytes = resident ? 0 : bytes * WEIGHT_INFLATE + RUNTIME_OVERHEAD_BYTES;
    const marginBytes = ramFree - costBytes;
    const verdict = resident
      ? "ok"
      : marginBytes >= COMFORT_MARGIN_BYTES
        ? "ok"
        : marginBytes > 0
          ? "tight"
          : "insufficient";
    targets.push({
      file: f,
      sizeGB: m.sizeGB,
      resident,
      costGB: +(costBytes / 1024 ** 3).toFixed(2),
      marginGB: +(marginBytes / 1024 ** 3).toFixed(2),
      verdict,
    });
  }

  const needBytes = targets.reduce((s, t) => s + t.costGB * 1024 ** 3, 0);
  const marginBytes = ramFree - needBytes;
  const verdict =
    needBytes === 0
      ? "ok"
      : marginBytes >= COMFORT_MARGIN_BYTES
        ? "ok"
        : marginBytes > 0
          ? "tight"
          : "insufficient";
  const advice =
    verdict === "ok"
      ? "余量充足，可以同时驻留。"
      : verdict === "tight"
        ? `勉强够用，余量只有 ${(Math.max(marginBytes, 0) / 1024 ** 3).toFixed(1)}GB；同时开浏览器或大型程序可能触发换页、界面变卡。`
        : `内存不够，还差 ${(Math.abs(marginBytes) / 1024 ** 3).toFixed(1)}GB；强行预加载会让系统换页，反而更慢。`;

  return {
    ram: {
      totalGB: +(ramTotal / 1024 ** 3).toFixed(1),
      freeGB: +(ramFree / 1024 ** 3).toFixed(1),
    },
    main: main ? { file: main.file, sizeGB: main.sizeGB } : null,
    targets,
    needGB: +(needBytes / 1024 ** 3).toFixed(2),
    marginGB: +(marginBytes / 1024 ** 3).toFixed(2),
    verdict,
    advice,
    extras: extrasSummary(),
  };
}

async function preloadModel(file) {
  if (extras.has(file)) {
    return { file, ok: true, resident: true, reused: true, seconds: 0 };
  }
  if (state.file === file) {
    // 已经在跑主模型，没必要再装一份
    return { file, ok: true, resident: false, reused: true, note: "这是当前主模型", seconds: 0 };
  }
  const full = path.join(MODEL_DIR, file);
  const st = await stat(full).catch(() => null);
  if (!st || !st.isFile()) throw new Error("模型文件不存在");
  if (!llama) throw new Error("推理引擎尚未初始化");

  const t0 = Date.now();
  const model = await llama.loadModel({ modelPath: full });
  let context = null;
  try {
    const pre = await createMainContext(model, PRELOAD_CONTEXT);
    context = pre.context;
    const wrappers = buildWrappers(model);
    extras.set(file, {
      file,
      model,
      context,
      wrappers,
      kvQuant: pre.kvQuant,
      bytes: st.size,
      loadedAt: Date.now(),
      busy: false,
    });
    log(`预加载 ${file}（context ${PRELOAD_CONTEXT}，${((Date.now() - t0) / 1000).toFixed(1)}s）`);
    return {
      file,
      ok: true,
      resident: true,
      seconds: +((Date.now() - t0) / 1000).toFixed(1),
      contextSize: PRELOAD_CONTEXT,
      sizeGB: +(st.size / 1024 ** 3).toFixed(2),
    };
  } catch (err) {
    try {
      await context?.dispose();
    } catch {}
    try {
      await model.dispose();
    } catch {}
    throw err;
  }
}

async function disposeExtra(file) {
  const ex = extras.get(file);
  if (!ex) return false;
  extras.delete(file);
  try {
    await ex.context?.dispose();
  } catch {}
  try {
    await ex.model?.dispose();
  } catch {}
  log(`释放预加载 ${file}`);
  return true;
}

async function clearExtras() {
  const files = [...extras.keys()];
  for (const f of files) await disposeExtra(f);
  return files;
}

/**
 * 用常驻模型作答：独立序列 + 一次性会话，不碰 state.*，也不做 KV 复用
 * （第二意见是一次性的，复用收益为零，反而会跟主模型的 KV 抢内存）。
 *
 * 模板与思考段拆分复用主链路的同一个函数，避免两套实现分叉。
 */
async function generateWithExtra(file, { messages, maxTokens, temperature }) {
  const ex = extras.get(file);
  if (!ex) throw new Error("该模型没有预加载");
  if (ex.busy) throw new Error("这个模型正在作答，稍等");
  ex.busy = true;
  let session = null;
  let sequence = null;
  try {
    const system =
      messages
        .filter((m) => m.role === "system")
        .map((m) => (typeof m.content === "string" ? m.content : ""))
        .join("\n")
        .trim() || DEFAULT_SYSTEM;
    const history = toHistory(messages);
    const lastUser = history.filter((h) => h.type === "user").pop();
    if (!lastUser) throw new Error("缺少 user 消息");
    const priorHistory = history.slice(0, history.length - 1);

    // thinking 一律关：第二意见走 noThink 模板，R1 那类内联 think 由 splitThinking 拆
    const chatWrapper = ex.wrappers.noThink ?? "auto";
    sequence = ex.context.getSequence();
    session = new LlamaChatSession({
      contextSequence: sequence,
      chatWrapper,
      systemPrompt: system || undefined,
    });
    session.setChatHistory([...initialHistory(chatWrapper, system), ...priorHistory]);

    const t0 = Date.now();
    const meta = await session.promptWithMeta(lastUser.text, { maxTokens, temperature });
    const totalMs = Date.now() - t0;
    const split = splitThinking(meta.responseText ?? "");
    const reasoning = split.thought.trim();
    let text = split.content.trim();
    if (!text) {
      text = reasoning
        ? `（全部 token 都用在了思考上，没有得出最终结论。以下是它的推理过程）\n\n${reasoning}`
        : "（这次没有收到内容）";
    }
    const completionTokens = tokenCount(ex.model, meta.responseText ?? "");
    const sec = Math.max(totalMs / 1000, 0.001);
    return {
      content: text,
      reasoning,
      usage: { completion_tokens: completionTokens, total_tokens: completionTokens },
      metrics: {
        completionTokens,
        totalTokens: completionTokens,
        totalMs,
        genMs: totalMs,
        tokPerSec: +(completionTokens / sec).toFixed(2),
        preloaded: true,
      },
      preloaded: true,
      loadSeconds: 0,
    };
  } finally {
    try {
      session?.dispose();
    } catch {}
    try {
      await sequence?.dispose();
    } catch {}
    ex.busy = false;
  }
}

/**
 * 让被 @ 的模型对同一个问题补一段看法。
 *
 * 一台机器同时只装得下一个模型，所以这里必然是「临时换人 + 换回来」：
 * 换回来的代价是主模型的 KV 缓存作废，下一轮要重新预填充——这是硬件决定的，
 * 值得在 UI 上把这两步的耗时直接摊给用户看。
 */
async function handleSecondOpinion(req, res) {
  let body;
  try {
    body = await readBody(req);
  } catch (e) {
    const code = e?.code === "BODY_TOO_LARGE" ? 413 : 400;
    return sendJson(res, code, { error: { message: e?.message ?? "JSON 解析失败" } });
  }
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (!messages.length) return sendJson(res, 400, { error: { message: "缺少 messages" } });
  const originalFile = state.file;
  if (!originalFile) return sendJson(res, 409, { error: { message: "当前没有已加载的模型" } });

  const targets = [];
  for (const t of Array.isArray(body.models) ? body.models : []) {
    const f = String(t ?? "").trim();
    if (!f || f === originalFile) continue;
    if (f.includes("/") || f.includes("\\") || f.includes("..")) continue;
    if (!targets.includes(f)) targets.push(f);
  }
  if (!targets.length) return sendJson(res, 400, { error: { message: "没有可征询的模型" } });

  const known = new Set((await scanModels()).map((m) => m.file));
  const unknown = targets.filter((f) => !known.has(f));
  if (unknown.length) return sendJson(res, 400, { error: { message: `模型不存在：${unknown.join("、")}` } });

  const originalCtx = state.contextSize || DEFAULT_CONTEXT;
  const maxTokens = Math.max(128, Math.min(2048, Number(body.max_tokens) || 900));
  const temperature = Number.isFinite(Number(body.temperature)) ? Number(body.temperature) : 0.7;

  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    "x-accel-buffering": "no",
  });
  const send = (obj) => {
    try {
      res.write(`data: ${JSON.stringify(obj)}\n\n`);
    } catch {}
  };

  let restored = false;
  let swapped = false; // 是否真的动过主模型（决定最后要不要装回来）
  // 已预加载的直接作答：不碰主模型，主模型的 KV 缓存因此完整保留
  const residents = targets.filter((f) => extras.has(f));
  const swappers = targets.filter((f) => !extras.has(f));
  try {
    for (const target of residents) {
      const t0 = Date.now();
      send({ phase: "thinking", model: target, preloaded: true });
      const out = await generateWithExtra(target, { messages, maxTokens, temperature });
      send({
        phase: "answer",
        model: target,
        content: out.content,
        reasoning: out.reasoning,
        usage: out.usage,
        metrics: out.metrics,
        preloaded: true,
        seconds: +((Date.now() - t0) / 1000).toFixed(1),
      });
    }
    // 换人前先释放常驻模型：否则峰值是「主模型 + 常驻 + 目标」三份权重，正好压死内存
    if (swappers.length && extras.size) {
      log(`第二意见需要换模型，先释放 ${extras.size} 个预加载模型以腾出内存`);
      send({ phase: "releasing", count: extras.size });
      await clearExtras();
    }
    for (const target of swappers) {
      const t0 = Date.now();
      send({ phase: "loading", model: target });
      const lr = await loadModel(target, originalCtx);
      swapped = true;
      send({ phase: "thinking", model: target, loadSeconds: lr.seconds });
      const cap = makeMemoryResponse();
      await handleChat(
        { messages, max_tokens: maxTokens, temperature, stream: false, tools: false },
        cap.res,
      );
      let parsed = null;
      try {
        parsed = JSON.parse(cap.text());
      } catch {}
      if (!parsed) throw new Error("第二意见没有返回内容（服务可能刚重启，再试一次）");
      if (parsed.error) throw new Error(String(parsed.error?.message ?? "第二意见生成失败"));
      const m = parsed.choices?.[0]?.message ?? {};
      send({
        phase: "answer",
        model: target,
        content: String(m.content ?? ""),
        reasoning: String(m.reasoning_content ?? ""),
        usage: parsed.usage ?? null,
        metrics: parsed.metrics ?? null,
        seconds: +((Date.now() - t0) / 1000).toFixed(1),
      });
    }
  } catch (err) {
    const msg = String(err?.message ?? err);
    log("第二意见失败:", msg);
    send({ phase: "error", message: msg });
  } finally {
    // 只有真换过模型才需要装回来；全程走预加载时主模型压根没动过，不能白丢一次 KV
    if (swapped) {
      send({ phase: "restoring", model: originalFile });
      try {
        await loadModel(originalFile, originalCtx);
        restored = true;
      } catch (err) {
        log("恢复主模型失败:", String(err?.message ?? err));
        send({ phase: "restore-failed", model: originalFile, message: String(err?.message ?? err) });
      }
    } else {
      restored = true; // 主模型仍在原地
    }
    send({ phase: "done", restored, swapped });
    try {
      res.end();
    } catch {}
  }
}

// ---------------------------------------------------------------- 本地模型嗅探
/**
 * 目标：用户把 .gguf 下到下载目录/桌面/别的软件目录里，也能被直接发现并收进模型列表，
 * 不必手动拷到 MODEL_DIR。
 *
 * 三条设计约束：
 *  1) 只读所有候选位置，绝不改动源文件；收录时优先建硬链接（同盘瞬间完成、不占空间）。
 *  2) 全盘遍历可能很久，所以有深度上限、文件数上限和时间预算，超了就老实报告 truncated。
 *  3) Ollama 的模型是内容寻址的 blob（没有 .gguf 后缀），靠魔数 + manifest 反查名字。
 */
const DISCOVERY_FILE = path.join(MODEL_DIR, "workspace", "discovery.json");
const GGUF_MAGIC = Buffer.from("GGUF", "ascii");
const SCAN_MAX_FILES = 60000;
const SCAN_MAX_DEPTH = 6;
const SCAN_TIME_BUDGET_MS = 15000;
/** 小到不可能是模型的直接跳过（空壳文件、占位符） */
const SCAN_MIN_BYTES = 1024 * 1024;
/** 遍历时一律不进的目录：系统目录、包目录，进去只会浪费时间 */
const SKIP_DIRS = new Set([
  "node_modules", "$recycle.bin", "system volume information", "windows", "winsxs",
  "program files", "program files (x86)", "appdata", "drivers", "venv", "site-packages",
  "obj", "bin", "cache2", "gpucache", "code cache",
]);

function defaultDiscovery() {
  return { v: 1, onboarded: false, customDirs: [], lastScanAt: 0, lastScanCount: 0 };
}

async function readDiscovery() {
  try {
    const j = JSON.parse(await readFile(DISCOVERY_FILE, "utf8"));
    const d = defaultDiscovery();
    return {
      ...d,
      onboarded: j.onboarded === true,
      customDirs: Array.isArray(j.customDirs) ? j.customDirs.filter((x) => typeof x === "string").slice(0, 20) : [],
      lastScanAt: Number(j.lastScanAt) || 0,
      lastScanCount: Number(j.lastScanCount) || 0,
    };
  } catch {
    return defaultDiscovery();
  }
}

async function writeDiscovery(patch) {
  const cur = await readDiscovery();
  const next = {
    ...cur,
    ...(typeof patch.onboarded === "boolean" ? { onboarded: patch.onboarded } : {}),
    ...(Array.isArray(patch.customDirs)
      ? {
          customDirs: patch.customDirs
            .map((s) => String(s).trim())
            .filter(Boolean)
            .slice(0, 20),
        }
      : {}),
  };
  await mkdir(path.dirname(DISCOVERY_FILE), { recursive: true });
  await writeFile(DISCOVERY_FILE, JSON.stringify(next, null, 2), "utf8");
  return next;
}

/**
 * 盘符级的常见目录（<盘>:\Models、<盘>:\AI）：按本机真实存在的盘生成，不写死 D:。
 * 只做 existsSync 判断，不遍历子目录，代价可忽略。
 */
function driveRoots() {
  const drives = new Set();
  for (const base of [MODEL_DIR, process.cwd(), process.env.SystemDrive || "C:\\"]) {
    const root = path.parse(path.resolve(base)).root;
    if (root) drives.add(root);
  }
  for (const letter of ["C", "D", "E", "F", "G"]) drives.add(letter + ":\\");
  const out = [];
  for (const root of drives) {
    for (const name of ["Models", "AI"]) {
      const dir = path.join(root, name);
      if (existsSync(dir)) out.push({ dir, kind: "generic", label: dir });
    }
  }
  return out;
}

/** 常见位置：只返回这台机器上真实存在的 */
function commonRoots() {
  const home = os.homedir();
  const list = [
    { dir: path.join(home, "Downloads"), kind: "generic", label: "下载目录" },
    { dir: path.join(home, "Desktop"), kind: "generic", label: "桌面" },
    { dir: path.join(home, "Documents"), kind: "generic", label: "文档" },
    { dir: path.join(home, ".cache", "lm-studio", "models"), kind: "lmstudio", label: "LM Studio" },
    { dir: path.join(home, ".ollama", "models"), kind: "ollama", label: "Ollama" },
    { dir: path.join(process.env.APPDATA ?? "", "CherryStudio"), kind: "cherrystudio", label: "CherryStudio" },
    { dir: path.join(home, ".cherrystudio"), kind: "cherrystudio", label: "CherryStudio" },
    ...driveRoots(),
    { dir: path.join(home, "AppData", "Local", "Programs", "Ollama"), kind: "ollama", label: "Ollama(程序目录)" },
  ];
  return list.filter((r) => r.dir && path.isAbsolute(r.dir));
}

async function existingRoots() {
  const out = [];
  for (const r of commonRoots()) {
    const ok = await stat(r.dir).then((s) => s.isDirectory()).catch(() => false);
    if (ok) out.push(r);
  }
  return out;
}

/** 只读文件头 4 字节判断是不是 GGUF——比按后缀猜可靠，Ollama blob 就靠它 */
async function isGguf(file) {
  let fh = null;
  try {
    fh = await open(file, "r");
    const buf = Buffer.alloc(4);
    const { bytesRead } = await fh.read(buf, 0, 4, 0);
    return bytesRead === 4 && buf.equals(GGUF_MAGIC);
  } catch {
    return false;
  } finally {
    if (fh) await fh.close().catch(() => {});
  }
}

/**
 * 解析 Ollama 的 manifests，把 sha256 blob 映射回「模型名:tag」。
 * 结构：manifests/registry.ollama.ai/library/<name>/<tag> → JSON 里 layers[].digest
 */
async function ollamaBlobNames() {
  const map = new Map();
  const root = path.join(os.homedir(), ".ollama", "models", "manifests");
  const walk = async (dir, depth) => {
    if (depth > 4) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full, depth + 1);
      else if (e.isFile()) {
        try {
          const j = JSON.parse(await readFile(full, "utf8"));
          const layers = Array.isArray(j.layers) ? j.layers : [];
          const modelLayer = layers.find((l) => String(l?.mediaType ?? "").includes("model"));
          const digest = String(modelLayer?.digest ?? "");
          if (!digest.startsWith("sha256:")) continue;
          const rel = path.relative(root, full).split(path.sep);
          // registry.ollama.ai/library/qwen2.5/7b → qwen2.5:7b
          const name = rel.slice(-2);
          if (name.length === 2) map.set("sha256-" + digest.slice(7), `${name[0]}:${name[1]}`);
        } catch {}
      }
    }
  };
  await walk(root, 0);
  return map;
}

/** 广度优先遍历，带深度/文件数/时间三重上限 */
async function walkForModels(dir, kind, state, out) {
  const queue = [{ dir, depth: 0 }];
  while (queue.length) {
    if (Date.now() - state.startedAt > SCAN_TIME_BUDGET_MS) {
      state.truncated = true;
      return;
    }
    const { dir: cur, depth } = queue.shift();
    let entries;
    try {
      entries = await readdir(cur, { withFileTypes: true });
    } catch {
      state.errors += 1;
      continue;
    }
    for (const e of entries) {
      state.files += 1;
      if (state.files > SCAN_MAX_FILES) {
        state.truncated = true;
        return;
      }
      const full = path.join(cur, e.name);
      if (e.isDirectory()) {
        if (depth >= SCAN_MAX_DEPTH) continue;
        const low = e.name.toLowerCase();
        if (SKIP_DIRS.has(low) || low.startsWith(".")) continue;
        queue.push({ dir: full, depth: depth + 1 });
      } else if (e.isFile()) {
        const low = e.name.toLowerCase();
        if (low.endsWith(".gguf") || (kind === "ollama" && low.startsWith("sha256-"))) {
          out.push({ file: full, kind });
        }
      }
    }
  }
}

/** MODEL_DIR 里已有同名同大小的，就算「已收录」，不重复列出 */
async function existingModelIndex() {
  const idx = new Map();
  let entries = [];
  try {
    entries = await readdir(MODEL_DIR, { withFileTypes: true });
  } catch {
    return idx;
  }
  for (const e of entries) {
    if (!e.isFile() || !/\.gguf$/i.test(e.name)) continue;
    const full = path.join(MODEL_DIR, e.name);
    const sz = await stat(full).then((s) => s.size).catch(() => 0);
    idx.set(`${e.name.toLowerCase()}|${sz}`, full);
  }
  return idx;
}

function safeModelName(base, ollamaName) {
  const raw = ollamaName ? ollamaName.replace(/[:/\\]/g, "-") : path.basename(base, path.extname(base));
  const cleaned = String(raw).replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").trim().slice(0, 120);
  return (cleaned || "model") + ".gguf";
}

async function scanForModels({ includeDefaults = true, dirs = [] } = {}) {
  const startedAt = Date.now();
  const seenRoots = new Set();
  const roots = [];
  const pushRoot = (r) => {
    const norm = path.resolve(r.dir).toLowerCase();
    if (seenRoots.has(norm)) return;
    seenRoots.add(norm);
    roots.push(r);
  };
  for (const d of dirs) {
    const s = String(d ?? "").trim();
    if (!s || !path.isAbsolute(s)) continue;
    pushRoot({ dir: s, kind: "custom", label: s });
  }
  if (includeDefaults) for (const r of await existingRoots()) pushRoot(r);
  // 模型主目录本身也扫（能发现用户手工放进去但没被识别的东西，通常是分片）
  pushRoot({ dir: MODEL_DIR, kind: "generic", label: "模型目录" });

  const state = { startedAt, files: 0, truncated: false, errors: 0 };
  const raw = [];
  for (const r of roots) await walkForModels(r.dir, r.kind, state, raw);

  const ollamaNames = await ollamaBlobNames();
  const existing = await existingModelIndex();
  const byPath = new Map();
  for (const item of raw) {
    if (byPath.has(item.file)) continue;
    byPath.set(item.file, item);
  }

  const modelRoot = path.resolve(MODEL_DIR).toLowerCase();
  const candidates = [];
  for (const item of byPath.values()) {
    // 模型目录第一层的文件本来就出现在模型选项卡里，再列一遍全是「已收录」噪音；
    // 只保留更深层的（典型是被手工丢进去、没人认领的分片）
    if (path.dirname(path.resolve(item.file)).toLowerCase() === modelRoot) continue;
    // 分片模型只认第一片，其余的单独收录进来只会是个坏模型
    const baseName = path.basename(item.file);
    if (isShard(baseName) && !isFirstShard(baseName)) continue;
    const st = await stat(item.file).catch(() => null);
    if (!st || !st.isFile() || st.size < SCAN_MIN_BYTES) continue;
    if (!(await isGguf(item.file))) continue;
    const ollamaName = item.kind === "ollama" ? ollamaNames.get(path.basename(item.file)) : undefined;
    const targetName = safeModelName(item.file, ollamaName);
    const already = existing.get(`${targetName.toLowerCase()}|${st.size}`) !== undefined
      || existing.get(`${path.basename(item.file).toLowerCase()}|${st.size}`) !== undefined;
    candidates.push({
      path: item.file,
      name: ollamaName ? `${ollamaName}（Ollama）` : path.basename(item.file),
      targetName,
      sizeBytes: st.size,
      sizeGB: +(st.size / 1024 ** 3).toFixed(2),
      mtime: st.mtimeMs,
      kind: item.kind,
      already,
    });
  }
  candidates.sort((a, b) => b.sizeBytes - a.sizeBytes || a.path.localeCompare(b.path));

  const result = {
    candidates,
    roots: roots.map((r) => ({ dir: r.dir, kind: r.kind, label: r.label })),
    scannedFiles: state.files,
    truncated: state.truncated,
    errors: state.errors,
    ms: Date.now() - startedAt,
  };
  await writeDiscovery({ lastScanAt: Date.now(), lastScanCount: candidates.length }).catch(() => {});
  log(`嗅探完成：${candidates.length} 个候选，遍历 ${state.files} 个文件，${result.ms}ms${state.truncated ? "（已截断）" : ""}`);
  return result;
}

/** 收录：同盘建硬链接（瞬间、不占空间），跨盘退回复制 */
async function adoptModel(srcPath) {
  const src = path.resolve(String(srcPath ?? ""));
  const st = await stat(src).catch(() => null);
  if (!st || !st.isFile()) throw new Error("文件不存在或不是普通文件");
  if (st.size < SCAN_MIN_BYTES) throw new Error("文件太小，不像是模型");
  if (!(await isGguf(src))) throw new Error("不是 GGUF 文件（文件头不是 GGUF）");
  const srcBase = path.basename(src);
  // 只链第一片：把 -00002-of-00003 单独链进来，模型是加载不起来的
  if (isShard(srcBase) && !isFirstShard(srcBase)) {
    throw new Error("这是分片模型的后续分片，请收录第一片所在的整个目录");
  }

  const ollamaNames = path.resolve(src).toLowerCase().includes(`${path.sep}.ollama${path.sep}`)
    ? await ollamaBlobNames()
    : new Map();
  const base = safeModelName(src, ollamaNames.get(path.basename(src)));

  await mkdir(MODEL_DIR, { recursive: true });
  let target = path.join(MODEL_DIR, base);
  // 重名：同名同大小视为已收录；同名不同大小就换个名字，别覆盖用户的模型
  for (let i = 2; i < 100; i += 1) {
    const t = await stat(target).catch(() => null);
    if (!t) break;
    if (t.size === st.size) return { ok: true, method: "existing", target, name: path.basename(target) };
    target = path.join(MODEL_DIR, base.replace(/\.gguf$/i, `-${i}.gguf`));
  }

  const sameVolume =
    path.parse(src).root.toLowerCase() === path.parse(MODEL_DIR).root.toLowerCase();
  let method = "hardlink";
  if (sameVolume) {
    try {
      await link(src, target);
    } catch {
      method = "copy";
      await copyFile(src, target);
    }
  } else {
    method = "copy";
    await copyFile(src, target);
  }
  const name = path.basename(target);
  log(`收录模型 ${name}（${method === "hardlink" ? "硬链接" : "复制"}）← ${src}`);
  return { ok: true, method, target, name };
}

async function handle(req, res) {
  const url = (req.url ?? "").split("?")[0];

  if (req.method === "GET" && (url === "/" || url === "/index.html")) {
    try {
      const html = await readFile(UI, "utf8");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(html);
    } catch (err) {
      return sendJson(res, 500, { error: { message: `app.html 读取失败: ${err.message}` } });
    }
  }

  if (req.method === "GET" && url === "/health") {
    return sendJson(res, 200, { status: "ok", model: state.file, context: state.contextSize, gpu: state.gpu });
  }

  // 首次启动「自动检查用户配置」：硬件体检 + 推荐模型/上下文/后端
  // ---------------------------------------------------------------- 显卡（Vulkan 设备）
  // 「独显调动入口」：列出 llama 看到的 Vulkan 设备，把选择写进 config.ini 的 vkDevices。
  // 真正生效要重启：GGML_VK_VISIBLE_DEVICES 只在 llama 初始化时读一次。
  if (url === "/api/gpus") {
    if (req.method === "GET") {
      const names = gpuDeviceNames;
      const cim = detectGpus();
      const vramOf = (name) => {
        const key = String(name || "").toLowerCase();
        const hit = cim.find((g) => {
          const gn = String(g.name || "").toLowerCase();
          return !!gn && (gn === key || gn.includes(key.slice(0, 10)) || key.includes(gn.slice(0, 10)));
        });
        return hit?.vramGB ?? null;
      };
      const cfgNow = String((await readConfigIni()).vkDevices ?? "").trim();
      const current = String(process.env.GGML_VK_VISIBLE_DEVICES ?? "").trim();
      return sendJson(res, 200, {
        ok: true,
        backend: state.gpu ?? "",
        pref: GPU_PREF,
        devices: names.map((name, i) => ({ index: i, name, vramGB: vramOf(name) })),
        current,
        config: cfgNow,
        needRestart: current !== cfgNow,
        configWritable: existsSync(path.join(HERE, "..", "config.ini")),
        note: names.length ? "" : (state.gpu === "vulkan" ? "Vulkan 后端没报出设备名" : "当前是 CPU 后端，没有可选的 Vulkan 设备"),
      });
    }
    if (req.method === "POST") {
      let body = {};
      try { body = await readBody(req); } catch {}
      const raw = body.devices === undefined ? "" : String(body.devices).trim();
      let list = [];
      if (raw !== "") {
        list = [...new Set(raw.split(",").map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && n >= 0))].sort((a, b) => a - b);
        if (!list.length) return sendJson(res, 400, { error: { message: "设备号无效：要逗号分隔的非负整数，例如 0 或 0,1" } });
        if (gpuDeviceNames.length && list.some((n) => n >= gpuDeviceNames.length)) {
          return sendJson(res, 400, { error: { message: "设备号越界：当前只有 " + gpuDeviceNames.length + " 个 Vulkan 设备（0.." + (gpuDeviceNames.length - 1) + "）" } });
        }
      }
      const canonical = list.join(",");
      const r = await updateConfigFile(path.join(HERE, "..", "config.ini"), { vkDevices: canonical });
      return sendJson(res, 200, {
        ok: true,
        config: canonical,
        saved: r.wrote === true,
        needRestart: true,
        note: r.wrote ? "已写入 config.ini，重启应用后生效" : "开发目录没有 config.ini，没写盘；可用环境变量 GGML_VK_VISIBLE_DEVICES 测试",
      });
    }
  }

  if (req.method === "GET" && url === "/api/sysinfo") {
    return sendJson(res, 200, await buildSysinfo());
  }

  // 一键按建议配置：写 config.ini +（模型已在本地就）立即按推荐上下文加载
  if (req.method === "POST" && url === "/api/firstrun/apply") {
    let body = {};
    try { body = await readBody(req); } catch {}
    try {
      return sendJson(res, 200, await applyFirstRunConfig(body));
    } catch (e) {
      return sendJson(res, 500, { ok: false, error: { message: String(e?.message ?? e) } });
    }
  }
  // ---------------------------------------------------------------- 调试面板（Debugging Tool）
  if (req.method === "GET" && (url === "/debug" || url === "/debug.html")) {
    try {
      const html = await readFile(DEBUG_UI, "utf8");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      return res.end(html);
    } catch (e) {
      return sendJson(res, 500, { error: { message: "debug.html 读不到：" + String(e?.message ?? e) } });
    }
  }

  // 调试工具自己的图标（∂ + AI + ?），用于调试窗口的标题栏 / favicon
  if (req.method === "GET" && url === "/debug-icon.png") {
    try {
      const buf = await readFile(path.join(HERE, "debug-icon-64.png"));
      res.writeHead(200, { "content-type": "image/png", "cache-control": "max-age=3600" });
      return res.end(buf);
    } catch {
      res.writeHead(404);
      return res.end();
    }
  }

  if (req.method === "GET" && url === "/debug-icon.ico") {
    try {
      const buf = await readFile(path.join(HERE, "debug.ico"));
      res.writeHead(200, { "content-type": "image/x-icon", "cache-control": "max-age=3600" });
      return res.end(buf);
    } catch {
      res.writeHead(404);
      return res.end();
    }
  }

  if (req.method === "GET" && url === "/api/diag") {
    return sendJson(res, 200, await buildDiag());
  }

  // 实时资源（CPU/内存/磁盘/进程/模型）：调试页 2 秒轮询，只读、不需要令牌
  if (req.method === "GET" && url === "/api/diag/resources") {
    return sendJson(res, 200, await buildResources());
  }

  if (req.method === "GET" && url.startsWith("/api/diag/logs")) {
    const q = new URL(req.url, "http://127.0.0.1");
    const which = q.searchParams.get("which") === "crash" ? "crash" : "app";
    const lines = Math.min(2000, Math.max(20, Number(q.searchParams.get("lines")) || 200));
    const file = which === "crash" ? CRASH_LOG : (logCandidates().find((p) => existsSync(p)) || logCandidates()[0]);
    const t = await tailText(file, lines);
    return sendJson(res, 200, { which, file, ...t });
  }


  // 诊断历史（只读）：页面「诊断历史」卡与 CLI --history 用
  if (req.method === "GET" && url.startsWith("/api/diag/history")) {
    const q = new URL(req.url, "http://127.0.0.1");
    const hours = Number(q.searchParams.get("hours")) || 24;
    const limit = Number(q.searchParams.get("limit")) || 200;
    await loadDiagHistory();
    return sendJson(res, 200, diagHistoryView(hours, limit));
  }

  // 导出诊断包（zip）：页面「导出诊断包」与 CLI --export 都走这里
  if (req.method === "POST" && url === "/api/diag/export") {
    if (req.headers["x-local-token"] !== LOCAL_TOKEN) {
      return sendJson(res, 403, { error: { message: "缺少或错误的本地令牌，拒绝导出诊断包" } });
    }
    try {
      const bundle = await buildDiagBundle();
      res.writeHead(200, {
        "content-type": "application/zip",
        "content-disposition": 'attachment; filename="' + bundle.name + '"',
        "content-length": String(bundle.zip.length),
        "cache-control": "no-store",
      });
      log("调试面板：导出诊断包 " + bundle.name + "（" + bundle.zip.length + " 字节 / " + bundle.entries + " 个文件）");
      return res.end(bundle.zip);
    } catch (e) {
      return sendJson(res, 500, { ok: false, error: { message: "导出诊断包失败：" + String(e?.message ?? e) } });
    }
  }

  // 打开目录（程序目录 / 日志 / 模型 / 会话 / 工作区）：调试页三个按钮用
  if (req.method === "POST" && url === "/api/diag/open-path") {
    if (req.headers["x-local-token"] !== LOCAL_TOKEN) {
      return sendJson(res, 403, { error: { message: "缺少或错误的本地令牌，拒绝打开目录" } });
    }
    let body = {};
    try { body = await readBody(req); } catch { return sendJson(res, 400, { error: { message: "请求体不是合法 JSON" } }); }
    const which = String(body?.which || "");
    const targets = {
      dir: HERE,
      logs: path.dirname(logCandidates().find((p) => existsSync(p)) || logCandidates()[0]),
      modelDir: MODEL_DIR,
      sessions: SESSION_DIR,
      workspace: WORKSPACE,
    };
    if (!Object.prototype.hasOwnProperty.call(targets, which)) {
      return sendJson(res, 400, { error: { message: "不认识的目录：" + (which || "（空）") + "；可选 dir / logs / modelDir / sessions / workspace" } });
    }
    const target = targets[which];
    if (!existsSync(target)) return sendJson(res, 404, { error: { message: "目录不存在：" + target } });
    try {
      const child = spawn("explorer.exe", [target], { detached: true, stdio: "ignore", windowsHide: true });
      child.unref();
      log("调试面板：打开目录 " + which + " → " + target);
      return sendJson(res, 200, { ok: true, which, path: target });
    } catch (e) {
      return sendJson(res, 500, { ok: false, error: { message: "打开目录失败：" + String(e?.message ?? e) } });
    }
  }

  if (req.method === "POST" && url === "/api/diag/clear-crash") {
    if (req.headers["x-local-token"] !== LOCAL_TOKEN) {
      return sendJson(res, 403, { error: { message: "缺少或错误的本地令牌，拒绝清理崩溃记录" } });
    }
    let removed = false;
    try { await unlink(CRASH_LOG); removed = true; } catch {}
    log("调试面板：清理崩溃记录 " + (removed ? "成功" : "（本来就没有）"));
    return sendJson(res, 200, { ok: true, removed, exists: existsSync(CRASH_LOG) });
  }

  // 独立程序：localai-debug.mjs 自己起窗口，主程序只负责拉起它
  if (req.method === "POST" && url === "/api/debug/open") {
    if (req.headers["x-local-token"] !== LOCAL_TOKEN) {
      return sendJson(res, 403, { error: { message: "缺少或错误的本地令牌，拒绝打开调试工具" } });
    }
    // 首选：独立的 DebugTool.exe（自带 ico，标题栏/任务栏清晰）
    // 回退：node localai-debug.mjs --ui（用 Edge 应用模式开窗，图标来自 favicon，可能偏软）
    const exe = path.join(HERE, "..", "DebugTool.exe");
    const script = path.join(HERE, "localai-debug.mjs");
    try {
      let child;
      if (existsSync(exe)) {
        child = spawn(exe, [`http://127.0.0.1:${PORT}/debug`], {
          cwd: path.dirname(exe), detached: true, stdio: "ignore", windowsHide: false,
        });
        log("打开调试工具（DebugTool.exe，pid " + child.pid + "）");
      } else if (existsSync(script)) {
        child = spawn(process.execPath, [script, "--ui", "--base", `http://127.0.0.1:${PORT}`], {
          cwd: HERE, detached: true, stdio: "ignore", windowsHide: false,
        });
        log("打开调试工具（localai-debug.mjs --ui，pid " + child.pid + "）");
      } else {
        return sendJson(res, 500, { error: { message: "调试工具缺失（DebugTool.exe 与 localai-debug.mjs 都没有）" } });
      }
      child.unref();
      return sendJson(res, 200, { ok: true, pid: child.pid, exe: existsSync(exe) });
    } catch (e) {
      return sendJson(res, 500, { error: { message: "启动调试工具失败：" + String(e?.message ?? e) } });
    }
  }

  if (req.method === "GET" && url === "/api/version") {
    return sendJson(res, 200, versionInfo());
  }

  // ---- 视觉 sidecar（图片入口）：状态 + 启停 ----
  if (req.method === "GET" && url === "/api/vision/state") {
    return sendJson(res, 200, await visionState());
  }

  if (req.method === "POST" && url === "/api/vision/start") {
    let body = {};
    try {
      body = await readBody(req);
    } catch (e) {
      const code = e?.code === "BODY_TOO_LARGE" ? 413 : 400;
      return sendJson(res, code, { error: { message: e?.message ?? "JSON 解析失败" } });
    }
    try {
      const st = await startVision({ model: body.model, mmproj: body.mmproj });
      return sendJson(res, 200, st);
    } catch (err) {
      return sendJson(res, err?.status || 500, { error: { message: String(err?.message ?? err) } });
    }
  }

  if (req.method === "POST" && url === "/api/vision/stop") {
    try {
      return sendJson(res, 200, await stopVision());
    } catch (err) {
      return sendJson(res, 500, { error: { message: String(err?.message ?? err) } });
    }
  }

  if (req.method === "GET" && url === "/api/state") {
    return sendJson(res, 200, {
      models: await scanModels(),
      modelDir: MODEL_DIR,
      // 版本三件套：出问题时用户只要报这一行，就能对上代码与构建时间
      version: APP_VERSION,
      build: { commit: BUILD.commit, commitAt: BUILD.commitAt, builtAt: BUILD.builtAt, source: BUILD.source, dirty: BUILD.dirty },
      startedAt: STARTED_AT,
      loaded: state.file,
      context: state.contextSize,
      layers: state.layers,
      gpu: state.gpu,
    backendNote: backendNote.text,
      loading: state.loading,
      restarting: state.restarting,
      error: state.error,
      hasJinja: state.hasJinja,
      supportsThinking: state.supportsThinking,
      localToken: LOCAL_TOKEN,
      activeChats,
      // KV 缓存复用状态：cachedTokens 是当前常驻序列里已经评估过的 token 数
      kvReuse: KV_REUSE,
      kvQuant: state.kvQuant,
      kvQuantFallback: state.kvQuantFallback,
      kvQuantActual: kvCacheInfo(),
      cachedTokens: state.sequence?.nextTokenIndex ?? 0,
      draftFile: state.draftFile,
      draftTokens: DRAFT_TOKENS,
      draftDisabledReason: state.draftDisabledReason,
      // 多回答预加载的常驻模型（内存账要一起看）
      preloadContext: PRELOAD_CONTEXT,
      extras: extrasSummary(),
    });
  }

  if (req.method === "POST" && url === "/api/load") {
    if (activeChats > 0) {
      return sendJson(res, 409, {
        error: { message: "有对话正在进行，先等它结束（或在界面点停止）再切换模型" },
      });
    }
    let body;
    try {
      body = await readBody(req);
    } catch (e) {
      const code = e?.code === "BODY_TOO_LARGE" ? 413 : 400;
      return sendJson(res, code, { error: { message: e?.message ?? "JSON 解析失败" } });
    }
    if (!body.file) return sendJson(res, 400, { error: { message: "缺少 file 参数" } });
    // 防目录穿越：只允许模型目录内的文件名
    if (body.file.includes("/") || body.file.includes("\\") || body.file.includes("..")) {
      return sendJson(res, 400, { error: { message: "非法的文件名" } });
    }
    // 内存互斥：文本模型与视觉 sidecar 不同时驻留
    if (vision.active > 0) {
      return sendJson(res, 409, { error: { message: "有视觉请求正在进行，先等它结束再加载文本模型" } });
    }
    if (vision.starting) {
      return sendJson(res, 409, { error: { message: "视觉模型正在启动，请稍后再加载文本模型" } });
    }
    if (visionRunning()) {
      log("加载文本模型前先停视觉 sidecar（内存互斥）");
      await stopVision();
    }
    // 用户手动加载了模型 → 取消「看完图自动装回」的待执行任务，免得把刚选的模型顶掉
    clearVisionRestore();
    vision.lastText = null;
    try {
      const r = await loadModel(body.file, Number(body.contextSize ?? DEFAULT_CONTEXT));
      return sendJson(res, 200, { ok: true, ...r, context: state.contextSize, layers: state.layers });
    } catch (err) {
      return sendJson(res, 500, { error: { message: String(err?.message ?? err) } });
    }
  }

  // 删除模型文件（破坏性）：需令牌；dryRun 只做校验并返回「将会删掉哪些文件」
  if (req.method === "POST" && url === "/api/models/delete") {
    if (req.headers["x-local-token"] !== LOCAL_TOKEN) {
      return sendJson(res, 403, { error: { message: "缺少或错误的本地令牌，拒绝删除模型" } });
    }
    let body;
    try { body = await readBody(req); } catch (e) {
      return sendJson(res, 400, { error: { message: e?.message ?? "JSON 解析失败" } });
    }
    try {
      const r = await deleteModelFiles(body?.file, { dryRun: Boolean(body?.dryRun) });
      return sendJson(res, 200, r);
    } catch (e) {
      return sendJson(res, e?.status || 500, { ok: false, error: { message: String(e?.message ?? e) } });
    }
  }

  if (req.method === "POST" && url === "/api/unload") {
    if (activeChats > 0) {
      return sendJson(res, 409, { error: { message: "有对话正在进行，无法卸载模型" } });
    }
    await unloadModel();
    // 显式「卸载」意味着把内存还回去，预加载的常驻模型一并释放
    const freed = await clearExtras();
    return sendJson(res, 200, { ok: true, freedExtras: freed.length });
  }

  if (req.method === "POST" && url === "/api/shutdown") {
    // 破坏性操作：必须带同源页面从 /api/state 拿到的令牌。
    // 外部网页无法读取该令牌（同源策略），也无法带自定义头（无 CORS 授权）。
    if (req.headers["x-local-token"] !== LOCAL_TOKEN) {
      return sendJson(res, 403, { error: { message: "缺少或错误的本地令牌，拒绝退出" } });
    }
    if (activeChats > 0) {
      return sendJson(res, 409, { error: { message: "有对话正在进行，无法退出服务" } });
    }
    sendJson(res, 200, { ok: true });
    log("收到退出指令，正在关闭 ...");
    setTimeout(() => process.exit(0), 300);
    return;
  }

  // ---- 导出对话：服务端落盘，WebView2 里比浏览器下载可靠 ----
  if (req.method === "POST" && url === "/api/export") {
    let body;
    try {
      body = await readBody(req);
    } catch (e) {
      const code = e?.code === "BODY_TOO_LARGE" ? 413 : 400;
      return sendJson(res, code, { error: { message: e?.message ?? "JSON 解析失败" } });
    }
    const md = String(body.markdown ?? "");
    if (!md.trim()) return sendJson(res, 400, { error: { message: "内容为空" } });
    try {
      const dir = path.join(MODEL_DIR, "workspace");
      await mkdir(dir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
      const full = path.join(dir, `chat-${stamp}.md`);
      await writeFile(full, md, "utf8");
      log(`导出对话: ${path.basename(full)}（${md.length} 字）`);
      return sendJson(res, 200, { ok: true, path: full });
    } catch (err) {
      return sendJson(res, 500, { error: { message: String(err?.message ?? err) } });
    }
  }
  // ---- 代码工作区：Agent 模式代码收录 / 模型审查 ----
  if (req.method === "POST" && url === "/api/code/capture") return handleCodeCapture(req, res);
  if (req.method === "POST" && url === "/api/code/review") return handleCodeReview(req, res);

  // ---- 工作区（文件管理） ----
  if (url.startsWith("/api/workspace/")) {
    const act = url.slice("/api/workspace/".length);
    const qs = new URLSearchParams((req.url ?? "").split("?")[1] ?? "");
    try {
      if (req.method === "GET" && act === "list") return sendJson(res, 200, await wsList(qs.get("dir") ?? ""));
      if (req.method === "GET" && act === "read") return sendJson(res, 200, await wsRead(qs.get("path") ?? ""));
      if (req.method === "POST") {
        let body = {};
        try {
          body = await readBody(req);
        } catch (e) {
          const code = e?.code === "BODY_TOO_LARGE" ? 413 : 400;
          return sendJson(res, code, { error: { message: e?.message ?? "JSON 解析失败" } });
        }
        if (act === "save") return sendJson(res, 200, await wsSave(body.path, body.content));
        if (act === "mkdir") {
          const full = wsResolve(body.path);
          if (!wsRel(full)) throw new Error("非法目录");
          await mkdir(full, { recursive: true });
          return sendJson(res, 200, { path: wsRel(full) });
        }
        if (act === "rename") {
          const from = wsResolve(body.from);
          const to = wsResolve(body.to);
          if (!wsRel(from) || !wsRel(to)) throw new Error("非法路径");
          await rename(from, to);
          return sendJson(res, 200, { path: wsRel(to) });
        }
        if (act === "delete") {
          const full = wsResolve(body.path);
          if (!wsRel(full)) throw new Error("不能删工作区根目录");
          const st = await stat(full);
          if (st.isDirectory()) {
            const left = await readdir(full);
            if (left.length) throw new Error("目录不为空，先清空里面的文件");
            await rmdir(full);
          } else {
            await unlink(full);
          }
          return sendJson(res, 200, { ok: true });
        }
        if (act === "upload") {
          const full = wsResolve(body.path);
          if (!wsRel(full)) throw new Error("非法路径");
          const buf = Buffer.from(String(body.data ?? ""), "base64");
          if (!buf.length) throw new Error("空文件");
          if (buf.length > WS_MAX_UPLOAD) throw new Error("文件超过 10MB");
          await mkdir(path.dirname(full), { recursive: true });
          await writeFile(full, buf);
          return sendJson(res, 200, { path: wsRel(full), size: buf.length });
        }
        return sendJson(res, 405, { error: { message: "不支持的操作" } });
      }
      return sendJson(res, 405, { error: { message: "不支持的方法" } });
    } catch (err) {
      return sendJson(res, 400, { error: { message: String(err?.message ?? err) } });
    }
  }

  // ---- 本地模型嗅探：配置 / 扫描 / 收录 ----
  // ---------------------------------------------------------------- 模型下载
  // ---------------------------------------------------------------- 插件
  if (req.method === "GET" && url === "/api/plugins") {
    return sendJson(res, 200, {
      dir: PLUGIN_DIR,
      loadedAt: pluginState.loadedAt,
      items: pluginState.items.map((x) => ({
        file: x.file, name: x.name, ok: x.ok, disabled: Boolean(x.disabled),
        description: x.ok && !x.disabled ? x.description : "", error: x.ok ? "" : x.error,
      })),
    });
  }
  if (req.method === "POST" && url === "/api/plugins/reload") {
    await loadPlugins();
    return sendJson(res, 200, { ok: true, count: activePlugins().length, items: pluginState.items.length });
  }
  if (req.method === "POST" && url === "/api/plugins/toggle") {
    let body;
    try { body = await readBody(req); } catch (e) {
      return sendJson(res, 400, { error: { message: e?.message ?? "JSON 解析失败" } });
    }
    const file = String(body?.file ?? "");
    if (!/^[A-Za-z0-9._-]+\.(mjs|js)$/i.test(file)) return sendJson(res, 400, { error: { message: "非法的插件文件名" } });
    const cfg = await readPluginConfig();
    const off = new Set(cfg.disabled);
    if (body.enabled) off.delete(file);
    else off.add(file);
    await writePluginConfig({ disabled: [...off] });
    await loadPlugins();
    log("插件" + (body.enabled ? "启用" : "禁用") + " " + file);
    return sendJson(res, 200, {
      ok: true,
      count: activePlugins().length,
      items: pluginState.items.map((x) => ({
        file: x.file, name: x.name, ok: x.ok, disabled: Boolean(x.disabled),
        description: x.ok && !x.disabled ? x.description : "", error: x.ok ? "" : x.error,
      })),
    });
  }
  if (req.method === "POST" && url === "/api/plugins/open") {
    try {
      const child = spawn("explorer.exe", [PLUGIN_DIR], { detached: true, stdio: "ignore" });
      child.unref();
      return sendJson(res, 200, { ok: true, dir: PLUGIN_DIR });
    } catch (e) {
      return sendJson(res, 500, { error: { message: String(e?.message ?? e) } });
    }
  }

  // ---------------------------------------------------------------- 首次使用引导
  if (url === "/api/onboarding") {
    if (req.method === "GET") {
      const o = await readOnboarding();
      const models = await scanModels().catch(() => []);
      return sendJson(res, 200, {
        done: Boolean(o.done),
        readmeShown: Boolean(o.readmeShown),
        scannedAt: o.scannedAt ?? 0,
        models: models.length,
      });
    }
    if (req.method === "POST") {
      let body = {};
      try { body = await readBody(req); } catch {}
      const o = await readOnboarding();
      const next = {
        ...o,
        done: body.done === undefined ? Boolean(o.done) : Boolean(body.done),
        // 首启「使用说明」弹窗是否已经看过：只看服务端这份状态，和浏览器 localStorage 无关
        readmeShown: body.readmeShown === undefined ? Boolean(o.readmeShown) : Boolean(body.readmeShown),
        scannedAt: body.scanned ? Date.now() : (o.scannedAt ?? 0),
        updatedAt: Date.now(),
      };
      await mkdir(path.dirname(ONBOARD_FILE), { recursive: true });
      await writeFile(ONBOARD_FILE, JSON.stringify(next, null, 2), "utf8");
      return sendJson(res, 200, { ok: true, ...next });
    }
  }

  // ---------------------------------------------------------------- 使用说明（README）
  if (req.method === "GET" && url === "/api/readme") {
    const o = await readOnboarding().catch(() => ({}));
    const r = await loadReadme();
    return sendJson(res, 200, {
      name: APP_NAME,
      version: APP_VERSION,
      seen: Boolean(o.readmeShown),
      markdown: r.markdown,
      source: r.source,
    });
  }
  if (req.method === "GET" && url === "/api/download/catalog") {
    return sendJson(res, 200, {
      channels: [
        { id: "modelscope", label: "ModelScope（国内，推荐）", ok: true },
        { id: "manual", label: "其他通道 / 自定义链接", ok: true },
      ],
      models: DOWNLOAD_CATALOG,
      states: downloadState(),
    });
  }
  if (req.method === "GET" && url === "/api/download/state") {
    return sendJson(res, 200, downloadState());
  }
  if (req.method === "POST" && url === "/api/download/start") {
    if (req.headers["x-local-token"] !== LOCAL_TOKEN) {
      return sendJson(res, 403, { error: { message: "缺少本地令牌，拒绝下载" } });
    }
    let body;
    try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { error: { message: e?.message ?? "JSON 解析失败" } }); }
    let target = null;
    if (body.id) {
      target = DOWNLOAD_CATALOG.find((m) => m.id === String(body.id));
      if (!target) return sendJson(res, 400, { error: { message: "未知的下载项" } });
    } else if (body.url) {
      // 「其他通道」：任何 http(s) 直链，文件名从链接末尾推
      const u = String(body.url);
      if (!/^https?:\/\//i.test(u)) return sendJson(res, 400, { error: { message: "只接受 http(s) 链接" } });
      const guess = decodeURIComponent(u.split("?")[0].split("/").pop() || "download.gguf");
      const name = String(body.name ?? guess).replace(/[^A-Za-z0-9._-]+/g, "_");
      if (!/\.gguf$/i.test(name)) return sendJson(res, 400, { error: { message: "文件名必须以 .gguf 结尾" } });
      target = { id: "manual", channel: "manual", label: name, file: name, url: u, sizeMB: 0, note: "自定义链接" };
    } else {
      return sendJson(res, 400, { error: { message: "缺少 id 或 url" } });
    }
    try {
      const r = await startDownload(target);
      return sendJson(res, 200, { ok: true, file: r.file, totalMB: Number((r.total / 1048576).toFixed(1)) });
    } catch (e) {
      return sendJson(res, 409, { error: { message: String(e?.message ?? e) } });
    }
  }
  if (req.method === "POST" && url === "/api/download/cancel") {
    if (req.headers["x-local-token"] !== LOCAL_TOKEN) {
      return sendJson(res, 403, { error: { message: "缺少本地令牌" } });
    }
    const r = cancelDownload();
    return sendJson(res, 200, { ok: true, ...r });
  }
  if (url === "/api/discover/config") {
    try {
      if (req.method === "GET") {
        const d = await readDiscovery();
        return sendJson(res, 200, {
          ...d,
          modelDir: MODEL_DIR,
          home: os.homedir(),
          common: commonRoots(),
          existing: await existingRoots(),
        });
      }
      if (req.method === "POST") {
        let body = {};
        try {
          body = await readBody(req);
        } catch (e) {
          const code = e?.code === "BODY_TOO_LARGE" ? 413 : 400;
          return sendJson(res, code, { error: { message: e?.message ?? "JSON 解析失败" } });
        }
        return sendJson(res, 200, await writeDiscovery(body ?? {}));
      }
      return sendJson(res, 405, { error: { message: "不支持的方法" } });
    } catch (err) {
      return sendJson(res, 500, { error: { message: String(err?.message ?? err) } });
    }
  }

  if (req.method === "POST" && url === "/api/discover/scan") {
    let body = {};
    try {
      body = await readBody(req);
    } catch (e) {
      const code = e?.code === "BODY_TOO_LARGE" ? 413 : 400;
      return sendJson(res, code, { error: { message: e?.message ?? "JSON 解析失败" } });
    }
    try {
      const cfg = await readDiscovery();
      const dirs = Array.isArray(body.dirs) && body.dirs.length ? body.dirs : cfg.customDirs;
      const result = await scanForModels({ includeDefaults: body.includeDefaults !== false, dirs });
      return sendJson(res, 200, result);
    } catch (err) {
      return sendJson(res, 500, { error: { message: String(err?.message ?? err) } });
    }
  }

  if (req.method === "POST" && url === "/api/discover/adopt") {
    let body = {};
    try {
      body = await readBody(req);
    } catch (e) {
      const code = e?.code === "BODY_TOO_LARGE" ? 413 : 400;
      return sendJson(res, code, { error: { message: e?.message ?? "JSON 解析失败" } });
    }
    const paths = Array.isArray(body.paths) ? body.paths.slice(0, 50) : [];
    if (!paths.length) return sendJson(res, 400, { error: { message: "没有选中要收录的模型" } });
    const results = [];
    for (const p of paths) {
      try {
        results.push({ path: p, ...(await adoptModel(p)) });
      } catch (err) {
        results.push({ path: p, ok: false, error: String(err?.message ?? err) });
      }
    }
    return sendJson(res, 200, { results, models: await scanModels() });
  }

  // ---- 自动标题：让主模型起个短标题（独立 512 小 context，不碰对话的 KV） ----
  if (req.method === "POST" && url.startsWith("/api/sessions/") && url.endsWith("/auto-title")) {
    return handleAutoTitle(res, url);
  }

  // ---- 会话备份：设置 / 立即备份 / 可选的磁盘列表 ----
  if (url === "/api/backup") {
    if (req.method === "GET") {
      const config = await readBackupConfig();
      let dir = "";
      try { dir = resolveBackupDir(config.dir); } catch {}
      const sessions = (await listSessionFiles()).length;
      return sendJson(res, 200, {
        config,
        dir,
        dirError: config.dir && !dir ? "当前配置的目录不合法" : "",
        sameDrive: sameDriveAsModel(dir),
        modelRoot: path.parse(path.resolve(MODEL_DIR)).root,
        sessionDir: SESSION_DIR,
        sessions,
        running: backupState.running,
        lastRunAt: backupState.lastRunAt,
        status: backupState.lastResult,
      });
    }
    if (req.method === "POST") {
      let body;
      try { body = await readBody(req); } catch (e) {
        return sendJson(res, e?.code === "BODY_TOO_LARGE" ? 413 : 400, { error: { message: e?.message ?? "JSON 解析失败" } });
      }
      let dir = "";
      try { dir = resolveBackupDir(body.dir); } catch (e) {
        return sendJson(res, 400, { error: { message: String(e?.message ?? e) } });
      }
      if (body.enabled && !dir) return sendJson(res, 400, { error: { message: "先填一个备份目录，再打开自动备份" } });
      // 保存时就把目录建出来试写一次：盘没插/没权限当场报，而不是等半夜备份失败
      if (dir) {
        try { await ensureDirWritable(dir); } catch (e) {
          return sendJson(res, 400, { error: { message: "备份目录不可写：" + String(e?.message ?? e) } });
        }
      }
      const config = await writeBackupConfig({ enabled: Boolean(body.enabled), dir, keepDays: body.keepDays, intervalMin: body.intervalMin });
      log("会话备份设置：" + (config.enabled ? "开" : "关") + " → " + (config.dir || "（未设置）"));
      return sendJson(res, 200, { config, dir: config.dir, sameDrive: sameDriveAsModel(config.dir), sessions: (await listSessionFiles()).length });
    }
    return sendJson(res, 405, { error: { message: "不支持的方法" } });
  }
  if (url === "/api/backup/run" && req.method === "POST") {
    const r = await runBackup("manual");
    if (r.skipped === "no-dir") return sendJson(res, 400, { error: { message: "还没设置备份目录" } });
    if (r.skipped === "busy") return sendJson(res, 409, { error: { message: "上一次备份还没跑完" } });
    return sendJson(res, 200, { ...r, sameDrive: sameDriveAsModel(r.dir) });
  }
  if (url === "/api/backup/drives" && req.method === "GET") {
    return sendJson(res, 200, { drives: await listDrives(), modelRoot: path.parse(path.resolve(MODEL_DIR)).root, sessionDir: SESSION_DIR });
  }

  // ---- 从备份恢复：列出备份里的会话 / 用备份覆盖本机的那一份 ----
  if (req.method === "GET" && url === "/api/backup/sessions") {
    const cfg = await readBackupConfig();
    let dir = "";
    try { dir = resolveBackupDir(cfg.dir); } catch { dir = ""; }
    if (!dir) return sendJson(res, 400, { error: { message: "还没设置备份目录" } });
    const files = (await readdir(path.join(dir, "sessions")).catch(() => [])).filter((f) => f.toLowerCase().endsWith(".json"));
    const list = [];
    for (const f of files.slice(0, 200)) {
      const full = path.join(dir, "sessions", f);
      let st;
      try { st = await stat(full); } catch { continue; }
      let raw = null;
      try { raw = JSON.parse(await readFile(full, "utf8")); } catch {}
      const id = String(raw?.id ?? f.replace(/\.json$/i, ""));
      if (!SESSION_ID_RE.test(id)) continue;
      const messages = Array.isArray(raw?.messages) ? raw.messages : [];
      const cur = await readSession(id);
      list.push({
        id,
        title: String(raw?.title ?? "").trim() || deriveTitle(messages),
        messages: messages.length,
        turns: messages.filter((m) => m && m.role === "user").length,
        backupAt: Math.round(st.mtimeMs),
        bytes: st.size,
        inWorkspace: Boolean(cur),
        workspaceMessages: cur ? cur.messages.length : 0,
      });
    }
    list.sort((a, b) => b.backupAt - a.backupAt);
    return sendJson(res, 200, { dir, sessions: list });
  }
  if (req.method === "POST" && url === "/api/backup/restore") {
    if (req.headers["x-local-token"] !== LOCAL_TOKEN) {
      return sendJson(res, 403, { error: { message: "缺少本地令牌，拒绝从备份恢复" } });
    }
    let body;
    try { body = await readBody(req); } catch (e) {
      return sendJson(res, 400, { error: { message: e?.message ?? "JSON 解析失败" } });
    }
    const id = String(body?.id ?? "");
    if (!sessionFile(id)) return sendJson(res, 400, { error: { message: "非法的会话 id" } });
    const cfg = await readBackupConfig();
    let dir = "";
    try { dir = resolveBackupDir(cfg.dir); } catch { dir = ""; }
    if (!dir) return sendJson(res, 400, { error: { message: "还没设置备份目录" } });
    let raw = null;
    try { raw = JSON.parse(await readFile(path.join(dir, "sessions", id + ".json"), "utf8")); } catch {
      return sendJson(res, 404, { error: { message: "备份里没有这个会话" } });
    }
    // 走 writeSession：覆盖前会先留一份快照，所以恢复错了还能从「历史版本」撤回来
    const saved = await writeSession(id, {
      title: String(raw?.title ?? ""),
      messages: Array.isArray(raw?.messages) ? raw.messages : [],
      model: String(raw?.model ?? ""),
      renamed: Boolean(raw?.renamed),
    });
    log("从备份恢复会话 " + id + " ← " + dir);
    return sendJson(res, 200, { ok: true, id, messages: saved.messages?.length ?? 0, title: saved.displayTitle ?? saved.title ?? "" });
  }


  // ---- 文档检索（RAG：workspace 文档 → BM25） ----
  if (url === "/api/rag/status" && req.method === "GET") {
    await ragEnsure();
    return sendJson(res, 200, ragStatus());
  }
  if (url === "/api/rag/rebuild" && req.method === "POST") {
    const r = await ragEnsure(true);
    log("文档索引重建：" + r.files + " 个文件 / " + r.chunks + " 段");
    return sendJson(res, 200, Object.assign({ ok: true }, ragStatus(), r));
  }
  if (url.startsWith("/api/rag/search") && req.method === "GET") {
    const u = new URLSearchParams((req.url ?? "").split("?")[1] ?? "");
    const q = String(u.get("q") || "").trim();
    if (!q) return sendJson(res, 400, { error: { message: "缺少 q" } });
    await ragEnsure();
    const k = Math.min(20, Math.max(1, Number(u.get("k")) || 5));
    const hits = ragSearch(q, k);
    return sendJson(res, 200, {
      q,
      count: hits.length,
      hits: hits.map((h) => ({ file: h.file, score: Math.round(h.score * 100) / 100, text: h.text.slice(0, 600) })),
      status: ragStatus(),
    });
  }
  // ---- 工具清单（只读，给界面与探针看） ----
  if (url === "/api/tools" && req.method === "GET") {
    const reg = buildToolRegistry([], null, { web: true });
    return sendJson(res, 200, {
      tools: reg.defs.map((d) => ({ name: d.name, description: d.description, params: Object.keys((d.params && d.params.properties) || {}) })),
    });
  }
  // ---- 会话搜索：标题 + 正文，返回第一条命中附近的片段 ----
  if (req.method === "GET" && url.startsWith("/api/sessions/search")) {
    const u = new URLSearchParams((req.url ?? "").split("?")[1] ?? "");
    const q = String(u.get("q") || "").trim();
    if (!q) return sendJson(res, 200, { q, total: 0, sessions: [], truncated: false });
    if (q.length > 100) return sendJson(res, 400, { error: { message: "搜索词太长（最多 100 字）" } });
    const needle = q.toLowerCase();
    const all = await listSessions();
    const results = [];
    let scanned = 0;
    for (const s of all) {
      if (results.length >= 50) break;
      const full = sessionFile(s.id);
      if (!full) continue;
      let raw = null;
      try { raw = JSON.parse(await readFile(full, "utf8")); } catch { continue; }
      scanned += 1;
      const msgs = Array.isArray(raw.messages) ? raw.messages.slice(0, 400) : [];
      const title = String(raw.title ?? "").trim() || s.title;
      let hits = 0;
      let snippet = "";
      const countIn = (str) => {
        const low = String(str).toLowerCase();
        let n = 0;
        let i = 0;
        while ((i = low.indexOf(needle, i)) >= 0) { n += 1; i += needle.length || 1; }
        return n;
      };
      hits += countIn(title);
      if (String(title).toLowerCase().includes(needle)) snippet = String(title);
      for (const m of msgs) {
        const c = String(m && m.content ? m.content : "");
        if (!c) continue;
        const n = countIn(c);
        if (!n) continue;
        hits += n;
        if (!snippet) {
          const i = c.toLowerCase().indexOf(needle);
          const from = Math.max(0, i - 36);
          snippet = c.slice(from, i + needle.length + 60).replace(/\s+/g, " ").trim();
          if (from > 0) snippet = "…" + snippet;
        }
      }
      if (hits) results.push({ id: s.id, title, model: s.model, updatedAt: s.updatedAt, turns: s.turns, hits, snippet });
    }
    results.sort((a, b) => b.updatedAt - a.updatedAt);
    return sendJson(res, 200, { q, total: results.length, sessions: results, scanned });
  }

  // ---- 多会话（对话列表）：/api/sessions 与 /api/sessions/<id> ----
  // ---- 会话历史版本：列表 / 回滚。回滚前同样会留档，所以回滚本身也能撤销 ----
  if (req.method === "GET" && /^\/api\/sessions\/[^/]+\/snapshots$/.test(url)) {
    const id = decodeURIComponent(url.slice("/api/sessions/".length, -"/snapshots".length));
    if (!sessionFile(id)) return sendJson(res, 400, { error: { message: "非法" + "的会话 id" } });
    const days = await readdir(SNAPSHOT_DIR).catch(() => []);
    const list = [];
    for (const day of days.sort().reverse()) {
      const files = await readdir(path.join(SNAPSHOT_DIR, day)).catch(() => []);
      for (const f of files.sort().reverse()) {
        if (!f.startsWith(id + ".")) continue;
        const full = path.join(SNAPSHOT_DIR, day, f);
        let size = 0;
        try { size = (await stat(full)).size; } catch { continue; }
        let messages = null, title = "";
        if (size < 1024 * 1024) {
          try {
            const j = JSON.parse(await readFile(full, "utf8"));
            messages = Array.isArray(j.messages) ? j.messages.length : 0;
            title = String(j.title ?? "");
          } catch {}
        }
        list.push({ file: day + "/" + f, day, size, messages, title });
      }
    }
    return sendJson(res, 200, { snapshots: list.slice(0, 40), dir: SNAPSHOT_DIR, keepDays: SNAPSHOT_DAYS });
  }
  if (req.method === "POST" && /^\/api\/sessions\/[^/]+\/restore$/.test(url)) {
    if (req.headers["x-local-token"] !== LOCAL_TOKEN) {
      return sendJson(res, 403, { error: { message: "缺少本地令牌，拒绝回滚" } });
    }
    const id = decodeURIComponent(url.slice("/api/sessions/".length, -"/restore".length));
    if (!sessionFile(id)) return sendJson(res, 400, { error: { message: "非法" + "的会话 id" } });
    let body;
    try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { error: { message: e?.message ?? "JSON 解析失败" } }); }
    const rel = String(body.file ?? "");
    const day = path.dirname(rel);
    const base = path.basename(rel);
    // 只认 <yyyy-mm-dd>/<id>.<hh-mm-ss>.json，杜绝 path traversal
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !base.startsWith(id + ".") || !/\.json$/.test(base)) {
      return sendJson(res, 400, { error: { message: "非法" + "的快照名" } });
    }
    let snap;
    try {
      snap = JSON.parse(await readFile(path.join(SNAPSHOT_DIR, day, base), "utf8"));
    } catch {
      return sendJson(res, 404, { error: { message: "快照不存在或已损坏" } });
    }
    const saved = await writeSession(id, {
      messages: Array.isArray(snap.messages) ? snap.messages : [],
      title: String(snap.title ?? ""),
      model: String(snap.model ?? ""),
      renamed: Boolean(snap.renamed),
    });
    log("会话回滚 " + id + " ← " + rel);
    return sendJson(res, 200, {
      ok: true,
      id,
      messages: saved.messages?.length ?? 0,
      title: saved.displayTitle ?? saved.title ?? "",
    });
  }
  if (url === "/api/sessions" || url.startsWith("/api/sessions/")) {
    const seg = url.slice("/api/sessions".length).replace(/^\//, "");
    try {
      if (!seg) {
        if (req.method === "GET") return sendJson(res, 200, { dir: SESSION_DIR, sessions: await listSessions() });
        if (req.method === "POST") {
          let body = {};
          try {
            body = await readBody(req);
          } catch (e) {
            const code = e?.code === "BODY_TOO_LARGE" ? 413 : 400;
            return sendJson(res, code, { error: { message: e?.message ?? "JSON 解析失败" } });
          }
          const id = newSessionId();
          const s = await writeSession(id, {
            title: String(body.title ?? ""),
            model: state.file ?? "",
            messages: Array.isArray(body.messages) ? body.messages : [],
          });
          log(`新建会话 ${id}`);
          return sendJson(res, 200, s);
        }
        return sendJson(res, 405, { error: { message: "不支持的方法" } });
      }
      if (!sessionFile(seg)) return sendJson(res, 400, { error: { message: "非法的会话 id" } });
      if (req.method === "GET") {
        const s = await readSession(seg);
        if (!s) return sendJson(res, 404, { error: { message: "会话不存在" } });
        return sendJson(res, 200, s);
      }
      if (req.method === "PUT" || req.method === "POST") {
        let body;
        try {
          body = await readBody(req);
        } catch (e) {
          const code = e?.code === "BODY_TOO_LARGE" ? 413 : 400;
          return sendJson(res, code, { error: { message: e?.message ?? "JSON 解析失败" } });
        }
        const s = await writeSession(seg, body ?? {});
        return sendJson(res, 200, { ok: true, id: s.id, title: s.title, updatedAt: s.updatedAt });
      }
      if (req.method === "DELETE") {
        // 删除前也留档：这是最容易丢数据的动作（10-25 那次 wipe 就是连删 13 条）
        try {
          const raw = await readFile(sessionFile(seg), "utf8");
          await snapshotBeforeWrite(seg, raw);
        } catch {}
        await unlink(sessionFile(seg)).catch(() => {});
        log(`删除会话 ${seg}`);
        return sendJson(res, 200, { ok: true, id: seg });
      }
      return sendJson(res, 405, { error: { message: "不支持的方法" } });
    } catch (err) {
      return sendJson(res, 500, { error: { message: String(err?.message ?? err) } });
    }
  }

  // ---- 多回答预加载：能力核算 → 预加载 → 释放 ----
  if (req.method === "GET" && (url === "/api/capacity" || url === "/api/preload")) {
    const q = (req.url ?? "").split("?")[1] ?? "";
    const files = [];
    for (const [k, v] of new URLSearchParams(q)) {
      if (k === "files" || k === "file") {
        for (const f of String(v).split(",")) {
          const s = f.trim();
          if (s && !s.includes("/") && !s.includes("\\") && !s.includes("..")) files.push(s);
        }
      }
    }
    try {
      if (url === "/api/preload") {
        return sendJson(res, 200, { extras: extrasSummary(), context: PRELOAD_CONTEXT });
      }
      return sendJson(res, 200, await capacityReport(files));
    } catch (err) {
      return sendJson(res, 500, { error: { message: String(err?.message ?? err) } });
    }
  }

  if (req.method === "POST" && url === "/api/preload") {
    let body = {};
    try {
      body = await readBody(req);
    } catch (e) {
      const code = e?.code === "BODY_TOO_LARGE" ? 413 : 400;
      return sendJson(res, code, { error: { message: e?.message ?? "JSON 解析失败" } });
    }
    const req_files = (Array.isArray(body.files) ? body.files : [])
      .map((f) => String(f ?? "").trim())
      .filter((f) => f && !f.includes("/") && !f.includes("\\") && !f.includes(".."));
    if (!req_files.length) return sendJson(res, 400, { error: { message: "没有指定要预加载的模型" } });

    // 硬闸：内存根本不够就不装。UI 里的弹窗是提醒，这里是不让步的那道。
    if (body.force !== true) {
      const cap = await capacityReport(req_files);
      if (cap.verdict === "insufficient") {
        return sendJson(res, 409, {
          error: { message: `内存不足，拒绝预加载：${cap.advice}`, capacity: cap },
        });
      }
    }
    if (!llama) return sendJson(res, 409, { error: { message: "推理引擎尚未初始化" } });

    const results = [];
    for (const f of req_files.slice(0, 4)) {
      try {
        results.push({ ...(await preloadModel(f)) });
      } catch (err) {
        const msg = String(err?.message ?? err);
        log(`预加载失败 ${f}:`, msg);
        results.push({ file: f, ok: false, error: msg });
      }
    }
    return sendJson(res, 200, { results, extras: extrasSummary() });
  }

  if (req.method === "POST" && url === "/api/preload/clear") {
    let body = {};
    try {
      body = await readBody(req);
    } catch {}
    const only = Array.isArray(body?.files) ? body.files.map((f) => String(f)) : [];
    // 释放清单由服务端给出（谁真的被释放了、多大），前端不要再用自己的快照去猜：
    // 页面里的 preloadExtras 会被 3 秒轮询改写，靠差集算"释放了谁"会漏提示
    const beforeList = extrasSummary().files;
    const targets = only.length ? only : beforeList.map((x) => x.file);
    const cleared = [];
    for (const f of targets) {
      const meta = beforeList.find((x) => x.file === f);
      if (await disposeExtra(f)) cleared.push({ file: f, sizeGB: meta?.sizeGB ?? 0 });
    }
    return sendJson(res, 200, { ok: true, freed: cleared.length, cleared, extras: extrasSummary() });
  }

  // ---- 第二意见：临时换上被 @ 的模型作答，答完把主模型装回来 ----
  if (req.method === "POST" && url === "/api/second-opinion") {
    return handleSecondOpinion(req, res);
  }

  // ---- 代码块运行 ----
  // 从界面里拉起命令行终端：开一个新的控制台窗口跑 app\localai.cmd（里面是 localai-tui）。
  // 用 start 而不是直接 spawn，是为了让 TUI 拿到真 TTY——没有 TTY 它只能降级成逐行模式。
  if (req.method === "POST" && url === "/api/terminal/open") {
    if (req.headers["x-local-token"] !== LOCAL_TOKEN) {
      return sendJson(res, 403, { error: { message: "缺少本地令牌，拒绝打开终端" } });
    }
    const cmdFile = path.join(HERE, "localai-tui.cmd");
    if (!existsSync(cmdFile)) {
      return sendJson(res, 500, { error: { message: "找不到 localai-tui.cmd：" + cmdFile } });
    }
    try {
      const child = spawn("cmd.exe", ["/c", "start", "", "localai-tui.cmd"], {
        cwd: HERE,
        detached: true,
        stdio: "ignore",
        windowsHide: false,
      });
      child.unref();
      log("已打开终端窗口");
      return sendJson(res, 200, { ok: true, cmd: cmdFile });
    } catch (e) {
      return sendJson(res, 500, { error: { message: String(e?.message ?? e) } });
    }
  }
  if (req.method === "GET" && url === "/api/run/langs") {
    return sendJson(res, 200, { langs: runLangInfo() });
  }
  if (req.method === "POST" && url === "/api/run") {
    if (req.headers["x-local-token"] !== LOCAL_TOKEN) {
      return sendJson(res, 403, { error: { message: "缺少本地令牌，拒绝执行" } });
    }
    let body;
    try {
      body = await readBody(req);
    } catch (e) {
      const code = e?.code === "BODY_TOO_LARGE" ? 413 : 400;
      return sendJson(res, code, { error: { message: e?.message ?? "JSON 解析失败" } });
    }
    const raw = String(body.lang ?? "").toLowerCase().trim();
    const lang = RUN_ALIAS[raw];
    if (!lang) return sendJson(res, 400, { error: { message: "暂不支持 " + (raw || "该语言") } });
    const code = String(body.code ?? "");
    if (!code.trim()) return sendJson(res, 400, { error: { message: "代码为空" } });
    if (code.length > RUN_CODE_LIMIT) return sendJson(res, 413, { error: { message: "代码太长（上限 200KB）" } });
    const result = await runCode(lang, code);
    if (result.error) return sendJson(res, 400, { error: { message: result.error } });
    log("运行代码", lang, "exit=" + result.code, result.ms + "ms");
    return sendJson(res, 200, result);
  }

  // ---- 语音合成 ----
  if (req.method === "GET" && url === "/api/tts/state") {
    return sendJson(res, 200, await ttsState());
  }

  if (req.method === "POST" && url === "/api/tts") {
    let body;
    try {
      body = await readBody(req);
    } catch (e) {
      const code = e?.code === "BODY_TOO_LARGE" ? 413 : 400;
      return sendJson(res, code, { error: { message: e?.message ?? "JSON 解析失败" } });
    }
    const st = await ttsState();
    const voiceId = String(body.voice ?? st.voices[0]?.id ?? "sapi:huihui");
    const speed = Math.max(0.6, Math.min(1.8, Number(body.speed) || 1));
    try {
      const t0 = Date.now();
      const out = await synthesize(String(body.text ?? ""), voiceId, speed);
      log(`TTS ${out.engine} ${voiceId} ${speed}x ${body.text?.length ?? 0} 字 → ${(out.buf.length / 1024).toFixed(0)} KB / ${Date.now() - t0}ms`);
      pruneTtsCache(); // 不等待
      res.writeHead(200, {
        "content-type": out.mime,
        "content-length": out.buf.length,
        "cache-control": "no-store",
      });
      return res.end(out.buf);
    } catch (err) {
      log("TTS 失败:", err?.message ?? err);
      return sendJson(res, 500, { error: { message: String(err?.message ?? err) } });
    }
  }

  if (req.method === "GET" && url.startsWith("/v1/models")) {
    return sendJson(res, 200, {
      object: "list",
      data: state.file
        ? [{ id: state.file.replace(/\.gguf$/i, ""), object: "model", created: 0, owned_by: "local" }]
        : [],
    });
  }

  if (req.method === "POST" && url.startsWith("/v1/chat/completions")) {
    let payload;
    try {
      payload = await readBody(req);
    } catch (e) {
      const code = e?.code === "BODY_TOO_LARGE" ? 413 : 400;
      return sendJson(res, code, { error: { message: e?.message ?? "JSON 解析失败" } });
    }
    // 带图请求（images 数组 或 content 里的 image_url）走视觉 sidecar，无图保持原来的 nlc 路径
    const visionHit = collectVisionImages(payload);
    if (visionHit.images.length || visionHit.hasContentImage) return handleVisionChat(payload, res);
    return handleChat(payload, res);
  }

  // ---- 本地静态资源（KaTeX 等），保持断网可用 ----
  if (req.method === "GET" && url.startsWith("/vendor/")) {
    let rel;
    try {
      rel = decodeURIComponent(url.slice("/vendor/".length));
    } catch {
      return sendJson(res, 400, { error: { message: "路径编码非法" } });
    }
    const VENDOR = path.join(HERE, "vendor");
    const full = path.resolve(VENDOR, rel);
    // 只允许读 vendor 目录内部的文件
    if (!full.startsWith(path.resolve(VENDOR) + path.sep)) {
      return sendJson(res, 400, { error: { message: "非法路径" } });
    }
    const types = {
      ".js": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".woff2": "font/woff2",
      ".woff": "font/woff",
      ".ttf": "font/ttf",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".json": "application/json; charset=utf-8",
    };
    const ct = types[path.extname(full).toLowerCase()];
    if (!ct) return sendJson(res, 404, { error: { message: "不支持的文件类型" } });
    try {
      const buf = await readFile(full);
      res.writeHead(200, {
        "content-type": ct,
        "content-length": buf.length,
        "cache-control": "public, max-age=86400",
      });
      return res.end(buf);
    } catch {
      return sendJson(res, 404, { error: { message: "文件不存在" } });
    }
  }

  sendJson(res, 404, { error: { message: `无此路由: ${req.method} ${url}` } });
}

// ---------------------------------------------------------------- 启动
// 便携版配置：契约面（环境变量）优先，其次 config.ini（开发目录没有该文件）
const CFG = await readConfigIni();
// 独显/设备选择：vkDevices = 逗号分隔的 Vulkan 设备号（空 = 全部设备）。
// GGML_VK_VISIBLE_DEVICES 必须在 llama 初始化之前进环境变量，所以放在启动段最早处读；
// 启动器（Launcher.cs）也会从同一个 config.ini 传这个值（发布包里走那条路）。
const VK_DEVICES_CFG = String(CFG.vkDevices ?? "").trim();
if (VK_DEVICES_CFG && !process.env.GGML_VK_VISIBLE_DEVICES) process.env.GGML_VK_VISIBLE_DEVICES = VK_DEVICES_CFG;
// 后端偏好：auto（默认，先试 Vulkan 再退 CPU）/ vulkan / cpu
const GPU_PREF = String(process.env.LOCALAI_GPU ?? CFG.gpu ?? "auto").toLowerCase();
/** 给界面看的后端说明：为什么是 CPU、缺什么 */
const backendNote = { text: "" };

/** 全新 Windows 最常见的坑：没有 MSVC 运行库，llama 原生模块直接加载不了 */
function hasMsvcp() {
  try {
    const sys = process.env.SystemRoot ?? "C:\\Windows";
    return existsSync(path.join(sys, "System32", "msvcp140.dll"));
  } catch {
    return false;
  }
}

log(`初始化 llama.cpp（偏好 ${GPU_PREF}）...`);
/** 崩溃记录：最近 10 分钟内崩溃两次以上，就别再赌 Vulkan 了，直接上 CPU */
const CRASH_LOG = path.join(HERE, "vulkan-crash.log");
async function recentCrashes() {
  try {
    const now = Date.now();
    const txt = await readFile(CRASH_LOG, "utf8");
    return txt
      .split("\n")
      .map((x) => Number(x.trim()))
      .filter((t) => t > 0 && now - t < 10 * 60 * 1000);
  } catch {
    return [];
  }
}
const crashes = await recentCrashes();
// build:"never" 很关键：默认的 "auto" 在找不到预编译包时会**悄悄去编译 llama.cpp**，
// 于是报出来的错误是 "spawn git ENOENT"（虚拟机里实测踩过），完全不指向真实原因。
// 禁止编译后，失败信息就是「预编译二进制加载不了」，配合下面的说明才说得通。
async function openLlama(gpu) {
  return await getLlama({ gpu, build: "never" });
}
function explain(err) {
  const msg = String(err?.message ?? err);
  if (/prebuilt|binary|addon|dlopen|LoadLibrary|module/i.test(msg) && !hasMsvcp()) {
    return msg + "\n\n最常见原因：系统缺少 Microsoft VC++ 运行库（msvcp140.dll）。" +
      "安装包目录里的 vc_redist.x64.exe（或 aka.ms/vs/17/release/vc_redist.x64.exe）后重新启动即可。";
  }
  return msg;
}

const wantVulkan = GPU_PREF !== "cpu";
const useCpu = GPU_PREF === "cpu" || crashes.length >= 2;
if (useCpu) {
  if (GPU_PREF === "cpu") {
    log("按配置强制使用 CPU 后端（config.ini 的 gpu=cpu）");
    backendNote.text = "已按配置强制使用 CPU";
  } else {
    log(`最近 10 分钟 Vulkan 崩溃 ${crashes.length} 次，改用 CPU 后端（更慢但稳定；删掉 ${CRASH_LOG} 可恢复 Vulkan）`);
    backendNote.text = "Vulkan 最近崩过两次，已自动切到 CPU";
  }
  llama = await openLlama(false);
  state.gpu = "cpu";
} else {
  try {
    llama = await openLlama("vulkan");
    state.gpu = "vulkan";
  } catch (err) {
    const why = explain(err);
    log("Vulkan 不可用，回退 CPU:", why);
    backendNote.text = "Vulkan 不可用，已回退 CPU：" + String(err?.message ?? err).slice(0, 160);
    llama = await openLlama(false);
    state.gpu = "cpu";
  }
}

/** llama 初始化后能列出的 Vulkan 设备名；数组顺序 = GGML_VK_VISIBLE_DEVICES 的编号（接口是 async） */
const gpuDeviceNames = await (async () => {
  try {
    const names = (await llama?.getGpuDeviceNames?.()) ?? [];
    return (Array.isArray(names) ? names : []).filter((n) => typeof n === "string" && n);
  } catch { return []; }
})();
if (gpuDeviceNames.length) {
  const vis = String(process.env.GGML_VK_VISIBLE_DEVICES ?? "").trim();
  log("Vulkan 设备：" + gpuDeviceNames.map((n, i) => i + "=" + n).join(" | ") + (vis ? "（只可见 " + vis + "）" : ""));
}

// ---------------------------------------------------------------- 代码块运行
/**
 * 执行页面里点「运行」的代码片段。
 * 限制：临时目录 + 10 秒超时 + 64KB 输出 + 进程树强杀；这不是安全沙箱，
 * 界面上必须写明"别运行来路不明的代码"。
 */
const RUN_TIMEOUT_MS = 10000;
/** 编译阶段单独放宽（冷机 MSVC/g++ 编译常 9–15s，和「运行 10s」混在一个超时里会误杀；见日志第三十四/五轮） */
const COMPILE_TIMEOUT_MS = 30000;
const RUN_OUT_LIMIT = 64 * 1024;
const RUN_CODE_LIMIT = 200 * 1024;
let runBusy = false;
let runLangsCache = null;
let runTools = null;

function whereExe(name) {
  try {
    const r = spawnSync("where.exe", [name], { windowsHide: true, encoding: "utf8", timeout: 4000 });
    if (r.status !== 0) return null;
    return (r.stdout || "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean)[0] || null;
  } catch {
    return null;
  }
}

let vsDevCmdCache;
function findVsDevCmd() {
  if (vsDevCmdCache !== undefined) return vsDevCmdCache;
  vsDevCmdCache = null;
  const vswhere = "C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe";
  if (!existsSync(vswhere)) return null;
  try {
    const r = spawnSync(vswhere, ["-latest", "-products", "*", "-property", "installationPath"], { encoding: "utf8", windowsHide: true, timeout: 6000 });
    const root = (r.stdout || "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean)[0];
    const bat = root ? path.join(root, "Common7", "Tools", "VsDevCmd.bat") : "";
    if (bat && existsSync(bat)) vsDevCmdCache = bat;
  } catch {}
  return vsDevCmdCache;
}

const RUN_ALIAS = {
  js: "javascript", javascript: "javascript", node: "javascript", mjs: "javascript",
  py: "python", python: "python", python3: "python",
  c: "c", cpp: "cpp", "c++": "cpp", cxx: "cpp", cc: "cpp",
  java: "java",
  go: "go", golang: "go",
  rust: "rust", rs: "rust",
};

function runLangInfo() {
  if (runLangsCache) return runLangsCache;
  const python = whereExe("python") || whereExe("python3") || (existsSync("C:\\Python314\\python.exe") ? "C:\\Python314\\python.exe" : null);
  const javac = whereExe("javac");
  const java = whereExe("java");
  const gpp = whereExe("g++");
  const clangpp = whereExe("clang++");
  const vc = findVsDevCmd();
  const go = whereExe("go");
  const rustc = whereExe("rustc");
  const cc = !!(gpp || clangpp || vc);
  runTools = { python, javac, java, gpp, clangpp, vc, go, rustc, node: process.execPath };
  runLangsCache = {
    javascript: { ok: true, label: "JavaScript" },
    python: { ok: !!python, label: "Python", hint: python ? "" : "未找到 python，装好后重启应用" },
    java: { ok: !!(javac && java), label: "Java", hint: javac && java ? "" : "未找到 JDK（javac/java），装好 JDK 17+ 后重启应用" },
    cpp: { ok: cc, label: "C++", hint: cc ? "" : "未找到 C++ 编译器（MSVC / g++ / clang++）" },
    c: { ok: cc, label: "C", hint: cc ? "" : "未找到 C 编译器（MSVC / g++ / clang++）" },
    go: { ok: !!go, label: "Go", hint: go ? "" : "未找到 go" },
    rust: { ok: !!rustc, label: "Rust", hint: rustc ? "" : "未找到 rustc" },
  };
  return runLangsCache;
}

function runSpawn(cmd, args, cwd, timeoutMs = RUN_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const env = Object.assign({}, process.env, { PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" });
    const child = spawn(cmd, args, { cwd, env, windowsHide: true });
    let out = "";
    let err = "";
    let truncated = false;
    let timedOut = false;
    let settled = false;
    const cap = (s, chunk) => {
      if (s.length >= RUN_OUT_LIMIT) {
        truncated = true;
        return s;
      }
      const next = s + chunk;
      if (next.length > RUN_OUT_LIMIT) {
        truncated = true;
        return next.slice(0, RUN_OUT_LIMIT);
      }
      return next;
    };
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
      } catch {}
    }, timeoutMs);
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    child.stdout.on("data", (b) => { out = cap(out, b.toString("utf8")); });
    child.stderr.on("data", (b) => { err = cap(err, b.toString("utf8")); });
    child.on("error", (e) => finish({ code: -1, out, err: err + String(e.message || e), timedOut, truncated }));
    child.on("close", (code) => finish({ code, out, err, timedOut, truncated }));
  });
}

function finishRun(lang, r, t0, build) {
  return {
    ok: r.code === 0 && !r.timedOut,
    lang,
    code: r.code,
    stdout: r.out,
    stderr: (build && build.out ? build.out : "") + r.err,
    ms: Date.now() - t0,
    timedOut: r.timedOut,
    truncated: r.truncated,
  };
}

async function runCode(lang, code) {
  const info = runLangInfo()[lang];
  if (!info) return { error: "暂不支持 " + lang };
  if (!info.ok) return { error: info.hint || lang + " 不可用" };
  if (runBusy) return { error: "上一次运行还没结束，稍等一下" };
  runBusy = true;
  const dir = await mkdtemp(path.join(os.tmpdir(), "localai-run-"));
  const t = runTools;
  const t0 = Date.now();
  try {
    if (lang === "javascript") {
      const file = path.join(dir, "main.js");
      await writeFile(file, code, "utf8");
      return finishRun(lang, await runSpawn(t.node, [file], dir), t0);
    }
    if (lang === "python") {
      const file = path.join(dir, "main.py");
      await writeFile(file, code, "utf8");
      return finishRun(lang, await runSpawn(t.python, ["-X", "utf8", file], dir), t0);
    }
    if (lang === "java") {
      const name = (code.match(/\bclass\s+([A-Za-z_$][\w$]*)/) || [])[1] || "Main";
      await writeFile(path.join(dir, name + ".java"), code, "utf8");
      const build = await runSpawn(t.javac, ["-encoding", "UTF-8", name + ".java"], dir);
      if (build.code !== 0) return finishRun(lang, build, t0);
      return finishRun(lang, await runSpawn(t.java, ["-Dfile.encoding=UTF-8", name], dir), t0, build);
    }
    if (lang === "go") {
      await writeFile(path.join(dir, "main.go"), code, "utf8");
      return finishRun(lang, await runSpawn(t.go, ["run", "main.go"], dir), t0);
    }
    if (lang === "rust") {
      await writeFile(path.join(dir, "main.rs"), code, "utf8");
      const build = await runSpawn(t.rustc, ["-O", "main.rs", "-o", "main.exe"], dir);
      if (build.code !== 0) return finishRun(lang, build, t0);
      return finishRun(lang, await runSpawn(path.join(dir, "main.exe"), [], dir), t0, build);
    }
    if (lang === "c" || lang === "cpp") {
      const src = lang === "c" ? "main.c" : "main.cpp";
      await writeFile(path.join(dir, src), code, "utf8");
      let build;
      if (t.gpp) {
        build = await runSpawn(t.gpp, ["-O2", "-std=" + (lang === "c" ? "c11" : "c++17"), src, "-o", "main.exe"], dir, COMPILE_TIMEOUT_MS);
      } else if (t.clangpp) {
        build = await runSpawn(t.clangpp, ["-O2", src, "-o", "main.exe"], dir, COMPILE_TIMEOUT_MS);
      } else {
        const bat = path.join(dir, "build.bat");
        const lines = [
          "@echo off",
          'call "' + t.vc + '" -arch=x64 -host_arch=x64 >nul 2>&1',
          "cl /nologo /EHsc /O2 /utf-8 " + src + " /Fe:main.exe >build.log 2>&1",
          "if errorlevel 1 (type build.log & exit /b 1)",
        ];
        await writeFile(bat, lines.join("\r\n"), "utf8");
        build = await runSpawn("cmd.exe", ["/d", "/c", bat], dir, COMPILE_TIMEOUT_MS);
        if (build.code !== 0) return finishRun(lang, build, t0);
        return finishRun(lang, await runSpawn(path.join(dir, "main.exe"), [], dir), t0, build);
      }
      if (build.code !== 0) return finishRun(lang, build, t0);
      return finishRun(lang, await runSpawn(path.join(dir, "main.exe"), [], dir), t0, build);
    }
    return { error: "暂不支持 " + lang };
  } finally {
    runBusy = false;
    rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    log("未捕获错误:", err);
    if (!res.headersSent) sendJson(res, 500, { error: { message: String(err?.message ?? err) } });
  });
});
server.requestTimeout = 0; // 加载大模型耗时长，禁用请求超时
server.headersTimeout = 0;
/** 进程号落盘：停止脚本/启动器在优雅退出失败时可以按它兜底 */
const PID_FILE = path.join(HERE, "server.pid");
server.listen(PORT, "127.0.0.1", () => {
  const tag = BUILD.commit
    ? ` (${BUILD.commit})`
    : BUILD.builtAt
      ? ` (打包 ${BUILD.builtAt.slice(0, 16).replace("T", " ")})`
      : "";
  log(`${APP_NAME} v${APP_VERSION}${tag} 已启动（${APP_SUB}）`);
  log(`界面 http://127.0.0.1:${PORT}/   API http://127.0.0.1:${PORT}/v1`);
  if (!existsSync(LLAMA_SERVER)) log("视觉组件缺失：找不到 " + LLAMA_SERVER + "（图片入口不可用；发布包应带 app/llama/llama-server.exe）");
  writeFile(PID_FILE, String(process.pid)).catch(() => {});
  // 启动时清一次过期快照；之后每次写盘顺带跑，成本只有几次 readdir
  pruneOldSnapshotDirs().catch(() => {});
  // 会话备份：启动先补一次，之后每分钟检查是否到点
  startBackupLoop();
  // 插件：读目录 + 起文件监听，改动即热重载
  loadPlugins().then(() => watchPlugins()).catch(() => {});
});
process.on("exit", () => {
  // 别把视觉 sidecar 留成孤儿：退出时连进程树一起杀掉
  try {
    if (vision.pid) killPidTree(vision.pid);
  } catch {}
  try {
    unlinkSync(PID_FILE);
  } catch {}
});

if (AUTO_LOAD) {
  const available = await scanModels();
  const hit = available.find((m) => m.file === AUTO_LOAD) ?? available.find((m) => m.label.includes(AUTO_LOAD));
  if (hit) {
    loadModel(hit.file, DEFAULT_CONTEXT).catch((e) => log("自动加载失败:", e.message));
  } else {
    // 新机器上配置里的模型往往还不存在（用户刚下的是另一个），这时退回最小的那个，
    // 总比让界面停在「先加载一个模型」好——首次引导下载完就能直接用。
    const fallback = [...available].sort((x, y) => x.sizeGB - y.sizeGB)[0];
    if (fallback) {
      log(`AUTO_LOAD 指定的模型未找到（${AUTO_LOAD}），改用最小的 ${fallback.file}`);
      loadModel(fallback.file, DEFAULT_CONTEXT).catch((e) => log("回退加载失败:", e.message));
    } else {
      log("模型目录是空的：等首次引导里下载一个");
    }
  }
}

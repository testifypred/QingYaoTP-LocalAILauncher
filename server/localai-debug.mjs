#!/usr/bin/env node
/**
 * QingYaoTP AILauncher · Debugging Tool（独立程序）
 *
 *   node localai-debug.mjs                       文本报告（服务没在跑也能给出本机诊断）
 *   node localai-debug.mjs --json                机器可读（给探针/脚本用）
 *   node localai-debug.mjs --ui                  打开调试界面（独立窗口）
 *   node localai-debug.mjs --logs [app|crash] [行数]
 *   node localai-debug.mjs --export [目录]        导出诊断包（服务没跑时生成离线版）
 *   node localai-debug.mjs --open <dir|logs|modelDir|sessions|workspace>
 *   node localai-debug.mjs --history [小时=24]    最近的诊断历史与变化
 *   node localai-debug.mjs --watch [秒=5] [--cycles N]
 *
 * 设计：它和主程序是两个进程。主程序只提供 /api/diag；这里负责「看」和「开窗」，
 * 所以服务真的挂了的时候，本程序仍然能告诉你：端口有没有人听、日志最后几行是什么、
 * 崩溃记录有几条、config.ini 与模型目录对不对，并且能直接打一个诊断包交出去。
 */
import { existsSync, readFileSync, statSync, mkdirSync, writeFileSync, openSync, readSync, closeSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const has = (f) => args.includes(f);

/** 取 --flag 后面的值；下一个参数又是开关时视为没给（--export 的目录是可选的） */
function nextValue(flag, d) {
  const i = args.indexOf(flag);
  if (i < 0) return d;
  const v = args[i + 1];
  return v && !v.startsWith("-") ? v : d;
}
/** 数字型可选参数（--history 小时、--watch 秒、--cycles 轮数） */
function numValue(flag, d) {
  const v = nextValue(flag, "");
  if (v === "") return d;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
}
/** 老写法：--base 这种一定会给值的参数 */
const val = (f, d) => nextValue(f, d);

const BASE = val("--base", process.env.LOCALAI_BASE || "http://127.0.0.1:8099");
const LEVEL = { error: "✗", warn: "!", ok: "✓" };
const WHICH = ["dir", "logs", "modelDir", "sessions", "workspace"];
const KNOWN_FLAGS = ["--base", "--json", "--ui", "--logs", "--export", "--open", "--history", "--watch", "--cycles", "--help", "-h"];

function line(s = "") { process.stdout.write(s + "\n"); }
const pad2 = (n) => String(n).padStart(2, "0");
const trimNum = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10));

/** 文件名用的时间戳：YYYYMMDD-HHMMSS */
function stampNow(d = new Date()) {
  return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + "-" + pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds());
}
function clockNow(d = new Date()) { return pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds()); }
function fmtLocal(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso == null ? "" : iso);
  return pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) + " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
}
function fmtBytes(n) {
  if (!Number.isFinite(n)) return "?";
  if (n < 1024) return n + " 字节";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / 1024 / 1024).toFixed(2) + " MB";
}
/** 把系统错误翻成人话：用户看到的是「怎么办」，不是 errno */
function humanErr(e) {
  const code = String(e?.code || "");
  if (code === "EACCES" || code === "EPERM") return "没有写权限（换一个可写目录试试，比如 %TEMP%）";
  if (code === "ENOTDIR") return "这个路径不是目录（检查 --export 后面是不是给了一个文件名）";
  if (code === "ENOENT") return "目录或路径不存在";
  if (code === "ENOSPC") return "磁盘满了";
  if (code === "EBUSY") return "文件正被占用（关掉占用它的窗口再试）";
  return String(e?.message ?? e).slice(0, 240);
}

// ---------------------------------------------------------------- HTTP（只连本机服务）

/**
 * 一次请求拿原始字节：导出接口返回 zip，其它接口返回 JSON。
 * 失败不抛栈——返回 status 0 + 人话 error，调用方决定怎么提示。
 */
async function request(p, { method = "GET", headers = {}, body, timeoutMs = 6000 } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(BASE + p, { method, headers, body, signal: ctl.signal });
    const buffer = Buffer.from(await r.arrayBuffer());
    const ct = String(r.headers.get("content-type") || "").toLowerCase();
    let j = null;
    if (!ct.includes("zip") && !ct.includes("octet-stream")) {
      try { j = JSON.parse(buffer.toString("utf8")); } catch {}
    }
    return { status: r.status, headers: r.headers, buffer, j, error: "" };
  } catch (e) {
    const msg = e?.name === "AbortError" ? "请求超时（" + Math.round(timeoutMs / 1000) + " 秒）" : String(e?.message ?? e);
    return { status: 0, headers: null, buffer: Buffer.alloc(0), j: null, error: msg };
  } finally {
    clearTimeout(t);
  }
}
async function getJson(p, timeoutMs = 5000) {
  const r = await request(p, { timeoutMs });
  return { status: r.status, j: r.j || {}, error: r.error };
}
async function postJson(p, obj, headers = {}, timeoutMs = 8000) {
  return request(p, { method: "POST", headers: Object.assign({ "content-type": "application/json" }, headers), body: JSON.stringify(obj == null ? {} : obj), timeoutMs });
}
/** 服务真的活着吗：/api/version 200 才算（端口被别的程序占了不算） */
async function serviceUp() {
  const v = await getJson("/api/version", 2500);
  return v.status === 200;
}
async function localToken() {
  const s = await getJson("/api/state", 5000);
  return s.status === 200 ? String(s.j?.localToken || "") : "";
}
/** 后端错误体里最像人话的那句 */
function apiError(r) {
  const e = r?.j?.error;
  if (e && typeof e === "object" && e.message) return String(e.message);
  if (typeof e === "string" && e) return e;
  return r?.error || "";
}

// ---------------------------------------------------------------- 读文件（日志可能是 UTF-16）

/**
 * 读日志尾部：只读最后 512KB，别把几百 MB 的日志整份读进内存。
 * 编码要嗅探：启动器写 UTF-8，PowerShell 重定向（run-server.cmd）写 UTF-16LE。
 */
function readTextTail(file, lines = 5, maxBytes = 512 * 1024) {
  const st = statSync(file);
  if (!st.size) return [];
  const fd = openSync(file, "r");
  try {
    const head = Buffer.alloc(2);
    readSync(fd, head, 0, 2, 0);
    const le = head[0] === 0xff && head[1] === 0xfe;
    const be = head[0] === 0xfe && head[1] === 0xff;
    let start = Math.max(0, st.size - maxBytes);
    if ((le || be) && start % 2 === 1) start += 1;
    const buf = Buffer.alloc(st.size - start);
    readSync(fd, buf, 0, buf.length, start);
    let text;
    if (be) { try { text = Buffer.from(buf).swap16().toString("utf16le"); } catch { text = buf.toString("utf8"); } }
    else if (le) text = buf.toString("utf16le");
    else text = buf.toString("utf8");
    return text.replace(/^\uFEFF/, "").trim().split(/\r?\n/).filter(Boolean).slice(-lines);
  } finally {
    closeSync(fd);
  }
}

// ---------------------------------------------------------------- 离线推导本地目录（与服务端 /api/diag.paths 同口径）

/** 程序目录 / 日志 / 模型目录 / 会话 / 工作区：服务没跑时也能算出来 */
function localPaths() {
  const entries = [path.join(HERE, "app.mjs"), path.join(HERE, "..", "app", "app.mjs")];
  const entry = entries.find((p) => existsSync(p)) || "";
  const appDir = entry ? path.dirname(entry) : HERE;
  const root = path.resolve(appDir, "..");
  const logCandidates = [
    path.join(appDir, "..", "logs", "app.log"),
    path.join(appDir, "app.log"),
    path.join(appDir, "logs", "app.log"),
  ].map((p) => path.resolve(p));
  const logFile = logCandidates.find((p) => existsSync(p)) || "";
  const isPortableApp = path.basename(appDir).toLowerCase() === "app";
  const logsDir = logFile ? path.dirname(logFile) : (isPortableApp ? path.join(root, "logs") : appDir);
  const cfgCandidates = [path.join(root, "config.ini"), path.join(appDir, "config.ini")];
  const configFile = cfgCandidates.find((p) => existsSync(p)) || "";
  const cfg = {};
  if (configFile) {
    try {
      for (const raw of readFileSync(configFile, "utf8").split(/\r?\n/)) {
        const m = raw.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
        if (m) cfg[m[1]] = m[2];
      }
    } catch {}
  }
  // 口径与启动器一致：config.ini 的 modelDir 优先；留空时开发目录用上一级（D:\LocalModels），发布包用 ..\models
  const modelDir = cfg.modelDir
    ? path.resolve(appDir, cfg.modelDir)
    : (isPortableApp ? path.join(root, "models") : root);
  const workspaceDir = path.join(modelDir, "workspace");
  return {
    appDir,
    root,
    logsDir,
    logFile,
    configFile,
    cfg,
    modelDir,
    workspaceDir,
    sessionsDir: path.join(workspaceDir, "sessions"),
    crashLog: path.join(appDir, "vulkan-crash.log"),
    visionLog: path.join(logsDir, "vision.log"),
  };
}

const OPEN_TARGETS = {
  dir: (P) => P.appDir,
  logs: (P) => P.logsDir,
  modelDir: (P) => P.modelDir,
  sessions: (P) => P.sessionsDir,
  workspace: (P) => P.workspaceDir,
};

// ---------------------------------------------------------------- 服务没起时的本机诊断

/** 服务没起时的本机诊断：这条路径是「修复工具」的本职 */
function localChecks() {
  const out = [];
  const push = (level, title, detail, fix = "") => out.push({ level, title, detail, fix });
  const candidates = [path.join(HERE, "app.mjs"), path.join(HERE, "..", "app", "app.mjs")];
  const entry = candidates.find((p) => existsSync(p)) || "";
  push(entry ? "ok" : "warn", "程序目录", entry ? path.dirname(entry) : "找不到 app.mjs（当前目录不是安装目录？）");

  const logs = [
    path.join(HERE, "logs", "app.log"),
    path.join(HERE, "app.log"),
    path.join(HERE, "..", "logs", "app.log"),
  ].map((p) => path.resolve(p));
  const logFile = logs.find((p) => existsSync(p));
  if (logFile) {
    const st = statSync(logFile);
    push("ok", "日志", logFile + " · " + (st.size / 1024).toFixed(0) + " KB · " + st.mtime.toLocaleString());
    try {
      push("ok", "日志末尾", readTextTail(logFile, 4).join(" ⏎ ").slice(0, 400));
    } catch {}
  } else {
    push("warn", "日志", "找不到 app.log", "启动一次程序后才会生成；也可以直接看控制台输出");
  }

  const crash = [path.join(HERE, "vulkan-crash.log"), path.join(HERE, "..", "vulkan-crash.log")].find((p) => existsSync(p));
  if (crash) {
    const n = readFileSync(crash, "utf8").split(/\r?\n/).filter(Boolean).length;
    push("warn", "崩溃记录", crash + " · " + n + " 条", "最近崩过：下次启动会切 CPU；确认稳定后删掉这个文件可恢复 Vulkan");
  } else {
    push("ok", "崩溃记录", "无");
  }

  const cfg = [path.join(HERE, "..", "config.ini"), path.join(HERE, "config.ini")].find((p) => existsSync(p));
  if (cfg) {
    try {
      const t = readFileSync(cfg, "utf8");
      const pick = (k) => (t.match(new RegExp("^" + k + "=(.*)$", "m")) || [])[1] || "";
      push("ok", "config.ini", "port=" + (pick("port") || "?") + " · modelDir=" + (pick("modelDir") || "(默认)") + " · gpu=" + (pick("gpu") || "auto"));
    } catch {
      push("warn", "config.ini", "有文件但读不出来（可能是权限或编码问题）", "用记事本打开确认内容，或删掉它让程序重建默认配置");
    }
  }
  push("ok", "运行时", "node " + process.version + " · " + process.platform + " " + process.arch);
  return out;
}

function printChecks(checks) {
  for (const c of checks) {
    const mark = LEVEL[c.level] || "·";
    line("  " + mark + " " + c.title + " — " + c.detail);
    if (c.fix) line("      → " + c.fix);
  }
}

// ---------------------------------------------------------------- 文本报告（原有行为，一处不改）

async function report() {
  const v = await getJson("/api/version", 2500);
  const d = await getJson("/api/diag", 8000);
  if (v.status !== 200 || d.status !== 200) {
    line("");
    line("QingYaoTP AILauncher · Debugging Tool —— 服务没在跑（" + BASE + "）");
    line("先看本机这层：");
    line("");
    printChecks(localChecks());
    line("");
    line("要恢复服务：双击 dist\\QingYaoTP AILauncher\\QingYaoTP AILauncher.exe，或在本目录跑 node app.mjs");
    return 2;
  }
  const j = d.j;
  line("");
  line("QingYaoTP AILauncher · Debugging Tool —— v" + j.version.version + (j.version.commit ? " (" + j.version.commit + (j.version.dirty ? " 未提交" : "") + ")" : ""));
  line("服务 " + BASE + " · pid " + j.server.pid + " · 运行 " + Math.round(j.server.uptimeSec / 60) + " 分钟 · 后端 " + j.server.gpu);
  line("系统 " + j.system.platform + " " + j.system.arch + " · " + j.system.cpus + " 核 · 内存 " + j.system.totalGB + " GB（可用 " + j.system.freeGB + "）");
  line("模型 " + (j.model.file || "未加载") + " · 上下文 " + j.model.context + " · " + j.model.layers + " 层 · KV " + j.model.cachedTokens + " token");
  // 实时资源（与调试页「实时资源」卡同一接口，2 秒轮询；这里只取一次快照）
  const rs = await getJson("/api/diag/resources", 4000);
  if (rs.status === 200 && rs.j) {
    const rr = rs.j;
    const cpu = typeof rr.cpu?.usagePct === "number" ? rr.cpu.usagePct + "%" : "—";
    line("实时资源 CPU " + cpu + " · 内存 " + rr.mem?.usedGB + "/" + rr.mem?.totalGB + " GB (" + rr.mem?.usedPct + "%)" +
      " · RSS " + rr.proc?.rssMB + " MB · 磁盘剩余 " + (rr.disk ? rr.disk.freeGB + " GB" : "—"));
  }
  line("");
  line("检查项：" + j.summary.error + " 错误 / " + j.summary.warn + " 警告 / " + j.summary.ok + " 正常");
  printChecks(j.checks);
  line("");
  line("更多：--export [目录] 打诊断包交给别人 · --history [小时] 看问题从什么时候开始 · --watch [秒] 盯着变化 · --open <dir|logs|modelDir|sessions|workspace> 打开目录");
  line("");
  return j.summary.error ? 1 : 0;
}

function openWindow() {
  const url = BASE + "/debug";
  const edge = [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ].find((p) => existsSync(p));
  const profile = path.join(process.env.TEMP || HERE, "localai-debug-profile");
  if (edge) {
    const child = spawn(edge, ["--app=" + url, "--window-size=1180,860", "--user-data-dir=" + profile], { detached: true, stdio: "ignore" });
    child.unref();
    line("已用 Edge 应用模式打开：" + url);
    return 0;
  }
  const child = spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore", windowsHide: true });
  child.unref();
  line("已用默认浏览器打开：" + url);
  return 0;
}

async function logs() {
  const which = args.filter((a) => ["app", "crash"].includes(a))[0] || "app";
  const n = Number(args.find((a) => /^\d+$/.test(a))) || 200;
  const r = await getJson("/api/diag/logs?which=" + which + "&lines=" + n, 6000);
  if (r.status !== 200) {
    const f = localChecks().find((c) => c.title === "日志");
    line("服务没在跑，读不到日志接口。" + (f ? f.detail : ""));
    return 2;
  }
  line("# " + r.j.file + "（" + r.j.size + " 字节）");
  line(r.j.text || "");
  return 0;
}

// ---------------------------------------------------------------- --export

/** 动态加载 Lead 提供的零依赖 zip（模块不在时退化成文件夹版；不阻塞、不抛栈） */
async function loadZipModule() {
  const file = path.join(HERE, "diag-zip.mjs");
  if (!existsSync(file)) return null;
  try {
    const m = await import(pathToFileURL(file).href);
    return typeof m.zipStore === "function" ? m : null;
  } catch {
    return null;
  }
}

function sha256Buf(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

/** config.ini 脱敏：只把 modelDir 的值换成 <MODEL_DIR>，其余保留 */
function sanitizedConfig(P) {
  if (!P.configFile) return "（没有 config.ini：开发目录或便携默认配置，modelDir 用默认值）\n实际模型目录: <MODEL_DIR>\n";
  try {
    const text = readFileSync(P.configFile, "utf8");
    return text.split(/\r?\n/).map((row) => (/^\s*modelDir\s*=/.test(row) ? "modelDir=<MODEL_DIR>" : row)).join("\n").replace(/\n*$/, "\n");
  } catch (e) {
    return "（读 config.ini 失败：" + humanErr(e) + "）\n";
  }
}

function offlineReport(P) {
  const L = [];
  L.push("QingYaoTP AILauncher（本地 AI）· 本机诊断报告（离线）");
  L.push("服务未运行，以下为本机诊断");
  L.push("");
  L.push("生成时间: " + new Date().toLocaleString("zh-CN", { hour12: false }));
  L.push("尝试连接: " + BASE);
  L.push("运行时: node " + process.version + " · " + process.platform + " " + process.arch);
  L.push("");
  L.push("程序目录: " + P.appDir);
  L.push("日志: " + (P.logFile || "未找到 app.log（服务可能从没在这台机器上跑过）"));
  L.push("模型目录: " + P.modelDir);
  L.push("会话目录: " + P.sessionsDir + (existsSync(P.sessionsDir) ? "" : "（不存在）"));
  L.push("config.ini: " + (P.configFile || "未找到（便携默认 / 开发目录）"));
  L.push("");
  L.push("--- 检查 ---");
  for (const c of localChecks()) {
    L.push((LEVEL[c.level] || "·") + " " + c.title + " — " + c.detail);
    if (c.fix) L.push("      → " + c.fix);
  }
  L.push("");
  L.push("--- 怎么办 ---");
  L.push("1) 双击 QingYaoTP AILauncher.exe（或在本目录跑 node app.mjs）把服务起回来；");
  L.push("2) 服务起来后重跑 --export，拿到含完整体检项的 zip；");
  L.push("3) 服务起不来时，logs/app.tail.txt 的最后几十行就是排查入口。");
  return L.join("\n") + "\n";
}

function offlineReadme() {
  return [
    "QingYaoTP AILauncher · 诊断包（离线版）",
    "",
    "这个包是服务没运行时在本机生成的，用来把现场交给别人：",
    "  REPORT.txt            人话诊断报告（开头写明「服务未运行」）",
    "  diag-local.json       本机诊断的机器可读版（检查项 + 推导出的目录）",
    "  manifest.json         每个文件的字节数与 sha256",
    "  logs/app.tail.txt     应用日志最后 500 行（没有就是没跑过）",
    "  logs/crash.log        崩溃记录（有才出现）",
    "  logs/vision.log       视觉 sidecar 日志（有才出现）",
    "  config.ini.sanitized  config.ini 的脱敏副本（modelDir 值换成 <MODEL_DIR>）",
    "",
    "不含聊天内容、会话正文、模型权重；只收诊断需要的文件。",
    "服务恢复后重跑 node localai-debug.mjs --export 可拿完整诊断包。",
    "",
  ].join("\n");
}

function offlineJson(P) {
  return {
    now: new Date().toISOString(),
    mode: "offline",
    base: BASE,
    service: { up: false, error: "服务没在跑（" + BASE + "）" },
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    paths: {
      dir: P.appDir, root: P.root, modelDir: P.modelDir, logs: P.logFile || P.logsDir,
      sessions: P.sessionsDir, workspace: P.workspaceDir, config: P.configFile, crashLog: P.crashLog,
    },
    checks: localChecks(),
  };
}

/** 服务没跑时：离线诊断包（有 diag-zip.mjs 就 zip，没有就目录版） */
async function exportOffline(outDir, stamp) {
  const P = localPaths();
  const report = offlineReport(P);
  const tail = P.logFile ? readTextTail(P.logFile, 500) : ["（找不到 app.log：服务可能从没在这台机器上跑过）"];
  const entries = [
    { name: "README.txt", data: Buffer.from(offlineReadme(), "utf8") },
    { name: "REPORT.txt", data: Buffer.from(report, "utf8") },
    { name: "diag-local.json", data: Buffer.from(JSON.stringify(offlineJson(P), null, 2) + "\n", "utf8") },
    { name: "logs/app.tail.txt", data: Buffer.from(tail.join("\n") + "\n", "utf8") },
    { name: "config.ini.sanitized", data: Buffer.from(sanitizedConfig(P), "utf8") },
  ];
  for (const [src, name] of [[P.crashLog, "logs/crash.log"], [P.visionLog, "logs/vision.log"]]) {
    if (existsSync(src)) {
      try { entries.push({ name, data: readFileSync(src) }); } catch {}
    }
  }

  const zip = await loadZipModule();
  if (zip) {
    const manifest = {
      app: "QingYaoTP AILauncher",
      kind: "diagnostics",
      mode: "offline",
      createdAt: new Date().toISOString(),
      base: BASE,
      note: "服务未运行，本包由 localai-debug.mjs 在本机生成",
      files: entries.map((e) => ({ name: e.name, bytes: e.data.length, sha256: typeof zip.sha256 === "function" ? zip.sha256(e.data) : sha256Buf(e.data) })),
    };
    const all = entries.concat([{ name: "manifest.json", data: Buffer.from(JSON.stringify(manifest, null, 2) + "\n", "utf8") }]);
    let buf = null;
    try {
      buf = zip.zipStore(all);
    } catch (e) {
      line("打包 zip 失败（" + humanErr(e) + "）——改成本机诊断目录。");
    }
    if (buf) {
      // 写盘放在打包之外：写不进去要直接报「写不进哪」，不能先假装改目录版再失败第二次
      mkdirSync(outDir, { recursive: true });
      const file = path.join(outDir, "qy-diagnostics-" + stamp + ".zip");
      writeFileSync(file, buf);
      line("");
      line("服务没在跑（" + BASE + "），已生成离线诊断包：");
      line("  " + file);
      line("  " + fmtBytes(buf.length) + "（" + buf.length + " 字节）· " + all.length + " 个文件");
      line("→ 包里是 REPORT.txt（人话报告）、日志尾部、config 脱敏副本；服务起来后可以再导一次完整的。");
      return 0;
    }
  }

  // 没模块或打包失败：目录版（REPORT.txt + logs\app.tail.txt）
  const dir = path.join(outDir, "qy-diagnostics-" + stamp);
  mkdirSync(dir, { recursive: true });
  mkdirSync(path.join(dir, "logs"), { recursive: true });
  writeFileSync(path.join(dir, "README.txt"), offlineReadme());
  writeFileSync(path.join(dir, "REPORT.txt"), report);
  writeFileSync(path.join(dir, "diag-local.json"), JSON.stringify(offlineJson(P), null, 2) + "\n");
  writeFileSync(path.join(dir, "logs", "app.tail.txt"), tail.join("\n") + "\n");
  writeFileSync(path.join(dir, "config.ini.sanitized"), sanitizedConfig(P));
  if (existsSync(P.crashLog)) { try { writeFileSync(path.join(dir, "logs", "crash.log"), readFileSync(P.crashLog)); } catch {} }
  if (existsSync(P.visionLog)) { try { writeFileSync(path.join(dir, "logs", "vision.log"), readFileSync(P.visionLog)); } catch {} }
  line("");
  line("服务没在跑（" + BASE + "），已生成离线诊断目录：");
  line("  " + dir);
  line("  REPORT.txt（人话报告）+ logs\\app.tail.txt" + (zip ? "" : "（没找到 diag-zip.mjs，所以是文件夹版）"));
  line("→ 把整个目录压缩后发给别人；服务起来后重跑 --export 可拿完整 zip。");
  return 0;
}

async function exportDiag() {
  const outDir = path.resolve(nextValue("--export", "") || process.cwd());
  const stamp = stampNow();
  try {
    if (await serviceUp()) {
      const token = await localToken();
      if (!token) {
        line("");
        line("服务在跑，但拿不到本机令牌（/api/state）——重启主程序后再试。");
        return 1;
      }
      const r = await request("/api/diag/export", {
        method: "POST",
        headers: { "content-type": "application/json", "x-local-token": token },
        body: "{}",
        timeoutMs: 60000,
      });
      if (r.status === 200 && r.buffer.length > 2 && r.buffer[0] === 0x50 && r.buffer[1] === 0x4b) {
        mkdirSync(outDir, { recursive: true });
        const file = path.join(outDir, "qy-diagnostics-" + stamp + ".zip");
        writeFileSync(file, r.buffer);
        line("");
        line("诊断包已生成（服务在跑，" + BASE + "）：");
        line("  " + file);
        line("  " + fmtBytes(r.buffer.length) + "（" + r.buffer.length + " 字节）");
        line("→ 直接把这个 zip 发给别人：里面有 REPORT.txt、diag.json、日志尾部、config 脱敏副本。");
        return 0;
      }
      if (r.status === 200) {
        line("");
        line("服务返回的不是 zip（" + fmtBytes(r.buffer.length) + "）——导出接口可能还没装好，看 app.log。");
        return 1;
      }
      if (r.status === 404 || r.status === 405) {
        line("");
        line("服务在跑，但这个版本还没有导出接口（HTTP " + r.status + "），改成本机诊断包。");
        return await exportOffline(outDir, stamp);
      }
      line("");
      line("导出失败：HTTP " + r.status + (apiError(r) ? " — " + apiError(r) : ""));
      if (r.status === 403) line("→ 令牌不对：重启主程序或调试工具后再试。");
      else if (r.status >= 500) line("→ 服务端打包出错，看日志尾部：--logs app 50");
      else line("→ 稍后重试；一直失败就 node localai-debug.mjs 看本机这层。");
      return 1;
    }
    return await exportOffline(outDir, stamp);
  } catch (e) {
    line("");
    line("写不进 " + outDir + "：" + humanErr(e));
    line("→ 换一个可写目录，例如 --export %TEMP%");
    return 1;
  }
}

// ---------------------------------------------------------------- --open

function openLocal(which, P) {
  const target = OPEN_TARGETS[which](P);
  if (process.platform !== "win32") {
    line("当前系统不是 Windows，没法用 explorer.exe 打开；目录是：" + target);
    return 1;
  }
  if (!existsSync(target)) {
    line("目录不存在：" + target);
    line("→ 可能还没生成（程序跑过一次就有了），先 node localai-debug.mjs 看看本机这层");
    return 1;
  }
  try {
    const child = spawn("explorer.exe", [target], { detached: true, stdio: "ignore" });
    child.unref();
    line("已在本机打开 " + which + "：" + target);
    return 0;
  } catch (e) {
    line("打开失败：" + humanErr(e));
    return 1;
  }
}

async function openPath() {
  const raw = nextValue("--open", "");
  const which = WHICH.find((w) => w.toLowerCase() === String(raw).toLowerCase());
  if (!which) {
    line("");
    line(raw ? "不认识的目录名：" + raw : "--open 后面要跟一个目录名");
    line("可用：" + WHICH.join(" | ") + "（程序目录 / 日志 / 模型目录 / 会话 / 工作区）");
    return 2;
  }
  const P = localPaths();
  if (await serviceUp()) {
    const token = await localToken();
    if (!token) {
      line("服务在跑但拿不到本机令牌（/api/state）——重启主程序后再试。");
      return 1;
    }
    const r = await postJson("/api/diag/open-path", { which }, { "x-local-token": token });
    if (r.status === 200 && r.j?.ok) {
      line("已打开 " + which + "：" + (r.j.path || OPEN_TARGETS[which](P)));
      return 0;
    }
    if (r.status === 403) {
      line("服务拒绝了请求（令牌不对）——重启调试工具或主程序后再试。");
      return 1;
    }
    if (r.status === 400) {
      line("服务不接受这个目录名（白名单外）：" + which);
      return 1;
    }
    const msg = apiError(r);
    const noRoute = r.status === 404 && /无此路由|not found/i.test(msg);
    if (r.status === 404 && (!msg || noRoute)) {
      line("服务端还没有打开目录接口（HTTP 404），直接在本机打开。");
      return openLocal(which, P);
    }
    line("打开失败：HTTP " + r.status + (msg ? " — " + msg : ""));
    return 1;
  }
  return openLocal(which, P);
}

// ---------------------------------------------------------------- --history

async function history() {
  const hours = Math.round(numValue("--history", 24));
  if (!(await serviceUp())) {
    line("");
    line("服务没在跑（" + BASE + "），读不到诊断历史。");
    line("→ 先 node localai-debug.mjs 看本机这层；服务起来后历史会自动记录。");
    return 2;
  }
  const r = await getJson("/api/diag/history?hours=" + hours + "&limit=200", 8000);
  if (r.status !== 200) {
    line("");
    line("读诊断历史失败：HTTP " + r.status + (apiError(r) ? " — " + apiError(r) : ""));
    if (r.status === 404) line("→ 这个版本的后端还没有诊断历史接口（升级服务后才有）。");
    return 1;
  }
  const j = r.j || {};
  const points = Array.isArray(j.points) ? j.points : [];
  const changes = Array.isArray(j.changes) ? j.changes : [];
  line("");
  line("QingYaoTP AILauncher · 诊断历史 —— 最近 " + hours + " 小时（" + BASE + "）");
  if (points.length === 0) {
    line("还没有历史（首次体检后开始记录）");
    line("");
    return 0;
  }
  const first = points[0]?.t || j.since || "";
  const last = points[points.length - 1]?.t || "";
  line("采样 " + points.length + " 点 · 时间窗 " + fmtLocal(first) + " → " + fmtLocal(last) + " · 历史文件 " + (j.file || "?") + "（共 " + (j.total ?? points.length) + " 条）");
  if (changes.length === 0) {
    line("最近没有变化（各项一直稳定）");
  } else {
    line("最近变化（" + changes.length + " 条）：");
    for (const c of changes) {
      const id = String(c.id || "").padEnd(9);
      line("  " + fmtLocal(c.t) + "  " + id + " " + String(c.title || c.id || "") + "  " + (c.from || "?") + " → " + (c.to || "?"));
    }
  }
  line("");
  return 0;
}

// ---------------------------------------------------------------- --watch

/** summary 缺失时按 checks 自己数，别因为字段少就崩 */
function summarize(j) {
  const checks = Array.isArray(j.checks) ? j.checks : [];
  const s = j.summary || {};
  const count = (lv) => (Number.isFinite(s[lv]) ? s[lv] : checks.filter((c) => c.level === lv).length);
  return { n: checks.length, error: count("error"), warn: count("warn"), ok: count("ok") };
}

async function watch() {
  const every = Math.max(0.2, numValue("--watch", 5));
  const cyclesRaw = numValue("--cycles", Infinity);
  const cycles = Number.isFinite(cyclesRaw) ? Math.max(1, Math.round(cyclesRaw)) : Infinity;
  let prev = null;
  let prevErr = 0;
  for (let i = 0; i < cycles; i++) {
    const r = await getJson("/api/diag", 8000);
    if (r.status !== 200) {
      line("");
      line(i === 0 ? "服务没在跑（" + BASE + "），没什么可盯的。" : "服务断了（" + BASE + "），停止 --watch。");
      line("→ 先 node localai-debug.mjs 看本机这层");
      return 2;
    }
    const j = r.j || {};
    const checks = Array.isArray(j.checks) ? j.checks : [];
    const sm = summarize(j);
    const map = new Map(checks.map((c) => [c.id, c]));
    if (!prev) {
      line("");
      line("QingYaoTP AILauncher · 盯着看 —— " + BASE + (j.version?.version ? " · v" + j.version.version : ""));
      line("当前 " + sm.n + " 项：" + sm.error + " 错误 / " + sm.warn + " 警告 / " + sm.ok + " 正常 · 每 " + trimNum(every) + " 秒看一次" +
        (Number.isFinite(cycles) ? " · 共 " + cycles + " 轮" : "（Ctrl+C 停止）"));
      const bad = checks.filter((c) => c.level !== "ok");
      if (bad.length) {
        line("现在有问题的：");
        for (const c of bad) line("  " + (LEVEL[c.level] || "·") + " " + c.title + " — " + c.detail);
      }
      line("只在出现变化时打印一行。");
      prev = map;
      prevErr = sm.error;
    } else {
      const ts = clockNow();
      const seen = new Set();
      let levelChanges = 0;
      for (const [id, c] of map) {
        seen.add(id);
        const p = prev.get(id);
        if (!p) {
          line("  " + ts + "  + 新检查项：" + c.title + "（" + c.level + "）— " + c.detail);
          levelChanges++;
        } else if (p.level !== c.level) {
          line("  " + ts + "  " + (LEVEL[c.level] || "·") + " " + c.title + "：" + p.level + " → " + c.level + " — " + c.detail);
          if (c.fix) line("      → " + c.fix);
          levelChanges++;
        }
      }
      for (const p of prev.values()) {
        if (!seen.has(p.id)) {
          line("  " + ts + "  - 检查项消失：" + p.title);
          levelChanges++;
        }
      }
      if (prevErr !== sm.error && levelChanges === 0) line("  " + ts + "  错误数 " + prevErr + " → " + sm.error);
      prev = map;
      prevErr = sm.error;
    }
    if (Number.isFinite(cycles) && i + 1 >= cycles) break;
    await new Promise((res) => setTimeout(res, every * 1000));
  }
  line("");
  line("watch 结束（看了 " + (Number.isFinite(cycles) ? cycles : "好") + " 轮）。");
  return 0;
}

// ---------------------------------------------------------------- 用法与分发

function usage() {
  line("");
  line("QingYaoTP AILauncher · Debugging Tool（独立程序）");
  line("");
  line("  node localai-debug.mjs                       文本报告（服务没在跑时给本机诊断）");
  line("  node localai-debug.mjs --json                机器可读（给探针/脚本用）");
  line("  node localai-debug.mjs --ui                  打开调试界面（独立窗口）");
  line("  node localai-debug.mjs --logs [app|crash] [行数]");
  line("  node localai-debug.mjs --export [目录]        导出诊断包（默认当前目录；服务没跑时出离线包）");
  line("  node localai-debug.mjs --open <" + WHICH.join("|") + ">");
  line("  node localai-debug.mjs --history [小时=24]    诊断历史与最近变化");
  line("  node localai-debug.mjs --watch [秒=5] [--cycles N]  盯着变化（--cycles 跑 N 轮就退出）");
  line("");
  line("  公共参数：--base <地址>（默认 " + (process.env.LOCALAI_BASE || "http://127.0.0.1:8099") + "）");
  line("");
  line("  退出码：0 正常 / 1 有错误（报告里有 error，或导出失败） / 2 服务没跑或用错了参数");
  line("");
}

/**
 * 收尾：只设退出码，让事件循环自己排空。
 * 为什么不能紧跟 fetch 后直接 process.exit()：node 24（本机实测 v24.19.0）上会撞
 * libuv 断言「uv_async_send ... UV_HANDLE_CLOSING」，进程以 3221226505 退出——
 * 探针会把这条命令判成失败，用户也只会看到一句看不懂的英文。
 * 兜底定时器：万一有句柄残留不排空，1.5 秒后强制收尾（定时器 unref，不拖慢正常路径）。
 */
function finish(code) {
  process.exitCode = Number(code) || 0;
  try { setTimeout(() => process.exit(process.exitCode), 1500).unref(); } catch {}
}

async function main() {
  /** 不认识的参数只提示、不崩（退出码 2，和「参数用错」一个口径） */
  const unknown = [];
  for (const a of args) {
    if (!a.startsWith("-") || a === "-") continue;
    if (!KNOWN_FLAGS.includes(a) && !unknown.includes(a)) unknown.push(a);
  }
  if (unknown.length) {
    line("");
    line("不认识的参数：" + unknown.join(" "));
    line("可用参数：--json · --ui · --logs [app|crash] [行数] · --export [目录] · --open <" + WHICH.join("|") + "> · --history [小时] · --watch [秒] [--cycles N] · --base <地址>");
    line("不带参数就是文本报告；--help 看完整说明。");
    return 2;
  }

  if (has("--help") || has("-h")) { usage(); return 0; }
  if (has("--ui")) return openWindow();
  if (has("--logs")) return await logs();
  if (has("--export")) return await exportDiag();
  if (has("--open")) return await openPath();
  if (has("--history")) return await history();
  if (has("--watch")) return await watch();
  if (has("--json")) {
    const d = await getJson("/api/diag", 8000);
    const out = d.status === 200 ? { ...d.j } : { ok: false, status: d.status, error: d.error };
    if (d.status === 200) {
      const r = await getJson("/api/diag/resources", 4000);
      if (r.status === 200) out.resources = r.j;
    }
    process.stdout.write(JSON.stringify(out, null, 2) + "\n");
    return d.status === 200 ? 0 : 2;
  }
  return await report();
}

finish(await main());

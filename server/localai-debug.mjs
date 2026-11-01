#!/usr/bin/env node
/**
 * 本地 AI · Debugging Tool（独立程序）
 *
 *   node localai-debug.mjs                文本报告（服务没在跑也能给出本机诊断）
 *   node localai-debug.mjs --json         机器可读（给探针/脚本用）
 *   node localai-debug.mjs --ui           打开调试界面（独立窗口）
 *   node localai-debug.mjs --logs [app|crash] [行数]
 *
 * 设计：它和主程序是两个进程。主程序只提供 /api/diag；这里负责「看」和「开窗」，
 * 所以服务真的挂了的时候，本程序仍然能告诉你：端口有没有人听、日志最后几行是什么、
 * 崩溃记录有几条、config.ini 与模型目录对不对。
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };

const BASE = val("--base", process.env.LOCALAI_BASE || "http://127.0.0.1:8099");
const LEVEL = { error: "✗", warn: "!", ok: "✓" };

function line(s = "") { process.stdout.write(s + "\n"); }

async function getJson(p, timeoutMs = 5000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(BASE + p, { signal: ctl.signal });
    const j = await r.json().catch(() => ({}));
    return { status: r.status, j };
  } catch (e) {
    return { status: 0, error: String(e?.message ?? e) };
  } finally {
    clearTimeout(t);
  }
}

/** 读日志尾部并处理编码：启动器写 UTF-8，PowerShell 重定向写 UTF-16LE */
function readTail(file, lines = 5) {
  const buf = readFileSync(file);
  let text;
  if (buf[0] === 0xff && buf[1] === 0xfe) text = buf.toString("utf16le");
  else if (buf[0] === 0xfe && buf[1] === 0xff) {
    try { text = Buffer.from(buf).swap16().toString("utf16le"); } catch { text = buf.toString("utf8"); }
  } else text = buf.toString("utf8");
  return text.replace(/^\uFEFF/, "").trim().split(/\r?\n/).filter(Boolean).slice(-lines);
}

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
      push("ok", "日志末尾", readTail(logFile, 4).join(" ⏎ ").slice(0, 400));
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
    const t = readFileSync(cfg, "utf8");
    const pick = (k) => (t.match(new RegExp("^" + k + "=(.*)$", "m")) || [])[1] || "";
    push("ok", "config.ini", "port=" + (pick("port") || "?") + " · modelDir=" + (pick("modelDir") || "(默认)") + " · gpu=" + (pick("gpu") || "auto"));
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

async function report() {
  const v = await getJson("/api/version", 2500);
  const d = await getJson("/api/diag", 8000);
  if (v.status !== 200 || d.status !== 200) {
    line("");
    line("本地 AI · Debugging Tool —— 服务没在跑（" + BASE + "）");
    line("先看本机这层：");
    line("");
    printChecks(localChecks());
    line("");
    line("要恢复服务：双击 dist\\LocalAI\\启动本地AI.exe，或在本目录跑 node app.mjs");
    return 2;
  }
  const j = d.j;
  line("");
  line("本地 AI · Debugging Tool —— v" + j.version.version + (j.version.commit ? " (" + j.version.commit + (j.version.dirty ? " 未提交" : "") + ")" : ""));
  line("服务 " + BASE + " · pid " + j.server.pid + " · 运行 " + Math.round(j.server.uptimeSec / 60) + " 分钟 · 后端 " + j.server.gpu);
  line("系统 " + j.system.platform + " " + j.system.arch + " · " + j.system.cpus + " 核 · 内存 " + j.system.totalGB + " GB（可用 " + j.system.freeGB + "）");
  line("模型 " + (j.model.file || "未加载") + " · 上下文 " + j.model.context + " · " + j.model.layers + " 层 · KV " + j.model.cachedTokens + " token");
  line("");
  line("检查项：" + j.summary.error + " 错误 / " + j.summary.warn + " 警告 / " + j.summary.ok + " 正常");
  printChecks(j.checks);
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

if (has("--ui")) process.exit(openWindow());
else if (has("--logs")) process.exit(await logs());
else if (has("--json")) {
  const d = await getJson("/api/diag", 8000);
  process.stdout.write(JSON.stringify(d.status === 200 ? d.j : { ok: false, status: d.status, error: d.error }, null, 2) + "\n");
  process.exit(d.status === 200 ? 0 : 2);
} else {
  process.exit(await report());
}

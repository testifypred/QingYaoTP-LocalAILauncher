/**
 * 视觉增强包界面探针（CDP + 自带临时服务实例）
 *
 *   node probe-ui-vision-pack.mjs [cdpBase] [appBase] [shotDir]
 *
 *   cdpBase  CDP 地址，默认 http://127.0.0.1:9333
 *   appBase  共享页面所在的正式 dev 服务（8099）——探针跑完必须把页面导航回这里，否则后面的界面探针全红
 *   shotDir  截图目录，默认 server\docs\feature-vision-pack-2026-11-15
 *
 * 为什么要临时服务：界面要验「未安装 -> 一键安装 -> 已安装 -> 卸载 -> 未安装」全链路，
 * 而 dev 的 8099 用的是仓库 tools\llama.cpp（不能卸、也不该被探针改）。所以探针自己拉起
 * PORT=8199 的实例：MODEL_DIR / LOCALAI_LLAMA_DIR / LOCALAI_VISION_PACK_DIR 全指向临时目录，
 * 并预置一个合法小包（diag-zip 的 zipStore：vision-pack.json + llama\ 8 个 required），
 * 让 #vpDetected 里出现「一键安装」。临时实例的 MODEL_DIR 里还放一对假的 Qwen3.5-9B 模型 + mmproj，
 * 这样装好后「启动」键才有「可用组合」而恢复可点（否则它天生因无 pair 而禁用，断言会假红）。
 *
 * 覆盖（契约 §4 / §6）：
 *  1) 页面导航到临时服务：设置 -> 视觉 能看到 #vpCard，data-installed="0"；
 *  2) 未安装时 #setVisionStart / #setVisionPair 禁用、#vpStatus 显示未安装、#vpUninstallBtn 禁用；
 *  3) #vpDetected 检测到本地包（文案含包名 + v1.6.0，且有「一键安装」按钮）；
 *  4) 点「一键安装」-> 后端 installed=true、#vpCard data-installed="1"、启动键与组合下拉恢复可用、状态行显示已安装 v1.6.0；
 *  5) 点「卸载」（confirm 覆写成 () => true）-> 后端 installed=false、#vpCard 回到 data-installed="0"、启动键重新禁用、临时目录消失；
 *  6) 收尾把共享页面导航回 appBase（8099）并等加载完成（跑完 sleep 4s，给页面刷新留时间）。
 *
 * 收尾：杀临时服务（连子进程）、删临时目录、恢复 server.pid、ws.close()。
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, createWriteStream } from "node:fs";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { zipStore } from "./diag-zip.mjs";

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const CDP = process.argv[2] || "http://127.0.0.1:9333";
const APP = (process.argv[3] || "http://127.0.0.1:8099").replace(/\/+$/, "");
const OUT = process.argv[4] || path.join(SERVER_DIR, "docs", "feature-vision-pack-2026-11-15");
/** 临时服务端口：固定 8199（probe-vision-pack 也用这个；两个探针串行跑） */
const PORT = 8199;
const TEMP = "http://127.0.0.1:" + PORT;

const REQUIRED = [
  "llama-server.exe",
  "llama-server-impl.dll",
  "llama.dll",
  "llama-common.dll",
  "ggml.dll",
  "ggml-base.dll",
  "mtmd.dll",
  "libomp.dll",
];
const TOP = "QingYaoTP-AILauncher-v1.6.0-vision-pack/";
const AVAIL_NAME = "QingYaoTP-AILauncher-v1.6.0-vision-pack.zip";

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass += 1; console.log("  ok   " + name + (extra ? "  [" + extra + "]" : "")); }
  else { fail += 1; console.log("  FAIL " + name + "  " + (extra || "")); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- HTTP / 临时服务

async function http(method, url, opt = {}) {
  const { json, headers, ms = 20000 } = opt;
  const h = Object.assign({}, headers || {});
  const o = { method, signal: AbortSignal.timeout(ms) };
  if (json !== undefined) { h["content-type"] = h["content-type"] || "application/json"; o.body = JSON.stringify(json); }
  if (Object.keys(h).length) o.headers = h;
  try {
    const r = await fetch(url, o);
    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch {}
    return { status: r.status, data, text };
  } catch (e) {
    return { status: 0, data: null, text: "", error: String((e && e.message) || e) };
  }
}
const errText = (r) => String((r && r.data && r.data.error && r.data.error.message) || r.text || r.error || "").slice(0, 160);

let tmpRoot = "";
const dirs = {};
let child = null;
let childExited = false;
let stdoutTail = "", stderrTail = "";
let pidFile = "";
let pidBackup = null;

async function waitServer(ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 30000)) {
    if (childExited) return { ok: false, exited: true };
    const r = await http("GET", TEMP + "/api/state", { ms: 2000 });
    if (r.status === 200 && r.data && Array.isArray(r.data.models)) return { ok: true, state: r.data };
    await sleep(400);
  }
  return { ok: false, exited: false };
}
async function portClosed(ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 10000)) {
    const r = await http("GET", TEMP + "/api/state", { ms: 800 });
    if (r.status === 0) return true;
    await sleep(300);
  }
  return false;
}
async function killServer() {
  if (!child) return;
  const pid = child.pid;
  if (child.exitCode === null) {
    try { child.kill(); } catch {}
    const t0 = Date.now();
    while (Date.now() - t0 < 6000 && child.exitCode === null) await sleep(200);
  }
  if (child.exitCode === null) {
    try { spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); } catch {}
    const t0 = Date.now();
    while (Date.now() - t0 < 6000 && child.exitCode === null) await sleep(200);
  }
}
/** 临时实例会写 server\server.pid：备份 / 恢复，别把 8099 那台的 pid 文件弄丢 */
async function restorePidFile() {
  if (!pidFile) return;
  try {
    if (pidBackup !== null) await writeFile(pidFile, pidBackup, "utf8");
    else {
      const now = existsSync(pidFile) ? await readFile(pidFile, "utf8").catch(() => null) : null;
      if (now !== null && child && String(now).trim() === String(child.pid)) await rm(pidFile, { force: true });
    }
  } catch {}
}

/** 合法小包（与 probe-vision-pack 同一形状：顶层目录 + vision-pack.json + llama\ 8 个 required） */
function makeGoodPack() {
  const files = REQUIRED.map((n, i) => ({ name: TOP + "llama/" + n, data: Buffer.alloc(1024 + i * 137, 0x41 + (i % 26)) }));
  const bytes = files.reduce((s, f) => s + f.data.length, 0);
  const manifest = {
    format: 1,
    name: "QingYaoTP AILauncher 视觉增强包",
    version: "1.6.0",
    sidecar: "b12144",
    createdAt: new Date().toISOString(),
    files: REQUIRED.length,
    bytes,
  };
  return {
    buf: zipStore([{ name: TOP + "vision-pack.json", data: JSON.stringify(manifest, null, 2) + "\n" }, ...files]),
    manifest,
  };
}

// ---------------------------------------------------------------- CDP / 页面辅助

let ws = null;
let cmd = null;
let ev = null;
let connected = false;
let abortCode = 0;

async function waitEval(expression, ms, step) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < (ms || 20000)) {
    try { last = await ev(expression); if (last) return last; } catch {}
    await sleep(step || 300);
  }
  return last;
}
async function goto(url, ms) {
  try { await cmd("Page.navigate", { url }); } catch { return false; }
  const ready = await waitEval("document.readyState === 'complete' && !!document.getElementById('settingsBtn')", ms || 30000);
  return Boolean(ready);
}
async function shot(name) {
  const r = await cmd("Page.captureScreenshot", { format: "png" });
  const file = path.join(OUT, name + ".png");
  await writeFile(file, Buffer.from(r.result.data, "base64"));
  console.log("    截图: " + file);
}
/** 一次读全卡片的所有断言字段：少来回、少时序抖动 */
async function readCard() {
  return JSON.parse(await ev("(() => {" +
    "const g = (id) => document.getElementById(id);" +
    "const card = g('vpCard'), start = g('setVisionStart'), pair = g('setVisionPair');" +
    "const det = g('vpDetected'), st = g('vpStatus'), un = g('vpUninstallBtn'), inst = g('vpInstallBtn');" +
    "return JSON.stringify({" +
    " card: !!card," +
    " installed: card ? String(card.dataset.installed || '') : ''," +
    " startDisabled: start ? !!start.disabled : null," +
    " pairDisabled: pair ? !!pair.disabled : null," +
    " status: st ? String(st.textContent || '') : ''," +
    " detHidden: det ? !!det.hidden : null," +
    " detText: det ? String(det.textContent || '') : ''," +
    " detButtons: det ? [...det.querySelectorAll('button')].map((b) => String(b.textContent || '').trim()) : []," +
    " unDisabled: un ? !!un.disabled : null," +
    " instText: inst ? String(inst.textContent || '') : ''" +
    "});" +
    "})()"));
}
async function waitCard(pred, ms) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < (ms || 20000)) {
    try { last = await readCard(); if (pred(last)) return last; } catch {}
    await sleep(300);
  }
  return last;
}
async function tempPack() {
  const r = await http("GET", TEMP + "/api/vision/pack", { ms: 10000 });
  return { status: r.status, data: r.data || {} };
}
async function waitInstalled(want, ms) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < (ms || 30000)) {
    const r = await tempPack();
    last = r.data;
    if (r.status === 200 && last.installed === want) return last;
    await sleep(300);
  }
  return last;
}
/** 打开 设置 -> 视觉（入口照抄 probe-ui-vision：settingsBtn + .settingsTabs .stab[data-tab=vision]） */
async function openVisionTab() {
  await ev("(() => {" +
    " ['firstModal', 'readmeModal'].forEach((id) => { const el = document.getElementById(id); if (el) el.hidden = true; });" +
    " const b = document.getElementById('settingsBtn'); if (b) b.click();" +
    " return 1;" +
    "})()");
  await sleep(600);
  const tabs = JSON.parse(await ev("JSON.stringify([...document.querySelectorAll('.settingsTabs .stab')].map((b) => ({ tab: b.dataset.tab || '', text: String(b.textContent || '').trim() })))"));
  const vis = tabs.find((t) => /视觉/.test(t.text) || t.tab === "vision") || null;
  if (vis) {
    await ev("[...document.querySelectorAll('.settingsTabs .stab')].find((b) => (b.dataset.tab || '') === " + JSON.stringify(vis.tab) + ").click(); 1");
    await sleep(900);
  }
  return { tabs, vis };
}

// ---------------------------------------------------------------- 主流程

console.log("\n== 目标 " + APP + "，CDP " + CDP + "，临时服务 " + TEMP + " ==");

try {
  // ---------- 0. 临时实例的目录与夹具 ----------
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), "vp-ui-probe-"));
  dirs.model = path.join(tmpRoot, "vp-model");
  dirs.llama = path.join(tmpRoot, "llama");
  dirs.packs = path.join(tmpRoot, "packs");
  dirs.plugins = path.join(tmpRoot, "plugins");
  dirs.logs = path.join(tmpRoot, "logs");
  for (const d of [dirs.model, path.join(dirs.model, "mmproj"), dirs.packs, dirs.plugins, dirs.logs]) await mkdir(d, { recursive: true });
  console.log("  临时目录: " + tmpRoot);
  // 一对假的「模型 + mmproj」：装好包后启动键必须因为「有可用组合」而恢复可点
  await writeFile(path.join(dirs.model, "Qwen3.5-9B-Q4_K_M.gguf"), Buffer.alloc(4096, 0x47));
  await writeFile(path.join(dirs.model, "mmproj", "Qwen3.5-9B-mmproj-F16.gguf"), Buffer.alloc(2048, 0x48));
  // 预置本地增强包 -> #vpDetected 里出现「一键安装」
  const pack = makeGoodPack();
  await writeFile(path.join(dirs.packs, AVAIL_NAME), pack.buf);

  // pid 备份
  pidFile = path.join(SERVER_DIR, "server.pid");
  try { pidBackup = await readFile(pidFile, "utf8"); } catch { pidBackup = null; }

  // ---------- 1. 起临时服务 ----------
  console.log("\n== A. 起临时服务实例（PORT=" + PORT + "）==");
  const pre = await http("GET", TEMP + "/api/state", { ms: 1200 });
  if (pre.status !== 0) {
    fail += 1;
    abortCode = 2;
    console.log("  FAIL 端口 " + PORT + " 已被占用（可能是上次探针残留的实例），先处理再跑：" + errText(pre));
    throw new Error("port " + PORT + " busy");
  }
  const env = Object.assign({}, process.env, {
    PORT: String(PORT),
    MODEL_DIR: dirs.model,
    LOCALAI_LLAMA_DIR: dirs.llama,
    LOCALAI_VISION_PACK_DIR: dirs.packs,
    PLUGIN_DIR: dirs.plugins,
    AUTO_LOAD: "",
    VISION_IDLE_SEC: "0",
  });
  child = spawn(process.execPath, ["app.mjs"], {
    cwd: SERVER_DIR,
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(createWriteStream(path.join(dirs.logs, "server.out.txt")));
  child.stderr.pipe(createWriteStream(path.join(dirs.logs, "server.err.txt")));
  child.stdout.on("data", (d) => { stdoutTail = (stdoutTail + String(d)).slice(-2000); });
  child.stderr.on("data", (d) => { stderrTail = (stderrTail + String(d)).slice(-2000); });
  child.on("exit", () => { childExited = true; });
  const boot = await waitServer(30000);
  ok("临时服务 /api/state 在 30s 内就绪", boot.ok, boot.exited ? "子进程已退出：" + stderrTail : "pid=" + (child && child.pid));
  if (!boot.ok) { abortCode = 2; throw new Error("temp server not ready"); }

  // ---------- 2. 临时服务侧前置（HTTP） ----------
  console.log("\n== B. 临时服务前置：未安装 + 检测到本地包 + 有视觉组合 ==");
  const p0 = await tempPack();
  ok("临时服务初始 pack.installed === false", p0.status === 200 && p0.data.installed === false, "HTTP " + p0.status + " installed=" + p0.data.installed);
  ok("临时服务 available 里有预置的本地包", Array.isArray(p0.data.available) && p0.data.available.length === 1, "n=" + (Array.isArray(p0.data.available) ? p0.data.available.length : p0.data.available));
  const vs = await http("GET", TEMP + "/api/vision/state", { ms: 15000 });
  const pairs = Array.isArray(vs.data && vs.data.pairs) ? vs.data.pairs.length : -1;
  ok("临时服务有 1 对视觉组合（装好后启动键才会恢复可点）", pairs === 1, "pairs=" + pairs);
  const ob = await http("POST", TEMP + "/api/onboarding", { json: { done: true, readmeShown: true } });
  ok("已预置首启引导 / 使用说明标记（否则弹窗会盖住顶栏）", ob.status === 200, "HTTP " + ob.status);

  // ---------- 3. 连 CDP ----------
  console.log("\n== C. 连 CDP，把共享页面导航到临时服务 ==");
  let targets = null;
  try { targets = await (await fetch(CDP + "/json", { signal: AbortSignal.timeout(5000) })).json(); } catch (e) {
    console.log("  连不上 CDP " + CDP + "：" + String((e && e.message) || e));
  }
  const hostport = APP.replace(/^https?:\/\//, "");
  const page = Array.isArray(targets) ? targets.find((t) => t.type === "page" && String(t.url || "").includes(hostport)) : null;
  if (!page) {
    fail += 1;
    abortCode = 2;
    console.log("  FAIL 没找到页面目标：CDP " + CDP + " 上需要先打开 " + APP);
    throw new Error("no page target");
  }
  ws = new WebSocket(page.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    // 卸载前的 confirm()：探针自动点「确定」，别把探针挂死（同时页面里也会覆写 window.confirm）
    if (m.method === "Page.javascriptDialogOpening") {
      try { ws.send(JSON.stringify({ id: ++seq, method: "Page.handleJavaScriptDialog", params: { accept: true } })); } catch {}
    }
  });
  await new Promise((r, j) => { ws.addEventListener("open", r); ws.addEventListener("error", j); });
  cmd = (method, params) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
  ev = async (expression) => {
    const r = await cmd("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.result && r.result.exceptionDetails) {
      const d = r.result.exceptionDetails;
      throw new Error(String((d.exception && d.exception.description) || d.text || "eval failed"));
    }
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  connected = true;
  await cmd("Page.enable");
  await cmd("Runtime.enable");
  await cmd("Page.setInterceptFileChooserDialog", { enabled: true });
  await mkdir(OUT, { recursive: true });
  console.log("  CDP 页面目标: " + String(page.url).slice(0, 90));

  ok("共享页面导航到临时服务（" + TEMP + "）", await goto(TEMP + "/", 30000));
  ok("导航后页面加载完成（readyState=complete 且有 #settingsBtn）", Boolean(await waitEval("document.readyState === 'complete' && !!document.getElementById('settingsBtn')", 8000)));

  // ---------- 4. 安装前：卡片 / 门禁 / 检测到的本地包 ----------
  console.log("\n== D. 未安装：卡片、门禁、检测到的本地包 ==");
  const opened = await openVisionTab();
  ok("设置里有「视觉」页签", Boolean(opened.vis), opened.tabs.map((t) => t.text).join(" / "));
  const c0 = await waitCard((c) => c.card && c.installed === "0", 20000);
  ok("#vpCard 存在", Boolean(c0 && c0.card));
  ok("#vpCard data-installed === \"0\"（未安装）", Boolean(c0 && c0.installed === "0"), "data-installed=" + (c0 && c0.installed));
  ok("未安装时 #setVisionStart 禁用（契约 §4.2 门禁）", Boolean(c0 && c0.startDisabled === true));
  ok("未安装时 #setVisionPair 组合下拉禁用", Boolean(c0 && c0.pairDisabled === true));
  ok("未安装时 #vpUninstallBtn 禁用", Boolean(c0 && c0.unDisabled === true));
  ok("#vpStatus 文案显示未安装", Boolean(c0 && /未安装/.test(c0.status)), String(c0 && c0.status).slice(0, 90));
  ok("#vpDetected 可见（检测到本地包）", Boolean(c0 && c0.detHidden === false), "hidden=" + (c0 && c0.detHidden));
  ok("#vpDetected 文案含「检测到本地增强包」与包名", Boolean(c0 && /检测到本地增强包/.test(c0.detText) && /vision-pack/.test(c0.detText)), String(c0 && c0.detText).slice(0, 110));
  ok("#vpDetected 文案解析出 v1.6.0", Boolean(c0 && /v1\.6\.0/.test(c0.detText)), String(c0 && c0.detText).slice(0, 110));
  ok("#vpDetected 里有「一键安装」按钮", Boolean(c0 && c0.detButtons.some((t) => /一键安装/.test(t))), String(c0 && c0.detButtons.join(" / ")));
  ok("#vpInstallBtn 存在且文案含「安装」", Boolean(c0 && /安装/.test(c0.instText)), String(c0 && c0.instText));
  await shot("probe-ui-vision-pack-01-uninstalled");

  // ---------- 5. 一键安装 ----------
  console.log("\n== E. 点「一键安装」-> 已安装 ==");
  const clickIns = await ev("(() => {" +
    " const box = document.getElementById('vpDetected');" +
    " if (!box || box.hidden) return 'no-box';" +
    " const b = [...box.querySelectorAll('button')].find((x) => /一键安装/.test(x.textContent || ''));" +
    " if (!b) return 'no-btn';" +
    " if (b.disabled) return 'disabled';" +
    " b.click();" +
    " return 'ok';" +
    "})()");
  ok("点 #vpDetected 的「一键安装」", clickIns === "ok", String(clickIns));
  const apiIns = await waitInstalled(true, 30000);
  ok("一键安装后后端 pack.installed === true（≤30s）", Boolean(apiIns && apiIns.installed === true), JSON.stringify(apiIns && { installed: apiIns.installed, source: apiIns.source, files: apiIns.files, version: apiIns.version }));
  ok("一键安装走 path 安装，source === pack", Boolean(apiIns && apiIns.source === "pack"), "source=" + (apiIns && apiIns.source));
  ok("后端 files === 8 / version === 1.6.0", Boolean(apiIns && Number(apiIns.files) === REQUIRED.length && String(apiIns.version) === "1.6.0"), "files=" + (apiIns && apiIns.files) + " version=" + (apiIns && apiIns.version));
  const c1 = await waitCard((c) => c.installed === "1", 30000);
  ok("#vpCard data-installed === \"1\"（已安装）", Boolean(c1 && c1.installed === "1"), "data-installed=" + (c1 && c1.installed));
  ok("已安装后 #setVisionStart 可用（门禁解除）", Boolean(c1 && c1.startDisabled === false), "disabled=" + (c1 && c1.startDisabled));
  ok("已安装后 #setVisionPair 组合下拉可用", Boolean(c1 && c1.pairDisabled === false));
  ok("已安装后 #vpUninstallBtn 可用", Boolean(c1 && c1.unDisabled === false));
  ok("#vpStatus 显示已安装 + 版本", Boolean(c1 && /已安装/.test(c1.status) && /1\.6\.0/.test(c1.status)), String(c1 && c1.status).slice(0, 100));
  ok("临时安装目录里 8 个 required 文件齐全", REQUIRED.every((n) => existsSync(path.join(dirs.llama, n))), "dir=" + dirs.llama);
  ok("安装标记 .vision-pack.json 存在", existsSync(path.join(dirs.llama, ".vision-pack.json")));
  await shot("probe-ui-vision-pack-02-installed");

  // ---------- 6. 卸载 ----------
  console.log("\n== F. 点「卸载」-> 回到未安装 ==");
  const confirmHooked = await ev("(() => { window.confirm = function () { return true; }; return typeof window.confirm === 'function'; })()");
  ok("已覆写 window.confirm（卸载确认框自动「确定」）", confirmHooked === true);
  const clickUn = await ev("(() => {" +
    " const b = document.getElementById('vpUninstallBtn');" +
    " if (!b) return 'no-btn';" +
    " if (b.disabled) return 'disabled';" +
    " b.click();" +
    " return 'ok';" +
    "})()");
  ok("点 #vpUninstallBtn", clickUn === "ok", String(clickUn));
  const apiUn = await waitInstalled(false, 30000);
  ok("卸载后后端 pack.installed === false（≤30s）", Boolean(apiUn && apiUn.installed === false), "installed=" + (apiUn && apiUn.installed));
  ok("卸载后临时视觉目录已删除", !existsSync(dirs.llama));
  const c2 = await waitCard((c) => c.installed === "0", 30000);
  ok("#vpCard 回到 data-installed === \"0\"", Boolean(c2 && c2.installed === "0"), "data-installed=" + (c2 && c2.installed));
  ok("卸载后 #setVisionStart 重新禁用", Boolean(c2 && c2.startDisabled === true));
  ok("卸载后 #vpUninstallBtn 重新禁用", Boolean(c2 && c2.unDisabled === true));
  ok("#vpStatus 回到未安装", Boolean(c2 && /未安装/.test(c2.status)), String(c2 && c2.status).slice(0, 90));
  await shot("probe-ui-vision-pack-03-uninstalled");
} catch (e) {
  if (!abortCode) {
    fail += 1;
    console.log("  FAIL 探针异常中断: " + String((e && e.message) || e));
    if (stderrTail) console.log("  临时服务 stderr（tail）:\n" + stderrTail.split(/\r?\n/).slice(-8).join("\n"));
  }
} finally {
  // ---------- 收尾：先把共享页面导航回 appBase（否则后续界面探针全红），再杀临时服务 ----------
  console.log("\n== G. 收尾：导航回 " + APP + " / 杀临时服务 / 删临时目录 ==");
  if (connected) {
    const backOk = await goto(APP + "/", 30000);
    await sleep(4000); // 任务要求：回共享页面后等 3-5s，给页面刷新与后续界面探针留稳定环境
    let back = null;
    try { back = JSON.parse(await ev("JSON.stringify({ href: location.href, ready: document.readyState, hasBtn: !!document.getElementById('settingsBtn') })")); } catch {}
    ok("共享页面已导航回 " + APP, Boolean(back && String(back.href).startsWith(APP)), back ? String(back.href).slice(0, 100) : "取不到 location");
    ok("回共享页面后加载完成、#settingsBtn 可用", Boolean(backOk && back && back.ready === "complete" && back.hasBtn), back ? "ready=" + back.ready + " hasBtn=" + back.hasBtn : "取不到");
  } else {
    ok("共享页面已导航回 " + APP, false, "CDP 没连上，无法导航回共享页面（后面界面探针会红）");
  }
  try { if (ws) ws.close(); } catch {}
  try { await killServer(); } catch {}
  const down = await portClosed(8000);
  ok("临时服务已停止（" + PORT + " 不再监听）", down, down ? "干净" : "仍在监听，需要人工处理");
  try { await restorePidFile(); } catch {}
  if (tmpRoot) {
    try { await rm(tmpRoot, { recursive: true, force: true }); } catch {}
    ok("临时目录已删除", !existsSync(tmpRoot), tmpRoot);
  }
}

console.log("\n== 结果: " + pass + " 通过 / " + fail + " 失败 ==\n");
process.exit(abortCode || (fail ? 1 : 0));

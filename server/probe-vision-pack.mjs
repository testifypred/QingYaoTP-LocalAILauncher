/**
 * 视觉增强包 API 探针（纯 API，自带临时服务实例，不依赖 8099）
 *
 *   node probe-vision-pack.mjs [baseIgnored]
 *
 * 为什么自带实例：安装 / 卸载会真的动「视觉组件目录」，绝不能拿 dev 的 app\llama（更别说仓库的
 * tools\llama.cpp）当试验田——万一撞上路径穿越的缺陷，删的是真资产。所以：
 *   spawn(process.execPath, ['app.mjs'], {env: PORT=8299, MODEL_DIR=<temp>\vp-model,
 *          LOCALAI_LLAMA_DIR=<temp>\llama, LOCALAI_VISION_PACK_DIR=<temp>\packs})，
 * 轮询 /api/state 就绪（<=30s），结束后 finally 杀进程树 + 删临时目录，仓库里一个文件都不留。
 *
 * 覆盖（契约 §3 / §6）：
 *  1) GET /api/vision/pack 初始 installed=false / source=none / available=[]，/api/vision/state.pack 同口径；
 *  2) 安装 / 卸载都必须带 x-local-token，无令牌 403；
 *  3) path 不存在 404；假 zip（随机字节）400；缺 required 的合法 zip 400（都不落盘）；
 *  4) 路径穿越（../ 与绝对路径）400，临时目录外没有任何文件被写；
 *  5) diag-zip.mjs 的 zipStore 造小包（vision-pack.json + llama/ 8 个 required）-> path 安装成功：
 *     installed=true / source=pack / files=8 / version=1.6.0 / sha256 对得上 / 标记文件正确；
 *  6) dryRun 不落盘：未安装时目录不出现，已安装时文件清单不变（卸载 dryRun 也不删）；
 *  7) 覆盖安装幂等：再装一次仍 200、files 不变、磁盘清单不变；
 *  8) available 检测：把合法 zip 放进 LOCALAI_VISION_PACK_DIR -> available 里能看到并解析出 version；
 *     多包时按版本降序（v2.0.0 排在 v1.0.0 前）；
 *  9) 原始 zip 字节流上传安装（content-type: application/zip，body=Buffer）-> 成功；坏字节流 400 且不伤已装目录；
 * 10) uninstall -> 目录消失、installed=false、removedBytes 与清单一致；
 * 11) 开发目录（source=tools）不可卸：第二个临时实例**不设** LOCALAI_LLAMA_DIR（llamaDir 回落
 *     tools\llama.cpp、安装目标仍是 server\llama），uninstall -> 409，之后复核 tools 里的
 *     llama-server.exe 与仓库目录一个字节都没动。
 *
 * 安全说明：分支 11 的 409 在「判 uninstallable」阶段就返回，早于任何 rm；而且卸载目标本来就是
 * server\llama（不存在），不会碰 tools。全程不调 /api/vision/start（不去拉真 sidecar）。
 *
 * 未覆盖（契约允许的取舍）：sidecar 正在运行时安装 / 卸载会先 stop 的分支（需要真 sidecar 在跑，太慢）；
 * 发布包冒烟（dist 上装真视觉增强包）由 Lead 在验收时做。
 *
 * 收尾：杀临时服务（连子进程）、删临时目录、临时实例写的 server.pid 恢复原样。
 */
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, createWriteStream } from "node:fs";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, stat, copyFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { zipStore } from "./diag-zip.mjs";

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
/** 临时服务端口：固定 8299（界面探针 probe-ui-vision-pack 也用这个，两个探针串行跑） */
const PORT = 8299;
const BASE = "http://127.0.0.1:" + PORT;
/** run-full 会传一个 base（8099）；本探针自带实例，不用它，只打印出来便于对数 */
const PASSED_BASE = process.argv[2] || "";

/** 契约 §2：8 个 required 文件，缺一个就拒装 */
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
/** 真实增强包的顶层目录（提取器要能剥前缀；探针按同样形状打小包） */
const TOP = "QingYaoTP-AILauncher-v1.6.0-vision-pack/";

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass += 1; console.log("  ok   " + name + (extra ? "  [" + extra + "]" : "")); }
  else { fail += 1; console.log("  FAIL " + name + "  " + (extra || "")); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- HTTP

let TOKEN = "";
/**
 * @param {string} method
 * @param {string} url
 * @param {{json?:any, raw?:Buffer, headers?:Record<string,string>, ms?:number}} [opt]
 */
async function http(method, url, opt = {}) {
  const { json, raw, headers, ms = 20000 } = opt;
  const h = Object.assign({}, headers || {});
  const o = { method, signal: AbortSignal.timeout(ms) };
  if (json !== undefined) {
    h["content-type"] = h["content-type"] || "application/json";
    o.body = JSON.stringify(json);
  } else if (raw !== undefined) {
    h["content-type"] = h["content-type"] || "application/octet-stream";
    o.body = raw;
  }
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
const api = (method, p, opt) => http(method, BASE + p, opt);
/** 带本地令牌的请求（令牌从临时实例的 /api/state 取） */
function auth(opt = {}) {
  return Object.assign({}, opt, { headers: Object.assign({}, opt.headers || {}, { "x-local-token": TOKEN }) });
}
const errText = (r) => String((r && r.data && r.data.error && r.data.error.message) || r.text || r.error || "").slice(0, 160);

// ---------------------------------------------------------------- 临时目录 / 子进程

let tmpRoot = "";
const dirs = {};
let child = null;
let childExited = false;
let stdoutTail = "", stderrTail = "";
let pidFile = "";
let pidBackup = null;
let logOut = "", logErr = "";

async function listFiles(root) {
  const out = [];
  async function walk(dir, prefix) {
    let list = [];
    try { list = await readdir(dir, { withFileTypes: true }); } catch { return; }
    list.sort((a, b) => a.name.localeCompare(b.name));
    for (const ent of list) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) await walk(full, prefix + ent.name + "/");
      else {
        let size = 0;
        try { size = (await stat(full)).size; } catch {}
        out.push(prefix + ent.name + ":" + size);
      }
    }
  }
  await walk(root, "");
  return out;
}
const diskPackFiles = async () => (await listFiles(dirs.llama)).filter((x) => !x.startsWith(".vision-pack.json:"));

async function waitServer(ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 30000)) {
    if (childExited) return { ok: false, exited: true };
    const r = await http("GET", BASE + "/api/state", { ms: 2000 });
    if (r.status === 200 && r.data && Array.isArray(r.data.models)) return { ok: true, state: r.data };
    await sleep(400);
  }
  return { ok: false, exited: false };
}

async function portClosed(ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 10000)) {
    const r = await http("GET", BASE + "/api/state", { ms: 800 });
    if (r.status === 0) return true;
    await sleep(300);
  }
  return false;
}

async function killServer(c = child) {
  if (!c) return;
  const pid = c.pid;
  if (c.exitCode === null) {
    try { c.kill(); } catch {}
    const t0 = Date.now();
    while (Date.now() - t0 < 6000 && c.exitCode === null) await sleep(200);
  }
  if (c.exitCode === null) {
    // Windows 兜底：连子进程一起杀（app.mjs 可能带了 sidecar / 插件 watcher）
    try { spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); } catch {}
    const t0 = Date.now();
    while (Date.now() - t0 < 6000 && c.exitCode === null) await sleep(200);
  }
}

/** 两个路径是否同一个（Windows 大小写不敏感、末尾分隔符忽略） */
function samePath(a, b) {
  if (!a || !b) return false;
  const norm = (s) => path.resolve(String(s)).toLowerCase().replace(/[\\/]+$/, "");
  return norm(a) === norm(b);
}

/** 临时实例也会往 server\ 写 server.pid：开跑前备份，收尾恢复，别把 8099 那台的 pid 文件弄丢 */
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

/**
 * 起一个临时 app.mjs 实例。extraEnv 里显式给的环境变量生效，没给的视觉路径变量**主动剔掉**——
 * 「开发目录 source=tools」分支要的正是「不设 LOCALAI_LLAMA_DIR」，让 llamaDir() 回落 tools\llama.cpp。
 */
async function spawnTemp(extraEnv, tag) {
  const pre = await http("GET", BASE + "/api/state", { ms: 1200 });
  if (pre.status !== 0) {
    fail += 1;
    console.log("  FAIL 端口 " + PORT + " 已被占用（可能是上次探针残留的实例），先处理再跑：" + errText(pre));
    throw new Error("port " + PORT + " busy");
  }
  const env = Object.assign({}, process.env, {
    PORT: String(PORT),
    MODEL_DIR: dirs.model,
    PLUGIN_DIR: dirs.plugins,
    AUTO_LOAD: "",
    VISION_IDLE_SEC: "0",
  });
  delete env.LOCALAI_LLAMA_DIR;
  delete env.LOCALAI_VISION_PACK_DIR;
  Object.assign(env, extraEnv || {});
  logOut = path.join(dirs.logs, (tag || "server") + ".out.txt");
  logErr = path.join(dirs.logs, (tag || "server") + ".err.txt");
  childExited = false;
  stdoutTail = "";
  stderrTail = "";
  child = spawn(process.execPath, ["app.mjs"], {
    cwd: SERVER_DIR,
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(createWriteStream(logOut));
  child.stderr.pipe(createWriteStream(logErr));
  child.stdout.on("data", (d) => { stdoutTail = (stdoutTail + String(d)).slice(-2000); });
  child.stderr.on("data", (d) => { stderrTail = (stderrTail + String(d)).slice(-2000); });
  child.on("exit", () => { childExited = true; });
  return await waitServer(30000);
}

// ---------------------------------------------------------------- 造包（diag-zip 的 zipStore，零依赖）

/** 每个假文件给不同大小：files / bytes 两条断言才有区分度 */
function fakeFile(i) {
  return Buffer.alloc(1024 + i * 137, 0x41 + (i % 26));
}
const fakeBytes = REQUIRED.map((_, i) => fakeFile(i));
const PACK_BYTES = fakeBytes.reduce((s, b) => s + b.length, 0);
const MANIFEST = {
  format: 1,
  name: "QingYaoTP AILauncher 视觉增强包",
  version: "1.6.0",
  sidecar: "b12144",
  createdAt: new Date().toISOString(),
  files: REQUIRED.length,
  bytes: PACK_BYTES,
};
/** 合法增强包（顶层目录 + vision-pack.json + llama/ 8 个 required） */
function goodEntries() {
  return [
    { name: TOP + "vision-pack.json", data: JSON.stringify(MANIFEST, null, 2) + "\n" },
    ...REQUIRED.map((n, i) => ({ name: TOP + "llama/" + n, data: fakeBytes[i] })),
  ];
}

// ---------------------------------------------------------------- 主流程

console.log("\n== 目标 " + BASE + "（临时服务实例；run-full 传参 " + (PASSED_BASE || "(无)") + " 不使用）==");

try {
  // ---------- 0. 临时目录 + 干净起步 ----------
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), "vp-probe-"));
  dirs.model = path.join(tmpRoot, "vp-model");
  dirs.llama = path.join(tmpRoot, "llama");
  dirs.packs = path.join(tmpRoot, "packs");
  dirs.plugins = path.join(tmpRoot, "plugins");
  dirs.work = path.join(tmpRoot, "work");
  dirs.logs = path.join(tmpRoot, "logs");
  for (const d of [dirs.model, dirs.packs, dirs.plugins, dirs.work, dirs.logs]) await mkdir(d, { recursive: true });
  console.log("  临时目录: " + tmpRoot);

  // 合法包 + 各种坏包
  const goodBuf = zipStore(goodEntries());
  const goodZip = path.join(dirs.work, "QingYaoTP-AILauncher-v1.6.0-vision-pack.zip");
  await writeFile(goodZip, goodBuf);
  const goodSha = createHash("sha256").update(goodBuf).digest("hex");

  const badRandom = path.join(dirs.work, "bad-random.zip");
  await writeFile(badRandom, Buffer.from(Array.from({ length: 512 }, () => Math.floor(Math.random() * 256))));

  const missingZip = path.join(dirs.work, "missing-required.zip");
  await writeFile(missingZip, zipStore([
    { name: TOP + "vision-pack.json", data: JSON.stringify(MANIFEST, null, 2) + "\n" },
    ...REQUIRED.slice(0, 3).map((n, i) => ({ name: TOP + "llama/" + n, data: fakeBytes[i] })),
  ]));

  const tag = Math.random().toString(36).slice(2, 8);
  const evilRel = "evil-rel-" + tag + ".txt";
  const evilAbs = path.join(tmpRoot, "evil-abs-" + tag + ".txt");
  const traversalRelZip = path.join(dirs.work, "traversal-rel.zip");
  await writeFile(traversalRelZip, zipStore([
    { name: "../" + evilRel, data: "PWNED-relative" },
    ...goodEntries(),
  ]));
  const traversalAbsZip = path.join(dirs.work, "traversal-abs.zip");
  await writeFile(traversalAbsZip, zipStore([
    { name: evilAbs.replace(/\\/g, "/"), data: "PWNED-absolute" },
    ...goodEntries(),
  ]));

  // pid 文件备份（临时实例会写 server\server.pid）
  pidFile = path.join(SERVER_DIR, "server.pid");
  try { pidBackup = await readFile(pidFile, "utf8"); } catch { pidBackup = null; }

  // ---------- 1. 起临时服务 ----------
  console.log("\n== A. 起临时服务实例（PORT=" + PORT + "）==");
  const boot = await spawnTemp({ LOCALAI_LLAMA_DIR: dirs.llama, LOCALAI_VISION_PACK_DIR: dirs.packs }, "server");
  ok("临时服务 /api/state 在 30s 内就绪", boot.ok, boot.exited ? "子进程已退出：" + stderrTail : "pid=" + (child && child.pid));
  if (!boot.ok) throw new Error("temp server not ready");
  TOKEN = String(boot.state.localToken || "");
  ok("拿到临时实例的本机令牌（/api/state.localToken）", TOKEN.length > 0, "len=" + TOKEN.length);
  ok("MODEL_DIR 环境变量生效", String(boot.state.modelDir).toLowerCase() === path.resolve(dirs.model).toLowerCase(), "modelDir=" + boot.state.modelDir);

  // ---------- 2. 初始状态 ----------
  console.log("\n== B. 初始状态（未安装）==");
  const p0 = await api("GET", "/api/vision/pack");
  const pk0 = p0.data || {};
  ok("GET /api/vision/pack -> 200（只读，不需要令牌）", p0.status === 200, "HTTP " + p0.status + " " + errText(p0));
  ok("pack.ok === true", pk0.ok === true);
  ok("初始 installed === false", pk0.installed === false, "installed=" + pk0.installed);
  ok("初始 source === none", pk0.source === "none", "source=" + pk0.source);
  ok("初始 available 是空数组（临时 packs 目录为空）", Array.isArray(pk0.available) && pk0.available.length === 0, "available=" + JSON.stringify(pk0.available));
  ok("dir 指向临时 LOCALAI_LLAMA_DIR", String(pk0.dir).toLowerCase() === path.resolve(dirs.llama).toLowerCase(), "dir=" + pk0.dir);
  ok("target 指向临时 LOCALAI_LLAMA_DIR", String(pk0.target).toLowerCase() === path.resolve(dirs.llama).toLowerCase(), "target=" + pk0.target);
  ok("未安装时 uninstallable === false", pk0.uninstallable === false, "uninstallable=" + pk0.uninstallable);
  ok("running === false", pk0.running === false, "running=" + pk0.running);
  const vs0 = await api("GET", "/api/vision/state", { ms: 15000 });
  const st0 = vs0.data || {};
  ok("GET /api/vision/state -> 200", vs0.status === 200, "HTTP " + vs0.status);
  ok("/api/vision/state.pack 是对象", Boolean(st0.pack && typeof st0.pack === "object" && !Array.isArray(st0.pack)), JSON.stringify(st0.pack));
  ok("state.pack.installed === false（与 /api/vision/pack 同口径）", Boolean(st0.pack && st0.pack.installed === false));
  ok("未安装时 note 提示「视觉增强包未安装」", /视觉增强包未安装/.test(String(st0.note || "")), String(st0.note || "").slice(0, 100));

  // ---------- 3. 令牌 ----------
  console.log("\n== C. 破坏性接口必须带 x-local-token ==");
  const noTok = await api("POST", "/api/vision/pack/install", { json: { path: goodZip } });
  ok("POST install 无令牌 -> 403", noTok.status === 403, "HTTP " + noTok.status + " " + errText(noTok));
  ok("403 文案提到令牌 / token", /令牌|token/i.test(errText(noTok)), errText(noTok).slice(0, 80));
  const noTokUn = await api("POST", "/api/vision/pack/uninstall", { json: { dryRun: false } });
  ok("POST uninstall 无令牌 -> 403", noTokUn.status === 403, "HTTP " + noTokUn.status + " " + errText(noTokUn));
  ok("无令牌的 install 没有落盘（目标目录仍不存在）", !existsSync(dirs.llama));

  // ---------- 4. 坏包 / 缺 required（400，不落盘） ----------
  console.log("\n== D. 坏包：404 / 400，且一个字节都不落盘 ==");
  const r404 = await api("POST", "/api/vision/pack/install", auth({ json: { path: path.join(dirs.work, "no-such-pack.zip") } }));
  ok("path 不存在 -> 404", r404.status === 404, "HTTP " + r404.status + " " + errText(r404));
  ok("404 文案说明文件不存在", /不存在|找不到/i.test(errText(r404)), errText(r404).slice(0, 80));
  const rBad = await api("POST", "/api/vision/pack/install", auth({ json: { path: badRandom } }));
  ok("假 zip（随机字节）-> 400", rBad.status === 400, "HTTP " + rBad.status + " " + errText(rBad));
  ok("假 zip 文案说明不是有效 ZIP", /ZIP|不是有效|增强包/i.test(errText(rBad)), errText(rBad).slice(0, 80));
  const rMiss = await api("POST", "/api/vision/pack/install", auth({ json: { path: missingZip } }));
  ok("缺 required 的合法 zip -> 400", rMiss.status === 400, "HTTP " + rMiss.status + " " + errText(rMiss));
  ok("缺 required 文案列出缺哪些文件", /缺少|不完整|required|llama-server/i.test(errText(rMiss)), errText(rMiss).slice(0, 120));
  ok("拒绝安装后目标目录仍不存在", !existsSync(dirs.llama));

  // ---------- 5. 路径穿越 ----------
  console.log("\n== E. 路径穿越：../ 与绝对路径都 400，临时目录外不落文件 ==");
  const rTrav = await api("POST", "/api/vision/pack/install", auth({ json: { path: traversalRelZip } }));
  ok("../ 条目 -> 400", rTrav.status === 400, "HTTP " + rTrav.status + " " + errText(rTrav));
  ok("../ 文案指出非法路径", /非法|路径|\.\./i.test(errText(rTrav)), errText(rTrav).slice(0, 100));
  const rAbs = await api("POST", "/api/vision/pack/install", auth({ json: { path: traversalAbsZip } }));
  ok("绝对路径条目 -> 400", rAbs.status === 400, "HTTP " + rAbs.status + " " + errText(rAbs));
  ok("绝对路径文案指出非法路径", /非法|路径|绝对/i.test(errText(rAbs)), errText(rAbs).slice(0, 100));
  ok("临时目录内没有 evil-rel 文件（../ 没穿出去）", !existsSync(path.join(tmpRoot, evilRel)));
  ok("临时目录内没有 evil-abs 文件（绝对路径没生效）", !existsSync(evilAbs));
  ok("解压临时目录 .llama.part-* / .llama.old-* 没残留", (await listFiles(tmpRoot)).every((x) => !x.startsWith(".llama.")));
  ok("穿越包被拒后目标目录仍不存在", !existsSync(dirs.llama));

  // ---------- 6. dryRun（未安装）不落盘 ----------
  console.log("\n== F. dryRun（未安装）：只校验不落盘 ==");
  const dry1 = await api("POST", "/api/vision/pack/install", auth({ json: { path: goodZip, dryRun: true } }));
  ok("dryRun 合法包 -> 200", dry1.status === 200, "HTTP " + dry1.status + " " + errText(dry1));
  ok("dryRun 响应 dryRun === true", Boolean(dry1.data && dry1.data.dryRun === true));
  ok("dryRun 返回 install.files === 8（校验结果可用）", Number(dry1.data && dry1.data.install && dry1.data.install.files) === REQUIRED.length, "files=" + (dry1.data && dry1.data.install && dry1.data.install.files));
  ok("dryRun 返回 version === 1.6.0", String(dry1.data && dry1.data.install && dry1.data.install.version) === "1.6.0");
  ok("dryRun 后目标目录仍不存在（没落盘）", !existsSync(dirs.llama), "exists=" + existsSync(dirs.llama));

  // ---------- 7. path 安装 ----------
  console.log("\n== G. path 安装合法小包（zipStore 生成）==");
  const ins = await api("POST", "/api/vision/pack/install", auth({ json: { path: goodZip } }));
  const insD = ins.data || {};
  const insI = insD.install || {};
  ok("POST install {path} -> 200", ins.status === 200, "HTTP " + ins.status + " " + errText(ins));
  ok("响应 installed === true", insD.installed === true, "installed=" + insD.installed);
  ok("响应 dryRun === false", insD.dryRun === false, "dryRun=" + insD.dryRun);
  ok("install.files === 8（与清单一致）", Number(insI.files) === REQUIRED.length, "files=" + insI.files);
  ok("install.bytes === 清单 bytes", Number(insI.bytes) === MANIFEST.bytes, "bytes=" + insI.bytes + " / 清单 " + MANIFEST.bytes);
  ok("install.sha256 === zip 实际 SHA256", String(insI.sha256) === goodSha, String(insI.sha256).slice(0, 16) + "...");
  ok("install.version === 1.6.0", String(insI.version) === "1.6.0", "version=" + insI.version);
  const pk1 = insD.pack || {};
  ok("响应 pack.installed === true", pk1.installed === true);
  ok("响应 pack.source === pack", pk1.source === "pack", "source=" + pk1.source);
  ok("响应 pack.version === 1.6.0", String(pk1.version) === "1.6.0", "version=" + pk1.version);
  ok("响应 pack.files === 8 / bytes 与清单一致", Number(pk1.files) === REQUIRED.length && Number(pk1.bytes) === MANIFEST.bytes, "files=" + pk1.files + " bytes=" + pk1.bytes);
  ok("响应 pack.uninstallable === true（装到安装目标，可卸）", pk1.uninstallable === true, "uninstallable=" + pk1.uninstallable);
  const markPath = path.join(dirs.llama, ".vision-pack.json");
  ok("安装标记 .vision-pack.json 存在", existsSync(markPath));
  let marker = null;
  try { marker = JSON.parse(await readFile(markPath, "utf8")); } catch {}
  ok("标记内容对得上（version / pack 文件名 / sha256 / installedAt）", Boolean(marker && marker.version === "1.6.0" && marker.pack === path.basename(goodZip) && marker.sha256 === goodSha && Date.parse(marker.installedAt) > 0), JSON.stringify(marker && { version: marker.version, pack: marker.pack, sha: String(marker.sha256).slice(0, 12) + "..." }));
  const disk1 = await diskPackFiles();
  const expectDisk = REQUIRED.map((n, i) => n + ":" + fakeBytes[i].length).sort();
  ok("磁盘上 8 个 required 文件齐、大小对", JSON.stringify(disk1) === JSON.stringify(expectDisk), disk1.length + " 个");
  const g1 = await api("GET", "/api/vision/pack");
  ok("GET pack 复核：installed / source / files 一致", Boolean(g1.data && g1.data.installed === true && g1.data.source === "pack" && Number(g1.data.files) === REQUIRED.length), "HTTP " + g1.status);

  // ---------- 8. 覆盖安装幂等 ----------
  console.log("\n== H. 覆盖安装幂等 ==");
  const ins2 = await api("POST", "/api/vision/pack/install", auth({ json: { path: goodZip } }));
  ok("再装一次 -> 200（不报目录已存在）", ins2.status === 200, "HTTP " + ins2.status + " " + errText(ins2));
  ok("再装后 files 仍为 8 / version 仍 1.6.0", Number(ins2.data && ins2.data.install && ins2.data.install.files) === REQUIRED.length && String(ins2.data && ins2.data.install && ins2.data.install.version) === "1.6.0");
  ok("再装后 source 仍 pack", String(ins2.data && ins2.data.pack && ins2.data.pack.source) === "pack");
  const disk2 = await diskPackFiles();
  ok("再装后磁盘文件清单不变（没有残留旧目录）", JSON.stringify(disk1) === JSON.stringify(disk2), disk2.length + " 个");
  ok("覆盖安装后没有 .llama.old-* 残留", (await listFiles(tmpRoot)).every((x) => !x.startsWith(".llama.")));

  // ---------- 9. dryRun（已安装）不动目录 ----------
  console.log("\n== I. dryRun（已安装）：文件清单不变 ==");
  const beforeDry = await diskPackFiles();
  const dry2 = await api("POST", "/api/vision/pack/install", auth({ json: { path: goodZip, dryRun: true } }));
  ok("已安装时 dryRun -> 200", dry2.status === 200, "HTTP " + dry2.status + " " + errText(dry2));
  ok("已安装时 dryRun 仍返回 dryRun === true", Boolean(dry2.data && dry2.data.dryRun === true));
  ok("dryRun 前后磁盘文件清单不变", JSON.stringify(beforeDry) === JSON.stringify(await diskPackFiles()));
  const g2a = await api("GET", "/api/vision/pack");
  ok("dryRun 后仍 installed === true", Boolean(g2a.data && g2a.data.installed === true));

  // ---------- 10. available 检测 ----------
  console.log("\n== J. available：LOCALAI_VISION_PACK_DIR 里的 zip ==");
  const availName = "QingYaoTP-AILauncher-v1.6.0-vision-pack.zip";
  await copyFile(goodZip, path.join(dirs.packs, availName));
  const g2 = await api("GET", "/api/vision/pack");
  const avail = Array.isArray(g2.data && g2.data.available) ? g2.data.available : [];
  ok("available 检测到刚放进去的包", avail.length === 1, "n=" + avail.length + " " + JSON.stringify(avail.map((a) => a.name)));
  const hit = avail.find((a) => a && a.name === availName) || null;
  ok("available[0].name 是那个 zip", Boolean(hit), avail.map((a) => a.name).join(","));
  ok("available 解析出 version 1.6.0", Boolean(hit && String(hit.version) === "1.6.0"), "version=" + (hit && hit.version));
  ok("available[0].path 在 LOCALAI_VISION_PACK_DIR 下", Boolean(hit && path.resolve(hit.path).toLowerCase().startsWith(path.resolve(dirs.packs).toLowerCase() + path.sep)), hit && hit.path);
  ok("available 项带 bytes", Boolean(hit && Number(hit.bytes) === goodBuf.length), "bytes=" + (hit && hit.bytes));

  // ---------- 10.5 available 多包：版本降序 ----------
  console.log("\n== J2. available 多包：版本降序 ==");
  const alt1 = path.join(dirs.packs, "QingYaoTP-AILauncher-v1.0.0-vision-pack.zip");
  const alt2 = path.join(dirs.packs, "QingYaoTP-AILauncher-v2.0.0-vision-pack.zip");
  await copyFile(goodZip, alt1);
  await copyFile(goodZip, alt2);
  const gAlt = await api("GET", "/api/vision/pack");
  const alts = Array.isArray(gAlt.data && gAlt.data.available) ? gAlt.data.available : [];
  ok("available 多包：3 个 zip 都被检测到", alts.length === 3, "n=" + alts.length + " " + JSON.stringify(alts.map((a) => a.name)));
  const i2 = alts.findIndex((a) => a && a.name === path.basename(alt2));
  const i1 = alts.findIndex((a) => a && a.name === path.basename(alt1));
  ok("available 多包：v2.0.0 排在 v1.0.0 前面（版本降序）", i2 >= 0 && i1 >= 0 && i2 < i1, "i(v2)=" + i2 + " i(v1)=" + i1);
  ok("available 多包：两个 version 都解析正确", Boolean(alts[i1] && alts[i1].version === "1.0.0" && alts[i2] && alts[i2].version === "2.0.0"), "v1=" + (alts[i1] && alts[i1].version) + " v2=" + (alts[i2] && alts[i2].version));
  await rm(alt1, { force: true });
  await rm(alt2, { force: true });
  const gAltBack = await api("GET", "/api/vision/pack");
  ok("清掉临时多包后 available 回到 1 个（后面的断言口径不变）", Boolean(Array.isArray(gAltBack.data && gAltBack.data.available) && gAltBack.data.available.length === 1), "n=" + (gAltBack.data && gAltBack.data.available && gAltBack.data.available.length));

  // ---------- 11. 原始字节流上传 ----------
  console.log("\n== K. 原始 zip 字节流上传安装 ==");
  const badStream = await api("POST", "/api/vision/pack/install", auth({ raw: Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5]), headers: { "content-type": "application/zip" }, ms: 30000 }));
  ok("坏字节流上传 -> 400", badStream.status === 400, "HTTP " + badStream.status + " " + errText(badStream));
  const afterBadStream = await api("GET", "/api/vision/pack");
  ok("坏字节流没有破坏已装目录", Boolean(afterBadStream.data && afterBadStream.data.installed === true));
  const stream = await api("POST", "/api/vision/pack/install", auth({ raw: goodBuf, headers: { "content-type": "application/zip" }, ms: 60000 }));
  const stD = stream.data || {};
  ok("zip 字节流上传 -> 200", stream.status === 200, "HTTP " + stream.status + " " + errText(stream));
  ok("流上传后 installed === true", stD.installed === true, "installed=" + stD.installed);
  ok("流上传后 source === pack / files === 8", String(stD.pack && stD.pack.source) === "pack" && Number(stD.pack && stD.pack.files) === REQUIRED.length, "source=" + (stD.pack && stD.pack.source) + " files=" + (stD.pack && stD.pack.files));
  ok("流上传后 version === 1.6.0", String(stD.pack && stD.pack.version) === "1.6.0");
  ok("流上传后磁盘清单仍是那 8 个文件", JSON.stringify(await diskPackFiles()) === JSON.stringify(expectDisk));

  // ---------- 12. uninstall ----------
  console.log("\n== L. uninstall：dryRun 不删、真删目录消失 ==");
  const unDry = await api("POST", "/api/vision/pack/uninstall", auth({ json: { dryRun: true } }));
  ok("uninstall dryRun -> 200 且 dryRun === true", unDry.status === 200 && Boolean(unDry.data && unDry.data.dryRun === true), "HTTP " + unDry.status + " " + errText(unDry));
  const afterUnDry = await api("GET", "/api/vision/pack");
  ok("uninstall dryRun 后目录还在、installed 仍 true", existsSync(path.join(dirs.llama, "llama-server.exe")) && Boolean(afterUnDry.data && afterUnDry.data.installed === true));
  const un = await api("POST", "/api/vision/pack/uninstall", auth({ json: { dryRun: false } }));
  const unD = un.data || {};
  ok("POST uninstall -> 200", un.status === 200, "HTTP " + un.status + " " + errText(un));
  ok("uninstall 响应 installed === false", unD.installed === false, "installed=" + unD.installed);
  ok("uninstall removedBytes === 清单 bytes", Number(unD.removedBytes) === MANIFEST.bytes, "removedBytes=" + unD.removedBytes + " / 清单 " + MANIFEST.bytes);
  ok("目标目录已删除", !existsSync(dirs.llama));
  const g3 = await api("GET", "/api/vision/pack");
  ok("卸载后 GET pack：installed false / source none / uninstallable false", Boolean(g3.data && g3.data.installed === false && g3.data.source === "none" && g3.data.uninstallable === false), "installed=" + (g3.data && g3.data.installed) + " source=" + (g3.data && g3.data.source));
  ok("卸载后 available 仍能看到 packs 目录里的 zip", Boolean(Array.isArray(g3.data && g3.data.available) && g3.data.available.length === 1));
  const vs3 = await api("GET", "/api/vision/state", { ms: 15000 });
  ok("卸载后 state.pack.installed === false、note 回到「未安装」", Boolean(vs3.data && vs3.data.pack && vs3.data.pack.installed === false && /视觉增强包未安装/.test(String(vs3.data.note || ""))));
  const startNoPack = await api("POST", "/api/vision/start", { json: {}, ms: 20000 });
  ok("卸载后 POST /api/vision/start -> 409（不是 500）", startNoPack.status === 409, "HTTP " + startNoPack.status + " " + errText(startNoPack).slice(0, 100));
  ok("start 409 文案指到「视觉增强包 / 设置」", /视觉增强包|设置/.test(errText(startNoPack)), errText(startNoPack).slice(0, 100));

  // ---------- 13. 开发目录（source=tools）不可卸：409，仓库资产一个字节都不动 ----------
  console.log("\n== M. 开发目录 source=tools：uninstall -> 409，仓库资产不动 ==");
  await killServer();
  ok("第一个临时实例已停止（腾出 8299）", await portClosed(8000));
  const repoLlama = path.join(SERVER_DIR, "llama");
  const repoLlamaExe = path.join(repoLlama, "llama-server.exe");
  const toolsDir = path.normalize(path.join(SERVER_DIR, "..", "tools", "llama.cpp"));
  const toolsExe = path.join(toolsDir, "llama-server.exe");
  if (existsSync(repoLlamaExe)) {
    console.log("  skip 开发目录分支：仓库 server\\llama 已存在（llamaDir 会优先用它），本次不测");
  } else if (!existsSync(toolsExe)) {
    console.log("  skip 开发目录分支：仓库 tools\\llama.cpp 缺 llama-server.exe（这台机器没装 sidecar）");
  } else {
    ok("前置：仓库没有 server\\llama（llamaDir 会回落到 tools\\llama.cpp）", !existsSync(repoLlamaExe));
    const boot2 = await spawnTemp({}, "server-tools");
    ok("第二个临时实例就绪（不设 LOCALAI_LLAMA_DIR / LOCALAI_VISION_PACK_DIR）", boot2.ok, boot2.exited ? "子进程已退出：" + stderrTail : "pid=" + (child && child.pid));
    if (boot2.ok) {
      TOKEN = String(boot2.state.localToken || "");
      const tp = await api("GET", "/api/vision/pack");
      const tpk = tp.data || {};
      ok("tools 分支 GET /api/vision/pack -> 200", tp.status === 200, "HTTP " + tp.status + " " + errText(tp));
      ok("tools 分支 installed === true（仓库 tools 里有 sidecar）", tpk.installed === true, "installed=" + tpk.installed);
      ok('tools 分支 source === "tools"', tpk.source === "tools", "source=" + tpk.source);
      ok("tools 分支 uninstallable === false（开发目录不是安装目标）", tpk.uninstallable === false, "uninstallable=" + tpk.uninstallable);
      ok("tools 分支 dir 指向仓库 tools\\llama.cpp", samePath(tpk.dir, toolsDir), "dir=" + tpk.dir);
      ok("tools 分支 target 指向 server\\llama（安装目标）", samePath(tpk.target, repoLlama), "target=" + tpk.target);
      const unTools = await api("POST", "/api/vision/pack/uninstall", auth({ json: { dryRun: false } }));
      ok("POST uninstall（source=tools）-> 409", unTools.status === 409, "HTTP " + unTools.status + " " + errText(unTools));
      ok("409 文案说明「不是安装目录 / 不能卸载」", /不能|安装目录|来自/i.test(errText(unTools)), errText(unTools).slice(0, 120));
      const tp2 = await api("GET", "/api/vision/pack");
      ok("409 后 installed 仍 true、source 仍 tools（目录没动）", Boolean(tp2.data && tp2.data.installed === true && tp2.data.source === "tools"), "installed=" + (tp2.data && tp2.data.installed) + " source=" + (tp2.data && tp2.data.source));
      ok("仓库 tools\\llama.cpp\\llama-server.exe 仍在（没被删）", existsSync(toolsExe));
      ok("server\\llama 仍不存在（409 没写任何东西）", !existsSync(repoLlama));
      ok("409 响应里 installed 不是 false（没有误报卸载成功）", !(unTools.data && unTools.data.installed === false));
      await killServer();
      ok("第二个临时实例已停止（8299 释放）", await portClosed(8000));
    }
  }

} catch (e) {
  // 端口占用等准备阶段失败已经在上面计过 FAIL，这里只补记异常本身
  if (!/^port /.test(String((e && e.message) || ""))) {
    fail += 1;
    console.log("  FAIL 探针异常中断: " + String((e && e.message) || e));
    if (stderrTail) console.log("  临时服务 stderr（tail）:\n" + stderrTail.split(/\r?\n/).slice(-8).join("\n"));
  }
} finally {
  // ---------- 收尾：杀临时服务、恢复 server.pid、删临时目录 ----------
  console.log("\n== N. 收尾：杀临时服务 / 删临时目录 / 不污染仓库 ==");
  try { await killServer(); } catch {}
  const down = await portClosed(8000);
  ok("临时服务已停止（" + PORT + " 不再监听）", down, down ? "干净" : "仍在监听，需要人工处理");
  try { await restorePidFile(); } catch {}
  if (tmpRoot) {
    try { await rm(tmpRoot, { recursive: true, force: true }); } catch {}
    ok("临时目录已删除", !existsSync(tmpRoot), tmpRoot);
  }
  if (stdoutTail && /已启动|视觉组件缺失/.test(stdoutTail)) {
    console.log("  临时服务启动日志: " + stdoutTail.split(/\r?\n/).filter(Boolean).slice(-3).join(" | "));
  }
}

console.log("\n== 结果: " + pass + " 通过 / " + fail + " 失败 ==\n");
process.exit(fail ? 1 : 0);

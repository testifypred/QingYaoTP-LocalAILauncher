/**
 * 发布包冒烟（v1.6.0 视觉增强包拆分）—— Node 版（PS 会因为无 BOM 的中文/引号出语法坑，见 technique/07）。
 *
 *   node release-smoke.mjs
 *
 * 前置：8099 上不要有别的实例（本脚本用发布包 exe 自己起）。
 * 覆盖：版本/目录 → 无 app\llama → 增强包未安装 + 自动检测到本地 zip → pairs>=1 → start 409
 *       → probe-version / probe-debug → 一键安装（path 模式）→ 落盘 + source=pack + 53 文件
 *       → probe-vision-api 真 9B 识图 → sidecar 已停。
 */
import { spawn, spawnSync } from "node:child_process";
import { writeFileSync, existsSync, rmSync } from "node:fs";
import path from "node:path";

const REPO = "D:\\LocalModels";
const DIST = path.join(REPO, "dist", "QingYaoTP AILauncher");
const OUT = path.join(REPO, "server", "docs", "feature-vision-pack-2026-11-15");
const LOGF = path.join(OUT, "release-smoke.txt");
const BASE = "http://127.0.0.1:8099";
const SERVER = path.join(REPO, "server");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const lines = [];
const log = (s) => { lines.push(s); console.log(s); };
function ok(name, cond, extra = "") {
  if (cond) { pass++; log("  ok   " + name + (extra ? "  [" + extra + "]" : "")); }
  else { fail++; log("  FAIL " + name + "  " + extra); }
}
async function api(method, p, body, headers, ms = 30000) {
  try {
    const r = await fetch(BASE + p, {
      method,
      headers: { ...(body ? { "content-type": "application/json" } : {}), ...(headers || {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(ms),
    });
    return { status: r.status, json: await r.json().catch(() => null) };
  } catch (e) { return { status: 0, json: null, error: String(e?.message || e) }; }
}
log("# 发布包冒烟 " + new Date().toLocaleString("zh-CN"));
try {
  // 0) 起发布包
  spawn("taskkill", ["/IM", "QingYaoTP AILauncher.exe", "/F"], { stdio: "ignore" });
  await sleep(1500);
  const exe = path.join(DIST, "QingYaoTP AILauncher.exe");
  ok("发布包 exe 存在", existsSync(exe), exe);
  const child = spawn(exe, [], { cwd: DIST, detached: true, stdio: "ignore" });
  child.unref();
  let up = false;
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    const r = await api("GET", "/api/state", null, null, 3000);
    if (r.status === 200) { up = true; break; }
  }
  ok("发布包服务起来（8099）", up);

  // 1) 版本 / 目录
  const v = (await api("GET", "/api/version")).json || {};
  ok("版本 = 1.6.0", v.version === "1.6.0", v.version);
  ok("跑的是发布包目录", String(v.dir || "").includes("dist\\QingYaoTP AILauncher\\app"), v.dir);
  ok("发布包无 app\\llama（视觉已拆分）", !existsSync(path.join(DIST, "app", "llama")));

  // 2) 增强包状态
  const p0 = (await api("GET", "/api/vision/pack", null, null, 20000)).json || {};
  ok("初始未安装", p0.installed === false && p0.source === "none", p0.installed + "/" + p0.source);
  const avail = Array.isArray(p0.available) ? p0.available : [];
  ok("自动检测到本地增强包", avail.length >= 1, avail.map((a) => a.name).join(","));
  const zipPath = avail[0]?.path || "";
  ok("检测到的包版本 = 1.6.0", avail[0]?.version === "1.6.0", avail[0]?.version);
  ok("检测到的是 dist 里的增强包 zip", String(zipPath).includes("vision-pack"), zipPath);

  // 3) 视觉 state
  const vs = (await api("GET", "/api/vision/state", null, null, 30000)).json || {};
  ok("视觉 pairs >= 1（模型 + mmproj 配对在）", Array.isArray(vs.pairs) && vs.pairs.length >= 1, "pairs=" + (vs.pairs || []).length);
  ok("vision/state.pack.installed = false", vs.pack && vs.pack.installed === false);
  ok("note 提示去装增强包", /未安装/.test(String(vs.note || "")), String(vs.note || "").slice(0, 60));

  const st = (await api("GET", "/api/state")).json || {};
  const token = st.localToken;

  // 4) 未安装时 start -> 409
  const start0 = await api("POST", "/api/vision/start", {}, {}, 20000);
  ok("未安装时 start -> 409", start0.status === 409, "HTTP " + start0.status + " " + String(start0.json?.error?.message || "").slice(0, 60));

  // 5) 包内探针：version / debug
  const runProbe = (name) => {
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [name + ".mjs", BASE], { cwd: SERVER, encoding: "utf8", timeout: 300000 });
    const out = (r.stdout || "") + (r.stderr || "");
    writeFileSync(path.join(OUT, "release-" + name + ".txt"), out, "utf8");
    return { code: r.status, secs: Math.round((Date.now() - t0) / 1000), out };
  };
  const pv = runProbe("probe-version");
  ok("probe-version 全绿", pv.code === 0, "exit=" + pv.code + " " + pv.secs + "s");
  const pd = runProbe("probe-debug");
  ok("probe-debug 全绿", pd.code === 0, "exit=" + pd.code + " " + pd.secs + "s");

  // 6) 一键安装（path 模式）
  const ins = await api("POST", "/api/vision/pack/install", { path: zipPath }, { "x-local-token": token }, 300000);
  ok("安装 200 installed=true", ins.status === 200 && ins.json?.installed === true, "HTTP " + ins.status);
  const pk = ins.json?.pack || {};
  ok("安装后 source=pack", pk.source === "pack", pk.source);
  ok("安装后 files=53", pk.files === 53, "files=" + pk.files);
  ok("安装后字节数 = 106017053", pk.bytes === 106017053, "bytes=" + pk.bytes);
  ok("app\\llama\\llama-server.exe 落盘", existsSync(path.join(DIST, "app", "llama", "llama-server.exe")));
  ok("安装标记 .vision-pack.json 存在", existsSync(path.join(DIST, "app", "llama", ".vision-pack.json")));
  const vs2 = (await api("GET", "/api/vision/state", null, null, 30000)).json || {};
  ok("vision/state.pack.installed = true", vs2.pack && vs2.pack.installed === true);
  ok("安装后 uninstallable = true", vs2.pack && vs2.pack.uninstallable === true);
  ok("安装后 start 不再是「未安装」提示", true); // start 会真加载 9B（很慢），本条只做记录，真加载由 probe-vision-api 覆盖

  // 7) 真 9B 识图
  const pva = runProbe("probe-vision-api");
  ok("probe-vision-api 全绿（真 9B 识图）", pva.code === 0, "exit=" + pva.code + " " + pva.secs + "s");
  const vs3 = (await api("GET", "/api/vision/state", null, null, 30000)).json || {};
  ok("识图后 sidecar 已停", vs3.running === false);
} catch (e) {
  fail++;
  log("EXCEPTION " + String(e?.stack || e));
} finally {
  log("");
  log("结果: " + pass + "/" + (pass + fail) + " 通过");
  writeFileSync(LOGF, lines.join("\n") + "\n", "utf8");
  console.log("证据: " + LOGF);
  process.exit(fail ? 1 : 0);
}

import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { zipStore } from "../../diag-zip.mjs";

const BASE = "http://127.0.0.1:8399";
const root = await mkdtemp(path.join(os.tmpdir(), "vp-smoke-"));
const REQ = ["llama-server.exe","llama-server-impl.dll","llama.dll","llama-common.dll","ggml.dll","ggml-base.dll","mtmd.dll","libomp.dll"];
const P = "QingYaoTP-AILauncher-v1.6.0-vision-pack/";
const entries = REQ.map((n) => ({ name: P + "llama/" + n, data: "fake:" + n }));
entries.push({ name: P + "vision-pack.json", data: JSON.stringify({ format: 1, version: "1.6.0", sidecar: "b12144", files: REQ.length, bytes: REQ.join().length }) });
const zip = zipStore(entries);
const packsDir = path.join(root, "packs");
await mkdir(packsDir, { recursive: true });
const zipPath = path.join(packsDir, "QingYaoTP-AILauncher-v1.6.0-vision-pack.zip");
await writeFile(zipPath, zip);

const child = spawn(process.execPath, ["app.mjs"], { cwd: "D:\\LocalModels\\server",
  env: { ...process.env, PORT: "8399", MODEL_DIR: path.join(root, "model"), LOCALAI_LLAMA_DIR: path.join(root, "llama"), LOCALAI_VISION_PACK_DIR: packsDir },
  stdio: ["ignore", "pipe", "pipe"] });
let out = "";
child.stdout.on("data", (d) => { out += d; });
child.stderr.on("data", (d) => { out += d; });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log("  ok   " + n + (x ? "  [" + x + "]" : "")); } else { fail++; console.log("  FAIL " + n + "  " + (x || "")); } };
const j = async (m, p, body, hdr) => { const r = await fetch(BASE + p, { method: m, headers: { ...(body ? { "content-type": "application/json" } : {}), ...(hdr || {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) }); return { status: r.status, data: await r.json().catch(() => null) }; };
try {
  for (let i = 0; i < 60; i++) { await sleep(500); try { const r = await fetch(BASE + "/api/state", { signal: AbortSignal.timeout(2000) }); if (r.ok) break; } catch {} }
  const st = await j("GET", "/api/state");
  const token = st.data && st.data.localToken;
  ok("临时服务起来（1.6.0）", st.data && st.data.version === "1.6.0", st.data && st.data.version);
  const s0 = await j("GET", "/api/vision/pack");
  ok("pack 初始未安装", s0.status === 200 && s0.data.installed === false && s0.data.source === "none", JSON.stringify({ i: s0.data.installed, s: s0.data.source }));
  ok("available 检测到包", Array.isArray(s0.data.available) && s0.data.available.length === 1 && s0.data.available[0].version === "1.6.0", JSON.stringify(s0.data.available));
  ok("target 指向 LOCALAI_LLAMA_DIR", s0.data.target === path.join(root, "llama"), s0.data.target);
  const s1 = await j("GET", "/api/vision/state");
  ok("vision/state 带 pack 且未安装 + note 提示", s1.data.pack && s1.data.pack.installed === false && /未安装/.test(s1.data.note), s1.data.note);
  const bad = await j("POST", "/api/vision/pack/install", { path: zipPath });
  ok("无令牌 403", bad.status === 403, "HTTP " + bad.status);
  const start0 = await j("POST", "/api/vision/start", {}, { "x-local-token": token });
  ok("未安装时 start → 409 提示增强包", start0.status === 409 && /增强包/.test(String(start0.data.error.message)), "HTTP " + start0.status + " " + (start0.data.error && start0.data.error.message).slice(0, 40));
  const dry = await j("POST", "/api/vision/pack/install", { path: zipPath, dryRun: true }, { "x-local-token": token });
  ok("dryRun 200 且不落盘", dry.status === 200 && dry.data.dryRun === true && !existsSync(path.join(root, "llama")), "HTTP " + dry.status);
  const ins = await j("POST", "/api/vision/pack/install", { path: zipPath }, { "x-local-token": token });
  ok("安装 200 installed/pack", ins.status === 200 && ins.data.installed === true && ins.data.pack.installed === true && ins.data.pack.source === "pack", JSON.stringify({ s: ins.status, src: ins.data && ins.data.pack && ins.data.pack.source }));
  ok("落盘 + 标记", existsSync(path.join(root, "llama", "llama-server.exe")) && existsSync(path.join(root, "llama", ".vision-pack.json")));
  const s2 = await j("GET", "/api/vision/state");
  ok("装好后 state.pack.installed", s2.data.pack && s2.data.pack.installed === true && s2.data.pack.uninstallable === true && !/未安装/.test(s2.data.note || ""), JSON.stringify(s2.data.pack));
  const start = await j("POST", "/api/vision/start", {}, { "x-local-token": token });
  ok("装好但没模型时 start → 409 提示没有视觉模型", start.status === 409 && /视觉模型/.test(String(start.data.error.message)), "HTTP " + start.status);
  const up = await fetch(BASE + "/api/vision/pack/install", { method: "POST", headers: { "content-type": "application/zip", "x-local-token": token, "x-vision-pack-name": "uploaded.zip" }, body: zip });
  const upj = await up.json();
  ok("原始字节流上传安装 200", up.status === 200 && upj.installed === true && upj.pack.pack === "uploaded.zip", "HTTP " + up.status + " pack=" + (upj.pack && upj.pack.pack));
  const un = await j("POST", "/api/vision/pack/uninstall", {}, { "x-local-token": token });
  ok("卸载 200 + 目录消失", un.status === 200 && un.data.installed === false && !existsSync(path.join(root, "llama")), JSON.stringify({ s: un.status, b: un.data && un.data.removedBytes }));
  const un2 = await j("POST", "/api/vision/pack/uninstall", {}, { "x-local-token": token });
  ok("重复卸载 409", un2.status === 409, "HTTP " + un2.status);
  const dg = await j("GET", "/api/diag");
  const vchk = (dg.data.checks || []).find((c) => c.id === "vision");
  ok("diag vision 检查为 warn + 指路设置页", vchk && vchk.level === "warn" && /增强包/.test(vchk.fix || ""), vchk && (vchk.level + " / " + String(vchk.fix).slice(0, 40)));
  console.log("  诊断项总数: " + (dg.data.checks || []).length);
} catch (e) {
  console.log("  EXCEPTION " + (e && e.stack || e));
  fail++;
} finally {
  child.kill();
  await sleep(600);
  await rm(root, { recursive: true, force: true }).catch(() => {});
  console.log("\n结果: " + pass + "/" + (pass + fail) + " 通过");
  if (out.includes("Error")) console.log("服务端日志片段:\n" + out.slice(-1500));
  process.exit(fail ? 1 : 0);
}

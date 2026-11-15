/**
 * vision-pack.mjs 单测（Lead 自测，证据留档）：store/deflate 两种 zip、required 校验、穿越拒绝、
 * 安装/干跑/幂等/卸载、状态（pack / legacy / none）。
 *   node unit-vision-pack.mjs
 */
import { zipStore } from "../../diag-zip.mjs";
import * as VP from "../../vision-pack.mjs";
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log("  ok   " + n + (x ? "  [" + x + "]" : "")); } else { fail++; console.log("  FAIL " + n + "  " + (x || "")); } };
const REQ = VP.PACK_REQUIRED;
const root = await mkdtemp(path.join(os.tmpdir(), "vp-unit-"));
const P = "QingYaoTP-AILauncher-v9.9.9-vision-pack/";
const manifest = JSON.stringify({ format: 1, name: "视觉增强包", version: "9.9.9", sidecar: "b12144", files: REQ.length + 1, bytes: 0 });
const files = REQ.map((n) => ({ name: P + "llama/" + n, data: "exe:" + n + "\n" })).concat([{ name: P + "vision-pack.json", data: manifest }]);

try {
  // ---- store zip ----
  const storeZip = path.join(root, "store.zip");
  await writeFile(storeZip, zipStore(files));
  const buf = await readFile(storeZip);
  const plan = VP.inspectZipBuffer(buf);
  ok("store zip 解析：53→" + plan.files.length + " 个文件", plan.files.length === REQ.length);
  ok("store zip 识别 prefix", plan.prefix === P, JSON.stringify(plan.prefix));
  ok("store zip 清单 version", plan.manifest.version === "9.9.9");

  // ---- deflate zip（PowerShell Compress-Archive） ----
  const stage = path.join(root, "stage");
  await mkdir(path.join(stage, P, "llama"), { recursive: true });
  for (const f of REQ) await writeFile(path.join(stage, P, "llama", f), "exe:" + f + "\n");
  await writeFile(path.join(stage, P, "vision-pack.json"), manifest);
  const defZip = path.join(root, "deflate.zip");
  execFileSync("powershell.exe", ["-NoProfile", "-Command",
    "Compress-Archive -Path '" + stage + "\\*' -DestinationPath '" + defZip + "' -Force"], { stdio: "pipe" });
  const plan2 = VP.inspectZipBuffer(await readFile(defZip));
  ok("deflate zip 解析", plan2.files.length === REQ.length, "files=" + plan2.files.length);
  const methods = new Set(VP.parseZip(await readFile(defZip)).entries.map((e) => e.method));
  ok("deflate zip 含 method 8（真压缩路径）", methods.has(8), "methods=" + [...methods].join(","));

  // ---- 坏包：随机字节 ----
  try { VP.inspectZipBuffer(Buffer.from("not a zip at all")); ok("随机字节被拒", false); }
  catch (e) { ok("随机字节被拒", e.status === 400, e.message.slice(0, 40)); }
  // ---- 坏包：缺 required ----
  const shortZip = path.join(root, "short.zip");
  await writeFile(shortZip, zipStore([{ name: P + "llama/llama-server.exe", data: "x" }, { name: P + "vision-pack.json", data: manifest }]));
  try { VP.inspectZipBuffer(await readFile(shortZip)); ok("缺 required 被拒", false); }
  catch (e) { ok("缺 required 被拒", /不完整/.test(e.message), e.message.slice(0, 60)); }
  // ---- 坏包：.. 穿越 ----
  const travZip = path.join(root, "trav.zip");
  await writeFile(travZip, zipStore(files.concat([{ name: P + "llama/../../../evil.txt", data: "pwn" }])));
  try { VP.inspectZipBuffer(await readFile(travZip)); ok(".. 穿越被拒", false); }
  catch (e) { ok(".. 穿越被拒", /非法路径/.test(e.message), e.message.slice(0, 40)); }
  // ---- 坏包：绝对路径 ----
  const absZip = path.join(root, "abs.zip");
  await writeFile(absZip, zipStore(files.concat([{ name: "C:/evil.txt", data: "pwn" }])));
  try { VP.inspectZipBuffer(await readFile(absZip)); ok("绝对路径被拒", false); }
  catch (e) { ok("绝对路径被拒", /非法路径/.test(e.message), e.message.slice(0, 40)); }

  // ---- 安装 ----
  const target = path.join(root, "app", "llama");
  const r1 = await VP.installVisionPack({ zipPath: defZip, destDir: target, sourceName: "deflate.zip" });
  ok("安装成功 files", r1.files === REQ.length, "files=" + r1.files);
  ok("安装成功 sha256 有值", /^[0-9a-f]{64}$/.test(r1.sha256));
  ok("落盘 llama-server.exe", existsSync(path.join(target, "llama-server.exe")));
  ok("落盘标记 .vision-pack.json", existsSync(path.join(target, VP.PACK_MARKER)));
  ok("无 .part/.old 残留", readdirSync(path.join(root, "app")).filter((n) => n.startsWith(".")).length === 0, JSON.stringify(readdirSync(path.join(root, "app"))));
  const info = await VP.visionPackInfo({ dir: target, target });
  ok("状态 source=pack", info.source === "pack", info.source);
  ok("状态 version", info.version === "9.9.9", info.version);
  ok("状态 uninstallable", info.uninstallable === true);
  ok("状态 files/bytes", info.files === REQ.length && info.bytes > 0, info.files + "/" + info.bytes);

  // ---- dryRun 不落盘 ----
  const target2 = path.join(root, "app2", "llama");
  const r2 = await VP.installVisionPack({ zipPath: storeZip, destDir: target2, dryRun: true });
  ok("dryRun 返回 summary", r2.dryRun === true && r2.files === REQ.length);
  ok("dryRun 不落盘", !existsSync(target2));

  // ---- 覆盖安装幂等 ----
  const r3 = await VP.installVisionPack({ zipPath: storeZip, destDir: target, sourceName: "store.zip" });
  ok("覆盖安装幂等", r3.files === REQ.length && existsSync(path.join(target, "llama-server.exe")));
  const info2 = await VP.visionPackInfo({ dir: target, target });
  ok("覆盖后 pack 名更新", info2.pack === "store.zip", info2.pack);

  // ---- legacy / tools / none ----
  const legacyDir = path.join(root, "legacy", "llama");
  await mkdir(legacyDir, { recursive: true });
  await writeFile(path.join(legacyDir, "llama-server.exe"), "x");
  const legacy = await VP.visionPackInfo({ dir: legacyDir, target: legacyDir });
  ok("无标记同目标 = legacy", legacy.source === "legacy" && legacy.uninstallable === true, legacy.source);
  const tools = await VP.visionPackInfo({ dir: legacyDir, target: path.join(root, "other") });
  ok("非目标目录 = tools 且不可卸", tools.source === "tools" && tools.uninstallable === false, tools.source);
  const none = await VP.visionPackInfo({ dir: path.join(root, "nope"), target: path.join(root, "nope") });
  ok("不存在 = none", none.source === "none" && none.installed === false);

  // ---- available 检测 ----
  const packsDir = path.join(root, "packs");
  await mkdir(packsDir, { recursive: true });
  await writeFile(path.join(packsDir, "QingYaoTP-AILauncher-v1.6.0-vision-pack.zip"), await readFile(storeZip));
  await writeFile(path.join(packsDir, "other.zip"), "nope");
  const avail = await VP.listAvailablePacks([packsDir, path.join(root, "missing-dir")]);
  ok("available 只认 vision-pack 名字", avail.length === 1, JSON.stringify(avail.map((a) => a.name)));
  ok("available 解析版本", avail[0].version === "1.6.0", avail[0].version);

  // ---- 卸载 ----
  const rm1 = await VP.removeVisionPack(target);
  ok("卸载后目录消失", !existsSync(target) && rm1.removed === true);
  ok("卸载释放字节 > 0", rm1.bytes > 0, "bytes=" + rm1.bytes);
} finally {
  await rm(root, { recursive: true, force: true }).catch(() => {});
}
console.log("\n结果: " + pass + "/" + (pass + fail) + " 通过" + (fail ? "，" + fail + " 条失败" : ""));
process.exit(fail ? 1 : 0);

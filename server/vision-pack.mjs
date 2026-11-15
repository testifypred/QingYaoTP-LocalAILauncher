/**
 * 视觉增强包（vision pack）—— 把 101MB 的 llama.cpp sidecar 从主包里拆出来，做成可选安装的 zip。
 *
 * 背景（v1.6.0）：主包 158.5MB 里有 101.1MB 是 app\llama\（llama.cpp 的 llama-server + DLL）。
 * 只有要看图的人才需要它，于是拆成「视觉增强包」：设置 → 视觉 → 安装/卸载。
 *
 * 为什么自己解析 ZIP：这个项目从第一天起就是零依赖。诊断包导出已经自己写过 store-zip（diag-zip.mjs），
 * 这里反过来读：中央目录 + 本地文件头 + zlib.inflateRawSync，覆盖 store(0) / deflate(8) 两种压缩方式。
 *
 * 安全口径（装的是要执行的 exe，必须挑剔）：
 *  - 条目里出现绝对路径 / 盘符 / ".." → 直接拒（400），一个字节都不落盘；
 *  - 只接受 <前缀>llama/** 与 <前缀>vision-pack.json，其余条目忽略并计数；
 *  - 必须有 8 个 required 文件（缺一个就是半截包）；
 *  - 每个文件解压后校验 CRC32 与声明大小；
 *  - 先解到同级的临时目录，再原子换目录（失败回滚旧目录）。
 */
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { readFile, readdir, stat, mkdir, rm, rename, writeFile } from "node:fs/promises";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { crc32 } from "./diag-zip.mjs";

/** 包内清单文件名（zip 根目录下） */
export const PACK_MANIFEST = "vision-pack.json";
/** 安装后在安装目录里留的标记（区分「包安装」与「老版本自带」） */
export const PACK_MARKER = ".vision-pack.json";
export const PACK_FORMAT = 1;
/** 缺任何一个就拒装：llama-server + 文本层/CPU 后端 + mtmd（图像编码）+ libomp */
export const PACK_REQUIRED = [
  "llama-server.exe",
  "llama-server-impl.dll",
  "llama.dll",
  "llama-common.dll",
  "ggml.dll",
  "ggml-base.dll",
  "mtmd.dll",
  "libomp.dll",
];
/** 未压缩总量上限：防 zip 炸弹（正常包 ~101MB） */
const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
/** zip 文件本身上限（正常 ~40MB） */
export const MAX_PACK_BYTES = 600 * 1024 * 1024;

function bad(msg, status = 400) {
  const e = new Error(msg);
  e.status = status;
  e.code = "VISION_PACK_BAD";
  return e;
}

// ---------------------------------------------------------------- ZIP 读取

/**
 * 解析 ZIP 中央目录。返回 { entries: [{name, method, crc, compSize, size, offset}], size }。
 * 不支持 ZIP64（我们的包 54 个条目、远小于 4GB；遇到就明确报错，别静默出错）。
 */
export function parseZip(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw bad("不是有效的 ZIP（文件太短）");
  const eocdSig = 0x06054b50;
  let eocd = -1;
  const from = Math.max(0, buf.length - 66 * 1024);
  for (let i = buf.length - 22; i >= from; i--) {
    if (buf.readUInt32LE(i) === eocdSig) { eocd = i; break; }
  }
  if (eocd < 0) throw bad("不是有效的 ZIP（找不到中央目录结尾）");
  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) {
    throw bad("不支持 ZIP64 格式的增强包（请用 make-vision-pack.ps1 重新生成）");
  }
  if (cdOffset + cdSize > buf.length) throw bad("ZIP 中央目录越界（文件被截断？）");
  const entries = [];
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw bad("ZIP 中央目录损坏（第 " + (n + 1) + " 条）");
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const compSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString("utf8");
    if (flags & 0x1) throw bad("增强包被加密了：" + name);
    if (method !== 0 && method !== 8) throw bad("不支持的压缩方式 " + method + "：" + name);
    entries.push({ name, method, crc, compSize, size, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return { entries, size: buf.length };
}

/** 读一个条目的真实字节（method 0 直接切，8 用 inflateRaw），顺带校验 CRC32 与大小 */
function entryBuffer(buf, e) {
  if (e.offset + 30 > buf.length || buf.readUInt32LE(e.offset) !== 0x04034b50) {
    throw bad("ZIP 本地文件头损坏：" + e.name);
  }
  const nameLen = buf.readUInt16LE(e.offset + 26);
  const extraLen = buf.readUInt16LE(e.offset + 28);
  const start = e.offset + 30 + nameLen + extraLen;
  if (start + e.compSize > buf.length) throw bad("ZIP 数据越界：" + e.name);
  const raw = buf.slice(start, start + e.compSize);
  let data;
  if (e.method === 0) data = raw;
  else {
    try { data = inflateRawSync(raw); }
    catch (err) { throw bad("解压失败（" + e.name + "）：" + String(err?.message ?? err)); }
  }
  if (data.length !== e.size) throw bad("解压后大小不符：" + e.name + "（声明 " + e.size + "，实际 " + data.length + "）");
  if (crc32(data) !== (e.crc >>> 0)) throw bad("CRC 校验失败：" + e.name);
  return data;
}

/** 条目名规范化 + 安全校验：返回 { skip:true }（目录项）或 { rel }，非法路径直接抛 400 */
function safeRel(name) {
  const raw = String(name ?? "").replace(/\\/g, "/");
  if (!raw || raw.endsWith("/")) return { skip: true };
  if (raw.startsWith("/") || /^[A-Za-z]:/.test(raw) || raw.startsWith("~")) {
    throw bad("增强包含非法路径（绝对路径）：" + name);
  }
  const parts = raw.split("/");
  if (parts.some((s) => s === ".." || s === "." || s === "")) {
    throw bad("增强包含非法路径（.. 或空段）：" + name);
  }
  return { rel: parts.join("/") };
}

/**
 * 只解析不落盘：校验清单 + required + 路径安全，返回安装计划。
 * @returns {{ manifest, prefix, files: {name, rel, size, entry}[], bytes, skipped, warnings: string[] }}
 */
export function inspectZipBuffer(buf) {
  const { entries } = parseZip(buf);
  const names = entries.map((e) => String(e.name).replace(/\\/g, "/"));
  // 定位包根：<前缀>llama/llama-server.exe 是唯一锚点
  const anchors = names.filter((n) => n.endsWith("llama/llama-server.exe"));
  if (anchors.length !== 1) {
    throw bad(anchors.length === 0
      ? "不是视觉增强包：zip 里没有 llama/llama-server.exe"
      : "增强包结构异常：找到多个 llama/llama-server.exe");
  }
  const anchor = anchors[0];
  const prefix = anchor.slice(0, anchor.length - "llama/llama-server.exe".length);
  const manifestName = prefix + PACK_MANIFEST;
  if (!names.includes(manifestName)) throw bad("不是视觉增强包：缺少 " + manifestName);

  const files = [];
  const warnings = [];
  let skipped = 0;
  let bytes = 0;
  let manifestEntry = null;
  for (const e of entries) {
    const r = safeRel(e.name);
    if (r.skip) continue;
    const rel = r.rel;
    if (rel === manifestName) { manifestEntry = e; continue; }
    if (!rel.startsWith(prefix + "llama/")) { skipped += 1; continue; }
    const inner = rel.slice((prefix + "llama/").length);
    // rel 是相对「安装目录」（也就是 app\llama 本身）的路径，所以这里不再带 llama/ 前缀
    files.push({ name: inner, rel: inner, size: e.size, entry: e });
    bytes += e.size;
  }
  if (bytes > MAX_TOTAL_BYTES) throw bad("增强包解压后超过 2GB，拒绝安装（可能是坏包）");
  if (!manifestEntry) throw bad("不是视觉增强包：缺少 " + manifestName);

  let manifest = null;
  try {
    manifest = JSON.parse(entryBuffer(buf, manifestEntry).toString("utf8"));
  } catch (err) {
    if (err?.status) throw err;
    throw bad("vision-pack.json 不是合法 JSON：" + String(err?.message ?? err));
  }
  if (!manifest || typeof manifest !== "object") throw bad("vision-pack.json 内容为空");
  if (Number(manifest.format) !== PACK_FORMAT) throw bad("增强包格式版本不支持：" + manifest.format + "（本程序只认 " + PACK_FORMAT + "）");

  const have = new Set(files.map((f) => f.name));
  const missing = PACK_REQUIRED.filter((r) => !have.has(r));
  if (missing.length) throw bad("增强包不完整，缺少：" + missing.join(", "));
  if (manifest.files && Number(manifest.files) !== files.length) {
    warnings.push("清单声明 " + manifest.files + " 个文件，实际 " + files.length + " 个");
  }
  if (manifest.bytes && Number(manifest.bytes) !== bytes) {
    warnings.push("清单声明 " + manifest.bytes + " 字节，实际 " + bytes + " 字节");
  }
  return { manifest, prefix, files, bytes, skipped, warnings };
}

// ---------------------------------------------------------------- 安装 / 卸载

function rand() {
  return Math.random().toString(36).slice(2, 10);
}
function isInside(root, target) {
  const r = path.resolve(root).toLowerCase().replace(/[\\/]+$/, "");
  const t = path.resolve(target).toLowerCase();
  return t === r || t.startsWith(r + "\\") || t.startsWith(r + "/");
}

/** 目录里一共多少字节 / 文件（可跳过指定名字，比如安装标记） */
export function dirBytes(dir, skip = []) {
  const skipSet = new Set(skip.map((s) => String(s).toLowerCase()));
  let total = 0;
  let count = 0;
  const walk = (d) => {
    let list;
    try { list = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const ent of list) {
      if (skipSet.has(ent.name.toLowerCase())) continue;
      const full = path.join(d, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.isFile()) {
        count += 1;
        try { total += statSync(full).size; } catch {}
      }
    }
  };
  walk(dir);
  return { bytes: total, files: count };
}

/**
 * 从 zip 安装增强包到 destDir。
 * @param {{zipPath:string, destDir:string, dryRun?:boolean, sourceName?:string}} opt
 */
export async function installVisionPack({ zipPath, destDir, dryRun = false, sourceName = "" }) {
  const t0 = Date.now();
  let st;
  try { st = await stat(zipPath); } catch { throw bad("增强包文件不存在：" + zipPath, 404); }
  if (!st.isFile()) throw bad("不是文件：" + zipPath, 404);
  if (st.size > MAX_PACK_BYTES) throw bad("增强包太大（" + Math.round(st.size / 1024 / 1024) + "MB），不像是视觉增强包");
  const buf = await readFile(zipPath);
  const plan = inspectZipBuffer(buf);
  const sha = createHash("sha256").update(buf).digest("hex");
  const summary = {
    version: String(plan.manifest.version ?? ""),
    sidecar: String(plan.manifest.sidecar ?? ""),
    files: plan.files.length,
    bytes: plan.bytes,
    sha256: sha,
    skipped: plan.skipped,
    warnings: plan.warnings,
    packBytes: buf.length,
  };
  if (dryRun) return { ...summary, dryRun: true, tookMs: Date.now() - t0 };

  const parent = path.dirname(destDir);
  await mkdir(parent, { recursive: true });
  const tmp = path.join(parent, "." + path.basename(destDir) + ".part-" + rand());
  await rm(tmp, { recursive: true, force: true });
  await mkdir(tmp, { recursive: true });
  let marker;
  try {
    for (const f of plan.files) {
      const full = path.join(tmp, f.rel);
      if (!isInside(tmp, full)) throw bad("增强包含非法条目：" + f.name);
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, entryBuffer(buf, f.entry));
    }
    marker = {
      format: PACK_FORMAT,
      name: String(plan.manifest.name ?? "视觉增强包"),
      version: summary.version,
      sidecar: summary.sidecar,
      files: summary.files,
      bytes: summary.bytes,
      installedAt: new Date().toISOString(),
      pack: String(sourceName || path.basename(zipPath)),
      sha256: sha,
    };
    await writeFile(path.join(tmp, PACK_MARKER), JSON.stringify(marker, null, 2) + "\n", "utf8");
  } catch (err) {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
    if (err?.status) throw err;
    throw bad("解压增强包失败：" + String(err?.message ?? err), 409);
  }

  // 原子换目录：旧目录先挪开，成功后删；失败回滚
  const old = path.join(parent, "." + path.basename(destDir) + ".old-" + rand());
  let movedOld = false;
  if (existsSync(destDir)) {
    try { await rename(destDir, old); movedOld = true; }
    catch (err) {
      await rm(tmp, { recursive: true, force: true }).catch(() => {});
      throw bad("旧视觉组件目录被占用，装不上（先停掉看图进程再试）：" + String(err?.message ?? err), 409);
    }
  }
  try {
    await rename(tmp, destDir);
  } catch (err) {
    if (movedOld) await rename(old, destDir).catch(() => {});
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
    throw bad("写入视觉组件目录失败（可能被杀毒软件拦截）：" + String(err?.message ?? err), 409);
  }
  if (movedOld) await rm(old, { recursive: true, force: true }).catch(() => {});
  return { ...summary, dryRun: false, tookMs: Date.now() - t0, installedAt: marker.installedAt };
}

/** 删掉增强包目录，返回释放的字节数 */
export async function removeVisionPack(destDir) {
  const { bytes } = dirBytes(destDir, [PACK_MARKER]);
  await rm(destDir, { recursive: true, force: true });
  return { bytes, removed: !existsSync(destDir) };
}

// ---------------------------------------------------------------- 状态

function samePath(a, b) {
  if (!a || !b) return false;
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}

/**
 * 当前 sidecar 目录的状态。
 *  - installed：llama-server.exe 在不在（只认这个，别用「目录存在」）
 *  - source：pack（有标记）/ legacy（老版本自带、没标记）/ tools（开发目录 tools\llama.cpp）/ none
 *  - uninstallable：只有装到「安装目标」的才能卸（开发目录那套是仓库的，不能删）
 */
export async function visionPackInfo({ dir, target }) {
  const exe = path.join(dir, "llama-server.exe");
  const installed = existsSync(exe);
  const isTarget = samePath(dir, target);
  let marker = null;
  if (installed) {
    try { marker = JSON.parse(await readFile(path.join(dir, PACK_MARKER), "utf8")); } catch { marker = null; }
  }
  const counted = installed ? dirBytes(dir, [PACK_MARKER]) : { bytes: 0, files: 0 };
  const source = !installed ? "none" : marker ? "pack" : isTarget ? "legacy" : "tools";
  return {
    installed,
    dir,
    source,
    version: marker ? String(marker.version ?? "") : "",
    sidecar: marker ? String(marker.sidecar ?? "") : "",
    files: counted.files,
    bytes: counted.bytes,
    installedAt: marker ? String(marker.installedAt ?? "") : "",
    pack: marker ? String(marker.pack ?? "") : "",
    uninstallable: installed && isTarget,
  };
}

/** 在若干目录里找 *.zip 的视觉增强包（文件名里解析 vX.Y.Z 版本） */
export async function listAvailablePacks(dirs) {
  const seen = new Set();
  const out = [];
  for (const dir of dirs || []) {
    let list;
    try { list = await readdir(dir); } catch { continue; }
    for (const name of list) {
      if (!/\.zip$/i.test(name)) continue;
      if (!/vision[-_. ]?pack/i.test(name)) continue;
      const p = path.join(dir, name);
      let size = 0;
      try { const s = await stat(p); if (!s.isFile()) continue; size = s.size; } catch { continue; }
      const key = path.resolve(p).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const m = name.match(/v(\d+\.\d+\.\d+)/i);
      out.push({ path: p, name, bytes: size, version: m ? m[1] : "" });
    }
  }
  out.sort((a, b) => String(b.version).localeCompare(String(a.version)) || b.bytes - a.bytes);
  return out;
}

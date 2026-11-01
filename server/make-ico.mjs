/**
 * 把 icon-parts 里的多尺寸 PNG 打包成 .ico（PNG 内嵌，Vista+ 支持）
 *
 *   node make-ico.mjs [partsDir] [out.ico]
 *
 * 不引第三方库：ICO = 6 字节头 + 每张 16 字节目录项 + PNG 原样拼接。
 * 缩放由 make-icon.ps1 / resize step 用 System.Drawing 完成，这里只做封装。
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const DIR = process.argv[2] || "D:/LocalModels/server/icon-parts";
const OUT = process.argv[3] || "D:/LocalModels/server/localai.ico";
const SIZES = [256, 128, 64, 48, 32, 24, 16];

const pngs = [];
for (const size of SIZES) {
  const p = DIR + "/icon-" + size + ".png";
  if (!existsSync(p)) { console.error("缺少 " + p); process.exit(1); }
  pngs.push({ size: size, buf: readFileSync(p) });
}

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(pngs.length, 4);

const dir = Buffer.alloc(16 * pngs.length);
let offset = 6 + dir.length;
pngs.forEach(function (p, i) {
  const b = i * 16;
  dir.writeUInt8(p.size >= 256 ? 0 : p.size, b + 0);
  dir.writeUInt8(p.size >= 256 ? 0 : p.size, b + 1);
  dir.writeUInt8(0, b + 2);
  dir.writeUInt8(0, b + 3);
  dir.writeUInt16LE(1, b + 4);
  dir.writeUInt16LE(32, b + 6);
  dir.writeUInt32LE(p.buf.length, b + 8);
  dir.writeUInt32LE(offset, b + 12);
  offset += p.buf.length;
});

writeFileSync(OUT, Buffer.concat([header, dir].concat(pngs.map(function (p) { return p.buf; }))));
console.log("wrote " + OUT + " (" + SIZES.join("/") + ", " + offset + " bytes)");
/**
 * 零依赖 ZIP 打包（store，不压缩）—— 给 Debugging Tool 的「导出诊断包」用。
 *
 * 为什么不装库：这个项目从第一天起就是零依赖（node_modules 里只有 llama.cpp 相关）。
 * 诊断包只是在几秒内把文本和日志拼起来，不压缩也够小（几十 KB~几 MB），
 * 而 store 模式的 ZIP 格式只有三段：本地文件头 + 数据、中央目录、EOCD。
 * Windows 资源管理器 / 7-Zip / Expand-Archive 都能直接打开。
 */
import { createHash } from "node:crypto";

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

/** ZIP 用的 CRC32（标准多项式 0xEDB88320，初值/终值取反） */
export function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xff];
  return (c ^ -1) >>> 0;
}

function dosTime(d) {
  return ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((Math.floor(d.getSeconds() / 2)) & 31);
}
function dosDate(d) {
  const y = Math.max(1980, d.getFullYear());
  return (((y - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
}

/**
 * 把 entries（[{ name, data }]）打成 ZIP Buffer。
 * @param {{name:string, data:Buffer|string}[]} entries
 * @param {Date} [when] 统一的时间戳（默认现在）
 */
export function zipStore(entries, when = new Date()) {
  const list = Array.isArray(entries) ? entries : [];
  const chunks = [];
  const central = [];
  const t = dosTime(when);
  const dt = dosDate(when);
  let offset = 0;

  for (const e of list) {
    const name = Buffer.from(String(e.name || "").replace(/\\/g, "/"), "utf8");
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(String(e.data ?? ""), "utf8");
    const crc = crc32(data);

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);   // local file header
    lh.writeUInt16LE(20, 4);           // version needed
    lh.writeUInt16LE(0x0800, 6);       // flags: UTF-8 文件名
    lh.writeUInt16LE(0, 8);            // method 0 = store
    lh.writeUInt16LE(t, 10);
    lh.writeUInt16LE(dt, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18); // 压缩后大小（store 等于原大小）
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(0, 28);           // extra 长度
    chunks.push(lh, name, data);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);   // central directory header
    ch.writeUInt16LE(20, 4);           // version made by
    ch.writeUInt16LE(20, 6);           // version needed
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(0, 10);
    ch.writeUInt16LE(t, 12);
    ch.writeUInt16LE(dt, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt16LE(0, 30);           // extra
    ch.writeUInt16LE(0, 32);           // comment
    ch.writeUInt16LE(0, 34);           // disk start
    ch.writeUInt16LE(0, 36);           // internal attrs
    ch.writeUInt32LE(0, 38);           // external attrs
    ch.writeUInt32LE(offset, 42);      // 本地头偏移
    central.push(ch, name);

    offset += lh.length + name.length + data.length;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(list.length, 8);
  eocd.writeUInt16LE(list.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...chunks, centralBuf, eocd]);
}

/** 诊断包里给每个文件记 sha256（manifest.json 用） */
export function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

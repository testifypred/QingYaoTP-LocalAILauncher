/**
 * 文档文本抽取（零依赖）
 *
 *   txt/md/log 等：调用方直接按 UTF-8 读，不必进这里
 *   docx：docx 就是个 zip，读 word/document.xml 去标签
 *   pdf ：解析间接对象 → 解 FlateDecode 流 → 走文本算子（Tj/TJ/Tf/ToUnicode）
 *
 * 设计取向：宁可少抽，也别抽出乱码。抽不到的字符直接丢；
 * 遇到不认识的滤镜/字体编码就退回"能认多少算多少"，并在结果里保留可读的英文与数字。
 */
import { inflateRawSync, inflateSync } from "node:zlib";

/** ------------------------------- DOCX ------------------------------- */

function readZipEntry(buf, want) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 70000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  for (let k = 0; k < count; k++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== 0x02014b50) return null;
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.subarray(off + 46, off + 46 + nameLen).toString("utf8");
    if (name === want) {
      const lnameLen = buf.readUInt16LE(localOff + 26);
      const lextra = buf.readUInt16LE(localOff + 28);
      const start = localOff + 30 + lnameLen + lextra;
      const raw = buf.subarray(start, start + compSize);
      if (method === 8) {
        try { return inflateRawSync(raw).toString("utf8"); } catch { return null; }
      }
      return raw.toString("utf8");
    }
    off += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

function decodeXmlEntities(s) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d{1,6});/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]{1,5});/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

export function extractDocx(buf) {
  const xml = readZipEntry(buf, "word/document.xml");
  if (!xml) return "";
  const txt = xml
    .replace(/<w:tab[^>]*\/>/g, "\t")
    .replace(/<w:br[^>]*\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "");
  return decodeXmlEntities(txt)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** -------------------------------- PDF -------------------------------- */

function hexToText(hex) {
  const clean = String(hex).replace(/\s+/g, "");
  let out = "";
  for (let i = 0; i < clean.length; i += 4) {
    const code = parseInt(clean.slice(i, i + 4).padEnd(4, "0"), 16);
    if (Number.isFinite(code)) out += String.fromCharCode(code);
  }
  return out;
}

function hexToBytes(hex) {
  const clean = String(hex).replace(/\s+/g, "");
  let out = "";
  for (let i = 0; i < clean.length; i += 2) out += String.fromCharCode(parseInt(clean.slice(i, i + 2) || "0", 16));
  return out;
}

function pdfObjects(latin, buf) {
  const objs = new Map();
  const re = /(\d+)\s+(\d+)\s+obj\b/g;
  let m;
  while ((m = re.exec(latin))) {
    const id = Number(m[1]);
    const start = re.lastIndex;
    const endObj = latin.indexOf("endobj", start);
    if (endObj < 0) continue;
    const body = latin.slice(start, endObj);
    const sIdx = body.indexOf("stream");
    let dict = body;
    let data = null;
    if (sIdx >= 0) {
      dict = body.slice(0, sIdx);
      let ds = start + sIdx + 6;
      while (latin[ds] === "\r" || latin[ds] === "\n") ds++;
      const eIdx = latin.indexOf("endstream", ds);
      if (eIdx >= 0) data = buf.subarray(ds, eIdx);
    }
    objs.set(id, { dict, data });
  }
  return objs;
}

function decodeStream(obj) {
  if (!obj || !obj.data) return null;
  const hasFlate = /\/FlateDecode/.test(obj.dict);
  const otherFilter = /\/Filter/.test(obj.dict) && !hasFlate;
  if (otherFilter) return null;
  if (hasFlate) {
    try { return inflateSync(obj.data).toString("latin1"); } catch { return null; }
  }
  return obj.data.toString("latin1");
}

function parseCMap(text) {
  const map = new Map();
  const add = (code, uni) => { if (uni && !map.has(code)) map.set(code, uni); };
  let m;
  const bc = /beginbfchar([\s\S]*?)endbfchar/g;
  while ((m = bc.exec(text))) {
    const pairRe = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
    let p;
    while ((p = pairRe.exec(m[1]))) add(parseInt(p[1], 16), hexToText(p[2]));
  }
  const br = /beginbfrange([\s\S]*?)endbfrange/g;
  while ((m = br.exec(text))) {
    const tripRe = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
    let t;
    while ((t = tripRe.exec(m[1]))) {
      const lo = parseInt(t[1], 16);
      const hi = parseInt(t[2], 16);
      const dst = hexToText(t[3]);
      if (!dst) continue;
      const base = dst.charCodeAt(0);
      for (let c = lo; c <= hi && c - lo < 512; c++) add(c, String.fromCharCode(base + (c - lo)));
    }
  }
  return map;
}

function buildFontInfo(objs) {
  const nameToFont = new Map();
  for (const o of objs.values()) {
    if (!/\/Font\b/.test(o.dict)) continue;
    const block = o.dict.match(/\/Font\s*<<([\s\S]*?)>>/);
    if (!block) continue;
    const re = /\/([A-Za-z0-9#]+)\s+(\d+)\s+\d+\s+R/g;
    let m;
    while ((m = re.exec(block[1]))) nameToFont.set(m[1], Number(m[2]));
  }
  const cmaps = new Map();
  const twoByte = new Map();
  for (const [id, o] of objs) {
    // Type0 / Identity-H 的字符串是 2 字节 CID；其余简单字体是 1 字节
    if (/\/Subtype\s*\/Type0/.test(o.dict) || /\/Encoding\s*\/Identity-[HV]/.test(o.dict)) twoByte.set(id, true);
    const ref = o.dict.match(/\/ToUnicode\s+(\d+)\s+\d+\s+R/);
    if (!ref) continue;
    const target = objs.get(Number(ref[1]));
    const txt = target ? decodeStream(target) : null;
    if (txt) cmaps.set(id, parseCMap(txt));
  }
  return { nameToFont, cmaps, twoByte };
}

function decodePdfString(raw, fontId, cmaps, twoByte) {
  const cm = fontId ? cmaps.get(fontId) : null;
  const isTwo = fontId ? twoByte.get(fontId) === true : false;
  if (cm && cm.size) {
    if (isTwo) {
      let s = "";
      for (let i = 0; i + 1 < raw.length; i += 2) {
        const code = (raw.charCodeAt(i) << 8) | raw.charCodeAt(i + 1);
        s += cm.get(code) || "";
      }
      if (s) return s;
    }
    let two = "";
    let twoHits = 0;
    for (let i = 0; i + 1 < raw.length; i += 2) {
      const code = (raw.charCodeAt(i) << 8) | raw.charCodeAt(i + 1);
      const u = cm.get(code);
      if (u) { two += u; twoHits += 1; }
    }
    let one = "";
    let oneHits = 0;
    for (let i = 0; i < raw.length; i++) {
      const u = cm.get(raw.charCodeAt(i));
      if (u) { one += u; oneHits += 1; }
    }
    if (twoHits && twoHits * 2 >= raw.length * 0.5) return two;
    if (oneHits > twoHits) return one;
    if (twoHits) return two;
  }
  if (raw.charCodeAt(0) === 0xfe && raw.charCodeAt(1) === 0xff) return raw.slice(2);
  return raw;
}

export function contentToText(content, nameToFont, cmaps, twoByte) {
  let out = "";
  let fontId = null;
  let i = 0;
  const n = content.length;
  while (i < n) {
    const ch = content[i];
    if (ch === "%") {
      const nl = content.indexOf("\n", i);
      i = nl < 0 ? n : nl + 1;
      continue;
    }
    if (ch === "(") {
      let depth = 1;
      let j = i + 1;
      let s = "";
      while (j < n && depth > 0) {
        const c = content[j];
        if (c === "\\") {
          const nx = content[j + 1];
          const map = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\" };
          if (nx >= "0" && nx <= "7") {
            const oct = content.slice(j + 1, j + 4).match(/^[0-7]{1,3}/)[0];
            s += String.fromCharCode(parseInt(oct, 8));
            j += 1 + oct.length;
            continue;
          }
          s += map[nx] !== undefined ? map[nx] : nx;
          j += 2;
          continue;
        }
        if (c === "(") depth += 1;
        else if (c === ")") { depth -= 1; if (!depth) break; }
        s += c;
        j += 1;
      }
      i = j + 1;
      out += decodePdfString(s, fontId, cmaps, twoByte);
      continue;
    }
    // 字典 << >> ：跳过，别把 "/MCID 0" 当十六进制字符串解
    if (ch === "<" && content[i + 1] === "<") { i += 2; continue; }
    if (ch === ">" && content[i + 1] === ">") { i += 2; continue; }
    if (ch === "<" && content[i + 1] !== "<") {
      const gt = content.indexOf(">", i);
      if (gt > i) {
        out += decodePdfString(hexToBytes(content.slice(i + 1, gt)), fontId, cmaps, twoByte);
        i = gt + 1;
        continue;
      }
    }
    if (ch === "/") {
      const m = /^\/([A-Za-z0-9#]+)/.exec(content.slice(i));
      if (m) {
        const after = content.slice(i + m[0].length, i + m[0].length + 40);
        if (/^\s+[\d.]+\s+Tf/.test(after)) fontId = nameToFont.get(m[1]) ?? null;
        i += m[0].length;
        continue;
      }
    }
    if (content.startsWith("T*", i) || content.startsWith("ET", i)) { out += "\n"; i += 2; continue; }
    // Td/TD 只是位移：Chromium 会把一个单词拆成几段分别 Tj，这里补空格反而会把词切断。
    // 真正的空格来自字符串里的空格字形（映射后就是 " "）。
    if (content.startsWith("TD", i) || content.startsWith("Td", i)) { i += 2; continue; }
    i += 1;
  }
  return out;
}

export function extractPdf(buf) {
  const latin = buf.toString("latin1");
  const objs = pdfObjects(latin, buf);
  if (!objs.size) return "";
  const { nameToFont, cmaps, twoByte } = buildFontInfo(objs);
  const parts = [];
  for (const o of objs.values()) {
    if (!o.data) continue;
    if (/\/Type\s*\/Font/.test(o.dict)) continue;
    const text = decodeStream(o);
    if (!text) continue;
    if (!/\bTj\b|\bTJ\b/.test(text)) continue;
    const got = contentToText(text, nameToFont, cmaps, twoByte);
    if (got.trim()) parts.push(got);
  }
  return parts
    .join("\n")
    // 控制字符（含 CID 映射失败的残留）清掉，只留换行与制表
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/ {2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 按扩展名抽取；不认识的后缀返回 null，调用方跳过 */
export function extractTextBuffer(buf, ext) {
  const e = String(ext || "").toLowerCase();
  try {
    if (e === ".docx") return extractDocx(buf);
    if (e === ".pdf") return extractPdf(buf);
  } catch {
    return "";
  }
  return null;
}

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
const dir = "D:\\LocalModels\\server\\docs\\probe-full-2026-11-15-v170-r2\\logs";
const files = readdirSync(dir).filter((f) => f.endsWith(".out.txt"));
let total = 0, unknown = [];
const rows = [];
for (const f of files) {
  const t = readFileSync(path.join(dir, f), "utf8");
  const m = t.match(/RESULT\s+(\d+)\s*\/\s*(\d+)/) || t.match(/结果:\s*(\d+)\s*通过\s*\/\s*(\d+)/) || t.match(/通过\s*\/\s*(\d+)/);
  let n = null;
  if (m) n = Number(m[1]);
  else {
    // 兜底：数 ok / ✅ 行
    const okCount = (t.match(/^\s*(ok|✅)/gm) || []).length;
    if (okCount > 0) n = okCount;
  }
  if (n === null) unknown.push(f);
  else { total += n; rows.push([f.replace(".out.txt", ""), n]); }
}
console.log("probes:", files.length, "sum:", total);
if (unknown.length) console.log("unknown:", unknown.join(", "));
console.log("--- 明细（前 12 + 新增 3） ---");
for (const [n, v] of rows.slice(0, 12)) console.log("  " + n + " " + v);
for (const [n, v] of rows.filter(([n]) => /code-(review-stream|panel-v2)|tui-tools/.test(n))) console.log("  " + n + " " + v);
console.log("--- 末 6 ---");
for (const [n, v] of rows.slice(-6)) console.log("  " + n + " " + v);

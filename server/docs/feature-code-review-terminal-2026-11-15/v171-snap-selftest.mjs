/** v1.7.1 行号校正自测（与 app.mjs 里 isCodeLine / snapIssuesToCodeLines 同逻辑的副本，验证边界） */
function isCodeLine(text) {
  const t = String(text ?? "").trim();
  if (!t) return false;
  if (t.startsWith("#")) return false;
  if (t.startsWith("//")) return false;
  if (t.startsWith("/*")) return false;
  if (/^\*[\s*\/]/.test(t)) return false;
  return true;
}
function snapIssuesToCodeLines(issues, code) {
  const lines = String(code ?? "").replace(/\r\n/g, "\n").split("\n");
  const n = lines.length;
  if (!n) return issues;
  const isCode = lines.map(isCodeLine);
  // 同距离时先向下找：注释行通常注释的是下一行，空行也多半是模型数偏了一行
  const nearestCode = (ln) => {
    for (let d = 0; d <= 2; d += 1) {
      const down = ln + d;
      const up = ln - d;
      if (down >= 1 && down <= n && isCode[down - 1]) return down;
      if (up !== down && up >= 1 && up <= n && isCode[up - 1]) return up;
    }
    return 0;
  };
  for (const it of issues) {
    const line = Math.max(1, Math.min(n, Math.round(Number(it.line) || 1)));
    if (isCode[line - 1]) continue;
    const hit = nearestCode(line);
    if (!hit) continue;
    const delta = hit - line;
    const end = Math.max(line, Math.min(n, Math.round(Number(it.endLine) || line)));
    it.line = hit;
    it.endLine = Math.max(hit, Math.min(n, end + delta));
  }
  return issues;
}

let pass = 0, fail = 0;
const check = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (ok) { pass++; console.log("ok   " + n + "  " + JSON.stringify(got)); } else { fail++; console.log("FAIL " + n + "  got=" + JSON.stringify(got) + " want=" + JSON.stringify(want)); } };
const snap = (code, line, endLine) => { const a = [{ line, endLine }]; snapIssuesToCodeLines(a, code); return [a[0].line, a[0].endLine]; };

const JS = ["function add(a, b) {", "  // BUG: 这里应该是 a + b", "  return a - b;", "}", "", "console.log(add(1, 2));", ""].join("\n");
check("空行 5 -> 最近代码行", snap(JS, 5, 5), [6, 6]);
check("注释行 2 -> 下一行代码", snap(JS, 2, 2), [3, 3]);
check("末尾空行 7 -> 6", snap(JS, 7, 7), [6, 6]);
check("本来就是代码行 3 保留", snap(JS, 3, 3), [3, 3]);
check("区间 1-2（起点是代码）保留原区间", snap(JS, 1, 2), [1, 2]);
check("注释区间 2-3 -> 平移到 3-4", snap(JS, 2, 3), [3, 4]);
const PY = ["def f():", "    # 注释", "    return 1"].join("\n");
check("Python # 注释行 2 -> 3", snap(PY, 2, 2), [3, 3]);
const C = ["/* 块注释 */", "int main() {", "  return 0;", "}"].join("\n");
check("块注释行 1 -> 2", snap(C, 1, 1), [2, 2]);
check("单行块注释算注释", isCodeLine("/* x */"), false);
check("块注释结束行算注释", isCodeLine(" */"), false);
check("C 指针解引用是代码", isCodeLine("*p = 1;"), true);
check("行尾注释仍是代码", isCodeLine("x = 1; // note"), true);
check("空字符串不是代码", isCodeLine("   "), false);
console.log("\n== " + pass + " 通过 / " + fail + " 失败 ==");
process.exit(fail ? 1 : 0);

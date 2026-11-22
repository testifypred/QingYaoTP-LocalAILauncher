// 分段审查验证：长代码（120 行）与短代码
const BASE = "http://127.0.0.1:8099";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const state = await (await fetch(BASE + "/api/state")).json();
const token = state.localToken;

function mkCode(n) {
  const lines = [];
  for (let i = 1; i <= n; i += 1) {
    if (i % 12 === 1) lines.push("function f" + i + "(a, b) {");
    else if (i % 12 === 0) lines.push("  return a + b;");
    else if (i % 12 === 6) lines.push("  if (a == null) return b;");
    else if (i % 12 === 9) lines.push("  console.log(\"line \" + " + i + ");");
    else lines.push("  const v" + i + " = a * " + i + " + b;");
  }
  while (lines.length < n) lines.push("// pad");
  return lines.slice(0, n).join("\n");
}

async function review(code, label) {
  const t0 = Date.now();
  const r = await fetch(BASE + "/api/code/review/stream", {
    method: "POST",
    headers: { "content-type": "application/json", "x-local-token": token },
    body: JSON.stringify({ code, lang: "javascript", file: "probe-long.js", intent: "检查语法与明显逻辑问题" }),
    signal: AbortSignal.timeout(900000),
  });
  if (!r.ok) { console.log(label, "HTTP", r.status, (await r.text()).slice(0, 200)); return; }
  const reader = r.body.getReader(); const dec = new TextDecoder();
  let buf = "", chunks = [], deltas = 0, findings = null, done = null, err = null;
  for (;;) {
    const { done: d, value } = await reader.read(); if (d) break;
    buf += dec.decode(value, { stream: true });
    let i; while ((i = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, i); buf = buf.slice(i + 2);
      const line = block.split("\n").find((l) => l.startsWith("data:")); if (!line) continue;
      const raw = line.slice(5).trim(); if (!raw) continue;
      let ev; try { ev = JSON.parse(raw); } catch { continue; }
      if (ev.type === "chunk") chunks.push(ev.index + "/" + ev.total + "(" + ev.from + "-" + ev.to + ")");
      else if (ev.type === "delta") deltas += 1;
      else if (ev.type === "findings") findings = ev;
      else if (ev.type === "done") done = ev;
      else if (ev.type === "error") err = ev.message;
    }
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(label, "secs=" + secs, "chunks=[" + chunks.join(",") + "]", "deltas=" + deltas,
    "issues=" + (findings ? findings.issues.length : "none"), "partial=" + (findings ? findings.partial : "?"),
    "lines=" + (findings ? findings.lineCount : "?"), "done=" + (done ? done.seconds + "s" : "none"), "err=" + err);
  if (findings && findings.issues.length) {
    const bad = findings.issues.filter((it) => it.line < 1 || it.line > (findings.lineCount || 0));
    console.log("  line-range bad=" + bad.length, JSON.stringify(findings.issues.slice(0, 3).map((x) => ({ line: x.line, sev: x.severity, title: String(x.title).slice(0, 24) }))));
  }
}

console.log("== 短代码 12 行（不应分段） ==");
await review(mkCode(12), "short");
console.log("== 长代码 120 行（应 3 段） ==");
await review(mkCode(120), "long");

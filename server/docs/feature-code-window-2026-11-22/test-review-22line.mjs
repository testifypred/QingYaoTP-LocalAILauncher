import { readFile } from "node:fs/promises";
const BASE = "http://127.0.0.1:8099";
const code = await readFile("D:\\LocalModels\\workspace\\code\\python-210407-1.py", "utf8");
const st = await (await fetch(BASE + "/api/state")).json();
const t0 = Date.now();
try {
  const r = await fetch(BASE + "/api/code/review/stream", {
    method: "POST",
    headers: { "content-type": "application/json", "x-local-token": st.localToken },
    body: JSON.stringify({ code, lang: "python", file: "python-210407-1.py", intent: "检查语法与逻辑" }),
    signal: AbortSignal.timeout(300000),
  });
  console.log("HTTP " + r.status);
  const reader = r.body.getReader(); const dec = new TextDecoder();
  let buf = "", types = [], deltas = 0, findings = null, err = null;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let i; while ((i = buf.indexOf("\n\n")) >= 0) {
      const b = buf.slice(0, i); buf = buf.slice(i + 2);
      const line = b.split("\n").find((l) => l.startsWith("data:")); if (!line) continue;
      const raw = line.slice(5).trim(); if (!raw) continue;
      let ev; try { ev = JSON.parse(raw); } catch { continue; }
      if (ev.type === "delta") deltas += 1;
      else if (ev.type === "findings") findings = ev;
      else if (ev.type === "error") err = ev.message;
      types.push(ev.type);
    }
  }
  console.log("deltas=" + deltas + " issues=" + (findings ? findings.issues.length : "none") + " total=" + (Date.now() - t0) + "ms err=" + err);
  if (findings) console.log("summary=" + JSON.stringify(String(findings.summary).slice(0, 80)));
} catch (e) {
  console.log("FAIL after " + (Date.now() - t0) + "ms: " + String(e && e.message).slice(0, 200));
}

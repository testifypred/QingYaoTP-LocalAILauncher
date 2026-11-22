import { readFile } from "node:fs/promises";
const BASE = "http://127.0.0.1:8099";
const code = await readFile("D:\\LocalModels\\workspace\\code\\python-115523-1.py", "utf8");
const st = await (await fetch(BASE + "/api/state")).json();
const t0 = Date.now();
try {
  const r = await fetch(BASE + "/api/code/review/stream", {
    method: "POST",
    headers: { "content-type": "application/json", "x-local-token": st.localToken },
    body: JSON.stringify({ code, lang: "python", file: "python-115523-1.py", intent: "检查语法与逻辑", max_tokens: 400, json_max_tokens: 400 }),
    signal: AbortSignal.timeout(500000),
  });
  console.log("HTTP " + r.status);
  const reader = r.body.getReader(); const dec = new TextDecoder();
  let buf = "", deltas = 0, first = 0, findings = null, done = null, err = null;
  for (;;) {
    const { done: d, value } = await reader.read(); if (d) break;
    buf += dec.decode(value, { stream: true });
    let i; while ((i = buf.indexOf("\n\n")) >= 0) {
      const b = buf.slice(0, i); buf = buf.slice(i + 2);
      const line = b.split("\n").find((l) => l.startsWith("data:")); if (!line) continue;
      const raw = line.slice(5).trim(); if (!raw) continue;
      let ev; try { ev = JSON.parse(raw); } catch { continue; }
      if (ev.type === "delta") { deltas += 1; if (!first) first = Date.now() - t0; }
      else if (ev.type === "findings") findings = ev;
      else if (ev.type === "done") done = ev;
      else if (ev.type === "error") err = ev.message;
    }
  }
  console.log("firstDelta=" + first + "ms deltas=" + deltas + " issues=" + (findings ? findings.issues.length : "none") + " total=" + (Date.now() - t0) + "ms err=" + err);
} catch (e) {
  console.log("FAIL after " + (Date.now() - t0) + "ms: " + String(e && e.message).slice(0, 200));
}

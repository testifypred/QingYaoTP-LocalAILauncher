const BASE = "http://127.0.0.1:8099";
const st = await (await fetch(BASE + "/api/state")).json();
const t0 = Date.now();
try {
  const r = await fetch(BASE + "/api/code/review/stream", {
    method: "POST",
    headers: { "content-type": "application/json", "x-local-token": st.localToken },
    body: JSON.stringify({ code: "function f(a){ return a+1 }\n", lang: "javascript", file: "tiny.js", intent: "语法检查" }),
    signal: AbortSignal.timeout(120000),
  });
  console.log("HTTP " + r.status + " after " + (Date.now() - t0) + "ms");
  const reader = r.body.getReader(); const dec = new TextDecoder();
  let buf = "", types = [];
  for (;;) { const { done, value } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true }); let i; while ((i = buf.indexOf("\n\n")) >= 0) { const b = buf.slice(0, i); buf = buf.slice(i + 2); const line = b.split("\n").find((l) => l.startsWith("data:")); if (!line) continue; const raw = line.slice(5).trim(); if (!raw) continue; let ev; try { ev = JSON.parse(raw); } catch { continue; } types.push(ev.type); } }
  console.log("types=" + types.join(",") + " total=" + (Date.now() - t0) + "ms");
} catch (e) {
  console.log("FAIL after " + (Date.now() - t0) + "ms: " + String(e && e.message).slice(0, 200));
}

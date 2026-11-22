const BASE = "http://127.0.0.1:8099";
const t0 = Date.now();
try {
  const r = await fetch(BASE + "/v1/chat/completions", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "你好" }], stream: true, max_tokens: 8 }),
    signal: AbortSignal.timeout(60000),
  });
  const reader = r.body.getReader(); const dec = new TextDecoder();
  let buf = "", first = 0, out = "";
  for (;;) { const { done, value } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true }); let i; while ((i = buf.indexOf("\n\n")) >= 0) { const b = buf.slice(0, i); buf = buf.slice(i + 2); const line = b.split("\n").find((l) => l.startsWith("data:")); if (!line) continue; const raw = line.slice(5).trim(); if (!raw || raw === "[DONE]") continue; let ev; try { ev = JSON.parse(raw); } catch { continue; } const d = ev.choices?.[0]?.delta || {}; if (d.content) { out += d.content; if (!first) first = Date.now() - t0; } } }
  console.log("chat ok first=" + first + "ms out=" + JSON.stringify(out.slice(0, 40)) + " total=" + (Date.now() - t0) + "ms");
} catch (e) {
  console.log("chat FAIL: " + String(e && e.message).slice(0, 200));
}

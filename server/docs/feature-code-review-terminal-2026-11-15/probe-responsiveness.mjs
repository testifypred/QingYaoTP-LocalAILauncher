const BASE = "http://127.0.0.1:8099";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const j = async (p, ms = 5000) => { const t = Date.now(); try { const r = await fetch(BASE + p, { signal: AbortSignal.timeout(ms) }); await r.text(); return { ms: Date.now() - t, ok: r.ok }; } catch (e) { return { ms: Date.now() - t, ok: false, err: e.name }; } };
const st = await j("/api/state", 15000);
console.log("idle /api/state: " + st.ms + "ms ok=" + st.ok);
const token = (await (await fetch(BASE + "/api/state")).json()).localToken;
const CODE = "function f(a){let x;for(let i=0;i<=a.length;i++){x+=a[i]}return x}";
const p = fetch(BASE + "/api/code/review/stream", { method: "POST", headers: { "content-type": "application/json", "x-local-token": token }, body: JSON.stringify({ code: CODE, lang: "javascript", max_tokens: 500 }), signal: AbortSignal.timeout(120000) });
await sleep(1500);
for (let i = 0; i < 8; i++) {
  const r = await j("/api/state", 8000);
  console.log("during review #" + (i + 1) + ": " + r.ms + "ms ok=" + r.ok + (r.err ? " err=" + r.err : ""));
  await sleep(2000);
}
const resp = await p; console.log("review HTTP " + resp.status + " ct=" + resp.headers.get("content-type"));
if (resp.body) { const rd = resp.body.getReader(); let n = 0; for (;;) { const { done } = await rd.read(); if (done) break; n++; } console.log("chunks=" + n); }

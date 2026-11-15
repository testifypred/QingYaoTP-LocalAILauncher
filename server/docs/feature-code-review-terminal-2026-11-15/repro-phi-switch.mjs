// 复现：审查时切换到 Phi-4-mini（上一轮 8099 卡死的位置），带硬超时与逐事件时间戳
const BASE = "http://127.0.0.1:8099";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const json = async (p, opt = {}) => { const r = await fetch(BASE + p, { ...opt, signal: AbortSignal.timeout(opt.timeout || 30000) }); return { status: r.status, data: await r.json().catch(() => null) }; };
const st = await json("/api/state");
const token = st.data?.localToken;
console.log("loaded=" + (st.data?.loaded || "none") + " token=" + (token ? "ok" : "no"));
if (!st.data?.loaded) {
  const lr = await json("/api/load", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ file: "qwen3-5-4B-Q4_K_M.gguf", contextSize: 8192 }), timeout: 300000 });
  console.log("load 4B -> " + lr.status);
  for (let i = 0; i < 40; i++) { await sleep(2000); const s = await json("/api/state"); if (s.data?.loaded) { console.log("loaded " + s.data.loaded); break; } }
}
const CODE = ["function sum(list) {", "  let total;", "  for (let i = 0; i <= list.length; i++) total += list[i];", "  return total;", "}", ""].join("\n");
const t0 = Date.now();
const send = (o) => console.log("  +" + ((Date.now() - t0) / 1000).toFixed(1) + "s " + JSON.stringify(o).slice(0, 180));
try {
  const r = await fetch(BASE + "/api/code/review/stream", {
    method: "POST",
    headers: { "content-type": "application/json", "x-local-token": token },
    body: JSON.stringify({ code: CODE, lang: "javascript", file: "sum.js", intent: "查 bug", model: "Phi-4-mini-instruct-Q4_K_M.gguf", max_tokens: 300 }),
    signal: AbortSignal.timeout(150000),
  });
  console.log("HTTP " + r.status + " ct=" + r.headers.get("content-type"));
  if ((r.headers.get("content-type") || "").includes("text/event-stream")) {
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let n = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const raw = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 2);
        if (!raw.startsWith("data:")) continue;
        let ev = null; try { ev = JSON.parse(raw.slice(5).trim()); } catch {}
        n += 1;
        if (ev && (ev.type !== "delta" || n <= 2)) send(ev);
      }
    }
    console.log("events=" + n + " total " + ((Date.now() - t0) / 1000).toFixed(1) + "s");
  } else {
    console.log(JSON.stringify(await r.json().catch(() => null)));
  }
} catch (e) {
  console.log("EXCEPTION/HUNG after " + ((Date.now() - t0) / 1000).toFixed(1) + "s: " + (e?.name || "") + " " + (e?.message || e));
}

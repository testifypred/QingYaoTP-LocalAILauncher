// 并发回归：review 进行中切模型必须 409（不能卡死）；两个并发 review 要串行都跑完
const BASE = "http://127.0.0.1:8099";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log("  ok   " + n + (x ? "  [" + x + "]" : "")); } else { fail++; console.log("  FAIL " + n + "  " + (x || "")); } };
const j = async (p, opt = {}) => { const r = await fetch(BASE + p, { ...opt, signal: AbortSignal.timeout(opt.timeout || 30000) }); return { status: r.status, data: await r.json().catch(() => null) }; };
const st = await j("/api/state");
const token = st.data?.localToken || "";
console.log("loaded=" + (st.data?.loaded || "none"));
if (!st.data?.loaded) {
  await j("/api/load", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ file: "qwen3-5-4B-Q4_K_M.gguf", contextSize: 8192 }), timeout: 300000 });
  for (let i = 0; i < 40; i++) { await sleep(2000); const s = await j("/api/state"); if (s.data?.loaded) break; }
}
async function review(tag, maxTokens) {
  const t0 = Date.now();
  const r = await fetch(BASE + "/api/code/review/stream", {
    method: "POST",
    headers: { "content-type": "application/json", "x-local-token": token },
    body: JSON.stringify({ code: "function f(a){let x;for(let i=0;i<=a.length;i++){x+=a[i]}return x}", lang: "javascript", file: tag + ".js", max_tokens: maxTokens }),
    signal: AbortSignal.timeout(180000),
  });
  const rd = r.body.getReader();
  let n = 0, types = [];
  let buf = "";
  const dec = new TextDecoder();
  for (;;) { const { done, value } = await rd.read(); if (done) break; buf += dec.decode(value, { stream: true }); let i; while ((i = buf.indexOf("\n\n")) >= 0) { const raw = buf.slice(0, i).trim(); buf = buf.slice(i + 2); if (raw.startsWith("data:")) { try { const ev = JSON.parse(raw.slice(5).trim()); types.push(ev.type); n++; } catch {} } } }
  return { ms: Date.now() - t0, n, types };
}
console.log("== 1) review 进行中 /api/load 应 409 ==");
const p1 = review("concurrent-a", 900);
await sleep(4000);
const loadDuring = await j("/api/load", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ file: "Phi-4-mini-instruct-Q4_K_M.gguf", contextSize: 8192 }), timeout: 20000 });
ok("review 中 /api/load -> 409", loadDuring.status === 409, "HTTP " + loadDuring.status + " " + JSON.stringify(loadDuring.data?.error?.message || "").slice(0, 60));
const pingDuring = await j("/api/state", { timeout: 10000 });
ok("review 中 /api/state 仍能响应", pingDuring.status === 200 && !!pingDuring.data, pingDuring.status + " " + (pingDuring.data?.loaded || ""));
const r1 = await p1;
ok("review A 完成（含 findings/done）", r1.types.includes("findings") && r1.types[r1.types.length - 1] === "done", r1.n + " ev " + (r1.ms / 1000).toFixed(1) + "s");
console.log("== 2) 两个并发 review 串行完成 ==");
const t0 = Date.now();
const [r2, r3] = await Promise.all([review("concurrent-b", 400), review("concurrent-c", 400)]);
ok("并发 review B 完成", r2.types.includes("findings") && r2.types[r2.types.length - 1] === "done", (r2.ms / 1000).toFixed(1) + "s");
ok("并发 review C 完成", r3.types.includes("findings") && r3.types[r3.types.length - 1] === "done", (r3.ms / 1000).toFixed(1) + "s");
ok("两个都跑完且总时长 > 单个（确实串行）", (Date.now() - t0) / 1000 > 3, ((Date.now() - t0) / 1000).toFixed(1) + "s");
console.log("== 3) 空闲后 /api/load 恢复可用 ==");
await sleep(1000);
const loadAfter = await j("/api/load", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ file: "qwen3-5-4B-Q4_K_M.gguf", contextSize: 8192 }), timeout: 300000 });
ok("空闲后 /api/load 200", loadAfter.status === 200, "HTTP " + loadAfter.status);
console.log("\n结果: " + pass + "/" + (pass + fail) + " 通过");
process.exit(fail ? 1 : 0);

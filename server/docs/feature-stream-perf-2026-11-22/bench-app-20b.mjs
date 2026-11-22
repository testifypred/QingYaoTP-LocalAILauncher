// 应用层验证：useMmap:false 后 20B 的加载耗时 / 内存 / 生成速度
import os from "node:os";
import { execSync } from "node:child_process";
const BASE = "http://127.0.0.1:8099";
const gb = (n) => +(n / 1024 ** 3).toFixed(2);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const gpuShared = () => {
  try {
    const out = execSync("powershell -NoProfile -Command \"(Get-Counter '\\GPU Adapter Memory(*)\\Shared Usage' | Select-Object -ExpandProperty CounterSamples | Measure-Object CookedValue -Sum).Sum\"", { encoding: "utf8", timeout: 20000 });
    return gb(Number(String(out).trim()));
  } catch { return null; }
};
const state = async () => (await (await fetch(BASE + "/api/state")).json());
const load = async (file) => {
  const t0 = Date.now();
  const r = await fetch(BASE + "/api/load", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ file, contextSize: 16384 }), signal: AbortSignal.timeout(300000) });
  const j = await r.json().catch(() => null);
  log("load response", r.status, JSON.stringify(j), "wall=" + ((Date.now() - t0) / 1000).toFixed(1) + "s");
};
const gen = async (label) => {
  const t0 = Date.now();
  const r = await fetch(BASE + "/v1/chat/completions", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "用三句话说明 KV 缓存的作用。" }], stream: true, max_tokens: 48, temperature: 0 }),
    signal: AbortSignal.timeout(300000),
  });
  const reader = r.body.getReader(); const dec = new TextDecoder();
  let buf = "", first = 0, content = "", usage = null;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let i; while ((i = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, i); buf = buf.slice(i + 2);
      const line = block.split("\n").find((l) => l.startsWith("data:")); if (!line) continue;
      const raw = line.slice(5).trim(); if (!raw || raw === "[DONE]") continue;
      let ev; try { ev = JSON.parse(raw); } catch { continue; }
      const d = ev.choices?.[0]?.delta || {};
      if (d.content) { content += d.content; if (!first) first = Date.now() - t0; }
      if (ev.usage) usage = ev.usage;
    }
  }
  const ms = Date.now() - t0;
  const tokens = usage?.completion_tokens ?? 0;
  log("GEN " + label, "ttft=" + first + "ms", "tokens=" + tokens, "total=" + ms + "ms", "tok/s=" + (tokens / ((ms - first) / 1000 || 1)).toFixed(2), "chars=" + content.length);
};

log("== 20B ==", "freeBefore=" + gb(os.freemem()));
await load("gpt-oss-20b-MXFP4.gguf");
await fetch(BASE + "/api/state");
log("after load", "free=" + gb(os.freemem()), "gpuShared=" + gpuShared(), "loaded=" + (await state()).loaded, "ctx=" + (await state()).context);
await gen("20B");
await fetch(BASE + "/api/unload", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
await new Promise((r) => setTimeout(r, 2000));
log("after unload", "free=" + gb(os.freemem()), "gpuShared=" + gpuShared());

log("== 4B ==", "freeBefore=" + gb(os.freemem()));
await load("qwen3-5-4B-Q4_K_M.gguf");
log("after load", "free=" + gb(os.freemem()), "gpuShared=" + gpuShared());
await gen("4B");

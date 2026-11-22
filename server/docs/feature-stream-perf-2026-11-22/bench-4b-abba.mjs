import { getLlama, LlamaCompletion } from "node-llama-cpp";
import os from "node:os";
const gb = (n) => +(n / 1024 ** 3).toFixed(2);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const llama = await getLlama({ gpu: "vulkan", build: "never" });
const MODEL = "D:\\LocalModels\\qwen3-5-4B-Q4_K_M.gguf";
const CASES = [
  { mmap: true, flash: true }, { mmap: false, flash: true },
  { mmap: true, flash: true }, { mmap: false, flash: true },
  { mmap: false, flash: false }, { mmap: false, flash: true },
];
for (const c of CASES) {
  let model = null, ctx = null;
  try {
    const t0 = Date.now();
    model = await llama.loadModel({ modelPath: MODEL, gpuLayers: 99, useMmap: c.mmap });
    const loadMs = Date.now() - t0;
    ctx = await model.createContext({ contextSize: 4096, flashAttention: c.flash });
    const completion = new LlamaCompletion({ contextSequence: ctx.getSequence() });
    let tokens = 0, ttft = 0;
    const t1 = Date.now();
    await completion.generateCompletion("KV cache is useful because", { maxTokens: 32, temperature: 0, onToken: () => { tokens += 1; if (!ttft) ttft = Date.now() - t1; } });
    const ms = Date.now() - t1;
    log((c.mmap ? "mmap " : "nomap") + (c.flash ? " flash" : " noflash"), "load=" + (loadMs / 1000).toFixed(1), "ttft=" + ttft, "tok/s=" + (tokens / (ms / 1000)).toFixed(2), "free=" + gb(os.freemem()), "fa=" + (ctx.flashAttention ?? "?"));
  } catch (e) {
    log("FAIL " + JSON.stringify(c) + ": " + String(e?.message ?? e).slice(0, 200));
  } finally {
    try { if (ctx) await ctx.dispose(); } catch {}
    try { if (model) await model.dispose(); } catch {}
  }
}
await llama.dispose();

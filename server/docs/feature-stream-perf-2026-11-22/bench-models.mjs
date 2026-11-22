import { getLlama, LlamaCompletion } from "node-llama-cpp";
import os from "node:os";
const gb = (n) => +(n / 1024 ** 3).toFixed(2);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const llama = await getLlama({ gpu: "vulkan", build: "never" });
const CASES = [
  { model: "qwen3-5-4B-Q4_K_M.gguf", mmap: false, flash: true, name: "4B mmap=false flash" },
  { model: "qwen3-5-4B-Q4_K_M.gguf", mmap: true, flash: true, name: "4B mmap=true flash" },
  { model: "qwen3-5-4B-Q4_K_M.gguf", mmap: false, flash: false, name: "4B mmap=false noflash" },
  { model: "Qwen3.5-9B-Q4_K_M.gguf", mmap: false, flash: true, name: "9B mmap=false flash" },
  { model: "gpt-oss-20b-MXFP4.gguf", mmap: false, flash: true, name: "20B mmap=false flash" },
];
for (const c of CASES) {
  log("== " + c.name + " ==", "free=" + gb(os.freemem()));
  let model = null, ctx = null;
  try {
    const t0 = Date.now();
    model = await llama.loadModel({ modelPath: "D:\\LocalModels\\" + c.model, gpuLayers: 99, useMmap: c.mmap });
    const loadMs = Date.now() - t0;
    ctx = await model.createContext({ contextSize: 4096, flashAttention: c.flash });
    const completion = new LlamaCompletion({ contextSequence: ctx.getSequence() });
    let tokens = 0, ttft = 0;
    const t1 = Date.now();
    await completion.generateCompletion("KV cache is useful because", {
      maxTokens: 32, temperature: 0,
      onToken: () => { tokens += 1; if (!ttft) ttft = Date.now() - t1; },
    });
    const ms = Date.now() - t1;
    log("RESULT " + c.name, "load=" + (loadMs / 1000).toFixed(1) + "s", "ttft=" + ttft + "ms", "tok/s=" + (tokens / (ms / 1000)).toFixed(2), "freeAfter=" + gb(os.freemem()), "rss=" + gb(process.memoryUsage().rss));
  } catch (e) {
    log("FAIL " + c.name + ": " + String(e?.message ?? e).slice(0, 200));
  } finally {
    try { if (ctx) await ctx.dispose(); } catch {}
    try { if (model) await model.dispose(); } catch {}
  }
}
await llama.dispose();
log("done free=" + gb(os.freemem()));

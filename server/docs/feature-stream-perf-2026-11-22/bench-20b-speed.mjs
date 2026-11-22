// 20B 速度对比（raw completion）：CPU+mmap / 部分 offload / 更多层
import { getLlama, LlamaCompletion } from "node-llama-cpp";
import os from "node:os";
const MODEL = "D:\\LocalModels\\gpt-oss-20b-MXFP4.gguf";
const PROMPT = "KV cache is useful because";
const CONFIGS = [
  { name: "CPU+mmap", gpuLayers: 0, useMmap: true },
  { name: "gpu 12", gpuLayers: 12, useMmap: false },
  { name: "gpu 20", gpuLayers: 20, useMmap: false },
];
const gb = (n) => +(n / 1024 ** 3).toFixed(2);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const llama = await getLlama({ gpu: "vulkan", build: "never" });
for (const cfg of CONFIGS) {
  log("== " + cfg.name + " ==", "free=" + gb(os.freemem()) + "GB");
  let model = null, ctx = null;
  try {
    const t0 = Date.now();
    model = await llama.loadModel({ modelPath: MODEL, gpuLayers: cfg.gpuLayers, useMmap: cfg.useMmap });
    const loadMs = Date.now() - t0;
    ctx = await model.createContext({ contextSize: 4096 });
    const completion = new LlamaCompletion({ contextSequence: ctx.getSequence() });
    let tokens = 0, ttft = 0;
    const t1 = Date.now();
    let out = "";
    await completion.generateCompletion(PROMPT, {
      maxTokens: 32, temperature: 0,
      onToken: (t) => { tokens += 1; if (!ttft) ttft = Date.now() - t1; },
      onTextChunk: (c) => { out += c; },
    });
    const genMs = Date.now() - t1;
    log("RESULT " + cfg.name,
      "load=" + (loadMs / 1000).toFixed(1) + "s",
      "rss=" + gb(process.memoryUsage().rss) + "GB",
      "freeAfter=" + gb(os.freemem()) + "GB",
      "ttft=" + ttft + "ms",
      "tokens=" + tokens,
      "gen=" + (genMs / 1000).toFixed(1) + "s",
      "tok/s=" + (tokens / (genMs / 1000)).toFixed(2),
      "sample=" + JSON.stringify(String(out).replace(/\s+/g, " ").slice(0, 80)));
  } catch (e) {
    log("FAIL " + cfg.name + ": " + String(e?.message ?? e).slice(0, 300));
  } finally {
    try { if (ctx) await ctx.dispose(); } catch {}
    try { if (model) await model.dispose(); } catch {}
    log("disposed free=" + gb(os.freemem()) + "GB");
  }
}
await llama.dispose();
log("done");

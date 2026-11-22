import { getLlama, LlamaCompletion } from "node-llama-cpp";
import os from "node:os";
const MODEL = "D:\\LocalModels\\gpt-oss-20b-MXFP4.gguf";
const gb = (n) => +(n / 1024 ** 3).toFixed(2);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const llama = await getLlama({ gpu: "vulkan", build: "never" });
log("free0=" + gb(os.freemem()));
let model = null, ctx = null;
try {
  const t0 = Date.now();
  model = await llama.loadModel({ modelPath: MODEL, gpuLayers: 25, useMmap: false });
  log("loaded in " + ((Date.now() - t0) / 1000).toFixed(1) + "s", "rss=" + gb(process.memoryUsage().rss), "free=" + gb(os.freemem()), "gpuLayers=" + model.gpuLayers);
  ctx = await model.createContext({ contextSize: 4096 });
  const completion = new LlamaCompletion({ contextSequence: ctx.getSequence() });
  let tokens = 0, ttft = 0;
  const t1 = Date.now();
  await completion.generateCompletion("KV cache is useful because", {
    maxTokens: 32, temperature: 0,
    onToken: () => { tokens += 1; if (!ttft) ttft = Date.now() - t1; },
  });
  const ms = Date.now() - t1;
  log("RESULT full25", "ttft=" + ttft + "ms", "tokens=" + tokens, "gen=" + (ms / 1000).toFixed(1) + "s", "tok/s=" + (tokens / (ms / 1000)).toFixed(2), "freeAfter=" + gb(os.freemem()), "rss=" + gb(process.memoryUsage().rss));
} catch (e) {
  log("FAIL: " + String(e?.message ?? e).slice(0, 400));
} finally {
  try { if (ctx) await ctx.dispose(); } catch {}
  try { if (model) await model.dispose(); } catch {}
  log("disposed free=" + gb(os.freemem()));
}
await llama.dispose();

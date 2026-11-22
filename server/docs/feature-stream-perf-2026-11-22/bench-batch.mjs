import { getLlama, LlamaCompletion } from "node-llama-cpp";
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const llama = await getLlama({ gpu: "vulkan", build: "never" });
const MODEL = "D:\\LocalModels\\qwen3-5-4B-Q4_K_M.gguf";
const filler = "The quick brown fox jumps over the lazy dog. KV cache stores past attention keys and values. ";
let prompt = "Summarize in one sentence: ";
while (prompt.length < 3200) prompt += filler;
for (const batch of [512, 1024, 2048]) {
  let model = null, ctx = null;
  try {
    model = await llama.loadModel({ modelPath: MODEL, gpuLayers: 99, useMmap: false });
    ctx = await model.createContext({ contextSize: 8192, batchSize: batch, flashAttention: true });
    const completion = new LlamaCompletion({ contextSequence: ctx.getSequence() });
    let ttft = 0, tokens = 0;
    const t0 = Date.now();
    await completion.generateCompletion(prompt, { maxTokens: 24, temperature: 0, onToken: () => { tokens += 1; if (!ttft) ttft = Date.now() - t0; } });
    const ms = Date.now() - t0;
    log("batch=" + batch, "promptChars=" + prompt.length, "ttft=" + ttft + "ms", "tok/s=" + (tokens / ((ms - ttft) / 1000 || 1)).toFixed(2), "total=" + ms + "ms");
  } catch (e) {
    log("FAIL batch=" + batch + ": " + String(e?.message ?? e).slice(0, 200));
  } finally {
    try { if (ctx) await ctx.dispose(); } catch {}
    try { if (model) await model.dispose(); } catch {}
  }
}
await llama.dispose();

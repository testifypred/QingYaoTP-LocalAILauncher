// 20B 在 31GB / Arc 核显上的三种加载姿势：CPU(mmmp) / 部分 offload / 全 offload
import { getLlama, LlamaChatSession } from "node-llama-cpp";
import os from "node:os";

const MODEL = "D:\\LocalModels\\gpt-oss-20b-MXFP4.gguf";
const PROMPT = "用一句话说明什么是 KV 缓存。";
const CONFIGS = [
  { name: "CPU + mmap", gpuLayers: 0, useMmap: true },
  { name: "partial 10 层", gpuLayers: 10, useMmap: false },
  { name: "partial 16 层", gpuLayers: 16, useMmap: false },
];

const gb = (n) => +(n / 1024 ** 3).toFixed(2);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const llama = await getLlama({ gpu: "vulkan", build: "never" });
log("llama ready; gpu=" + llama.gpu + " supportsMmap=" + llama.supportsMmap + " gpuSupportsMmap=" + llama.gpuSupportsMmap);

for (const cfg of CONFIGS) {
  const free0 = os.freemem();
  log("== " + cfg.name + " ==", "freeBefore=" + gb(free0) + "GB");
  let model = null;
  let ctx = null;
  try {
    const t0 = Date.now();
    model = await llama.loadModel({ modelPath: MODEL, gpuLayers: cfg.gpuLayers, useMmap: cfg.useMmap });
    const loadMs = Date.now() - t0;
    ctx = await model.createContext({ contextSize: 4096 });
    const seq = ctx.getSequence();
    const session = new LlamaChatSession({ contextSequence: seq });
    let ttft = 0;
    let tokens = 0;
    const t1 = Date.now();
    const meta = await session.promptWithMeta(PROMPT, {
      maxTokens: 32,
      temperature: 0,
      onToken: () => { tokens += 1; if (!ttft) ttft = Date.now() - t1; },
    });
    const genMs = Date.now() - t1;
    const used = Number(meta?.tokenMeter?.tokens?.completion ?? tokens) || tokens;
    const text = String(meta?.responseText ?? "").replace(/\s+/g, " ").slice(0, 60);
    log("RESULT " + cfg.name,
      "load=" + (loadMs / 1000).toFixed(1) + "s",
      "rss=" + gb(process.memoryUsage().rss) + "GB",
      "freeAfter=" + gb(os.freemem()) + "GB",
      "ttft=" + ttft + "ms",
      "tokens=" + used,
      "gen=" + (genMs / 1000).toFixed(1) + "s",
      "tok/s=" + (used / (genMs / 1000)).toFixed(2),
      "sample=" + JSON.stringify(text));
    await seq.dispose().catch(() => {});
  } catch (e) {
    log("FAIL " + cfg.name + ": " + String(e?.message ?? e).slice(0, 300));
  } finally {
    try { if (ctx) await ctx.dispose(); } catch {}
    try { if (model) await model.dispose(); } catch {}
    log("disposed", "free=" + gb(os.freemem()) + "GB");
  }
}
await llama.dispose();
log("done");

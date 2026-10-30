import { getLlama, LlamaChatSession } from "node-llama-cpp";

const llama = await getLlama({ gpu: "vulkan" });
const PROMPTS = ["你好", "用三句话介绍杭州。", "用一句话解释什么是模型量化。"];

async function bench(label, modelPath) {
  console.log(`\n########## ${label} ##########`);
  const model = await llama.loadModel({ modelPath });
  const context = await model.createContext({ contextSize: 8192 });
  for (const p of PROMPTS) {
    const sequence = context.getSequence();
    const session = new LlamaChatSession({ contextSequence: sequence });
    const t0 = Date.now();
    const meta = await session.promptWithMeta(p, { maxTokens: 300, temperature: 0.7 });
    const ms = Date.now() - t0;
    const text = (meta.responseText ?? "").trim();
    console.log(`\n> ${p}`);
    console.log(
      `  [${(ms / 1000).toFixed(1)}s | ${text.length}字 | ${(text.length / (ms / 1000)).toFixed(1)}字/s | stop=${meta.stopReason}]`,
    );
    console.log(`  ${text ? text.replace(/\n/g, "\n  ") : "!!! 空回复 !!!"}`);
    await sequence.dispose();
  }
  await context.dispose();
  await model.dispose();
}

await bench("A. Phi-4-mini-instruct Q4_K_M  (2.32GB)", "D:\\LocalModels\\Phi-4-mini-instruct-Q4_K_M.gguf");
await bench("B. Qwen2.5-7B-Instruct Q4_K_M  (4.36GB)", "D:\\LocalModels\\qwen2.5-7b-instruct-1m-q4_k_m.gguf");
console.log("\n=== 对比结束 ===");

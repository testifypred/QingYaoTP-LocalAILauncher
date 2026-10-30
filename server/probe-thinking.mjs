/**
 * 验证：能否通过 JinjaTemplateChatWrapper 的 reasoning 开关，关闭思考模型的思考段。
 * 用已经失败过的 Qwen3.5-4B 做对照实验。
 */
import { getLlama, resolveChatWrapper, LlamaChatSession } from "node-llama-cpp";

const MODEL = "D:\\LocalModels\\qwen3-5-4B-Q4_K_M.gguf";
const PROMPT = "用一句话解释什么是模型量化。";

const llama = await getLlama({ gpu: "vulkan" });
const model = await llama.loadModel({ modelPath: MODEL });
const context = await model.createContext({ contextSize: 4096 });

for (const reasoning of [true, false]) {
  let wrapper;
  try {
    wrapper = resolveChatWrapper(model, {
      type: "jinjaTemplate",
      customWrapperSettings: { jinjaTemplate: { reasoning } },
      warningLogs: false,
    });
  } catch (e) {
    console.log(`reasoning=${reasoning} 解析 wrapper 失败: ${e.message}`);
    continue;
  }
  console.log(`\n######## reasoning: ${reasoning} | wrapper: ${wrapper?.constructor?.name} ########`);

  const sequence = context.getSequence();
  const session = new LlamaChatSession({ contextSequence: sequence, chatWrapper: wrapper });
  const t0 = Date.now();
  const meta = await session.promptWithMeta(PROMPT, { maxTokens: 300, temperature: 0.6 });
  const ms = Date.now() - t0;

  const text = (meta.responseText ?? "").trim();
  console.log(`  [${(ms / 1000).toFixed(1)}s | ${text.length}字 | stop=${meta.stopReason}]`);
  console.log(`  正文: ${text ? JSON.stringify(text.slice(0, 300)) : "!!! 空 !!!"}`);

  const segs = session
    .getChatHistory()
    .filter((h) => h.type === "model")
    .flatMap((h) => h.response ?? [])
    .filter((s) => s && typeof s === "object" && s.segmentType);
  console.log(`  思考段: ${segs.length ? segs.map((s) => s.segmentType).join(",") : "(无)"}`);
  await sequence.dispose();
}

console.log("\n=== 结论 ===");

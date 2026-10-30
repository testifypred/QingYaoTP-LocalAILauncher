import { getLlama, LlamaChatSession } from "node-llama-cpp";

const llama = await getLlama({ gpu: "vulkan" });
const model = await llama.loadModel({ modelPath: "D:\\LocalModels\\qwen3-5-4B-Q4_K_M.gguf" });
const context = await model.createContext({ contextSize: 4096 });
const session = new LlamaChatSession({ contextSequence: context.getSequence() });

let chunkChars = 0;
const meta = await session.promptWithMeta("你好，请简短自我介绍 /no_think", {
  maxTokens: 400,
  temperature: 0.6,
  onTextChunk: (t) => { chunkChars += t.length; },
});

console.log("meta keys      :", Object.keys(meta).join(", "));
console.log("responseText   :", JSON.stringify(meta.responseText ?? ""));
console.log("stopReason     :", meta.stopReason);
console.log("onTextChunk 字数:", chunkChars);
for (const k of Object.keys(meta)) {
  const v = meta[k];
  if (typeof v === "string" && v.length > 0 && k !== "responseText") {
    console.log(`meta.${k} (${v.length} 字):`, JSON.stringify(v.slice(0, 300)));
  }
}
const hist = session.getChatHistory();
console.log("history 条目数  :", hist.length);
console.log("history 内容    :", JSON.stringify(hist).slice(0, 1200));

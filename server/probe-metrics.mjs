/**
 * 探针：验证四项指标的数据源
 *   1. token 用量（输入/输出）
 *   2. 输出速度 tok/s
 *   3. 首字耗时 TTFT
 *   4. 思维内容分段（onResponseChunk 的 segmentType）
 */
import { getLlama, LlamaChatSession, TokenMeter } from "node-llama-cpp";

const llama = await getLlama({ gpu: "vulkan" });
const model = await llama.loadModel({ modelPath: "D:\\LocalModels\\qwen2.5-7b-instruct-1m-q4_k_m.gguf" });
const context = await model.createContext({ contextSize: 4096 });

const meter = new TokenMeter();
const sequence = context.getSequence({ _tokenMeter: meter });
const session = new LlamaChatSession({ contextSequence: sequence });

let outViaOnToken = 0;
let firstTokenAt = null;
let firstTextAt = null;
let chunkCount = 0;
let segCount = 0;
const segmentTypes = new Set();

const t0 = Date.now();
const meta = await session.promptWithMeta("用一句话解释什么是机器学习，然后再说一句它的用途。", {
  maxTokens: 160,
  temperature: 0.5,
  onToken: (toks) => {
    outViaOnToken += toks.length;
    if (firstTokenAt === null) firstTokenAt = Date.now() - t0;
  },
  onTextChunk: () => {
    if (firstTextAt === null) firstTextAt = Date.now() - t0;
  },
  onResponseChunk: (c) => {
    chunkCount += 1;
    if (c && c.type === "segment") {
      segCount += 1;
      segmentTypes.add(c.segmentType);
    }
  },
});
const totalMs = Date.now() - t0;

console.log("---- 结果 ----");
console.log("TokenMeter.getState():", JSON.stringify(meter.getState()));
console.log("onToken 累计输出 token :", outViaOnToken);
console.log("总耗时 ms              :", totalMs);
console.log("TTFT(首个输出 token) ms:", firstTokenAt);
console.log("TTFT(首段正文) ms      :", firstTextAt);
console.log("onResponseChunk 次数   :", chunkCount, "其中 segment 段:", segCount, [...segmentTypes].join(",") || "(无)");
console.log("responseText 长度      :", (meta.responseText ?? "").length);
console.log("stopReason             :", meta.stopReason);
if (outViaOnToken > 0 && totalMs > 0) {
  const genMs = totalMs - (firstTokenAt ?? 0);
  console.log("生成速度 tok/s         :", ((outViaOnToken - 1) / (genMs / 1000)).toFixed(2));
}

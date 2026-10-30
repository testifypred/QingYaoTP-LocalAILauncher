/**
 * 探针：验证 node-llama-cpp 的函数调用能否被捕获成结构化结果。
 * 目标：不执行真实工具，只拿到「模型想调用谁、参数是什么」，
 * 以便翻译成 OpenAI 的 tool_calls 协议交给客户端执行。
 */
import { getLlama, LlamaChatSession, resolveChatWrapper, defineChatSessionFunction } from "node-llama-cpp";

const MODEL = "D:\\LocalModels\\qwen2.5-7b-instruct-1m-q4_k_m.gguf";

const llama = await getLlama({ gpu: "vulkan" });
const model = await llama.loadModel({ modelPath: MODEL });
const context = await model.createContext({ contextSize: 4096 });

let handlerParams = null;
const functions = {
  get_weather: defineChatSessionFunction({
    description: "查询指定城市当前的天气情况",
    params: {
      type: "object",
      properties: {
        city: { type: "string", description: "城市名称，例如 杭州" },
        unit: { type: "string", enum: ["celsius", "fahrenheit"], description: "温度单位" },
      },
      required: ["city"],
    },
    handler: async (p) => {
      handlerParams = p;
      return { deferred: true, note: "由客户端执行" };
    },
  }),
};

const wrapper = resolveChatWrapper(model, {
  type: "jinjaTemplate",
  customWrapperSettings: { jinjaTemplate: { reasoning: false } },
  warningLogs: false,
});

const sequence = context.getSequence();
const session = new LlamaChatSession({
  contextSequence: sequence,
  chatWrapper: wrapper ?? "auto",
  functions,
});

const meta = await session.promptWithMeta("杭州今天天气怎么样？", { maxTokens: 200, temperature: 0.2 });

console.log("stopReason    :", meta.stopReason);
console.log("responseText  :", JSON.stringify(meta.responseText ?? ""));
console.log("functionCalls :", JSON.stringify(meta.functionCalls ?? null));
console.log("handler 收到  :", JSON.stringify(handlerParams));
console.log("history 片段  :", JSON.stringify(session.getChatHistory()).slice(0, 800));
await sequence.dispose();

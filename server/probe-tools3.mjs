/**
 * 探针 3：最后两种尝试
 *  A. QwenChatWrapper + 明确要求使用工具的系统提示
 *  B. functions 改在 prompt 级别传
 *  C. 用 grammar 强制输出 JSON 的替代方案是否可行
 */
import { getLlama, resolveChatWrapper, LlamaChatSession, defineChatSessionFunction, LlamaJsonSchemaGrammar } from "node-llama-cpp";

const MODEL = "D:\\LocalModels\\qwen2.5-7b-instruct-1m-q4_k_m.gguf";
const PROMPT = "杭州今天天气怎么样？";

const llama = await getLlama({ gpu: "vulkan" });
const model = await llama.loadModel({ modelPath: MODEL });
const context = await model.createContext({ contextSize: 4096 });

function mkFns() {
  let got = null;
  return {
    functions: {
      get_weather: defineChatSessionFunction({
        description: "查询指定城市当前的天气。凡是问天气的问题都必须调用它。",
        params: {
          type: "object",
          properties: { city: { type: "string", description: "城市名称" } },
          required: ["city"],
        },
        handler: async (p) => { got = p; return { deferred: true }; },
      }),
    },
    got: () => got,
  };
}

const qwenWrapper = resolveChatWrapper(model, { warningLogs: false });
const SYS = "你是一个助手。你有 get_weather 函数可以查询天气。回答天气问题前必须先调用该函数，不要凭记忆编造。";

// A: QwenChatWrapper + 明确系统提示
{
  const { functions, got } = mkFns();
  const sequence = context.getSequence();
  try {
    const session = new LlamaChatSession({
      contextSequence: sequence,
      chatWrapper: qwenWrapper ?? "auto",
      systemPrompt: SYS,
      functions,
    });
    const meta = await session.promptWithMeta(PROMPT, { maxTokens: 200, temperature: 0.1 });
    console.log("A. QwenWrapper + 强制提示");
    console.log("   stop        :", meta.stopReason);
    console.log("   functionCalls:", JSON.stringify(meta.functionCalls ?? null));
    console.log("   handler     :", JSON.stringify(got()));
    console.log("   text        :", JSON.stringify((meta.responseText ?? "").slice(0, 120)));
  } catch (e) { console.log("A 异常:", e.message); }
  finally { try { await sequence.dispose(); } catch {} }
}

// B: functions 在 prompt 级传
{
  const { functions, got } = mkFns();
  const sequence = context.getSequence();
  try {
    const session = new LlamaChatSession({
      contextSequence: sequence,
      chatWrapper: qwenWrapper ?? "auto",
      systemPrompt: SYS,
    });
    const meta = await session.promptWithMeta(PROMPT, { maxTokens: 200, temperature: 0.1, functions });
    console.log("B. prompt 级 functions");
    console.log("   stop        :", meta.stopReason);
    console.log("   functionCalls:", JSON.stringify(meta.functionCalls ?? null));
    console.log("   handler     :", JSON.stringify(got()));
    console.log("   text        :", JSON.stringify((meta.responseText ?? "").slice(0, 120)));
  } catch (e) { console.log("B 异常:", e.message); }
  finally { try { await sequence.dispose(); } catch {} }
}

// C: grammar 强制 JSON —— 作为兜底方案
{
  const sequence = context.getSequence();
  try {
    const grammar = await llama.getGrammarFor?.({
      type: "json",
      schema: {
        type: "object",
        properties: {
          action: { enum: ["call_tool", "reply"] },
          tool: { type: "string" },
          args: { type: "object", properties: { city: { type: "string" } } },
          text: { type: "string" },
        },
        required: ["action"],
      },
    });
    const session = new LlamaChatSession({ contextSequence: sequence, chatWrapper: qwenWrapper ?? "auto", systemPrompt: SYS });
    const meta = await session.promptWithMeta(PROMPT, { maxTokens: 200, temperature: 0.1, grammar });
    console.log("C. grammar 强制 JSON");
    console.log("   text:", JSON.stringify((meta.responseText ?? "").slice(0, 200)));
  } catch (e) { console.log("C 异常:", e.message); }
  finally { try { await sequence.dispose(); } catch {} }
}

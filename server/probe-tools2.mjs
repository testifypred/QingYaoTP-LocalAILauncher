/**
 * 探针 2：找出哪种 chat wrapper 配置才能真正触发函数调用。
 * 怀疑点：强制 jinjaTemplate 绕过了 Qwen 原生的函数调用格式。
 */
import { getLlama, resolveChatWrapper, LlamaChatSession, defineChatSessionFunction } from "node-llama-cpp";

const MODEL = "D:\\LocalModels\\qwen2.5-7b-instruct-1m-q4_k_m.gguf";
const PROMPT = "杭州今天天气怎么样？";

const llama = await getLlama({ gpu: "vulkan" });
const model = await llama.loadModel({ modelPath: MODEL });
const context = await model.createContext({ contextSize: 4096 });

function makeFunctions() {
  let got = null;
  const functions = {
    get_weather: defineChatSessionFunction({
      description: "查询指定城市当前的天气情况",
      params: {
        type: "object",
        properties: { city: { type: "string", description: "城市名称" } },
        required: ["city"],
      },
      handler: async (p) => { got = p; return { deferred: true }; },
    }),
  };
  return { functions, got: () => got };
}

const autoResolved = (() => {
  try { return resolveChatWrapper(model, { warningLogs: false }); } catch (e) { return `ERR ${e.message}`; }
})();
const jinjaStrict = (() => {
  try {
    return resolveChatWrapper(model, {
      type: "jinjaTemplate",
      customWrapperSettings: { jinjaTemplate: { reasoning: false, functionCallMessageTemplate: "noJinja" } },
      warningLogs: false,
    });
  } catch (e) { return `ERR ${e.message}`; }
})();

const cases = [
  ["1. 完全默认（wrapper=auto）", "auto", undefined],
  ["2. resolveChatWrapper(auto)", autoResolved, undefined],
  ["3. jinja + noJinja 函数模板", jinjaStrict, undefined],
  ["4. auto + 明确系统提示", "auto", "你可以调用工具来获取实时信息。需要时请调用合适的函数。"],
];

for (const [label, wrapper, sys] of cases) {
  const { functions, got } = makeFunctions();
  const sequence = context.getSequence();
  let line = `${label}`;
  try {
    const session = new LlamaChatSession({
      contextSequence: sequence,
      chatWrapper: typeof wrapper === "string" ? wrapper : wrapper ?? "auto",
      systemPrompt: sys,
      functions,
    });
    const meta = await session.promptWithMeta(PROMPT, { maxTokens: 160, temperature: 0.2 });
    const wrapperName = typeof wrapper === "object" && wrapper?.constructor ? wrapper.constructor.name : String(wrapper);
    line += `\n   wrapper=${wrapperName}  stop=${meta.stopReason}`;
    line += `\n   functionCalls=${JSON.stringify(meta.functionCalls ?? null)}`;
    line += `\n   handler=${JSON.stringify(got())}`;
    line += `\n   text=${JSON.stringify((meta.responseText ?? "").slice(0, 90))}`;
  } catch (e) {
    line += `\n   异常: ${e.message}`;
  } finally {
    try { await sequence.dispose(); } catch {}
  }
  console.log(line + "\n");
}

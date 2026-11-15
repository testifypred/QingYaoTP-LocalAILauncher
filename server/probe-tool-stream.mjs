/**
 * 工具模式流式探针（真加载模型，约 30–60s）
 *
 *   node probe-tool-stream.mjs [base] [model]
 *
 * 覆盖：工具模式下也**逐块推正文**（首字远早于结束，2026-11-15 修）、
 *       <tool_call>/<tool_response> 不外泄、真调工具时仍有 tool 事件、
 *       非流式请求仍一次性返回完整 JSON。
 */
const BASE = process.argv[2] || "http://127.0.0.1:8099";
const MODEL = process.argv[3] || "qwen3-5-4B-Q4_K_M.gguf";

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) { pass++; console.log("  ok   " + n + (d ? "  [" + d + "]" : "")); } else { fail++; console.log("  FAIL " + n + "  " + d); } };

const state = async () => (await (await fetch(BASE + "/api/state")).json());
if (!(await state()).loaded) {
  await fetch(BASE + "/api/load", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ file: MODEL, contextSize: 8192 }) });
  for (let i = 0; i < 90; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if ((await state()).loaded) break;
  }
}
console.log("\n== 目标 " + BASE + " · 模型 " + (await state()).loaded + " ==\n");

async function stream(body) {
  const t0 = Date.now();
  let first = null, chunks = 0, text = "", tools = 0, metrics = null;
  const res = await fetch(BASE + "/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop();
    for (const p of parts) {
      const line = p.replace(/^data:\s*/, "").trim();
      if (!line || line === "[DONE]") continue;
      let j = null;
      try { j = JSON.parse(line); } catch { continue; }
      if (j.metrics) metrics = j.metrics;
      const d = j.choices && j.choices[0] && j.choices[0].delta;
      if (!d) continue;
      if (d.tool) tools += 1;
      if (d.content) { if (first === null) first = Date.now() - t0; chunks += 1; text += d.content; }
    }
  }
  return { first: first === null ? null : first, total: Date.now() - t0, chunks, text, tools, metrics };
}

const msg = (content, tools) => ({ messages: [{ role: "user", content }], stream: true, tools, thinking: false, max_tokens: 220, temperature: 0.7 });

const plain = await stream(msg("用两句话解释什么是栈。", false));
ok("非工具模式逐块推正文", plain.chunks > 3, plain.chunks + " chunks / " + plain.total + "ms");

const tooled = await stream(msg("用两句话解释什么是队列。", true));
ok("工具模式也逐块推正文", tooled.chunks > 3, tooled.chunks + " chunks / " + tooled.total + "ms");
ok("工具模式首字远早于结束（不再整段一次性给）", tooled.first !== null && tooled.first < tooled.total * 0.9, "first=" + tooled.first + "ms total=" + tooled.total + "ms");
ok("正文不含 <tool_call>", !/<tool_call>/i.test(tooled.text));
ok("正文不含 <tool_response>", !/<tool_response>/i.test(tooled.text));
ok("指标齐全", Boolean(tooled.metrics && Number.isFinite(tooled.metrics.prefillMs) && Number.isFinite(tooled.metrics.genMs)), JSON.stringify(tooled.metrics || {}).slice(0, 120));

const called = await stream(msg("现在几点？直接告我时间。", true));
ok("真调工具时仍推 tool 事件", called.tools >= 1, "toolEvents=" + called.tools);
ok("调完工具正文正常且不泄漏标记", called.text.trim().length > 0 && !/<tool_call>/i.test(called.text), called.text.slice(0, 40).replace(/\n/g, " "));

const r = await fetch(BASE + "/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: [{ role: "user", content: "说一句话。" }], stream: false, tools: true, thinking: false, max_tokens: 80, temperature: 0.7 }) });
const j = await r.json();
ok("非流式仍返回完整 JSON", r.status === 200 && typeof j.choices?.[0]?.message?.content === "string", "HTTP " + r.status);

console.log("\nRESULT " + pass + "/" + (pass + fail));
process.exit(fail ? 1 : 0);

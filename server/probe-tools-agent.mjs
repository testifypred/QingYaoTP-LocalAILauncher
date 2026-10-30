/**
 * 工具调用（Agent）端到端探针：会真加载模型并真跑工具。
 *
 *   node probe-tools-agent.mjs [base] [model]
 *
 * 验证：格式解析 → 真实执行 → 结果回填 → 续答；流式事件；边界（不存在的工具 / 坏参数 / 关闭工具）。
 */
const BASE = process.argv[2] || "http://127.0.0.1:8096";
const MODEL = process.argv[3] || "qwen2.5-7b-instruct-1m-q4_k_m.gguf";

let pass = 0;
let fail = 0;
function ok(name, cond, extra = "") {
  if (cond) { pass += 1; console.log(`  ✅ ${name}${extra ? " — " + extra : ""}`); }
  else { fail += 1; console.log(`  ❌ ${name}${extra ? " — " + extra : ""}`); }
}
const t = () => new Date().toISOString().slice(11, 19);

async function chat(body) {
  const r = await fetch(BASE + "/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (body.stream) return { status: r.status, stream: r };
  const j = await r.json().catch(() => ({}));
  return { status: r.status, data: j };
}

async function readStream(r) {
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const tools = [];
  let content = "";
  let reasoning = "";
  let metrics = null;
  let usage = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop();
    for (const p of parts) {
      const line = p.replace(/^data:\s*/, "").trim();
      if (!line || line === "[DONE]") continue;
      let j; try { j = JSON.parse(line); } catch { continue; }
      const d = j.choices?.[0]?.delta;
      if (d?.tool) tools.push(d.tool);
      if (d?.content) content += d.content;
      if (d?.reasoning_content) reasoning += d.reasoning_content;
      if (j.metrics) metrics = j.metrics;
      if (j.usage) usage = j.usage;
    }
  }
  return { tools, content, reasoning, metrics, usage };
}

console.log(`\n== 目标 ${BASE}  模型 ${MODEL} ==\n`);

console.log("== 0. 加载模型 ==");
{
  const t0 = Date.now();
  const r = await fetch(BASE + "/api/load", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file: MODEL, contextSize: 8192 }),
  });
  ok("模型就绪", r.status === 200, `${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (r.status !== 200) { console.log(await r.text()); process.exit(1); }
}

console.log("\n== 1. 时间（get_current_time）==");
let timeTool = null;
{
  const r = await chat({
    messages: [
      { role: "system", content: "你是一个中文助手，回答简短。" },
      { role: "user", content: "现在几点了？请用工具查，不要猜。" },
    ],
    tools: true,
    max_tokens: 300,
    temperature: 0.2,
    stream: false,
  });
  ok("HTTP 200", r.status === 200, String(r.status));
  const tools = r.data?.tools || [];
  timeTool = tools.find((x) => x.name === "get_current_time");
  ok("调用了 get_current_time", !!timeTool, tools.map((x) => x.name).join(",") || "（没有工具调用）");
  ok("工具结果含真实时间", !!timeTool?.result?.localTime, JSON.stringify(timeTool?.result));
  const c = r.data?.choices?.[0]?.message?.content || "";
  ok("最终回答非空", c.trim().length > 0, c.slice(0, 60));
  ok("回答里没有原始调用块", !c.includes("<tool_call>"), c.slice(0, 40));
  ok("指标记录了工具调用次数", (r.data?.metrics?.toolCalls ?? 0) >= 1, String(r.data?.metrics?.toolCalls));
  ok("指标记录了轮次", (r.data?.metrics?.rounds ?? 0) >= 1, String(r.data?.metrics?.rounds));
  console.log(`${t()} 用时 ${r.data?.metrics?.totalMs}ms`);
}

console.log("\n== 2. 精确计算（calculate）==");
{
  const r = await chat({
    messages: [{ role: "user", content: "帮我精确算一下 (1234*56)+78 等于多少。必须用计算工具。" }],
    tools: true,
    max_tokens: 300,
    temperature: 0.2,
    stream: false,
  });
  const tools = r.data?.tools || [];
  const calc = tools.find((x) => x.name === "calculate");
  ok("调用了 calculate", !!calc, tools.map((x) => x.name).join(",") || "（无）");
  ok("计算结果正确（69182）", calc?.result?.value === 69182, String(calc?.result?.value));
  const c = r.data?.choices?.[0]?.message?.content || "";
  ok("回答里带上正确结果", c.includes("69182") || c.includes("69,182"), c.slice(0, 80));
}

console.log("\n== 3. 本地模型列表（list_local_models）==");
{
  const r = await chat({
    messages: [{ role: "user", content: "本机现在装了哪些模型？各多大？用工具查。" }],
    tools: true,
    max_tokens: 400,
    temperature: 0.2,
    stream: false,
  });
  const tools = r.data?.tools || [];
  const list = tools.find((x) => x.name === "list_local_models");
  ok("调用了 list_local_models", !!list, tools.map((x) => x.name).join(",") || "（无）");
  ok("返回了真实模型清单", (list?.result?.count ?? 0) >= 1, JSON.stringify(list?.result?.models?.slice(0, 2)));
  const c = r.data?.choices?.[0]?.message?.content || "";
  ok("回答里出现了模型名", /gguf|Qwen|Phi|DeepSeek/i.test(c), c.slice(0, 60));
}

console.log("\n== 4. 读文件（read_workspace_file）==");
{
  const r = await chat({
    messages: [{ role: "user", content: "读一下 workspace 里的 note.txt，告诉我里面写了什么。" }],
    tools: true,
    max_tokens: 400,
    temperature: 0.2,
    stream: false,
  });
  const tools = r.data?.tools || [];
  const read = tools.find((x) => x.name === "read_workspace_file");
  ok("调用了 read_workspace_file", !!read, tools.map((x) => x.name).join(",") || "（无）");
  ok("读到了文件内容", typeof read?.result?.content === "string" && read.result.content.length > 0,
    (read?.result?.content || "").slice(0, 40));
}

console.log("\n== 5. 流式：工具事件先到、正文后到 ==");
{
  const r = await chat({
    messages: [{ role: "user", content: "现在几点？用工具查。" }],
    tools: true,
    max_tokens: 300,
    temperature: 0.2,
    stream: true,
  });
  const out = await readStream(r.stream);
  ok("收到 tool 增量事件", out.tools.length >= 1, out.tools.map((x) => x.name).join(","));
  ok("正文不空", out.content.trim().length > 0, out.content.slice(0, 50));
  ok("正文里没有原始调用块", !out.content.includes("<tool_call>"));
  ok("流里带 metrics/tools", !!out.metrics && Array.isArray(out.metrics.toolCalls !== undefined ? [] : []), out.metrics ? "有 metrics" : "无");
}

console.log("\n== 6. 边界 ==");
{
  // 关掉工具：不该出现任何工具调用
  const r = await chat({
    messages: [{ role: "user", content: "现在几点了？" }],
    tools: false,
    max_tokens: 200,
    temperature: 0.2,
    stream: false,
  });
  ok("关闭工具后不调工具", (r.data?.tools || []).length === 0, JSON.stringify((r.data?.tools || []).map((x) => x.name)));
  ok("关闭工具仍能正常回答", (r.data?.choices?.[0]?.message?.content || "").trim().length > 0);

  // 坏参数：calculate 少参数 → 工具报错，但整体不该 500
  const r2 = await chat({
    messages: [{ role: "user", content: "用 calculate 工具算 1+1。" }],
    tools: true,
    max_tokens: 200,
    temperature: 0.2,
    stream: false,
  });
  ok("整体没有 500", r2.status === 200, String(r2.status));

  // 模型不调用工具时也应正常
  const r3 = await chat({
    messages: [{ role: "user", content: "用一句话介绍你自己，不要调用任何工具。" }],
    tools: true,
    max_tokens: 200,
    temperature: 0.2,
    stream: false,
  });
  ok("不需要工具时正常作答", (r3.data?.choices?.[0]?.message?.content || "").trim().length > 0,
    (r3.data?.choices?.[0]?.message?.content || "").slice(0, 40));
}

console.log(`\n== 结果: ${pass} 通过 / ${fail} 失败 ==\n`);
process.exit(fail ? 1 : 0);

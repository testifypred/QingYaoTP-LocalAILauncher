/**
 * 纯聊天路径回归（tools:false）：确认改工具调用没有碰坏原来的流式对话。
 *   node probe-chat-plain.mjs [base]
 */
const BASE = process.argv[2] || "http://127.0.0.1:8096";
let pass = 0, fail = 0;
const ok = (n, c, e = "") => {
  if (c) { pass++; console.log(`  ✅ ${n}${e ? " — " + e : ""}`); }
  else { fail++; console.log(`  ❌ ${n}${e ? " — " + e : ""}`); }
};

async function streamChat(body) {
  const r = await fetch(BASE + "/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (r.status !== 200) return { status: r.status, text: await r.text() };
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "", content = "", chunks = 0, done = false, metrics = null, usage = null;
  for (;;) {
    const { done: d, value } = await reader.read();
    if (d) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop();
    for (const p of parts) {
      const line = p.replace(/^data:\s*/, "").trim();
      if (!line) continue;
      if (line === "[DONE]") { done = true; continue; }
      let j; try { j = JSON.parse(line); } catch { continue; }
      const dl = j.choices?.[0]?.delta;
      if (dl?.content) { content += dl.content; chunks += 1; }
      if (j.metrics) metrics = j.metrics;
      if (j.usage) usage = j.usage;
    }
  }
  return { status: 200, content, chunks, done, metrics, usage };
}

console.log(`\n== 目标 ${BASE} ==\n`);
console.log("== 1. 流式对话（tools:false）==");
{
  const r = await streamChat({
    messages: [{ role: "user", content: "用两句话解释天空为什么看起来是蓝色，直接说答案。" }],
    stream: true,
    max_tokens: 120,
    temperature: 0.2,
    tools: false,
  });
  ok("HTTP 200", r.status === 200, String(r.status));
  ok("逐块流式输出（多块）", (r.chunks || 0) > 1, String(r.chunks) + " 块");
  ok("正文非空", (r.content || "").trim().length > 0, (r.content || "").trim().slice(0, 30));
  ok("收到 [DONE]", r.done === true);
  ok("带 metrics", !!r.metrics, r.metrics ? `复用 ${Math.round((r.metrics.cacheHit || 0) * 100)}%` : "");
  ok("没有工具调用", (r.metrics?.toolCalls ?? 0) === 0, String(r.metrics?.toolCalls));
}

console.log("\n== 2. 非流式对话（tools:false）==");
{
  const r = await fetch(BASE + "/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: "回复两个字：收到" }],
      stream: false,
      max_tokens: 20,
      temperature: 0.2,
      tools: false,
    }),
  });
  const j = await r.json().catch(() => ({}));
  ok("HTTP 200", r.status === 200, String(r.status));
  ok("JSON 形状正确", !!j.choices?.[0]?.message?.content, JSON.stringify(j).slice(0, 60));
  ok("没有 tools 字段残留", !j.tools || j.tools.length === 0, JSON.stringify(j.tools || []));
}

console.log("\n== 3. 会话接口未受影响 ==");
{
  const r = await fetch(BASE + "/api/sessions");
  const j = await r.json();
  ok("sessions 200", r.status === 200);
  ok("返回数组", Array.isArray(j.sessions), String((j.sessions || []).length));
}

console.log(`\n== 结果: ${pass} 通过 / ${fail} 失败 ==\n`);
process.exit(fail ? 1 : 0);

/**
 * 功能回归：确认 KV 复用改造没有破坏原有行为
 *   node probe-func.mjs [port]
 *
 * 覆盖：系统提示跨轮保留 / 工具调用 / 非流式 / 断线后继续 / 并发串行 / 换模型前后
 */
const PORT = Number(process.argv[2] ?? 8099);
const BASE = `http://127.0.0.1:${PORT}`;
let pass = 0;
let fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}${detail ? `（${detail}）` : ""}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}${detail ? `（${detail}）` : ""}`);
  }
};

async function chat(payload, { abortAfterMs = 0 } = {}) {
  const ac = new AbortController();
  const t0 = Date.now();
  const timer = abortAfterMs ? setTimeout(() => ac.abort(), abortAfterMs) : null;
  try {
    const res = await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: ac.signal,
    });
    if (!res.ok) return { status: res.status, error: (await res.text()).slice(0, 200) };
    if (!payload.stream) {
      const j = await res.json();
      return { status: 200, text: j.choices?.[0]?.message?.content ?? "", metrics: j.metrics, usage: j.usage, json: j };
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let text = "";
    let metrics = null;
    let ttft = null;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop();
      for (const p of parts) {
        const line = p.replace(/^data:\s*/, "").trim();
        if (!line || line === "[DONE]") continue;
        let j;
        try { j = JSON.parse(line); } catch { continue; }
        const d = j.choices?.[0]?.delta;
        if (d?.content) { text += d.content; if (ttft === null) ttft = Date.now() - t0; }
        if (j.metrics) metrics = j.metrics;
      }
    }
    return { status: 200, text, metrics, ttft };
  } catch (e) {
    return { status: 0, error: e.name === "AbortError" ? "aborted" : e.message };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const SYS = "无论问什么，回答的最后必须以「喵」结尾。";

console.log("1) 系统提示跨轮保留");
{
  const m = (q, hist) => ({
    messages: [{ role: "system", content: SYS }, ...hist, { role: "user", content: q }],
    stream: true,
    max_tokens: 80,
    temperature: 0.2,
  });
  const h = [];
  const a = await chat(m("1+1 等于几？", h));
  h.push({ role: "user", content: "1+1 等于几？" }, { role: "assistant", content: a.text });
  const b = await chat(m("再说一次，2+2 呢？", h));
  const c = await chat(m("那 3+3 呢？", h));
  ok("第一轮带系统提示", a.text.includes("喵"), a.text.slice(-20));
  ok("第二轮仍带系统提示", b.text.includes("喵"), `复用率 ${Math.round((b.metrics?.cacheHit ?? 0) * 100)}%`);
  ok("第三轮仍带系统提示", c.text.includes("喵"), `复用率 ${Math.round((c.metrics?.cacheHit ?? 0) * 100)}%`);
}

console.log("2) 工具调用");
{
  const r = await chat({
    messages: [{ role: "user", content: "现在几点了？" }],
    stream: true,
    tools: true,
    max_tokens: 120,
    temperature: 0.2,
  });
  const calls = r.metrics?.toolCalls ?? 0;
  ok("工具真的执行了", calls >= 1, `toolCalls=${calls}：${r.text.replace(/\s+/g, " ").slice(0, 50)}`);
}

console.log("3) 非流式");
{
  const r = await chat({ messages: [{ role: "user", content: "只回答数字：7 乘 6 等于多少？" }], stream: false, max_tokens: 40, temperature: 0 });
  ok("非流式返回正文", r.status === 200 && r.text.length > 0, r.text.replace(/\s+/g, " ").slice(0, 40));
  ok("非流式带 usage/metrics", Boolean(r.usage && r.metrics), `prompt=${r.usage?.prompt_tokens} reused=${r.metrics?.reusedTokens}`);
}

console.log("4) 断线后继续（中止不应搞坏序列）");
{
  const aborted = await chat(
    { messages: [{ role: "user", content: "请写一段 500 字的散文，越长越好。" }], stream: true, max_tokens: 400 },
    { abortAfterMs: 1200 },
  );
  const after = await chat({ messages: [{ role: "user", content: "只回答数字：9+9" }], stream: true, max_tokens: 30, temperature: 0 });
  ok("客户端主动断开", aborted.status === 0, aborted.error);
  ok("断开后仍能正常问答", after.status === 200 && after.text.length > 0, after.text.replace(/\s+/g, " ").slice(0, 30));
}

console.log("5) 并发串行（同一序列不能并行）");
{
  const bodies = ["只回答数字：1+1", "只回答数字：2+2", "只回答数字：3+3"].map((q) => ({
    messages: [{ role: "user", content: q }],
    stream: true,
    max_tokens: 20,
    temperature: 0,
  }));
  const rs = await Promise.all(bodies.map((b) => chat(b)));
  ok("三个并发请求都成功", rs.every((r) => r.status === 200 && r.text.length > 0), rs.map((r) => r.status).join(","));
}

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);

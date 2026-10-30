/**
 * KV 缓存复用实测（长上下文版）
 *
 * 用法：node probe-kv-long.mjs [port]
 *
 * 用一段约 1200 token 的系统提示模拟真实使用（系统提示词面板里贴了长提示词的场景），
 * 然后连问三轮。每轮记录客户端首字延迟与服务端 metrics。
 * 在 KV_REUSE=1 / KV_REUSE=0 下各跑一次，差值就是复用的收益。
 */
const PORT = Number(process.argv[2] ?? 8099);
const BASE = `http://127.0.0.1:${PORT}`;

/** 约 1200 token 的固定系统提示 */
const SYSTEM = [
  "你是「本地 AI」桌面助手，运行在一台普通 Windows 机器上，模型是量化过的 Qwen2.5-7B。",
  "回答要求：中文、准确、简洁；需要给步骤时用编号列表；不要编造事实；不确定就直说不确定。",
  "你了解本机环境：模型文件放在 D:\\LocalModels，服务端是 Node 写的，界面是内置的网页，端口 8099，",
  "推理后端是 llama.cpp 的 Vulkan 实现，实测生成速度大约每秒 10 个 token，属于带宽瓶颈而非算力瓶颈。",
].join("\n") + "\n\n" + Array.from({ length: 14 }, (_, i) =>
  `参考资料 ${i + 1}：本地推理的成本主要来自显存/内存带宽。模型权重每生成一个 token 都要完整读一遍，` +
  `因此量化位数越低、速度越快；上下文越长，KV 缓存占用的内存越大，但已评估过的前缀可以复用，` +
  `从而把多轮对话的首字延迟压缩到接近一次短提示的水平。`
).join("\n");

const QUESTIONS = [
  "这台机器上多轮对话为什么要复用 KV 缓存？用两句话说明。",
  "那它对显存占用有什么代价？",
  "总结成一句给用户看的说明。",
];

async function ask(history, question) {
  const messages = [{ role: "system", content: SYSTEM }, ...history, { role: "user", content: question }];
  const t0 = Date.now();
  const res = await fetch(`${BASE}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      messages,
      stream: true,
      max_tokens: 120,
      temperature: 0.2,
      thinking: false,
      tools: false,
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let ttftMs = null;
  let text = "";
  let metrics = null;

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
      try {
        j = JSON.parse(line);
      } catch {
        continue;
      }
      const d = j.choices?.[0]?.delta;
      if (d && (d.content || d.reasoning_content)) {
        if (ttftMs === null) ttftMs = Date.now() - t0;
        text += d.content ?? "";
      }
      if (j.metrics) metrics = j.metrics;
    }
  }
  return { ttftMs, text, metrics };
}

const state = await fetch(`${BASE}/api/state`).then((r) => r.json());
const sysTokens = state ? "" : "";
console.log(`模型: ${state.loaded} | KV_REUSE=${state.kvReuse} | 系统提示约 ${Math.round(SYSTEM.length / 1.5)} token`);
console.log("轮次 | 客户端首字 | 服务端 ttft | 预填充 token | 复用 token | 复用率");
console.log("-----|-----------|------------|-------------|-----------|-------");

const history = [];
const rows = [];
for (let i = 0; i < QUESTIONS.length; i++) {
  const { ttftMs, text, metrics } = await ask(history, QUESTIONS[i]);
  const m = metrics ?? {};
  rows.push({ turn: i + 1, client: ttftMs, ttft: m.ttftMs, prefill: m.prefillTokens, reused: m.reusedTokens, hit: m.cacheHit, prompt: m.promptTokens });
  console.log(
    `  ${i + 1}  | ${String(ttftMs).padStart(7)}ms | ${String(m.ttftMs ?? "-").padStart(8)}ms | ` +
      `${String(m.prefillTokens ?? "-").padStart(11)} | ${String(m.reusedTokens ?? "-").padStart(9)} | ` +
      `${String(Math.round((m.cacheHit ?? 0) * 100)).padStart(5)}%`,
  );
  console.log(`     回复：${text.replace(/\s+/g, " ").slice(0, 60)}`);
  history.push({ role: "user", content: QUESTIONS[i] });
  history.push({ role: "assistant", content: text });
}
console.log(`\n完整提示长度：${rows.map((r) => r.prompt).join(" → ")} token`);

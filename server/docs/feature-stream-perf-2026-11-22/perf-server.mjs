// 为什么主页面慢于终端：A) 服务端首字/生成差异（同接口，只改 tools/thinking）
const BASE = process.env.LOCALAI_URL || "http://127.0.0.1:8099";
const PROMPT = "用一句话介绍你自己，然后给出一个简单的数学公式。";

async function once(cfg, label) {
  const t0 = Date.now();
  const r = await fetch(BASE + "/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: PROMPT }],
      stream: true,
      max_tokens: 160,
      temperature: 0.7,
      thinking: cfg.thinking === true,
      tools: cfg.tools === true,
      web: false,
    }),
    signal: AbortSignal.timeout(180000),
  });
  if (!r.ok) throw new Error("HTTP " + r.status + " " + (await r.text()).slice(0, 120));
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "", firstByte = 0, firstThink = 0, firstContent = 0, content = "", think = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!firstByte) firstByte = Date.now() - t0;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, i); buf = buf.slice(i + 2);
      const line = block.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      const raw = line.slice(5).trim();
      if (!raw || raw === "[DONE]") continue;
      let ev; try { ev = JSON.parse(raw); } catch { continue; }
      const d = ev.choices?.[0]?.delta || {};
      if (d.reasoning_content) { think += d.reasoning_content; if (!firstThink) firstThink = Date.now() - t0; }
      if (d.content) { content += d.content; if (!firstContent) firstContent = Date.now() - t0; }
    }
  }
  const total = Date.now() - t0;
  console.log(label.padEnd(22) + " firstByte=" + String(firstByte).padStart(5) + "ms  firstThink=" + String(firstThink || 0).padStart(5) +
    "ms  firstContent=" + String(firstContent || 0).padStart(5) + "ms  total=" + String(total).padStart(6) + "ms  chars=" + content.length + " think=" + think.length);
  return { firstContent, total, content, think };
}

console.log("== 服务端对比（同一接口 /v1/chat/completions，同 prompt，4B） ==");
await once({}, "预热");            // 让模型/会话热起来
for (const cfg of [{ tools: false }, { tools: true }, { thinking: true }]) {
  const label = cfg.tools ? "tools=true" : cfg.thinking ? "thinking=true" : "tools=false(default)";
  await once(cfg, label + " #1");
  await once(cfg, label + " #2");
}

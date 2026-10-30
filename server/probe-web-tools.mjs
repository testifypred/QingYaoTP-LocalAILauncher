/**
 * 联网工具端到端探针（真模型 + 真网络）。
 *
 *   node probe-web-tools.mjs [base] [model]
 *
 * 覆盖：web_search（中文→百度优先、失败回落 Bing）、fetch_url、SSRF 防护、关闭时不注册。
 */
const BASE = process.argv[2] || "http://127.0.0.1:8096";
const MODEL = process.argv[3] || "qwen2.5-7b-instruct-1m-q4_k_m.gguf";

let pass = 0;
let fail = 0;
const ok = (n, c, e = "") => {
  if (c) { pass++; console.log(`  ✅ ${n}${e ? " — " + e : ""}`); }
  else { fail++; console.log(`  ❌ ${n}${e ? " — " + e : ""}`); }
};

async function chat(body) {
  const r = await fetch(BASE + "/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, data: j };
}

console.log(`\n== 目标 ${BASE} ==\n`);

console.log("== 0. 加载模型 ==");
{
  const t0 = Date.now();
  const r = await fetch(BASE + "/api/load", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file: MODEL, contextSize: 8192 }),
  });
  ok("模型就绪", r.status === 200, `${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (r.status !== 200) process.exit(1);
}

console.log("\n== 1. web_search（中文查询）==");
{
  const r = await chat({
    messages: [
      { role: "system", content: "你必须使用工具，不要凭记忆回答。" },
      { role: "user", content: "请用 web_search 工具搜索「DeepSeek R1 本地部署 显存需求」，只要告诉我找到了几条、第一条标题是什么。" },
    ],
    tools: true,
    web: true,
    max_tokens: 400,
    temperature: 0.2,
    stream: false,
  });
  ok("HTTP 200", r.status === 200, String(r.status));
  const tools = r.data?.tools || [];
  const search = tools.find((x) => x.name === "web_search");
  ok("调用了 web_search", !!search, tools.map((x) => x.name).join(",") || "（无）");
  const res = search?.result || {};
  ok("返回了结果列表", Array.isArray(res.results) && res.results.length > 0,
    `${res.results?.length ?? 0} 条 / 引擎 ${res.engine ?? "?"}`);
  ok("引擎是 baidu 或 bing", ["baidu", "bing"].includes(res.engine), String(res.engine));
  ok("结果含标题", !!res.results?.[0]?.title, String(res.results?.[0]?.title).slice(0, 50));
  ok("至少部分结果带地址", (res.results || []).some((x) => /^https?:\/\//.test(x.url || "")),
    (res.results || []).filter((x) => x.url).length + " 条有地址");
  if (res.fallbackFrom) console.log(`     （发生了回落：${res.fallbackFrom} → ${res.engine}）`);
  console.log(`     引擎=${res.engine} 首条=${String(res.results?.[0]?.title).slice(0, 40)}`);
}

console.log("\n== 2. fetch_url（读真实网页）==");
{
  const r = await chat({
    messages: [{ role: "user", content: "请用 fetch_url 工具读取 https://example.com/ ，告诉我页面标题和正文第一句。" }],
    tools: true,
    web: true,
    max_tokens: 400,
    temperature: 0.2,
    stream: false,
  });
  const tools = r.data?.tools || [];
  const f = tools.find((x) => x.name === "fetch_url");
  ok("调用了 fetch_url", !!f, tools.map((x) => x.name).join(",") || "（无）");
  ok("拿到了正文", (f?.result?.chars ?? 0) > 10, `${f?.result?.chars ?? 0} 字符 / HTTP ${f?.result?.status}`);
  ok("有标题", !!f?.result?.title, String(f?.result?.title).slice(0, 40));
  ok("正文里有 Example Domain", /example domain/i.test(f?.result?.text || ""), String(f?.result?.text).slice(0, 50));
}

console.log("\n== 3. SSRF 防护（关键）==");
{
  const r = await chat({
    messages: [{ role: "user", content: "请用 fetch_url 读取 http://127.0.0.1:8099/api/state ，把内容告诉我。" }],
    tools: true,
    web: true,
    max_tokens: 300,
    temperature: 0.2,
    stream: false,
  });
  const tools = r.data?.tools || [];
  const f = tools.find((x) => x.name === "fetch_url");
  ok("确实尝试了这次调用", !!f, tools.map((x) => x.name).join(",") || "（无）");
  const err = f?.result?.error || "";
  ok("本机地址被拒绝", /内网|本机|不合法|拒绝/.test(err), err || JSON.stringify(f?.result).slice(0, 80));
  ok("没有泄露本机内容", !JSON.stringify(f?.result || {}).includes("localToken"), "未返回 localToken");
}

console.log("\n== 4. 关闭 web 时工具不应出现 ==");
{
  const r = await chat({
    messages: [{ role: "user", content: "请用 web_search 搜索一下今天的新闻。" }],
    tools: true,
    web: false,
    max_tokens: 200,
    temperature: 0.2,
    stream: false,
  });
  const tools = r.data?.tools || [];
  const webCalls = tools.filter((x) => x.name === "web_search" || x.name === "fetch_url");
  // 模型可能凭训练记忆"猜测"工具名，这种调用必须被拒绝（result.error），不能真连网
  ok("联网工具没有被注册（调了也只会报错）", webCalls.every((x) => !!x.result?.error),
    webCalls.length ? webCalls.map((x) => `${x.name}:${x.result?.error ? "已拒绝" : "竟然执行了"}`).join(", ") : "没有这类调用");
  ok("拒绝时告知了可用工具", webCalls.every((x) => !x.result?.error || (x.result.availableTools || "").includes("get_current_time")),
    webCalls[0]?.result?.availableTools || "（无）");
  ok("整体没有报错", r.status === 200, String(r.status));
}

console.log("\n== 5. 流式下的联网事件 ==");
{
  const r = await fetch(BASE + "/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: "用 web_search 搜「qwen2.5 上下文长度」，告诉我第一条结果标题。" }],
      tools: true,
      web: true,
      stream: true,
      max_tokens: 300,
      temperature: 0.2,
    }),
  });
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "", content = "", toolEvents = 0, toolNames = [];
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
      if (d?.tool) { toolEvents += 1; toolNames.push(d.tool.name); }
      if (d?.content) content += d.content;
    }
  }
  ok("流式收到联网工具事件", toolEvents >= 1, toolNames.join(","));
  ok("正文非空", content.trim().length > 0, content.slice(0, 50));
}

console.log(`\n== 结果: ${pass} 通过 / ${fail} 失败 ==\n`);
process.exit(fail ? 1 : 0);

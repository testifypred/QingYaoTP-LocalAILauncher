/**
 * 视觉 sidecar 自测脚本（backend 自查用，可重复运行）
 * 用法：node selftest.mjs [baseUrl] [imagePath]
 * 覆盖：/api/vision/state、/api/vision/start（幂等 + 400 语义）、
 *       /v1/chat/completions 非流式（images 数组）、流式（content 里 image_url）、/api/vision/stop。
 */
import { readFile } from "node:fs/promises";

const BASE = process.argv[2] || "http://127.0.0.1:8102";
const IMG = process.argv[3] || "D:\\LocalModels\\tools\\vision-test.png";

const out = [];
const say = (s) => { out.push(s); console.log(s); };

async function jpost(path, body, timeoutMs = 300000) {
  const r = await fetch(BASE + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await r.text();
  let j = null;
  try { j = JSON.parse(text); } catch {}
  return { status: r.status, text, json: j };
}

const bytes = await readFile(IMG);
const dataUrl = "data:image/png;base64," + bytes.toString("base64");
say("image: " + IMG + " (" + bytes.length + " bytes)");
say("base: " + BASE);

// 1) state
{
  const r = await fetch(BASE + "/api/vision/state", { signal: AbortSignal.timeout(15000) });
  const j = await r.json();
  say("1) GET /api/vision/state -> " + r.status + " running=" + j.running + " pairs=" + j.pairs.length + " selected=" + JSON.stringify(j.selected));
}

// 2) start 幂等（sidecar 已在跑）：不应重启，pid 不变
{
  const before = await (await fetch(BASE + "/api/vision/state")).json();
  const t0 = Date.now();
  const r = await jpost("/api/vision/start", {});
  const after = r.json || {};
  say("2) POST /api/vision/start -> " + r.status + " running=" + after.running + " pid=" + after.pid + " samePid=" + (before.pid === after.pid) + " " + (Date.now() - t0) + "ms");
}

// 3) 错误语义：文件不存在 -> 400
{
  const r = await jpost("/api/vision/start", { model: "不存在的模型.gguf", mmproj: "mmproj\\Qwen3.5-9B-mmproj-F16.gguf" });
  say("3) start 不存在的模型 -> " + r.status + " msg=" + (r.json && r.json.error && r.json.error.message));
}

// 4) 非流式视觉请求（应用级 images 字段）
let nonStreamOk = false;
{
  const t0 = Date.now();
  const r = await jpost("/v1/chat/completions", {
    stream: false,
    max_tokens: 160,
    temperature: 0.1,
    images: [dataUrl],
    messages: [{ role: "user", content: "图里的文字是什么？只回答你看到的文字。" }],
  });
  const content = r.json && r.json.choices && r.json.choices[0] && r.json.choices[0].message && r.json.choices[0].message.content;
  const hit = typeof content === "string" && (content.includes("QWEN") || content.includes("42"));
  nonStreamOk = r.status === 200 && hit;
  say("4) POST /v1/chat/completions (json, images) -> " + r.status + " " + (Date.now() - t0) + "ms");
  say("   content=" + JSON.stringify(content));
  say("   contains QWEN/42 = " + hit);
}

// 5) 流式视觉请求（content 里已有 image_url，验证两种入口都认）
let streamOk = false;
{
  const t0 = Date.now();
  const r = await fetch(BASE + "/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      stream: true,
      max_tokens: 160,
      temperature: 0.1,
      messages: [{ role: "user", content: [{ type: "text", text: "图里的文字是什么？只回答你看到的文字。" }, { type: "image_url", image_url: { url: dataUrl } }] }],
    }),
    signal: AbortSignal.timeout(300000),
  });
  say("5) POST /v1/chat/completions (stream, content 内 image_url) -> " + r.status + " content-type=" + r.headers.get("content-type") + " x-local-vision=" + r.headers.get("x-local-vision"));
  let chunks = 0;
  let firstChunkMs = 0;
  let text = "";
  let sawDone = false;
  if (r.ok) {
    const decoder = new TextDecoder();
    for await (const chunk of r.body) {
      chunks++;
      if (!firstChunkMs) firstChunkMs = Date.now() - t0;
      text += decoder.decode(chunk, { stream: true });
      if (text.includes("data: [DONE]")) sawDone = true;
    }
  }
  const content = text.split("\n").filter((l) => l.startsWith("data: ") && l !== "data: [DONE]").map((l) => {
    try { const j = JSON.parse(l.slice(6)); return (j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content) || ""; } catch { return ""; }
  }).join("");
  const hit = content.includes("QWEN") || content.includes("42");
  streamOk = r.status === 200 && sawDone && hit;
  say("   chunks=" + chunks + " firstChunk=" + firstChunkMs + "ms total=" + (Date.now() - t0) + "ms [DONE]=" + sawDone);
  say("   content=" + JSON.stringify(content));
  say("   contains QWEN/42 = " + hit);
}

// 6) stop -> running:false，8101 释放
{
  const t0 = Date.now();
  const r = await jpost("/api/vision/stop", {});
  say("6) POST /api/vision/stop -> " + r.status + " " + JSON.stringify(r.json) + " " + (Date.now() - t0) + "ms");
  let health = "closed";
  try {
    await fetch("http://127.0.0.1:8101/health", { signal: AbortSignal.timeout(1500) });
    health = "still-listening";
  } catch {}
  say("   /health after stop = " + health);
}

say("RESULT nonStream=" + (nonStreamOk ? "PASS" : "FAIL") + " stream=" + (streamOk ? "PASS" : "FAIL"));

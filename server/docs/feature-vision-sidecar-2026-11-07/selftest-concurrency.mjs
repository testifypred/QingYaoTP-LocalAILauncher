/**
 * 视觉 sidecar 并发/自愈自测（backend 回归用）
 * 用法：node selftest-concurrency.mjs [baseUrl] [imagePath]
 * 覆盖：3 条串行请求都成功且 sidecar 不退出；2 条并发请求被串行锁排队（都成功）；
 *       外部杀掉 sidecar 后下一条请求自动「崩溃重启」并成功；结束时 stop 释放 8101。
 */
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const BASE = process.argv[2] || "http://127.0.0.1:8102";
const IMG = process.argv[3] || "D:\\LocalModels\\tools\\vision-test.png";
const DATA_URL = "data:image/png;base64," + (await readFile(IMG)).toString("base64");
const results = [];
const t0 = Date.now();
const ts = () => "[" + ((Date.now() - t0) / 1000).toFixed(1) + "s]";
const say = (s) => { console.log(ts() + " " + s); };
function check(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail: detail || "" });
  say((ok ? "PASS " : "FAIL ") + name + (detail ? " :: " + detail : ""));
}
async function getJson(path) {
  const r = await fetch(BASE + path, { signal: AbortSignal.timeout(30000) });
  return { status: r.status, json: await r.json().catch(() => null) };
}
async function healthOk(port) {
  try {
    const r = await fetch("http://127.0.0.1:" + port + "/health", { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return false;
    const j = await r.json().catch(() => null);
    return Boolean(j && j.status === "ok");
  } catch {
    return false;
  }
}
async function ask(tag) {
  const started = Date.now();
  const r = await fetch(BASE + "/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      stream: false,
      max_tokens: 32,
      temperature: 0.1,
      images: [DATA_URL],
      messages: [{ role: "user", content: "图里的文字是什么？只回答你看到的文字。" }],
    }),
    signal: AbortSignal.timeout(600000),
  });
  const j = await r.json().catch(() => null);
  const ms = Date.now() - started;
  const content = j && j.choices && j.choices[0] && j.choices[0].message ? String(j.choices[0].message.content || "") : "";
  say(tag + " -> http " + r.status + " " + ms + "ms content=" + JSON.stringify(content.slice(0, 80)));
  return { status: r.status, content, ms };
}
const hit = (c) => c.includes("QWEN") || c.includes("42") || c.toLowerCase().includes("hello");

// 0) 前置：sidecar 必须已经在跑（脚本不负责首次启动；由调用方 POST /api/vision/start）
const s0 = await getJson("/api/vision/state");
const pid0 = s0.json && s0.json.pid;
say("初始 state: running=" + (s0.json && s0.json.running) + " pid=" + pid0 + " pairs=" + (s0.json && s0.json.pairs.length));
check("前置 sidecar 运行中", s0.json && s0.json.running && pid0, "pid=" + pid0);
check("前置 /health ok", await healthOk(8101), "8101");

// 1) 串行 3 条：都成功，sidecar 不退出、pid 不变
for (let i = 1; i <= 3; i++) {
  const r = await ask("串行 #" + i);
  check("串行 #" + i + " 200", r.status === 200, "http " + r.status);
  check("串行 #" + i + " 内容含 QWEN/42", hit(r.content), JSON.stringify(r.content.slice(0, 60)));
  const st = await getJson("/api/vision/state");
  check("串行 #" + i + " 后 sidecar 存活", Boolean(st.json && st.json.running && st.json.pid === pid0), "pid=" + (st.json && st.json.pid));
  check("串行 #" + i + " 后 /health ok", await healthOk(8101), "8101");
}

// 2) 并发 2 条：串行锁排队，两条都应成功，sidecar 不崩、pid 不变
say("并发 2 条（Promise.all）...");
const [c1, c2] = await Promise.all([ask("并发 #A"), ask("并发 #B")]);
check("并发 #A 200", c1.status === 200, "http " + c1.status + " " + c1.ms + "ms");
check("并发 #B 200", c2.status === 200, "http " + c2.status + " " + c2.ms + "ms");
check("并发 #A 内容含 QWEN/42", hit(c1.content), JSON.stringify(c1.content.slice(0, 60)));
check("并发 #B 内容含 QWEN/42", hit(c2.content), JSON.stringify(c2.content.slice(0, 60)));
check(
  "并发确实被串行（另一条排队后更晚完成）",
  Math.max(c1.ms, c2.ms) >= Math.min(c1.ms, c2.ms) * 1.4 && Math.max(c1.ms, c2.ms) >= Math.min(c1.ms, c2.ms) + 800,
  "A=" + c1.ms + "ms B=" + c2.ms + "ms",
);
const s2 = await getJson("/api/vision/state");
check("并发后 sidecar 存活且 pid 不变", Boolean(s2.json && s2.json.running && s2.json.pid === pid0), "pid=" + (s2.json && s2.json.pid));
check("并发后 /health ok", await healthOk(8101), "8101");

// 3) 崩溃自愈：外部杀掉 sidecar，下一条请求应自动「崩溃重启」并成功
say("模拟 sidecar 崩溃（taskkill pid " + pid0 + "）...");
try {
  spawnSync("taskkill", ["/PID", String(pid0), "/T", "/F"], { windowsHide: true, encoding: "utf8", timeout: 15000 });
} catch {}
let dead = false;
for (let i = 0; i < 30; i++) {
  const st = await getJson("/api/vision/state");
  if (st.json && !st.json.running) { dead = true; break; }
  await new Promise((r) => setTimeout(r, 300));
}
check("sidecar 已被杀掉（state.running=false）", dead, "8101 health=" + (await healthOk(8101)));
const healStart = Date.now();
const r3 = await ask("崩溃后请求");
const healMs = Date.now() - healStart;
check("崩溃后请求 200（自动重启）", r3.status === 200, "http " + r3.status + " " + healMs + "ms");
check("崩溃后内容含 QWEN/42", hit(r3.content), JSON.stringify(r3.content.slice(0, 60)));
const s3 = await getJson("/api/vision/state");
check("自动重启后 sidecar 存活且 pid 已换", Boolean(s3.json && s3.json.running && s3.json.pid && s3.json.pid !== pid0), "newPid=" + (s3.json && s3.json.pid) + " oldPid=" + pid0);
check("重启后 /health ok", await healthOk(8101), "8101");

// 4) 结束：stop 释放 8101
const stop = await fetch(BASE + "/api/vision/stop", { method: "POST", headers: { "content-type": "application/json" }, body: "{}", signal: AbortSignal.timeout(60000) });
check("stop 200", stop.status === 200, "http " + stop.status);
check("stop 后 /health 关闭", !(await healthOk(8101)), "8101");

const failed = results.filter((r) => !r.ok);
say("RESULT " + (results.length - failed.length) + "/" + results.length + " PASS" + (failed.length ? "；FAIL: " + failed.map((f) => f.name).join("、") : ""));
process.exitCode = failed.length ? 1 : 0;

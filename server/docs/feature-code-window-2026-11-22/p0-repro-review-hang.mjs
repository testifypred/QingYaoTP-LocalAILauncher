/**
 * P0 复现探针：22 行 python 本地审查卡住
 * 记录：首个 SSE 事件时间、delta 数、每个事件时间戳；同时每 10s 打一次 /api/state 延迟，
 * 判断是「生成慢」还是「原生层把事件循环卡死」。
 *   node p0-repro-review-hang.mjs [文件] [超时ms]
 */
import { readFile } from "node:fs/promises";
const BASE = "http://127.0.0.1:8099";
const FILE = process.argv[2] || "D:\\LocalModels\\workspace\\code\\python-210407-1.py";
const LIMIT = Number(process.argv[3]) || 240000;
const code = await readFile(FILE, "utf8");
const t0 = Date.now();
const rel = () => ((Date.now() - t0) / 1000).toFixed(1) + "s";
const st = await (await fetch(BASE + "/api/state", { signal: AbortSignal.timeout(10000) })).json();
console.log(rel() + " 模型=" + st.loaded + " token=" + String(st.localToken).slice(0, 8));

let stopPoll = false;
const poll = (async () => {
  while (!stopPoll) {
    await new Promise((r) => setTimeout(r, 10000));
    if (stopPoll) break;
    const p0 = Date.now();
    try {
      const s = await fetch(BASE + "/api/state", { signal: AbortSignal.timeout(8000) });
      const j = await s.json();
      console.log(rel() + "   [poll] /api/state " + (Date.now() - p0) + "ms loaded=" + j.loaded + " loading=" + j.loading);
    } catch (e) {
      console.log(rel() + "   [poll] /api/state FAIL " + (Date.now() - p0) + "ms " + String(e && e.message).slice(0, 60));
    }
  }
})();

const ctl = new AbortController();
const kill = setTimeout(() => ctl.abort(), LIMIT);
try {
  const r = await fetch(BASE + "/api/code/review/stream", {
    method: "POST",
    headers: { "content-type": "application/json", "x-local-token": st.localToken },
    body: JSON.stringify({ code, lang: "python", file: FILE.split(/[\\/]/).pop(), intent: "检查语法与逻辑，指出问题行" }),
    signal: ctl.signal,
  });
  console.log(rel() + " HTTP " + r.status);
  const reader = r.body.getReader(); const dec = new TextDecoder();
  let buf = "", deltas = 0, findings = null, err = null, firstEvent = 0, firstDelta = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const b = buf.slice(0, i); buf = buf.slice(i + 2);
      const line = b.split("\n").find((l) => l.startsWith("data:")); if (!line) continue;
      const raw = line.slice(5).trim(); if (!raw) continue;
      let ev; try { ev = JSON.parse(raw); } catch { continue; }
      if (!firstEvent) { firstEvent = Date.now(); console.log(rel() + " 首个事件 " + ev.type); }
      if (ev.type === "delta") { deltas += 1; if (!firstDelta) { firstDelta = Date.now(); console.log(rel() + " 首个 delta"); } }
      else if (ev.type === "findings") { findings = ev; console.log(rel() + " findings issues=" + (ev.issues || []).length); }
      else if (ev.type === "error") { err = ev.message; console.log(rel() + " error: " + ev.message); }
      else console.log(rel() + " 事件 " + ev.type);
    }
  }
  console.log(rel() + " 流结束 deltas=" + deltas + " issues=" + (findings ? findings.issues.length : "none") + " err=" + err + " total=" + (Date.now() - t0) + "ms");
  if (findings) console.log("summary=" + JSON.stringify(String(findings.summary || "").slice(0, 100)));
} catch (e) {
  console.log(rel() + " FAIL: " + String(e && e.message).slice(0, 200));
} finally {
  clearTimeout(kill);
  stopPoll = true;
  await poll;
}

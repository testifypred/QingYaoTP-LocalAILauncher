/**
 * 消息时间戳探针（UI，headless Edge 9333）
 *
 *   node probe-timestamps.mjs [base] [cdp]
 *
 * 覆盖：每条消息都有时间 / 时间格式 / 悬停有完整时间 / 新消息立即带时间。
 *
 * 2026-11-08 修：旧版点 #recentOpen 打开「上次在聊」——那个会话可能是别的探针留下的
 * localStorage 迁移夹具（消息没有 t），于是 rows=2 / times=1，**每轮必红**且越查越像产品 bug。
 * 现在探针自建一个带 t 的夹具会话（成为最近会话），跑完删掉，不依赖前序探针的残留。
 */
import WebSocket from "ws";

const BASE = process.argv[2] || "http://127.0.0.1:8099";
const CDP = process.argv[3] || "http://127.0.0.1:9333";
const PORT = new URL(BASE).port || "8099";

let pass = 0, fail = 0;
const check = (n, c, d = "") => {
  if (c) { pass++; console.log("ok   " + n + (d ? "  [" + d + "]" : "")); }
  else { fail++; console.log("FAIL " + n + "  " + d); }
};

// ---- A. 自建夹具会话（带 t）：它是「最近会话」，点 #recentOpen 打开的必定是它 ----
const now = Date.now();
let fixtureId = null;
try {
  const r = await fetch(BASE + "/api/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: "时间戳探针夹具",
      messages: [
        { role: "user", content: "时间戳夹具：用户消息", t: now - 120000 },
        { role: "assistant", content: "时间戳夹具：模型回答", t: now - 110000 },
      ],
    }),
  });
  const j = await r.json();
  fixtureId = j?.session?.id || j?.id || null;
  if (!r.ok) console.log("  夹具会话创建失败: HTTP " + r.status + " " + JSON.stringify(j).slice(0, 120));
} catch (e) {
  console.log("  夹具会话创建异常: " + e.message);
}

const list = await (await fetch(CDP + "/json/list")).json();
const page = list.find((t) => t.type === "page" && t.url.includes("127.0.0.1:" + PORT));
if (!page) { console.log("no page"); process.exit(2); }
const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise((r, j) => { ws.once("open", r); ws.once("error", j); });
let id = 0; const pend = new Map();
ws.on("message", (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text); return r.result?.result?.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await send("Page.enable"); await send("Runtime.enable");
await send("Page.reload", { ignoreCache: true }); await sleep(3200);
await ev("document.getElementById('recentOpen').click(); 1"); await sleep(1600);
const stat = await ev("({ rows: document.querySelectorAll('.row').length, times: [...document.querySelectorAll('.msgTime')].map(e => e.textContent), titles: [...document.querySelectorAll('.msgTime')].map(e => e.title) })");
console.log(JSON.stringify(stat).slice(0, 240));

// 红了才有诊断价值：把「最近会话」的每条消息有没有 t 打出来
if (stat.times.length < stat.rows) {
  try {
    const sid = await ev("sessionId");
    const s = await (await fetch(BASE + "/api/sessions/" + encodeURIComponent(sid))).json();
    console.log("  诊断：会话 " + sid + " 的消息 t 情况 → " + JSON.stringify((s.messages || []).map((m, i) => ({ i, role: m.role, kind: m.kind || null, hasT: m.t !== undefined && m.t !== null }))));
  } catch (e) { console.log("  诊断失败: " + e.message); }
}

check("每条消息都有时间", stat.times.length >= stat.rows && stat.rows > 0, "times=" + stat.times.length + " rows=" + stat.rows);
check("时间格式正确", stat.times.every((t) => /^(\d{2}:\d{2}|\d{1,2}-\d{1,2} \d{2}:\d{2})$/.test(t)), JSON.stringify(stat.times));
check("悬停有完整时间", stat.titles.every((t) => t && t.length > 4));
await ev("bubble('user', '时间测试', Date.now()); 1"); await sleep(300);
const live = await ev("(() => { const ts = document.querySelectorAll('.msgTime'); return ts[ts.length - 1].textContent; })()");
check("新消息立即带时间", /^(\d{2}:\d{2})$/.test(live), live);

// ---- 自复位：删掉夹具会话 ----
try {
  if (fixtureId) await fetch(BASE + "/api/sessions/" + encodeURIComponent(fixtureId), { method: "DELETE" });
} catch {}

await send("Page.reload", { ignoreCache: true });
console.log("\nRESULT " + pass + "/" + (pass + fail));
ws.close();
process.exit(fail ? 1 : 0);

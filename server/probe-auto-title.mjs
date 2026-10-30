import WebSocket from "ws";
import fs from "node:fs";
const CDP = "http://127.0.0.1:9333";
const OUT = "D:/LocalModels/server/docs/ui-new";
const base = "http://127.0.0.1:8099";

const list = await (await fetch(CDP + "/json/list")).json();
const page = list.find((t) => t.type === "page" && t.url.includes("8099"));
const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise((r, j) => { ws.once("open", r); ws.once("error", j); });
let id = 0; const pend = new Map();
ws.on("message", (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text); return r.result?.result?.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (n, c, d = "") => { if (c) { pass++; console.log("ok   " + n + (d ? "  [" + d + "]" : "")); } else { fail++; console.log("FAIL " + n + "  " + d); } };

await send("Page.enable"); await send("Runtime.enable");
await send("Page.reload", { ignoreCache: true });
await sleep(2800);
if (await ev("document.body.classList.contains('sideOff')")) { await ev("document.getElementById('sideToggle').click()"); await sleep(300); }
await ev("newChat()");
await sleep(400);

async function turn(text, n) {
  await ev("(() => { const q = document.getElementById('q'); q.value = " + JSON.stringify(text) + "; q.dispatchEvent(new Event('input', { bubbles: true })); q.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return true; })()");
  for (let i = 0; i < 180; i++) {
    await sleep(500);
    const st = await ev("({ busy: document.getElementById('send').disabled, rows: document.querySelectorAll('.row.assistant').length })");
    if (!st.busy && st.rows >= n) return true;
  }
  return false;
}

const q1 = "用一句话解释什么是 KV 缓存，只回答一句。";
const q2 = "再举一个一句话的例子。";
check("第一轮完成", await turn(q1, 1));
check("第二轮完成", await turn(q2, 2));

const before = await ev("(() => { const it = document.querySelector('.sessionItem.sel .t'); return it ? it.textContent : ''; })()");
console.log("标题（自动前）:", before);

let title = "";
let waited = 0;
for (let i = 0; i < 40; i++) {
  await sleep(1000); waited++;
  const sid = await ev("localStorage.getItem('localai.lastSession') || ''");
  const s = await (await fetch(base + "/api/sessions/" + encodeURIComponent(sid))).json();
  if (s.title && s.title !== before) { title = s.title; break; }
}
console.log("标题（自动后）:", title, "等待", waited + "s");
check("两轮后自动生成标题", !!title && title.length >= 2 && waited <= 40, "waited=" + waited + "s");
check("自动标题不是首句照抄", title !== before);
const renamed = await ev("(async () => { const sid = localStorage.getItem('localai.lastSession'); const s = await (await fetch('/api/sessions/' + sid)).json(); return s.renamed; })()");
check("自动标题不置 renamed", renamed === false);

const shot = await send("Page.captureScreenshot", { format: "png" });
fs.writeFileSync(OUT + "/auto-title.png", Buffer.from(shot.result.data, "base64"));

// 清理：先切新对话，再删测试会话
const sid = await ev("localStorage.getItem('localai.lastSession')");
await ev("newChat()");
await sleep(700);
await fetch(base + "/api/sessions/" + encodeURIComponent(sid), { method: "DELETE" });
const left = await (await fetch(base + "/api/sessions")).json();
console.log("left", (left.sessions || left).length);
console.log("\nRESULT " + pass + "/" + (pass + fail));
ws.close(); process.exit(fail ? 1 : 0);

// UI 闭环：代码工作区 → 模型审查按钮 → 渲染审查结果（2026-11-07）
import WebSocket from "ws";
import fs from "node:fs";
const BASE = "http://127.0.0.1:8099";
const CDP = "http://127.0.0.1:9333";
const OUT = "D:\\LocalModels\\server\\docs\\feature-code-workspace-2026-11-07\\logs";
const stamp = Date.now().toString(36);
const list = await (await fetch(CDP + "/json/list")).json();
const page = list.find((t) => t.type === "page" && t.url.includes("8099"));
const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise((r, j) => { ws.once("open", r); ws.once("error", j); });
let id = 0; const pend = new Map();
ws.on("message", (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text); return r.result?.result?.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await send("Page.enable"); await send("Runtime.enable");
await send("Page.reload", { ignoreCache: true });
await sleep(3500);
// 关掉首启引导（headless profile 是全新 localStorage）
await ev("(()=>{const b=[...document.querySelectorAll('button')].find(x=>/完成，进入应用/.test(x.textContent)); if(b){b.click();return 'closed';} return 'none';})()");
await sleep(600);
await ev("document.getElementById('codeBtn').click(); 1");
await sleep(1200);
await ev("document.getElementById('cwRefresh').click(); 1");
await sleep(1200);
const picked = await ev("(()=>{const it=[...document.querySelectorAll('.cwItem')].find(x=>/python/.test(x.dataset.path||'')) || document.querySelector('.cwItem'); if(!it) return null; it.click(); return it.dataset.path;})()");
console.log("opened file:", picked);
await sleep(800);
const codeLen = await ev("(()=>{const cm=document.querySelector('#codeModal .CodeMirror'); return cm && cm.CodeMirror ? cm.CodeMirror.getValue().length : -1;})()");
console.log("editor chars:", codeLen);
await ev("(()=>{const t=document.getElementById('cwIntent'); t.value='写一个判断质数的函数，要求能处理大数并尽量快'; t.dispatchEvent(new Event('input',{bubbles:true})); return t.value;})()");
await ev("document.getElementById('cwReview').click(); 1");
let body = "", waited = 0;
for (; waited < 240000; waited += 2000) {
  await sleep(2000);
  const s = await ev("(()=>{const b=document.getElementById('cwReviewBody'); const m=document.getElementById('cwReviewMeta'); return {len:(b&&b.innerText||'').length, meta:(m&&m.innerText||''), btn:document.getElementById('cwReview').textContent};})()");
  if (s.len > 80) { body = s; break; }
}
console.log("review meta:", body.meta, "| chars:", body.len, "| button:", body.btn);
const detail = await ev("document.getElementById('cwReviewBody').innerText");
console.log("review head:", (detail || '').slice(0, 400).replace(/\s+/g, ' '));
const shot = await send("Page.captureScreenshot", { format: "png" });
fs.mkdirSync(OUT, { recursive: true });
const p1 = OUT + "\\ui-review-" + stamp + ".png";
fs.writeFileSync(p1, Buffer.from(shot.result.data, "base64"));
console.log("shot:", p1);
// 关掉工作区，回到聊天看收录条
await ev("document.getElementById('codeClose').click(); 1");
await sleep(500);
await ev("(()=>{const rows=[...document.querySelectorAll('.row.assistant')]; if(rows.length) rows[rows.length-1].scrollIntoView({block:'center'}); return 1;})()");
await sleep(600);
const shot2 = await send("Page.captureScreenshot", { format: "png" });
const p2 = OUT + "\\ui-chat-captured-" + stamp + ".png";
fs.writeFileSync(p2, Buffer.from(shot2.result.data, "base64"));
console.log("shot2:", p2);
const ok = (body.len > 80) && /s|秒/.test(body.meta);
console.log("UI_REVIEW " + (ok ? "PASS" : "FAIL"));
ws.close();
process.exit(ok ? 0 : 1);

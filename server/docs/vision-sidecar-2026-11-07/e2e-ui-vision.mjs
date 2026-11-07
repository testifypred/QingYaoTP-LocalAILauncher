// E2E UI：界面传图 → 发送 → 视觉回答（2026-11-07 集成验证）
import WebSocket from "ws";
import fs from "node:fs";
const CDP = "http://127.0.0.1:9333";
const APP = "http://127.0.0.1:8099";
const OUT = "D:\\LocalModels\\server\\docs\\vision-sidecar-2026-11-07\\logs";
const PNG = "D:\\LocalModels\\tools\\vision-test.png";
const b64 = fs.readFileSync(PNG).toString("base64");
const list = await (await fetch(CDP + "/json/list")).json();
const page = list.find(t => t.type === "page" && t.url.includes("8099"));
if (!page) { console.log("no page"); process.exit(2); }
const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise((r, j) => { ws.once("open", r); ws.once("error", j); });
let id = 0; const pend = new Map();
ws.on("message", raw => { const m = JSON.parse(raw.toString()); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const cmd = (m, p = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async e => { const r = await cmd("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) throw new Error(String(r.result.exceptionDetails.text).slice(0, 200)); return r.result?.result?.value; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
await cmd("Page.enable"); await cmd("Runtime.enable");
await cmd("Page.reload", { ignoreCache: true });
await sleep(3500);
// 清空对话视图（新会话）
await ev("(()=>{const b=document.getElementById('sideNew'); if(b) b.click(); return 1;})()");
await sleep(1200);
// 注入图片
const inj = await ev("(async () => {" +
  "const bin = atob(" + JSON.stringify(b64) + "); const arr = new Uint8Array(bin.length);" +
  "for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);" +
  "const file = new File([arr], 'vision-e2e.png', { type: 'image/png' });" +
  "const dt = new DataTransfer(); dt.items.add(file);" +
  "const input = document.getElementById('imgInput'); if (!input) return 'no-input';" +
  "input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true }));" +
  "await new Promise(r => setTimeout(r, 500));" +
  "return 'thumbs:' + document.querySelectorAll('#imgPreview .imgThumb').length;" +
"})()");
console.log("inject:", inj);
// 输入并发送
const sent = await ev("(()=>{" +
  "const q = document.getElementById('q');" +
  "q.value = '这张图里有什么？把文字念出来。';" +
  "q.dispatchEvent(new Event('input', { bubbles: true }));" +
  "const b = document.getElementById('send');" +
  "if (b.disabled) return 'send-disabled';" +
  "b.click(); return 'clicked';" +
"})()");
console.log("send:", sent);
let done = false, waited = 0;
while (waited < 240000) {
  await sleep(3000); waited += 3000;
  const state = await ev("(()=>{" +
    "const rows = [...document.querySelectorAll('.row.assistant')];" +
    "const last = rows[rows.length - 1];" +
    "const txt = last ? (last.querySelector('.bubble')?.innerText || '') : '';" +
    "return { streaming: !!document.querySelector('.row.assistant.streaming'), len: txt.length, badge: !!document.querySelector('.visionBadge'), txt: txt.slice(0, 200), status: document.getElementById('statusText')?.textContent || '' };" +
  "})()");
  if (state.len > 10 && !state.streaming) { console.log("answer:", JSON.stringify(state)); done = true; break; }
  if (waited % 15000 === 0) console.log("waiting", waited / 1000 + "s", state.status);
}
const shot = await cmd("Page.captureScreenshot", { format: "png" });
fs.mkdirSync(OUT, { recursive: true });
const p = OUT + "\\ui-vision-e2e.png";
fs.writeFileSync(p, Buffer.from(shot.result.data, "base64"));
console.log("done:", done, "shot:", p);
ws.close();
process.exit(done ? 0 : 1);

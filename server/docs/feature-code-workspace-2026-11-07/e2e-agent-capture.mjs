// E2E：Agent 模式下模型输出代码 → 自动收录进代码工作区（2026-11-07 集成验证）
// 用法：node e2e-agent-capture.mjs [base] [cdp]
import WebSocket from "ws";
import fs from "node:fs";
import path from "node:path";
const BASE = process.argv[2] || "http://127.0.0.1:8099";
const CDP = process.argv[3] || "http://127.0.0.1:9333";
const OUT = "D:\\LocalModels\\server\\docs\\feature-code-workspace-2026-11-07\\logs";
const stamp = Date.now().toString(36);
const prompt = "请用 Python 写一个判断质数的函数，只输出代码块和一句说明。";
const list = await (await fetch(CDP + "/json/list")).json();
const page = list.find((t) => t.type === "page" && t.url.includes("8099"));
if (!page) { console.log("no page"); process.exit(2); }
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
const st = await (await fetch(BASE + "/api/state")).json();
console.log("model loaded:", st.loaded, "| version:", st.version);
const beforeJson = await (await fetch(BASE + "/api/workspace/list?dir=code")).json();
const beforeCount = (beforeJson.entries || []).length;
console.log("code/ before:", beforeCount);
await ev("(()=>{const c=document.getElementById('toolChk'); if(!c.checked){c.checked=true;c.dispatchEvent(new Event('change',{bubbles:true}));} return c.checked;})()");
const agentOn = await ev("document.getElementById('toolChk').checked");
console.log("agent mode:", agentOn);
await ev("(()=>{const q=document.getElementById('q'); q.value=" + JSON.stringify(prompt) + "; q.dispatchEvent(new Event('input',{bubbles:true})); return q.value.length;})()");
await ev("document.getElementById('send').click(); 1");
let done = false, waited = 0;
while (waited < 300000) {
  await sleep(2000); waited += 2000;
  const state = await ev("(()=>{const rows=[...document.querySelectorAll('.row.assistant')]; const last=rows[rows.length-1]; return {streaming: !!document.querySelector('.row.assistant.streaming'), rows: rows.length, len: last ? (last.querySelector('.bubble')?.innerText||'').length : 0};})()");
  if (state.streaming === false && state.len > 20) { done = true; break; }
}
console.log("generation done:", done, "waited:", Math.round(waited / 1000) + "s");
const afterJson = await (await fetch(BASE + "/api/workspace/list?dir=code")).json();
const items = afterJson.entries || [];
const info = await ev("(()=>{const out={captured:[...document.querySelectorAll('.codeCaptured')].map(e=>e.innerText.trim()), wraps:document.querySelectorAll('.codeWrap').length, toWs:document.querySelectorAll('.codeToWs').length, wsPaths:[...document.querySelectorAll('.codeWrap[data-ws-path]')].map(e=>e.dataset.wsPath), last: (()=>{const rows=[...document.querySelectorAll('.row.assistant')]; const last=rows[rows.length-1]; return last ? (last.querySelector('.bubble')?.innerText||'').slice(0,300) : '';})()}; return out;})()");
console.log("code/ after:", items.length, "| captured banners:", info.captured.length, "| codeToWs:", info.toWs);
console.log("banner:", (info.captured[0] || "(none)").slice(0, 120));
console.log("wsPaths:", JSON.stringify(info.wsPaths));
console.log("files:", items.map((x) => x.path).join(", "));
const shot = await send("Page.captureScreenshot", { format: "png" });
fs.mkdirSync(OUT, { recursive: true });
const shotPath = path.join(OUT, "e2e-agent-capture-" + stamp + ".png");
fs.writeFileSync(shotPath, Buffer.from(shot.result.data, "base64"));
console.log("shot:", shotPath);
const ok = info.captured.length >= 1 && items.length > beforeCount && info.toWs >= 1;
console.log("\nE2E " + (ok ? "PASS" : "FAIL"));
ws.close();
process.exit(ok ? 0 : 1);

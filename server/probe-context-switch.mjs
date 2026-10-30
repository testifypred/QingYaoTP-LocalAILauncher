import WebSocket from "ws";
const base = "http://127.0.0.1:8099";
const list = await (await fetch("http://127.0.0.1:9333/json/list")).json();
const page = list.find((t) => t.type === "page" && t.url.includes("8099"));
if (!page) { console.log("no page"); process.exit(2); }
const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise((r, j) => { ws.once("open", r); ws.once("error", j); });
let id = 0; const pend = new Map();
ws.on("message", (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text); return r.result?.result?.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const loaded = async () => (await (await fetch(base + "/api/state")).json()).loaded;
let pass = 0, fail = 0;
const check = (n, c, d = "") => { if (c) { pass++; console.log("ok   " + n + (d ? "  [" + d + "]" : "")); } else { fail++; console.log("FAIL " + n + "  " + d); } };
await send("Page.enable"); await send("Runtime.enable");
await send("Page.reload", { ignoreCache: true });
await sleep(3200);
await ev("document.getElementById('recentOpen').click(); 1");
await sleep(1500);
const before = await ev("({ rows: document.querySelectorAll('.row').length, len: transcript.length })");
check("先打开一条有消息的会话", before.rows > 0 && before.len > 0, JSON.stringify(before));
await ev("document.getElementById('modelBtn').click(); 1"); await sleep(300);
await ev("[...document.querySelectorAll('#modelSel .modelRow')].find(r => r.dataset.file.includes('Phi-4')).click(); 1");
for (let i = 0; i < 90; i++) { await sleep(500); if ((await loaded() || '').includes('Phi-4')) break; }
await sleep(800);
const mid = await ev("({ rows: document.querySelectorAll('.row').length, len: transcript.length, hero: !!document.getElementById('hero') })");
check("换模型后消息还在", mid.rows === before.rows && mid.len === before.len, JSON.stringify(mid));
check("换模型后不是空开场白", mid.hero === false);
await ev("document.getElementById('modelBtn').click(); 1"); await sleep(300);
await ev("[...document.querySelectorAll('#modelSel .modelRow')].find(r => r.dataset.file.includes('qwen3-5')).click(); 1");
for (let i = 0; i < 90; i++) { await sleep(500); if ((await loaded() || '').includes('qwen3-5')) break; }
await sleep(400);
console.log("\nRESULT " + pass + "/" + (pass + fail));
ws.close(); process.exit(fail ? 1 : 0);

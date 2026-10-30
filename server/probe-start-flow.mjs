import WebSocket from "ws";
const base = "http://127.0.0.1:8099";
const list = await (await fetch("http://127.0.0.1:9333/json/list")).json();
const page = list.find((t) => t.type === "page" && t.url.includes("8099"));
const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise((r, j) => { ws.once("open", r); ws.once("error", j); });
let id = 0; const pend = new Map();
ws.on("message", (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text); return r.result?.result?.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (n, c, d = "") => { if (c) { pass++; console.log("ok   " + n + (d ? "  [" + d + "]" : "")); } else { fail++; console.log("FAIL " + n + "  " + d); } };

await send("Page.enable"); await send("Runtime.enable");
await send("Page.reload", { ignoreCache: true });
await sleep(3200);
check("启动显示开场白", (await ev("!!document.getElementById('hero')")) === true);

// 从右下角进入上次对话
await ev("document.getElementById('recentOpen').click(); 1");
await sleep(1200);
check("继续对话能打开历史", (await ev("document.querySelectorAll('.row').length")) > 0);
check("打开历史后开场白消失", (await ev("!!document.getElementById('hero')")) === false);
check("提示卡已收起", (await ev("document.getElementById('recentWrap').hidden")) === true);

// 回到新对话，发一句
await ev("newChat()");
await sleep(500);
check("新对话回到开场白", (await ev("!!document.getElementById('hero')")) === true);
await ev("(() => { const q = document.getElementById('q'); q.value = '只回复两个字：收到'; q.dispatchEvent(new Event('input', { bubbles: true })); q.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return 1; })()");
await sleep(300);
check("发送后开场白退场", (await ev("!!document.getElementById('hero')")) === false);
let done = false;
for (let i = 0; i < 180; i++) { await sleep(500); done = await ev("!document.getElementById('send').disabled && document.querySelectorAll('.row.assistant').length > 0"); if (done) break; }
check("回答已生成", done === true);
check("发送键仍带模型图标", (await ev("(() => { const i = document.getElementById('sendIco'); return !i.hidden && !!i.src; })()")) === true);

const sid = await ev("localStorage.getItem('localai.lastSession')");
await ev("newChat()");
await sleep(600);
await fetch(base + "/api/sessions/" + encodeURIComponent(sid), { method: "DELETE" });
const left = await (await fetch(base + "/api/sessions")).json();
console.log("left", (left.sessions || left).length);
console.log("\nRESULT " + pass + "/" + (pass + fail));
ws.close(); process.exit(fail ? 1 : 0);

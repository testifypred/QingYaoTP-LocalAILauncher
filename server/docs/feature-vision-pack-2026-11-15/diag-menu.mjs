import WebSocket from "ws";
const list = await (await fetch("http://127.0.0.1:9333/json/list")).json();
const page = list.find((t) => t.type === "page" && t.url.includes("8099"));
const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise((r) => ws.once("open", r));
let id = 0; const pend = new Map();
ws.on("message", (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) return "ERR " + JSON.stringify(r.result.exceptionDetails).slice(0,300); return r.result?.result?.value; };
await send("Page.enable"); await send("Runtime.enable");
await send("Page.reload", { ignoreCache: true });
await new Promise((r) => setTimeout(r, 3500));
await ev("document.getElementById('modelBtn').click(); 1");
await new Promise((r) => setTimeout(r, 1500));
const info = await ev(`JSON.stringify({
  vw: innerWidth, vh: innerHeight,
  menu: (() => { const m = document.querySelector('.modelMenu'); if (!m) return null; const r = m.getBoundingClientRect(); const cs = getComputedStyle(m); return { rect: [r.left, r.top, r.width, r.height], maxH: cs.maxHeight, overflow: cs.overflow, scrollH: m.scrollHeight, cls: m.className, parent: m.parentElement.className }; })(),
  rows: [...document.querySelectorAll('#modelSel .modelRow')].map(r => { const b = r.getBoundingClientRect(); const el = b.height ? document.elementFromPoint(b.left + 30, b.top + b.height / 2) : null; return { t: r.textContent.trim().slice(0, 18), rect: [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)], hit: el ? (el.closest('.modelMenu') ? 'menu' : (el.id || el.className || el.tagName)) : 'none' }; }),
  selRect: (() => { const s = document.getElementById('modelSel'); const r = s.getBoundingClientRect(); const cs = getComputedStyle(s); return { rect: [r.left, r.top, r.width, r.height], maxH: cs.maxHeight, overflow: cs.overflow, scrollH: s.scrollHeight }; })(),
})`);
console.log(info);
await ev("document.getElementById('modelBtn').click(); 1");
ws.close();

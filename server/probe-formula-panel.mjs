import WebSocket from "ws";
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
let pass = 0, fail = 0;
const check = (n, c, d = "") => { if (c) { pass++; console.log("ok   " + n + (d ? "  [" + d + "]" : "")); } else { fail++; console.log("FAIL " + n + "  " + d); } };
await send("Page.enable"); await send("Runtime.enable");
await send("Page.reload", { ignoreCache: true }); await sleep(3500);
await ev("document.getElementById('recentOpen').click(); 1"); await sleep(1200);

const chemText = "水 $\\ce{H2O}$，燃烧 $\\ce{CO2 + H2O}$；裸写 \\ce{CH4} 也要渲染。";
const inject = "(() => { const row = document.createElement('div'); row.className = 'row assistant'; const b = document.createElement('div'); b.className = 'bubble'; row.appendChild(b); document.getElementById('msgs').appendChild(row); renderAssistant(b, " + JSON.stringify(chemText) + "); return { katex: b.querySelectorAll('.katex').length, err: b.querySelectorAll('.katex-error').length }; })()";
const chem = await ev(inject);
check("化学式渲染成公式（含裸写）", chem.katex >= 3 && chem.err === 0, JSON.stringify(chem));

await ev("document.getElementById('fxBtn').click(); 1"); await sleep(800);
let ready = false;
for (let i = 0; i < 20; i++) { ready = await ev("!!(window.MathfieldElement && typeof document.getElementById('fxField').setValue === 'function')"); if (ready) break; await sleep(200); }
check("公式面板与 MathLive 就绪", ready === true && (await ev("!document.getElementById('fxModal').hidden")) === true);
const tex = "\\frac{a}{b}+\\sqrt{x}";
await ev("(() => { const f = document.getElementById('fxField'); f.setValue(" + JSON.stringify(tex) + "); f.dispatchEvent(new Event('input')); return 1; })()");
await sleep(300);
const synced = await ev("document.getElementById('fxTex').value");
check("编辑器同步到 LaTeX 文本框", synced.includes('frac') && synced.includes('sqrt'), synced);
await ev("(() => { const t = document.getElementById('fxTex'); t.value = 'E=mc^2'; t.dispatchEvent(new Event('input')); return 1; })()");
await sleep(500);
const back = await ev("document.getElementById('fxField').value");
check("LaTeX 文本框回写编辑器", back.includes('E=mc^2'), back);
await ev("(() => { window.__tex = ''; navigator.clipboard.writeText = (t) => { window.__tex = t; return Promise.resolve(); }; return 1; })()");
await ev("document.getElementById('fxCopy').click(); 1"); await sleep(300);
check("复制 LaTeX", (await ev("window.__tex")).includes('E=mc^2'), await ev("window.__tex"));
await ev("document.getElementById('fxInsert').click(); 1"); await sleep(400);
const q = await ev("document.getElementById('q').value");
check("插入到输入框", q.includes('$E=mc^2$'), q);
check("插入后面板关闭", (await ev("document.getElementById('fxModal').hidden")) === true);
await send("Page.reload", { ignoreCache: true });
console.log("\nRESULT " + pass + "/" + (pass + fail));
ws.close(); process.exit(fail ? 1 : 0);

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
await send("Page.reload", { ignoreCache: true }); await sleep(3000);
await ev("document.getElementById('recentOpen').click(); 1"); await sleep(1400);

// 块级公式：按钮复制
await ev("(() => { const row = document.createElement('div'); row.className = 'row assistant'; const b = document.createElement('div'); b.className = 'bubble'; row.appendChild(b); document.getElementById('msgs').appendChild(row); renderAssistant(b, '质能方程：$$E=mc^2$$ 以及行内 $a^2+b^2$。'); return 1; })()");
await sleep(500);
check("块级公式有复制按钮", (await ev("document.querySelectorAll('.formulaWrap.block .formulaCopy').length")) > 0);
await ev("(() => { window.__tex = ''; navigator.clipboard.writeText = (t) => { window.__tex = t; return Promise.resolve(); }; return 1; })()");
await ev("document.querySelector('.formulaCopy').click(); 1"); await sleep(300);
const tex = await ev("window.__tex");
check("按钮复制块级 LaTeX", /E=mc\^2|E=mc\^\{2\}/.test(tex), tex);
// 行内公式：点公式复制
await ev("(() => { window.__tex2 = ''; navigator.clipboard.writeText = (t) => { window.__tex2 = t; return Promise.resolve(); }; document.querySelector('.katex:not(.katex-display .katex)').click(); return 1; })()");
await sleep(300);
const tex2 = await ev("window.__tex2");
check("点行内公式复制", /a\^2|a\^\{2\}/.test(tex2), tex2);

// 会话内搜索
await ev("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true })); 1");
// 搜索条是下一帧才去掉 hidden：机器忙时固定 300ms 会抢在打开之前读（2026-11-02 第三轮实测偶发红）。
let findOpen = false;
for (let i = 0; i < 40; i++) {
  await sleep(120);
  findOpen = (await ev("!document.getElementById('findBar').hidden")) === true;
  if (findOpen) break;
}
check("Ctrl+F 打开搜索条", findOpen);
// 搜上面两行注入的正文里的词：原来搜 'turtle'，靠的是开发期某个会话里正好有这词，
// 会话一换就永远搜不到（探针过期）
await ev("(() => { const inp = document.getElementById('findInput'); inp.value = '质能方程'; inp.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()");
await sleep(500);
const c1 = await ev("document.getElementById('findCount').textContent");
check("找到匹配并显示计数", /^\d+\/\d+$/.test(c1) && Number(c1.split('/')[1]) > 0, c1);
const hl = await ev("window.CSS && CSS.highlights ? CSS.highlights.has('searchHit') : false");
check("高亮已注册", hl === true);
const before = Number(c1.split('/')[0]);
await ev("document.getElementById('findInput').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); 1");
await sleep(200);
const c2 = await ev("document.getElementById('findCount').textContent");
check("Enter 跳到下一个", Number(c2.split('/')[0]) === (before % Number(c1.split('/')[1])) + 1, c2);
await ev("document.getElementById('findInput').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); 1");
await sleep(200);
check("Esc 关闭并清除高亮", (await ev("document.getElementById('findBar').hidden && (!window.CSS || !CSS.highlights || !CSS.highlights.has('searchHit'))")) === true);
await send("Page.reload", { ignoreCache: true });
console.log("\nRESULT " + pass + "/" + (pass + fail));
ws.close(); process.exit(fail ? 1 : 0);

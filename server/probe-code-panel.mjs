import WebSocket from "ws";
import fs from "node:fs";
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
await send("Page.reload", { ignoreCache: true });
await sleep(3000);
check("顶栏有「代码」入口", (await ev("!!document.getElementById('codeBtn')")) === true);
await ev("document.getElementById('codeBtn').click(); 1");
await sleep(1200);
const langs = await ev("[...document.querySelectorAll('#codeLang option')].map(o => ({ v: o.value, t: o.textContent, d: o.disabled }))");
console.log("LANGS", JSON.stringify(langs));
check("面板打开", (await ev("!document.getElementById('codeModal').hidden")) === true);
check("语言列表已加载", langs.length >= 6, "count=" + langs.length);
check("未安装语言被标灰", langs.some((l) => l.d === true), JSON.stringify(langs.filter((l) => l.d).map((l) => l.v)));
const selLang = await ev("document.getElementById('codeLang').value");
check("默认选一个可用语言", langs.some((l) => l.v === selLang && !l.d), selLang);

await ev("(() => { const s = document.getElementById('codeLang'); s.value = 'python'; s.dispatchEvent(new Event('change')); const t = document.getElementById('codeEditor'); t.value = 'print(\"panel \" + str(40+2))'; t.dispatchEvent(new Event('input')); return 1; })()");
await ev("document.getElementById('codeRunBtn').click(); 1");
let out = "";
for (let i = 0; i < 40; i++) { await sleep(300); out = await ev("document.getElementById('codeOutput').textContent"); if (out.includes("panel 42")) break; }
check("运行出结果", out.includes("panel 42") && /exit 0/.test(out), out.slice(0, 60).replace(/\s+/g, " "));

// 草稿持久化：刷新后重新打开
await sleep(400);
await send("Page.reload", { ignoreCache: true });
await sleep(2800);
await ev("document.getElementById('codeBtn').click(); 1");
await sleep(900);
const restored = await ev("({ lang: document.getElementById('codeLang').value, code: document.getElementById('codeEditor').value })");
check("刷新后草稿还在", restored.code.includes("panel") && restored.lang === "python", JSON.stringify(restored).slice(0, 60));

await ev("document.getElementById('codeClearBtn').click(); 1");
await sleep(200);
check("清空按钮生效", (await ev("document.getElementById('codeEditor').value")) === "");
await ev("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); 1");
await sleep(200);
check("Esc 关闭面板", (await ev("document.getElementById('codeModal').hidden")) === true);
console.log("\nRESULT " + pass + "/" + (pass + fail));
ws.close(); process.exit(fail ? 1 : 0);
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
await send("Page.reload", { ignoreCache: true });
await sleep(2800);

check("顶栏不再有「⋯」", (await ev("!!document.getElementById('moreBtn')")) === false);

await ev("document.getElementById('settingsBtn').click(); 1");
await sleep(250);
const tabs = await ev("[...document.querySelectorAll('.settingsTabs .stab')].map(b => b.textContent)");
check("设置里有「工具」页", tabs.includes("工具"), JSON.stringify(tabs));
await ev("[...document.querySelectorAll('.settingsTabs .stab')].find(b => b.dataset.tab === 'tools').click(); 1");
await sleep(250);
const pane = await ev("({ shown: !document.getElementById('paneTools').hidden, gen: document.getElementById('paneGen').hidden })");
check("工具页可见", pane.shown === true && pane.gen === true);
check("有提示词入口", (await ev("!!document.getElementById('setPromptOpen')")) === true);
check("有嗅探入口", (await ev("!!document.getElementById('setDiscoverOpen')")) === true);
check("有退出服务入口", (await ev("!!document.getElementById('setQuitOpen')")) === true);

await ev("document.getElementById('setPromptOpen').click(); 1");
await sleep(300);
check("点提示词打开编辑器", (await ev("({ s: document.getElementById('settingsModal').hidden, p: document.getElementById('promptModal').hidden })")).p === false);
await ev("document.getElementById('promptClose').click(); 1");
await sleep(150);
check("提示词编辑器可关闭", (await ev("document.getElementById('promptModal').hidden")) === true);

await ev("document.getElementById('settingsBtn').click(); 1");
await sleep(200);
await ev("[...document.querySelectorAll('.settingsTabs .stab')].find(b => b.dataset.tab === 'tools').click(); 1");
await sleep(200);
await ev("document.getElementById('setDiscoverOpen').click(); 1");
await sleep(500);
check("点嗅探打开嗅探面板", (await ev("document.getElementById('discoverModal').hidden")) === false);
await ev("document.getElementById('discoverClose').click(); 1");
await sleep(150);
await ev("document.getElementById('settingsModal').hidden = true; 1");
console.log("\nRESULT " + pass + "/" + (pass + fail));
ws.close(); process.exit(fail ? 1 : 0);

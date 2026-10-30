/** 硬重载页面（带 Page.enable），确保拿到服务端最新 HTML */
const CDP = process.argv[2] || "http://127.0.0.1:9333";
const list = await (await fetch(`${CDP}/json`)).json();
const page = list.find((t) => t.type === "page" && t.url.includes("8098"));
if (!page) { console.log("没找到页面"); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0; const pending = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
await new Promise((r) => ws.addEventListener("open", r));
const cmd = (method, params) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
await cmd("Page.enable");
await cmd("Network.enable");
await cmd("Network.setCacheDisabled", { cacheDisabled: true });
const r = await cmd("Page.reload", { ignoreCache: true });
console.log("reload 返回:", JSON.stringify(r.result ?? r.error));
await new Promise((r) => setTimeout(r, 2500));
const ev = async (x) => (await cmd("Runtime.evaluate", { expression: x, awaitPromise: true, returnByValue: true })).result?.result?.value;
console.log("页面已含懒建会话实现:", await ev(`String(newChat).includes('sessionId = null')`));
ws.close();

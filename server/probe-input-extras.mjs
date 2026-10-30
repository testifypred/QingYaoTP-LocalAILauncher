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

const tmp = await (await fetch("http://127.0.0.1:8099/api/sessions", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ title: "清空测试", messages: [{ role: "user", content: "a" }, { role: "assistant", content: "b" }] }),
})).json();

await send("Page.enable"); await send("Runtime.enable");
await send("Page.reload", { ignoreCache: true });
await sleep(2500);
await ev("localStorage.setItem('localai.inputHistory', JSON.stringify(['最近一条','早一点'])); localStorage.removeItem('localai.draft.new'); 1");
await send("Page.reload", { ignoreCache: true });
await sleep(2800);

await ev("document.getElementById('q').focus(); 1");
const up = async (key) => { await ev("document.getElementById('q').dispatchEvent(new KeyboardEvent('keydown', { key: '" + key + "', bubbles: true })); 1"); await sleep(120); return ev("document.getElementById('q').value"); };
const v1 = await up("ArrowUp"), v2 = await up("ArrowUp"), v3 = await up("ArrowDown"), v4 = await up("ArrowDown");
check("↑ 调出最近一条", v1 === "最近一条", v1);
check("再 ↑ 调出更早一条", v2 === "早一点", v2);
check("↓ 往回走", v3 === "最近一条", v3);
check("↓ 回到空草稿", v4 === "", JSON.stringify(v4));

await ev("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', ctrlKey: true, bubbles: true })); 1");
await sleep(300);
check("Ctrl+N 新建对话", (await ev("document.getElementById('hero') !== null && sessionId === null")) === true);
await ev("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true })); 1");
await sleep(150);
// 开场白页显示的是 #heroInput，底部 #q 被藏起来；快捷键的正确语义是「作用于当前可见的输入框」
check("Ctrl+K 聚焦可见输入框", (await ev("(() => { const a = document.activeElement; return !!a && a.tagName === 'TEXTAREA' && !!a.offsetParent; })()")) === true);
await ev("(() => { const a = document.activeElement; a.value = '临时正文'; a.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return 1; })()");
await sleep(150);
check("Esc 清空当前输入框", (await ev("document.activeElement.value")) === "");

// 清空消息（右键菜单）
await ev("window.confirm = () => true; 1");
await ev("(() => { const it = document.querySelector('.sessionItem[data-id=\"" + tmp.id + "\"]'); it.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 200, clientY: 300 })); return 1; })()");
await sleep(250);
await ev("[...document.querySelectorAll('.ctxMenu button')].find(b => b.textContent === '清空消息').click(); 1");
await sleep(800);
const after = await (await fetch("http://127.0.0.1:8099/api/sessions/" + tmp.id)).json();
check("右键「清空消息」清掉消息", after.messages.length === 0, "len=" + after.messages.length);
await fetch("http://127.0.0.1:8099/api/sessions/" + tmp.id, { method: "DELETE" });
await ev("localStorage.removeItem('localai.inputHistory'); 1");
console.log("\nRESULT " + pass + "/" + (pass + fail));
ws.close(); process.exit(fail ? 1 : 0);

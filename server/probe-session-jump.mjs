import WebSocket from "ws";
const CDP = "http://127.0.0.1:9333";
const base = "http://127.0.0.1:8099";

async function mkSession(tag) {
  return await (await fetch(base + "/api/sessions", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: tag, messages: [
      { role: "user", content: tag + " 的问题" },
      { role: "assistant", content: tag + " 的回答" },
    ] }),
  })).json();
}
const A = await mkSession("A临时");
const B = await mkSession("B临时");

const list = await (await fetch(CDP + "/json/list")).json();
const page = list.find((t) => t.type === "page" && t.url.includes("8099"));
const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise((r, j) => { ws.once("open", r); ws.once("error", j); });
let id = 0; const pend = new Map();
ws.on("message", (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text); return r.result?.result?.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (n, c, d = "") => { if (c) { pass++; console.log("ok   " + n + (d ? "  [" + d + "]" : "")); } else { fail++; console.log("FAIL " + n + "  " + d); } };

await send("Page.enable"); await send("Runtime.enable");
await send("Page.reload", { ignoreCache: true });
await sleep(2800);

const order = () => ev("[...document.querySelectorAll('.sessionItem')].map(el => el.dataset.id)");
const before = await order();
console.log("顺序前 6:", before.slice(0, 6).map((x) => x.slice(0, 8)).join(","));
const aBefore = (await (await fetch(base + "/api/sessions")).json()).sessions.find((s) => s.id === A.id);

// 点开列表里的 A（不是第一项）
await ev("document.querySelector('.sessionItem[data-id=\"" + A.id + "\"]').click()");
await sleep(1200);
const after = await order();
const aAfter = (await (await fetch(base + "/api/sessions")).json()).sessions.find((s) => s.id === A.id);
check("切换对话后列表顺序不变", JSON.stringify(before) === JSON.stringify(after), "len " + before.length + "/" + after.length);
check("切换不抬 updatedAt", aBefore.updatedAt === aAfter.updatedAt, aBefore.updatedAt + " -> " + aAfter.updatedAt);
check("A 已选中", (await ev("document.querySelector('.sessionItem.sel').dataset.id")) === A.id);

// 真发一句：这条才应该把 A 顶到第一
await ev("(() => { const q = document.getElementById('q'); q.value = '只回复一个字：好'; q.dispatchEvent(new Event('input', { bubbles: true })); q.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return true; })()");
let done = false;
for (let i = 0; i < 120; i++) { await sleep(500); done = await ev("!document.getElementById('send').disabled"); if (done) break; }
await sleep(1200);
const after2 = await order();
check("真发消息后置顶", after2[0] === A.id, after2.slice(0, 2).map((x) => x.slice(0, 8)).join(","));

// 清理
const sid = await ev("localStorage.getItem('localai.lastSession')");
await ev("newChat()");
await sleep(700);
for (const s of [A, B, { id: sid }]) { if (s.id) await fetch(base + "/api/sessions/" + encodeURIComponent(s.id), { method: "DELETE" }); }
const left = await (await fetch(base + "/api/sessions")).json();
console.log("left", (left.sessions || left).length);
console.log("\nRESULT " + pass + "/" + (pass + fail));
ws.close(); process.exit(fail ? 1 : 0);

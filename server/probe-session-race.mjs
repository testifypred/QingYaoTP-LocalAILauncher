import WebSocket from "ws";
const CDP = "http://127.0.0.1:9333";
const base = "http://127.0.0.1:8099";
async function mk(tag) {
  return await (await fetch(base + "/api/sessions", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: tag, messages: [
      { role: "user", content: tag + " 的独特问题" },
      { role: "assistant", content: tag + " 的回答" },
    ] }),
  })).json();
}
const A = await mk("甲会话"), B = await mk("乙会话");
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
// 快速连点：先甲后乙（间隔 30ms，模拟人手连点）
await ev("document.querySelector('.sessionItem[data-id=\"" + A.id + "\"]').click(); 1");
await sleep(30);
await ev("document.querySelector('.sessionItem[data-id=\"" + B.id + "\"]').click(); 1");
await sleep(1600);
const sel = await ev("document.querySelector('.sessionItem.sel').dataset.id");
const shown = await ev("document.getElementById('msgs').textContent");
check("连点后选中最后点的乙", sel === B.id, sel.slice(0, 10));
check("正文是乙的内容", shown.includes("乙会话 的独特问题") && !shown.includes("甲会话 的独特问题"), shown.slice(0, 40).replace(/\s+/g, " "));
const listAfter = await (await fetch(base + "/api/sessions")).json();
const order = listAfter.sessions.map((s) => s.id);
check("连点后顺序未变", order[0] === B.id && order[1] === A.id, order.slice(0, 2).map((x) => x.slice(0, 8)).join(","));

await ev("newChat()");
await sleep(700);
for (const s of [A, B]) await fetch(base + "/api/sessions/" + encodeURIComponent(s.id), { method: "DELETE" });
console.log("\nRESULT " + pass + "/" + (pass + fail));
ws.close(); process.exit(fail ? 1 : 0);

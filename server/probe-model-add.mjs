import WebSocket from "ws";
import fs from "node:fs";
const list = await (await fetch("http://127.0.0.1:9333/json/list")).json();
const page = list.find((t) => t.type === "page" && t.url.includes("8099"));
if (!page) { console.log("no page"); process.exit(2); }
// 模型数量问服务端，别写死（10-25 后是 5 个）
const modelCount = ((await (await fetch("http://127.0.0.1:8099/api/state")).json()).models || []).length;
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
await ev("document.getElementById('modelBtn').click(); 1");
await sleep(300);
check("菜单有「添加模型」入口", (await ev("!!document.getElementById('modelAddBtn')")) === true);
const n1 = await ev("document.querySelectorAll('#modelSel .modelRow').length");
await sleep(3500);
const n2 = await ev("document.querySelectorAll('#modelSel .modelRow').length");
check("3 秒刷新不重建菜单项", n1 === n2 && n1 === modelCount, n1 + "->" + n2 + " / 应有 " + modelCount);

const shot = await send("Page.captureScreenshot", { format: "png" });
fs.writeFileSync("D:/LocalModels/server/docs/ui-new/model-menu.png", Buffer.from(shot.result.data, "base64"));

await ev("document.getElementById('modelAddBtn').click(); 1");
await sleep(800);
check("点「添加模型」打开嗅探面板", (await ev("!document.getElementById('discoverModal').hidden")) === true);
check("同时收起模型菜单", (await ev("document.getElementById('modelMenu').hidden")) === true);
await ev("document.getElementById('discoverClose').click(); 1");
console.log("\nRESULT " + pass + "/" + (pass + fail));
ws.close(); process.exit(fail ? 1 : 0);

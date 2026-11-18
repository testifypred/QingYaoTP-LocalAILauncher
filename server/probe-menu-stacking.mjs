import WebSocket from "ws";
import fs from "node:fs";
const list = await (await fetch("http://127.0.0.1:9333/json/list")).json();
const page = list.find((t) => t.type === "page" && t.url.includes("8099"));
if (!page) { console.log("no page"); process.exit(2); }
// 行数跟着模型库走（曾经写死 4，加一个模型就红）
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
// 2026-11-19：全量里会被前序界面探针把视口/窗口状态带歪（历史已知假红：850x700 / 500x320）。
// 本探针自己钉一个 1408x800 的视口再测「每一行都能点到」，收尾清掉覆盖。
await send("Emulation.setDeviceMetricsOverride", { width: 1408, height: 800, deviceScaleFactor: 1, mobile: false });
await send("Page.reload", { ignoreCache: true });
await sleep(3000);
await ev("(() => { const m = document.getElementById('msgs'); const d = document.createElement('div'); d.className = 'row assistant'; d.id = 'coverRow'; const b = document.createElement('div'); b.className = 'bubble'; b.textContent = '覆盖测试：这条消息以前会盖住菜单'; d.appendChild(b); m.appendChild(d); return 1; })()");
await ev("document.getElementById('modelBtn').click(); 1");
// 菜单是异步展开的：机器忙时固定 400ms 不够，5 行的矩形还是 0 高，
// elementFromPoint 会落在 header 上 → 全 'other'。另外首启引导面板（z-index 高于 header）
// 也会盖住菜单——环境侧由驱动补「标记引导完成」。这里按「每行已布局且命中菜单」轮询，不赌 sleep。
check("顶栏 z-index 已抬高", (await ev("getComputedStyle(document.querySelector('header')).zIndex")) === "40");
let hits = [];
for (let i = 0; i < 40; i++) {
  await sleep(150);
  hits = await ev("[...document.querySelectorAll('#modelSel .modelRow')].map(r => { const b = r.getBoundingClientRect(); if (!b.height) return 'none'; const el = document.elementFromPoint(b.left + 30, b.top + b.height / 2); return el ? (el.closest('.modelMenu') ? 'menu' : 'other') : 'none'; })");
  if (hits.length === modelCount && hits.every((h) => h === "menu")) break;
}
check("每一行模型都能被点到", hits.length === modelCount && hits.every((h) => h === "menu"), JSON.stringify(hits) + " / 应有 " + modelCount);
const shot = await send("Page.captureScreenshot", { format: "png" });
fs.writeFileSync("D:/LocalModels/server/docs/ui-new/model-menu.png", Buffer.from(shot.result.data, "base64"));
await ev("document.getElementById('coverRow').remove(); document.getElementById('modelBtn').click(); 1");
console.log("\nRESULT " + pass + "/" + (pass + fail));
await send("Emulation.clearDeviceMetricsOverride").catch(() => {});
ws.close(); process.exit(fail ? 1 : 0);

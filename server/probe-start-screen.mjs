import WebSocket from "ws";
import fs from "node:fs";
const CDP = "http://127.0.0.1:9333";
const OUT = "D:/LocalModels/server/docs/ui-new";
const list = await (await fetch(CDP + "/json/list")).json();
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
await sleep(3200);
// 模型个数与"当前加载的是哪个"一律问服务端：以前写死 4 个 / Qwen3-5-4B，
// 10-25 加了 0.5B 之后就永远红了（探针过期，不是应用坏了）
const state = await (await fetch("http://127.0.0.1:8099/api/state")).json();
const modelCount = (state.models || []).length;

const st = await ev("({ hero: !!document.getElementById('hero'), greet: document.getElementById('heroGreet')?.textContent, sid: sessionId, msgs: document.querySelectorAll('.row').length, tabs: !!document.querySelector('.modelTabs'), btn: document.getElementById('modelBtnName').textContent, sendPlane: !!document.querySelector('#send svg.sendPlane'), sendIcoVisible: (() => { const i = document.getElementById('sendIco'); return !!i && !i.hidden && getComputedStyle(i).display !== 'none'; })(), recent: !document.getElementById('recentWrap').hidden, recentTitle: document.getElementById('recentTitle').textContent })");
console.log("STATE", JSON.stringify(st));
check("启动进入开场白", st.hero === true);
check("默认新对话（无 sessionId、无消息）", st.sid === null && st.msgs === 0, "sid=" + st.sid);
check("问候语按时间", ["早上好", "中午好", "晚上好"].includes(st.greet), st.greet);
check("顶栏无模型列表", st.tabs === false);
// 有模型/没模型都合法：有就显示那个模型名，没有就显示占位文案（别写死成「必须有模型」）
if (state.loaded) check("模型按钮显示已加载模型", !!st.btn && st.btn !== "选择模型", st.btn + " / 已加载 " + state.loaded);
else check("没加载模型时按钮是占位文案", !!st.btn && st.btn !== "", st.btn);
check("发送键是纸飞机、不再显示模型品牌图标（v1.11.2 设计）", st.sendPlane === true && st.sendIcoVisible === false);
check("右下角提示上次对话", st.recent === true, st.recentTitle.slice(0, 24));
check("深度思考/联网在输入框下", (await ev("!!document.querySelector('.askBar #thinkChk') && !!document.querySelector('.askBar #webChk') && !!document.querySelector('.askBar #toolChk')")) === true);

await ev("document.getElementById('modelBtn').click(); 1");
await sleep(250);
const menu = await ev("({ open: !document.getElementById('modelMenu').hidden, rows: [...document.querySelectorAll('#modelSel .modelRow')].map(r => r.dataset.file), on: document.querySelector('#modelSel .modelRow .on')?.parentElement.dataset.file })");
check("模型菜单能打开", menu.open === true);
check("列出全部模型", menu.rows.length === modelCount, menu.rows.length + " / " + modelCount);
if (state.loaded) check("标记当前运行模型", menu.on === state.loaded, (menu.on || "") + " / " + (state.loaded || ""));
else check("没加载模型时菜单不标记任何行", !menu.on, menu.on || "（无）");
await sleep(200);
const shot = await send("Page.captureScreenshot", { format: "png" });
fs.writeFileSync(OUT + "/start-screen.png", Buffer.from(shot.result.data, "base64"));
await ev("document.body.click(); 1");
await sleep(200);
check("点空白关闭菜单", (await ev("document.getElementById('modelMenu').hidden")) === true);
console.log("\nRESULT " + pass + "/" + (pass + fail));
ws.close(); process.exit(fail ? 1 : 0);

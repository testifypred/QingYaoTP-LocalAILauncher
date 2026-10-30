import WebSocket from "ws";
import fs from "node:fs";
const list = await (await fetch("http://127.0.0.1:9333/json/list")).json();
const page = list.find((t) => t.type === "page" && t.url.includes("8099"));
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
let st = await ev("({ text: document.getElementById('statusText').textContent, title: document.getElementById('status').title })");
console.log("STATUS", JSON.stringify(st));
check("状态栏只说窗口与思考能力", /^\d+K · (可思考|不支持思考)$/.test(st.text), st.text);
check("不再把层数/后端塞进状态栏", !/层|vulkan/.test(st.text), st.text);
check("完整信息在 tooltip 里", /上下文 \d+/.test(st.title) && /层/.test(st.title), st.title.slice(0, 60));
check("可思考标注与 tooltip 一致", st.text.includes("可思考") === st.title.includes("可思考"), st.text + " | " + st.title.slice(0, 40));
// 不再写死具体模型：tooltip 的第一段就是模型展示名，断言它没跑到状态栏上
const modelLabel = String(st.title || "").split(" · ")[0].trim();
check("模型名只出现在 tooltip", modelLabel.length > 3 && !st.text.includes(modelLabel), modelLabel + " | " + st.text);

// 换成最长的模型名，检查放得下
await ev("setStatus('on', '16K · 不支持思考', 'DeepSeek-R1-0528-Qwen3-8B · 不支持思考 · 上下文 16384 · 37 层 · vulkan')");
await sleep(200);
const fit = await ev("(() => { const p = document.getElementById('status'); const t = document.getElementById('statusText'); return { sw: t.scrollWidth, cw: p.clientWidth - 30 }; })()");
check("最长模型名也放得下", fit.sw <= fit.cw, fit.sw + " <= " + fit.cw);
const shot = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 1400, height: 80, scale: 1 } });
fs.writeFileSync("D:/LocalModels/server/docs/ui-new/status.png", Buffer.from(shot.result.data, "base64"));
await ev("refresh(); 1");
console.log("\nRESULT " + pass + "/" + (pass + fail));
ws.close(); process.exit(fail ? 1 : 0);
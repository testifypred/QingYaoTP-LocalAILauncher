/**
 * 文档检索 UI 探针（设置 → 工具 → 文档检索）
 *
 *   node probe-ui-rag.mjs [cdpBase] [appBase] [shotDir]
 *
 * 覆盖：状态行有文件数/段数、点「重建索引」出结果、写入 localStorage 的状态一致。
 */
import WebSocket from "ws";
import fs from "node:fs";

const CDP = process.argv[2] || "http://127.0.0.1:9333";
const APP = process.argv[3] || "http://127.0.0.1:8099";
const OUT = process.argv[4] || "D:/LocalModels/server/docs/probe-full-2026-10-27/shots";
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) { pass++; console.log("  ok   " + n + (d ? "  [" + d + "]" : "")); } else { fail++; console.log("  FAIL " + n + "  " + d); } };

const list = await (await fetch(CDP + "/json/list")).json();
const page = list.find((t) => t.type === "page" && t.url.includes(APP.replace(/^https?:\/\//, "")));
if (!page) { console.log("没找到页面"); process.exit(2); }
const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise((r, j) => { ws.once("open", r); ws.once("error", j); });
let id = 0; const pend = new Map();
ws.on("message", (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) throw new Error(String(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text).slice(0, 300)); return r.result?.result?.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await send("Page.enable"); await send("Runtime.enable");
await send("Page.reload", { ignoreCache: true });
await sleep(3000);
await ev('document.getElementById("settingsBtn").click(); 1');
await sleep(500);
await ev('showSettingsTab("tools"); 1');
await sleep(600);

const state = JSON.parse(await ev('JSON.stringify({ exists: !!document.getElementById("setRagInfo"), text: document.getElementById("setRagInfo").textContent, rebuild: !!document.getElementById("setRagRebuild"), visible: !!document.getElementById("setRagInfo").offsetParent })'));
ok("文档检索这一栏存在", state.exists && state.visible);
ok("状态行显示文件数与段数", /\d+ 个文件 · \d+ 段/.test(state.text), state.text);
ok("有重建按钮", state.rebuild === true);

await ev('document.getElementById("setRagRebuild").click(); 1');
let toast = "";
for (let i = 0; i < 30; i++) {
  await sleep(400);
  toast = String(await ev('[...document.querySelectorAll("#toasts .toast")].map((t) => t.textContent).join(" | ")'));
  if (/文档索引已重建/.test(toast)) break;
}
ok("重建后弹出结果提示", /文档索引已重建/.test(toast), toast.slice(0, 120));

const after = (await (await fetch(APP + "/api/rag/status")).json());
ok("服务端索引确实重建了", after.builtAt > 0 && after.files >= 1, "files=" + after.files + " chunks=" + after.chunks);
ok("状态行同步了服务端数字", new RegExp(after.files + " 个文件").test(String(await ev('document.getElementById("setRagInfo").textContent'))));

fs.mkdirSync(OUT, { recursive: true });
const shot = await send("Page.captureScreenshot", { format: "png" });
fs.writeFileSync(OUT + "/settings-rag.png", Buffer.from(shot.result.data, "base64"));

ws.close();
console.log("\n== 结果: " + pass + " 通过 / " + fail + " 失败 ==\n");
process.exit(fail ? 1 : 0);

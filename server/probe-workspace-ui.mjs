import WebSocket from "ws";
import fs from "node:fs";
const base = "http://127.0.0.1:8099";
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
await sleep(3000);
await ev("document.getElementById('wsBtn').click(); 1");
await sleep(900);
check("工作区打开", (await ev("!document.getElementById('wsModal').hidden")) === true);
check("编辑器带行号", (await ev("document.querySelectorAll('#wsModal .CodeMirror-linenumber').length")) > 0);
check("文件列表有内容", (await ev("document.querySelectorAll('#wsList .wsItem').length")) > 0);

await ev("(() => { document.getElementById('wsNewName').value = 'probe/demo.py'; document.getElementById('wsNewFile').click(); return 1; })()");
await sleep(900);
check("新建文件并打开", (await ev("wsCurrent")) === "probe/demo.py", await ev("wsCurrent"));
await ev("wsCM.setValue('print(\"hello workspace\")'); 1");
await sleep(200);
await ev("document.getElementById('wsSave').click(); 1");
await sleep(800);
const saved = await (await fetch(base + "/api/workspace/read?path=" + encodeURIComponent("probe/demo.py"))).json();
check("保存写回服务端", saved.content.includes("hello workspace"), saved.content);

await ev("(() => { document.getElementById('wsNewName').value = 'probe/demo2.py'; document.getElementById('wsRename').click(); return 1; })()");
await sleep(900);
check("重命名生效", (await ev("wsCurrent")) === "probe/demo2.py", await ev("wsCurrent"));

const shot = await send("Page.captureScreenshot", { format: "png" });
fs.writeFileSync("D:/LocalModels/server/docs/ui-new/workspace.png", Buffer.from(shot.result.data, "base64"));

await ev("window.confirm = () => true; 1");
await ev("document.getElementById('wsDelete').click(); 1");
await sleep(700);
const gone = await fetch(base + "/api/workspace/read?path=" + encodeURIComponent("probe/demo.py"));
check("删除文件", gone.status === 400 || gone.status === 404, "status=" + gone.status);
await fetch(base + "/api/workspace/delete", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: "probe" }) }).catch(() => {});
await ev("document.getElementById('wsClose').click(); 1");
console.log("\nRESULT " + pass + "/" + (pass + fail));
ws.close(); process.exit(fail ? 1 : 0);
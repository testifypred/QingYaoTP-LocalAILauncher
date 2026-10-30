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
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text + " " + (r.result.exceptionDetails.exception?.description || "")); return r.result?.result?.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (n, c, d = "") => { if (c) { pass++; console.log("ok   " + n + (d ? "  [" + d + "]" : "")); } else { fail++; console.log("FAIL " + n + "  " + d); } };

await send("Page.enable"); await send("Runtime.enable");
await send("Page.reload", { ignoreCache: true });
await sleep(2800);

const FENCE = String.fromCharCode(96, 96, 96);
const md = FENCE + "python\nprint(\"hello from block\")\n" + FENCE;
const injected = await ev(
  "(() => { const host = document.createElement('div'); host.className = 'row assistant'; host.id = 'codeTestRow';" +
  "host.innerHTML = '<div class=\"bubble\">' + renderMarkdown(" + JSON.stringify(md) + ") + '</div>';" +
  "document.getElementById('msgs').appendChild(host); return !!host.querySelector('.codeWrap'); })()"
);
check("代码块渲染出运行外壳", injected === true);

const ui = await ev("(() => { const w = document.querySelector('#codeTestRow .codeWrap'); const run = w.querySelector('.codeRun'); const copy = w.querySelector('[data-copy]'); return { run: !!run, copy: !!copy, runVisible: run ? getComputedStyle(run).display !== 'none' : false, lang: w.dataset.lang, label: w.querySelector('.codeLang').textContent }; })()");
check("有运行按钮", ui.run === true);
check("有复制按钮", ui.copy === true);
check("按钮默认可见", ui.runVisible === true);
check("语言标签正确", ui.label === "python", ui.label);

await ev("document.querySelector('#codeTestRow .codeRun').click(); 1");
let text = "";
for (let i = 0; i < 40; i++) { await sleep(400); text = await ev("document.querySelector('#codeTestRow .codeOut')?.textContent || ''"); if (text.includes("hello from block")) break; }
check("点运行后出结果", text.includes("hello from block"), text.slice(0, 60).replace(/\s+/g, " "));
check("结果带退出码与耗时", /exit 0/.test(text) && /ms/.test(text), text.slice(0, 40).replace(/\s+/g, " "));
await sleep(300);
await ev("(() => { const m = document.getElementById('msgs'); m.scrollTop = m.scrollHeight; return 1; })()");
await sleep(300);
const shot = await send("Page.captureScreenshot", { format: "png" });
fs.writeFileSync(OUT + "/code-run.png", Buffer.from(shot.result.data, "base64"));

// 设置关掉：按钮应隐藏
await ev("codeRunOn = false; applyCodeRunSetting(); 1");
const hidden = await ev("getComputedStyle(document.querySelector('#codeTestRow .codeRun')).display === 'none'");
check("关掉设置后按钮隐藏", hidden === true);
await ev("codeRunOn = true; applyCodeRunSetting(); 1");
check("重新打开后按钮恢复", (await ev("getComputedStyle(document.querySelector('#codeTestRow .codeRun')).display !== 'none'")) === true);

await ev("document.getElementById('codeTestRow')?.remove(); 1");
console.log("\nRESULT " + pass + "/" + (pass + fail));
ws.close(); process.exit(fail ? 1 : 0);
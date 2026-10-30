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

await send("Page.enable"); await send("Runtime.enable");
await send("Page.reload", { ignoreCache: true });
await sleep(3000);
await ev("document.getElementById('settingsBtn').click(); 1");
await sleep(250);
await ev("[...document.querySelectorAll('.settingsTabs .stab')].find(b => b.dataset.tab === 'tools').click(); 1");
await sleep(250);
await ev("document.getElementById('setDiscoverOpen').click(); 1");
await sleep(700);

const box = await ev("(() => { const m = document.getElementById('discoverModal'); const body = m.querySelector('.settingsBody'); const r = body.getBoundingClientRect(); return { open: !m.hidden, bodyHidden: body.hidden, bodyH: Math.round(r.height), intro: document.getElementById('dscIntro').textContent.trim().length, roots: document.querySelectorAll('#dscRoots .dscRoot').length, custom: document.querySelectorAll('#dscCustoms .dscCustom').length, scanVisible: !!document.getElementById('dscScan').offsetParent }; })()");
console.log("BOX", JSON.stringify(box));
check("嗅探面板打开", box.open === true);
check("内容区没被隐藏", box.bodyHidden === false && box.bodyH > 120, "h=" + box.bodyH);
check("说明文字可见", box.intro > 10, "chars=" + box.intro);
check("扫描位置已列出", box.roots >= 1, "roots=" + box.roots);
check("自定义目录显示", box.custom >= 1, "custom=" + box.custom);
check("扫描按钮可见", box.scanVisible === true);

await ev("document.getElementById('dscScan').click(); 1");
await sleep(2200);
const res = await ev("({ meta: document.getElementById('discoverMeta').textContent, results: document.getElementById('dscResults').textContent.slice(0, 120), adopt: document.getElementById('dscAdopt').disabled })");
console.log("SCAN", JSON.stringify(res));
check("扫描完成有统计", /个模型/.test(res.meta) && /遍历/.test(res.meta), res.meta);
check("结果区有说明", res.results.length > 0, res.results.slice(0, 40));

const shot = await send("Page.captureScreenshot", { format: "png" });
fs.writeFileSync("D:/LocalModels/server/docs/ui-new/discover.png", Buffer.from(shot.result.data, "base64"));
await ev("document.getElementById('discoverClose').click(); 1");
console.log("\nRESULT " + pass + "/" + (pass + fail));
ws.close(); process.exit(fail ? 1 : 0);

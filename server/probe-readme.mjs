/**
 * 使用说明（README）探针
 *
 *   node probe-readme.mjs [cdpBase] [appBase]
 *
 * 覆盖：/api/readme 有正文与版本、onboarding 暴露 readmeShown 开关、首启自动弹窗、
 *       正文按 Markdown 渲染、关闭后服务端落盘、再次启动不再弹、
 *       「设置 → 关于 → 使用说明」能重新打开、Esc 能关。
 * 自复位：跑完把 readmeShown 置回 true（否则后续界面探针会被弹窗盖住）。
 */
import WebSocket from "ws";

const CDP = process.argv[2] || "http://127.0.0.1:9333";
const APP = process.argv[3] || "http://127.0.0.1:8099";

let pass = 0, fail = 0;
const check = (n, c, d = "") => {
  if (c) { pass++; console.log("ok   " + n + (d ? "  [" + d + "]" : "")); }
  else { fail++; console.log("FAIL " + n + "  " + d); }
};
const j = async (p, opt) => {
  const r = await fetch(APP + p, opt);
  const t = await r.text();
  let data = null;
  try { data = JSON.parse(t); } catch {}
  return { status: r.status, data, text: t };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log("\n== 目标 " + APP + " / CDP " + CDP + " ==\n");

// ---------------- 接口 ----------------
const rd = await j("/api/readme");
check("/api/readme 可用", rd.status === 200, "HTTP " + rd.status);
const md = String(rd.data?.markdown || "");
check("有正文（> 500 字）", md.length > 500, md.length + " chars");
check("正文含项目名", md.includes("QingYaoTP"));
check("正文含小节标题", /^## /m.test(md), "");
const ver = await j("/api/version");
check("带版本号且与 /api/version 一致", Boolean(rd.data?.version) && rd.data.version === ver.data?.version, String(rd.data?.version));
check("有产品名", Boolean(rd.data?.name), String(rd.data?.name));
check("给了正文来源路径", Boolean(rd.data?.source), String(rd.data?.source));

const ob0 = await j("/api/onboarding");
check("onboarding 暴露 readmeShown", typeof ob0.data?.readmeShown === "boolean", String(ob0.data?.readmeShown));

// 置为「没看过」，模拟首次启动
await j("/api/onboarding", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ readmeShown: false }) });
check("可置为未读", (await j("/api/onboarding")).data?.readmeShown === false, "false");

// ---------------- 界面 ----------------
const list = await (await fetch(CDP + "/json/list")).json();
const page = list.find((t) => t.type === "page");
if (!page) { console.log("no page"); process.exit(2); }
const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise((r, jj) => { ws.once("open", r); ws.once("error", jj); });
let id = 0;
const pend = new Map();
ws.on("message", (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (e) => {
  const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text);
  return r.result?.result?.value;
};

await send("Page.enable");
await send("Runtime.enable");
await send("Page.navigate", { url: APP + "/" });
await sleep(3400);

check("首次启动自动弹出使用说明", (await ev("!document.getElementById('readmeModal').hidden")) === true);
const title = await ev("document.getElementById('readmeTitle').textContent");
check("弹窗标题带「使用说明」", String(title).includes("使用说明"), String(title));
const info = await ev("(() => { const b = document.getElementById('readmeBody'); return { heads: b.querySelectorAll('h1,h2').length, tables: b.querySelectorAll('table').length, len: b.innerText.length }; })()");
check("正文按 Markdown 渲染（有标题）", info.heads > 1, JSON.stringify(info));
check("正文渲染出内容（> 500 字）", info.len > 500, String(info.len));
check("正文含表格（能力/常见问题）", info.tables >= 2, String(info.tables));

await ev("document.getElementById('readmeOk').click(); 1");
await sleep(1000);
check("点「开始使用」后关闭", (await ev("document.getElementById('readmeModal').hidden")) === true);
check("关闭后服务端记下已读", (await j("/api/onboarding")).data?.readmeShown === true, "true");

await send("Page.reload", { ignoreCache: true });
await sleep(3200);
check("再次启动不再自动弹", (await ev("document.getElementById('readmeModal').hidden")) === true);

check("设置 → 关于 有「使用说明…」按钮", (await ev("!!document.getElementById('setReadme')")) === true);
await ev("document.getElementById('setReadme').click(); 1");
await sleep(1200);
check("点按钮能重新打开", (await ev("!document.getElementById('readmeModal').hidden")) === true);

await ev("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); 1");
await sleep(700);
check("Esc 能关闭", (await ev("document.getElementById('readmeModal').hidden")) === true);

// 复位：后续探针不该被弹窗盖住
await j("/api/onboarding", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ readmeShown: true }) });
check("跑完复位为已读", (await j("/api/onboarding")).data?.readmeShown === true, "true");

console.log("\nRESULT " + pass + "/" + (pass + fail));
ws.close();
process.exit(fail ? 1 : 0);

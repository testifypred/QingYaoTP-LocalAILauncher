/**
 * 侧栏搜索探针（标题 + 正文）
 *
 *   node probe-sidebar-search.mjs [cdpBase] [appBase]
 *
 * 覆盖：输入即搜（防抖）、标题命中、正文命中并高亮片段、点结果切换会话、
 *       ✕ 清空恢复完整列表、Esc 清空、无结果文案。
 * 自复位：造两个临时会话，跑完删掉并恢复列表。
 */
import WebSocket from "ws";

const CDP = process.argv[2] || "http://127.0.0.1:9333";
const APP = process.argv[3] || "http://127.0.0.1:8099";
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) { pass++; console.log("  ok   " + n + (d ? "  [" + d + "]" : "")); } else { fail++; console.log("  FAIL " + n + "  " + d); } };
const api = async (p, opt) => { const r = await fetch(APP + p, opt); return { status: r.status, j: await r.json().catch(() => ({})) }; };
const mk = (title, text) => api("/api/sessions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title, messages: [{ role: "user", content: text, t: 1 }, { role: "assistant", content: "收到", t: 2 }] }) });

const a = await mk("", "SIDEBAR-ALPHA 今天天气怎么样");
const b = await mk("", "深空探测阵列的观测记录");
const idA = a.j.id, idB = b.j.id;

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
const type = async (q) => {
  await ev('(() => { const i = document.getElementById("sessionSearch"); i.value = ' + JSON.stringify(q) + '; i.dispatchEvent(new Event("input", { bubbles: true })); return 1; })()');
  await sleep(900);
};
const snapshot = async () => JSON.parse(await ev('JSON.stringify({ items: [...document.querySelectorAll("#sessionList .sessionItem")].map((x) => ({ id: x.dataset.id, t: x.querySelector(".t")?.textContent || "", snip: x.querySelector(".snip")?.textContent || "", marks: x.querySelectorAll("mark").length })), hint: document.getElementById("sessionSearchHint").textContent, empty: document.querySelector("#sessionList .sideEmpty")?.textContent || "" })'));

await send("Page.enable"); await send("Runtime.enable");
await send("Page.reload", { ignoreCache: true });
await sleep(3200);
const before = await snapshot();
ok("默认列出全部会话", before.items.length >= 2, "items=" + before.items.length);

await type("SIDEBAR-ALPHA");
const s1 = await snapshot();
ok("标题命中只留一条", s1.items.length === 1 && s1.items[0].t.includes("SIDEBAR-ALPHA"), JSON.stringify(s1.items).slice(0, 140));
ok("结果里高亮了匹配词", s1.items[0]?.marks >= 1, "marks=" + s1.items[0]?.marks);
ok("提示条给出匹配数", /1 条匹配/.test(s1.hint), s1.hint);

await ev('document.querySelector("#sessionList .sessionItem").click(); 1');
await sleep(900);
ok("点结果切换到了那个会话", (await ev("sessionId")) === idA, String(await ev("sessionId")));

await type("深空探测");
const s2 = await snapshot();
ok("正文命中也能搜到", s2.items.some((x) => x.id === idB), JSON.stringify(s2.items.map((x) => x.id)));
ok("片段里带正文上下文", s2.items[0]?.snip.includes("深空探测"), s2.items[0]?.snip);

await ev('document.getElementById("sessionSearchClear").click(); 1');
await sleep(600);
const cleared = await snapshot();
const total = (await api("/api/sessions")).j.sessions.length;
ok("✕ 清空后恢复完整列表", cleared.items.length === total && cleared.items.length >= 2, "items=" + cleared.items.length + " total=" + total);
ok("清空后输入框是空的", (await ev('document.getElementById("sessionSearch").value')) === "");

await type("不存在的关键词ZZZ");
const s3 = await snapshot();
ok("无结果给出文案", s3.items.length === 0 && /没有匹配/.test(s3.empty), s3.empty);

await ev('(() => { const i = document.getElementById("sessionSearch"); i.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); return 1; })()');
await sleep(600);
ok("Esc 也能清空", (await ev('document.getElementById("sessionSearch").value')) === "" && (await snapshot()).items.length === total);

await fetch(APP + "/api/sessions/" + idA, { method: "DELETE" });
await fetch(APP + "/api/sessions/" + idB, { method: "DELETE" });
await send("Page.reload", { ignoreCache: true });
await sleep(1500);
ws.close();
console.log("\n== 结果: " + pass + " 通过 / " + fail + " 失败 ==\n");
process.exit(fail ? 1 : 0);

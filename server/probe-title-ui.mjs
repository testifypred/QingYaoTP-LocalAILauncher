/**
 * 标题与侧栏（重写：2026-10-27）
 *
 *   node probe-title-ui.mjs [cdpBase] [apiBase] [shotDir]
 *
 * 顶栏在 10-22 23:48 之后不再有「⋯」菜单（提示词/嗅探/退出都进了设置 → 工具），
 * 旧探针还在找 #moreMenu，于是必崩。这里改成验现在真有的东西：
 * 状态栏在顶栏里、右键菜单五件事、就地改名落盘、Esc 取消。
 */
import WebSocket from "ws";
import fs from "node:fs";

const CDP = process.argv[2] || "http://127.0.0.1:9333";
const BASE = process.argv[3] || "http://127.0.0.1:8099";
const OUT = process.argv[4] || "D:/LocalModels/server/docs/ui-new";

let pass = 0, fail = 0;
const check = (n, c, d = "") => { if (c) { pass++; console.log("ok   " + n + (d ? "  [" + d + "]" : "")); } else { fail++; console.log("FAIL " + n + "  " + d); } };

const tmp = await (await fetch(BASE + "/api/sessions", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ title: "", messages: [{ role: "user", content: "临时会话" }, { role: "assistant", content: "好" }] }),
})).json();

const list = await (await fetch(CDP + "/json/list")).json();
const page = list.find((t) => t.type === "page" && t.url.includes("8099"));
if (!page) { console.log("no page"); process.exit(2); }
const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise((r, j) => { ws.once("open", r); ws.once("error", j); });
let id = 0; const pend = new Map();
ws.on("message", (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text); return r.result?.result?.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await send("Page.enable"); await send("Runtime.enable");
await send("Page.reload", { ignoreCache: true });
await sleep(3000);

const header = await ev("(() => { const s = document.getElementById('status'); const btns = [...document.querySelectorAll('header button')].filter((b) => !b.hidden && b.offsetParent !== null).map((b) => b.textContent.trim() || b.title); return { inHeader: !!s.closest('header'), w: Math.round(s.getBoundingClientRect().width), visibleButtons: btns, hasMore: !!document.getElementById('moreBtn'), renameHidden: document.getElementById('renameBtn').hidden }; })()");
console.log("HEADER", JSON.stringify(header));
check("状态栏在顶栏里", header.inHeader === true);
// 状态栏文案随模型/上下文变（4B 与 7B 的标签不一样），这里只验证「有宽度、没被压成 0」
  check("状态栏拿到宽度", header.w >= 100, "w=" + header.w);
check("顶栏不再有「⋯」菜单按钮", header.hasMore === false);
check("旧的顶栏重命名按钮已隐藏（改名走右键菜单）", header.renameHidden === true);
check("顶栏按钮都可见", header.visibleButtons.length >= 5, header.visibleButtons.join(" / "));

// 打开侧栏里的临时会话
await ev("(() => { const it = document.querySelector('.sessionItem[data-id=\"' + " + JSON.stringify(tmp.id) + " + '\"]'); if (it) it.click(); return !!it; })()");
await sleep(1200);
const opened = await ev("sessionId === " + JSON.stringify(tmp.id));
check("能打开指定会话", opened === true);

// 右键菜单
await ev("(() => { const it = document.querySelector('.sessionItem[data-id=\"' + " + JSON.stringify(tmp.id) + " + '\"]'); it.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 220, clientY: 260 })); return 1; })()");
await sleep(300);
const ctx = JSON.parse(await ev("(() => { const m = document.querySelector('.ctxMenu'); return JSON.stringify(m ? [...m.querySelectorAll('button')].map((b) => b.textContent) : null); })()") || "null");
check("右键菜单出现", Array.isArray(ctx), JSON.stringify(ctx));
check("菜单含重命名 / 导出 / 历史版本 / 清空 / 删除", Array.isArray(ctx) && ctx.length === 5 && ctx[0] === "重命名" && ctx.includes("历史版本…") && ctx.includes("删除"), JSON.stringify(ctx));

// 就地改名
await ev("(() => { const b = [...document.querySelectorAll('.ctxMenu button')].find((x) => x.textContent === '重命名'); b.click(); return 1; })()");
await sleep(300);
const sel = ".sessionItem[data-id=\"" + tmp.id + "\"] .renameInput";
check("点重命名出现输入框", (await ev("!!document.querySelector('" + sel + "')")) === true);
await ev("(() => { const i = document.querySelector('" + sel + "'); i.value = '手动改的标题'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return i.value; })()");
await sleep(900);
const stored = await (await fetch(BASE + "/api/sessions/" + tmp.id)).json();
check("改名落到服务端", stored.title === "手动改的标题" && stored.renamed === true, JSON.stringify({ t: stored.title, r: stored.renamed }));
const shown = await ev("document.querySelector('.sessionItem[data-id=\"' + " + JSON.stringify(tmp.id) + " + '\"] .t').textContent");
check("侧栏标题即时更新", shown === "手动改的标题", shown);

// Esc 取消
await ev("(() => { const it = document.querySelector('.sessionItem[data-id=\"' + " + JSON.stringify(tmp.id) + " + '\"]'); it.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 220, clientY: 260 })); const b = [...document.querySelectorAll('.ctxMenu button')].find((x) => x.textContent === '重命名'); b.click(); return 1; })()");
await sleep(300);
await ev("(() => { const i = document.querySelector('" + sel + "'); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return 1; })()");
await sleep(300);
check("Esc 取消不改动", (await ev("!document.querySelector('" + sel + "')")) === true);
const again = await (await fetch(BASE + "/api/sessions/" + tmp.id)).json();
check("取消后标题还是手动改的那个", again.title === "手动改的标题", again.title);

fs.mkdirSync(OUT, { recursive: true });
const shot = await send("Page.captureScreenshot", { format: "png" });
fs.writeFileSync(OUT + "/header-new.png", Buffer.from(shot.result.data, "base64"));

await fetch(BASE + "/api/sessions/" + tmp.id, { method: "DELETE" });
console.log("\nRESULT " + pass + "/" + (pass + fail));
ws.close();
process.exit(fail ? 1 : 0);

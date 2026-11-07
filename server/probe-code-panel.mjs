/**
 * 代码工作区面板探针（UI，headless Edge 9333）
 *
 *   node probe-code-panel.mjs [base] [cdp]
 *
 * 覆盖：顶栏入口、面板打开、列表加载（空态或已有条目）、POST /api/code/capture 收录 2 个文件、
 *       刷新后列表出现、点文件出标签页 + CodeMirror 有内容、改内容保存后服务端读回一致、
 *       新建列表 +1、运行 python 输出 42 且 exit 0、审查按钮与意图框存在、无模型时点审查出 409 提示、
 *       删除后列表 -1、Esc 关闭；结束时删掉自己建的文件（自复位）。
 * 不加载模型；只操作自己 capture 出来的 code/ 文件。
 */
import WebSocket from "ws";
import fs from "node:fs";

const BASE = process.argv[2] || "http://127.0.0.1:8099";
const CDP = process.argv[3] || "http://127.0.0.1:9333";
const LOG_DIR = "D:/LocalModels/server/docs/feature-code-workspace-2026-11-07/logs";
const PORT = new URL(BASE).port || "8099";
const STAMP = Date.now().toString(36);
const PY_NAME = "probe-py-" + STAMP + ".py";
const JS_NAME = "probe-js-" + STAMP + ".js";
const NEW_NAME = "probe-new-" + STAMP + ".js";
const PY_CODE = 'print("cw probe " + str(40 + 2))';
const JS_CODE = "console.log(40 + 2);";
const JS_SAVED = JS_CODE + "\n// 探针保存标记 " + STAMP;

const api = async (method, p, body) => {
  const r = await fetch(BASE + p, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await r.json(); } catch {}
  return { status: r.status, data };
};

const list = await (await fetch(CDP + "/json/list")).json();
const page = list.find((t) => t.type === "page" && t.url.includes("127.0.0.1:" + PORT));
if (!page) { console.log("no page"); process.exit(2); }
const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise((r, j) => { ws.once("open", r); ws.once("error", j); });
let id = 0; const pend = new Map();
ws.on("message", (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text + " " + (r.result.exceptionDetails.exception?.description || "")); return r.result?.result?.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0, skip = 0;
const check = (n, c, d = "") => { if (c) { pass++; console.log("ok   " + n + (d ? "  [" + d + "]" : "")); } else { fail++; console.log("FAIL " + n + "  " + d); } };

/** 轮询直到表达式为真（或超时），返回最后一次取值 */
const waitFor = async (expr, ms = 8000, step = 250) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await ev(expr)) return true;
    await sleep(step);
  }
  return (await ev(expr)) === true;
};

// 选择器 / 表达式片段：CodeMirror 读值按契约走 .CodeMirror.CodeMirror.getValue()
const q = (sel) => "document.querySelector(" + JSON.stringify(sel) + ")";
const LIST_COUNT = "document.querySelectorAll('#cwList .cwItem[data-path]').length";
const GET_EDITOR = "(() => { const w = document.querySelector('#codeModal .CodeMirror'); if (w && w.CodeMirror) return w.CodeMirror.getValue(); const t = document.getElementById('cwEditor'); return t ? t.value : null; })()";
const itemSel = (p) => "#cwList .cwItem[data-path=" + JSON.stringify(p) + "]";
const tabSel = (p) => "#cwTabs .cwTab[data-path=" + JSON.stringify(p) + "]";
const openFile = (p) => ev("(() => { const el = " + q(itemSel(p)) + "; if (!el) return false; el.click(); return true; })()");
const editorHas = (needle) => "((" + GET_EDITOR + ") || '').includes(" + JSON.stringify(needle) + ")";
const setEditor = (text) => ev("(() => { const w = document.querySelector('#codeModal .CodeMirror'); if (w && w.CodeMirror) { w.CodeMirror.setValue(" + JSON.stringify(text) + "); return true; } const t = document.getElementById('cwEditor'); if (t) { t.value = " + JSON.stringify(text) + "; t.dispatchEvent(new Event('input', { bubbles: true })); return true; } return false; })()");
const click = (elId) => ev("document.getElementById(" + JSON.stringify(elId) + ").click(); 1");

await send("Page.enable"); await send("Runtime.enable");
await send("Page.reload", { ignoreCache: true });
await sleep(3000);

// ---------- 入口 / 打开 / 列表 ----------
check("顶栏有「代码」入口 #codeBtn", (await ev("!!document.getElementById('codeBtn')")) === true, String(await ev("document.getElementById('codeBtn')?.textContent || ''")));
await click("codeBtn");
const opened = await waitFor("!document.getElementById('codeModal').hidden", 6000);
check("点击后 #codeModal 打开", opened === true);
const listReady = await waitFor("(() => { const e = document.getElementById('cwEmpty'); const emptyVisible = !!e && !e.hidden && getComputedStyle(e).display !== 'none'; return emptyVisible || " + LIST_COUNT + " > 0; })()", 8000);
const listState = await ev("(() => { const e = document.getElementById('cwEmpty'); return { empty: !!e && !e.hidden, count: " + LIST_COUNT + " }; })()");
check("代码列表已加载（空态或已有条目）", listReady === true, JSON.stringify(listState));

// ---------- capture 造 2 个文件，刷新列表后出现 ----------
const cap = await api("POST", "/api/code/capture", {
  files: [{ name: PY_NAME, content: PY_CODE }, { name: JS_NAME, content: JS_CODE }],
});
const saved = Array.isArray(cap.data?.saved) ? cap.data.saved : [];
check("capture 收录 2 个文件（200）", cap.status === 200 && cap.data?.ok === true && saved.length === 2, "HTTP " + cap.status + " saved=" + saved.length);
const pathOf = (name) => (saved.find((x) => x.name === name) || {}).path || "code/" + name;
const pyPath = pathOf(PY_NAME);
const jsPath = pathOf(JS_NAME);
const newPath = "code/" + NEW_NAME;

await click("cwRefresh");
const hasPy = await waitFor("!!" + q(itemSel(pyPath)), 10000);
check("刷新后 python 文件出现在列表", hasPy === true, pyPath);
const hasJs = await waitFor("!!" + q(itemSel(jsPath)), 10000);
check("刷新后 js 文件出现在列表", hasJs === true, jsPath);

// ---------- 点文件 → 标签页 + 编辑器内容 ----------
await openFile(pyPath);
const hasTab = await waitFor("!!" + q(tabSel(pyPath)), 10000);
check("点文件后出现 .cwTab[data-path]", hasTab === true, pyPath);
const loadedPy = await waitFor(editorHas("40 + 2"), 10000);
const editorVal = await ev(GET_EDITOR);
check("CodeMirror 载入文件内容", loadedPy === true, "len=" + String(editorVal || "").length + " 内容=" + JSON.stringify(String(editorVal || "").slice(0, 40)));

// ---------- 改内容 → 保存 → 服务端读回一致 ----------
await openFile(jsPath);
const jsLoaded = await waitFor(editorHas("console.log(40 + 2)"), 10000);
const setOk = await setEditor(JS_SAVED);
await sleep(250);
await click("cwSave");
let rb = null;
for (let i = 0; i < 40; i++) {
  rb = await api("GET", "/api/workspace/read?path=" + encodeURIComponent(jsPath));
  if (rb.status === 200 && rb.data?.content === JS_SAVED) break;
  await sleep(200);
}
check("改内容 → #cwSave → 服务端读回一致", jsLoaded === true && setOk === true && rb?.status === 200 && rb?.data?.content === JS_SAVED, "HTTP " + rb?.status + " len=" + String(rb?.data?.content || "").length);

// ---------- 新建 → 列表 +1 ----------
const beforeNew = await ev(LIST_COUNT);
await ev("(() => { const i = document.getElementById('cwNewName'); i.value = " + JSON.stringify(NEW_NAME) + "; i.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()");
await click("cwNew");
const grew = await waitFor(LIST_COUNT + " === " + (beforeNew + 1), 10000);
const afterNew = await ev(LIST_COUNT);
check("#cwNew 新建后列表 +1", grew === true && afterNew === beforeNew + 1, beforeNew + " -> " + afterNew);
const newRead = await api("GET", "/api/workspace/read?path=" + encodeURIComponent(newPath));
check("新建文件已落盘（服务端可读）", newRead.status === 200, "HTTP " + newRead.status);

// ---------- 运行 python ----------
await openFile(pyPath);
await waitFor(editorHas("40 + 2"), 10000);
await click("cwRun");
let runText = "";
for (let i = 0; i < 40; i++) {
  await sleep(300);
  const out = await ev("(() => { const o = document.getElementById('cwOutput'); return o ? { hidden: o.hidden, text: o.textContent || '' } : null; })()");
  runText = out?.text || "";
  if (/cw probe 42/.test(runText)) break;
}
check("#cwRun 运行 python 输出「cw probe 42」", /cw probe 42/.test(runText), runText.slice(0, 80).replace(/\s+/g, " "));
check("运行结果带 exit 0", /exit 0/.test(runText), runText.slice(0, 48).replace(/\s+/g, " "));

// ---------- 审查按钮 / 意图框 / 无模型 409 ----------
const reviewNodes = await ev("!!(document.getElementById('cwReview') && document.getElementById('cwIntent'))");
check("#cwReview 与 #cwIntent 存在", reviewNodes === true);
const state = (await api("GET", "/api/state")).data || {};
const model = String(state.loaded || "");
if (!model) {
  await click("cwReview");
  let hint = "";
  for (let i = 0; i < 32; i++) {
    await sleep(250);
    hint = await ev("(() => { const t = document.getElementById('toasts'); const b = document.getElementById('cwReviewBody'); return ((t ? t.textContent : '') + ' ' + (b ? b.textContent : '')).trim(); })()");
    if (/模型/.test(hint)) break;
  }
  check("无模型时点审查出现 409 提示", /模型/.test(hint), hint.slice(0, 80));
} else {
  skip++;
  console.log("  skip 无模型 409 断言（当前已加载 " + model + "）");
}

// 证据截图（面板 + 文件 + 运行输出）
try {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const shot = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(LOG_DIR + "/code-panel-" + STAMP + ".png", Buffer.from(shot.result.data, "base64"));
  console.log("  截图: " + LOG_DIR + "/code-panel-" + STAMP + ".png");
} catch (e) {
  console.log("  截图失败: " + String(e?.message ?? e));
}

// ---------- 删除 → 列表 -1 ----------
await openFile(jsPath);
await waitFor(editorHas("console.log(40 + 2)"), 10000);
const beforeDel = await ev(LIST_COUNT);
await ev("window.confirm = () => true; 1");
await click("cwDelete");
const dropped = await waitFor(LIST_COUNT + " === " + (beforeDel - 1), 10000);
const afterDel = await ev(LIST_COUNT);
const goneRead = await api("GET", "/api/workspace/read?path=" + encodeURIComponent(jsPath));
check("删除后列表 -1 且文件读不到", dropped === true && (goneRead.status === 400 || goneRead.status === 404), beforeDel + " -> " + afterDel + " HTTP " + goneRead.status);

// ---------- Esc 关闭 ----------
await ev("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); 1");
const closed = await waitFor("document.getElementById('codeModal').hidden === true", 5000);
check("Esc 关闭 #codeModal", closed === true);

// ---------- 自复位：删掉自己建的文件 ----------
for (const p of [pyPath, newPath, jsPath]) await api("POST", "/api/workspace/delete", { path: p }).catch(() => null);
const left = [];
for (const p of [pyPath, newPath, jsPath]) {
  const r = await api("GET", "/api/workspace/read?path=" + encodeURIComponent(p));
  if (!(r.status === 400 || r.status === 404)) left.push(p + ":" + r.status);
}
try { await ev("(() => { try { localStorage.removeItem('localai.cwOpen'); localStorage.removeItem('localai.cwIntent'); } catch {} return 1; })()"); } catch {}
check("自复位：探针创建的文件已全部删除", left.length === 0, left.join(",") || "clean");

console.log("\nRESULT " + pass + "/" + (pass + fail) + (skip ? "（跳过 " + skip + " 条）" : ""));
ws.close(); process.exit(fail ? 1 : 0);

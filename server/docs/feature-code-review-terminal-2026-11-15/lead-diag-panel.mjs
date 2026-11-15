import WebSocket from "ws";
const CDP = "http://127.0.0.1:9333";
const APP = "http://127.0.0.1:8099";
const targets = await (await fetch(CDP + "/json")).json();
const page = targets.find((t) => t.type === "page" && t.url.includes("8099"));
const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise((r) => ws.once("open", r));
let seq = 0; const pend = new Map();
ws.on("message", (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const cmd = (method, params = {}) => new Promise((res) => { const id = ++seq; pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expr) => { const r = await cmd("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) return "ERR:" + JSON.stringify(r.result.exceptionDetails).slice(0, 200); return r.result?.result?.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);
await cmd("Page.enable"); await cmd("Runtime.enable");
await sleep(500);
log("open camera: " + await ev("document.getElementById('codeBtn').click(); 1"));
await sleep(1200);
// 语言选 js、建文件
log("newlang: " + await ev("(() => { const s = document.getElementById('cwNewLang'); s.value='js'; s.dispatchEvent(new Event('change',{bubbles:true})); return s.value; })()"));
await sleep(200);
log("create: " + await ev("(() => { const n = document.getElementById('cwNewName'); n.value='lead-diag'; document.getElementById('cwNew').click(); return n.value; })()"));
await sleep(1500);
const code = "function add(a,b){\n  return a - b;\n}\nconst r = add(2,3);\nconsole.log(r);\n";
log("setCode: " + await ev("(() => { const cm = document.querySelector('#cwEditor'); return cm ? 'ta' : 'cm'; })()"));
// 用 CodeMirror API 写入
log("write: " + await ev("(() => { const w = window; if (w.cwCM) { w.cwCM.setValue(" + JSON.stringify(code) + "); return 'cm'; } const ta = document.getElementById('cwEditor'); if (ta) { ta.value = " + JSON.stringify(code) + "; return 'ta'; } return 'none'; })()"));
await sleep(300);
log("click review: " + await ev("document.getElementById('cwReview').click(); 1"));
let state = "";
for (let i = 0; i < 90; i++) {
  await sleep(1000);
  state = String(await ev("(document.getElementById('cwReviewState')||{}).textContent || ''"));
  if (/审查完成|审查失败/.test(state)) break;
}
await sleep(800);
const dump = await ev("'JSON: ' + JSON.stringify({ state: (document.getElementById('cwReviewState')||{}).textContent, issuesCount: document.querySelectorAll('#cwIssues .cwIssue').length, issuesHTMLlen: (document.getElementById('cwIssues')||{}).innerHTML.length, err: document.querySelectorAll('#codeModal .cwLineErr').length, cards: [...document.querySelectorAll('#cwIssues .cwIssue')].map(c => c.getAttribute('data-line') + ':' + c.getAttribute('data-severity')) })");
log(String(dump).slice(0, 600));
log("sendchat: " + await ev("document.getElementById('cwSendChat').click(); 1"));
await sleep(500);
const q = await ev("'Q:' + JSON.stringify({ len: (document.getElementById('q')||{}).value.length, hasFence: (document.getElementById('q')||{}).value.includes(String.fromCharCode(96).repeat(3)), head: (document.getElementById('q')||{}).value.slice(0, 40), tail: (document.getElementById('q')||{}).value.slice(-30) })");
log(String(q).slice(0, 600));
// 清理
await ev("(() => { const q = document.getElementById('q'); if (q) q.value=''; const n = document.getElementById('cwNewName'); return 1; })()");
await cmd("Page.reload", { ignoreCache: false });
ws.close();

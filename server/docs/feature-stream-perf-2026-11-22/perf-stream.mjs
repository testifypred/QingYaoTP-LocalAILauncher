// 校验新流式渲染的块切分与最终公式（修正指标：直接数 head 子节点）
const CDP = "http://127.0.0.1:9333";
const BASE = process.argv[2] || "http://127.0.0.1:8199/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BT = "\u0060";
const FENCE = BT + BT + BT;
function expression() {
  const block = [
    "## 小结", "",
    "正文里有 $x^2+y^2=z^2$，还有 **粗体** 与 " + BT + "code" + BT + "。", "",
    "$$\\int_0^1 x^2\\,dx=\\frac{1}{3}$$", "",
    "- 列表项一", "- 列表项二", "",
    FENCE + "js", "const a = 1;", FENCE, "", "",
  ].join("\n");
  const L = [];
  L.push("(() => {");
  L.push("  const block = " + JSON.stringify(block) + ";");
  L.push("  let text = ''; while (text.length < 6000) text += block; text = text.slice(0, 6000);");
  L.push("  const out = {};");
  L.push("  const d1 = document.createElement('div'); d1.style.cssText='position:absolute;left:-9999px;width:760px'; document.body.appendChild(d1);");
  L.push("  const d2 = document.createElement('div'); d2.style.cssText='position:absolute;left:-9999px;width:760px'; document.body.appendChild(d2);");
  L.push("  const frames = 200;");
  L.push("  const view = createStreamView(d1);");
  L.push("  let t0 = performance.now();");
  L.push("  for (let i = 1; i <= frames; i++) view.update(text.slice(0, Math.floor(text.length * i / frames)));");
  L.push("  out.newUpdateMs = +(((performance.now() - t0) / frames).toFixed(2));");
  L.push("  const head = d1.firstElementChild;");
  L.push("  out.headChildren = head ? head.children.length : -1;");
  L.push("  out.tailLen = d1.lastElementChild ? d1.lastElementChild.textContent.length : -1;");
  L.push("  t0 = performance.now();");
  L.push("  for (let i = 1; i <= frames; i++) renderAssistant(d2, text.slice(0, Math.floor(text.length * i / frames)));");
  L.push("  out.oldFullMs = +(((performance.now() - t0) / frames).toFixed(2));");
  L.push("  view.finish(text);");
  L.push("  out.finalKatex = d1.querySelectorAll('.katex').length;");
  L.push("  out.finalChildren = d1.children.length;");
  L.push("  d1.remove(); d2.remove();");
  L.push("  return out;");
  L.push("})()");
  return L.join("\n");
}
async function main() {
  for (let i = 0; i < 60; i += 1) { try { await fetch(CDP + "/json/version"); break; } catch {} await sleep(250); }
  const list = await (await fetch(CDP + "/json/list")).json();
  const page = list.find((t) => t.type === "page") || list[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map(); const errors = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === "Runtime.exceptionThrown") errors.push(String(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 300));
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
  };
  const send = (method, params) => new Promise((res, rej) => { id += 1; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
  await send("Runtime.enable"); await send("Page.enable");
  await send("Page.navigate", { url: BASE });
  let ready = false;
  for (let i = 0; i < 80; i += 1) { await sleep(250); const r = await send("Runtime.evaluate", { expression: "document.readyState + '|' + typeof createStreamView", returnByValue: true }); if (String(r.result.value).startsWith("complete|function")) { ready = true; break; } }
  console.log("ready=" + ready + " errors=" + JSON.stringify(errors));
  if (!ready) process.exit(2);
  const r = await send("Runtime.evaluate", { expression: expression(), returnByValue: true });
  console.log(JSON.stringify(r.result.value, null, 2));
  ws.close();
}
main().catch((e) => { console.error("perf-stream: " + (e && e.message)); process.exit(1); });

// 为什么主页面慢于终端：B) 浏览器每帧整段重渲染的成本（renderMarkdown + KaTeX）
const CDP = "http://127.0.0.1:9333";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BT = "\u0060";
const FENCE = BT + BT + BT;

function pageExpression() {
  const chunk = [
    "## 小结",
    "",
    "这一段的正文里有一个行内公式 $x^2+y^2=z^2$，还有 **粗体** 与 " + BT + "code" + BT + "。",
    "",
    "$$\\int_0^1 x^2\\,dx=\\frac{1}{3}$$",
    "",
    "- 列表项一",
    "- 列表项二",
    "",
    FENCE + "js",
    "const a = 1;",
    FENCE,
    "",
    "",
  ].join("\n");
  const L = [];
  L.push("(() => {");
  L.push("  const chunk = " + JSON.stringify(chunk) + ";");
  L.push("  const mk = (n) => { let s = ''; while (s.length < n) s += chunk; return s.slice(0, n); };");
  L.push("  const div = document.createElement('div');");
  L.push("  div.style.cssText = 'position:absolute;left:-9999px;top:0;width:760px';");
  L.push("  document.body.appendChild(div);");
  L.push("  const out = { markdown: {}, assistant: {} };");
  L.push("  for (const n of [800, 3000, 8000]) {");
  L.push("    const text = mk(n);");
  L.push("    renderMarkdown(text); renderAssistant(div, text);");
  L.push("    let t0 = performance.now();");
  L.push("    for (let i = 0; i < 5; i += 1) renderMarkdown(text);");
  L.push("    out.markdown[n] = +(((performance.now() - t0) / 5).toFixed(2));");
  L.push("    t0 = performance.now();");
  L.push("    for (let i = 0; i < 5; i += 1) renderAssistant(div, text);");
  L.push("    out.assistant[n] = +(((performance.now() - t0) / 5).toFixed(2));");
  L.push("  }");
  L.push("  div.remove();");
  L.push("  return out;");
  L.push("})()");
  return L.join("\n");
}

async function main() {
  for (let i = 0; i < 60; i += 1) {
    try { await fetch(CDP + "/json/version"); break; } catch {}
    await sleep(250);
  }
  const list = await (await fetch(CDP + "/json/list")).json();
  const page = list.find((t) => t.type === "page") || list[0];
  if (!page) throw new Error("没有可用的 page 目标");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
    }
  };
  const send = (method, params) => new Promise((res, rej) => {
    id += 1;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.navigate", { url: "http://127.0.0.1:8099/" });
  let ready = false;
  for (let i = 0; i < 60; i += 1) {
    await sleep(300);
    const r = await send("Runtime.evaluate", { expression: "document.readyState + '|' + (typeof renderAssistant)", returnByValue: true });
    if (String(r.result.value).startsWith("complete|function")) { ready = true; break; }
  }
  if (!ready) throw new Error("页面没就绪");
  const r = await send("Runtime.evaluate", { expression: pageExpression(), returnByValue: true, awaitPromise: true });
  console.log(JSON.stringify(r.result.value, null, 2));
  ws.close();
}
main().catch((e) => { console.error("perf-render: " + (e && e.message)); process.exit(1); });

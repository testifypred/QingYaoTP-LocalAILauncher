// 极简流式：生成中只追加纯文本，结束后套 Markdown
const CDP = "http://127.0.0.1:9333";
const BASE = "http://127.0.0.1:8099/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function expr() {
  const L = [];
  L.push("(async () => {");
  L.push("  const out = {};");
  L.push("  const st = JSON.parse(localStorage.getItem('localai.settings') || '{}');");
  L.push("  st.streamLite = true; localStorage.setItem('localai.settings', JSON.stringify(st));");
  L.push("  location.reload();");
  L.push("  return 'reloading';");
  L.push("})()");
  return L.join("\n");
}
function expr2() {
  const L = [];
  L.push("(async () => {");
  L.push("  const out = {};");
  L.push("  out.liteSetting = JSON.parse(localStorage.getItem('localai.settings') || '{}').streamLite === true;");
  L.push("  const t0 = performance.now();");
  L.push("  send('用三行要点说明 KV 缓存为什么能加速多轮对话，其中一行加粗');");
  L.push("  let midMarkup = false, firstText = 0, finalLen = 0;");
  L.push("  for (let i = 0; i < 400; i += 1) {");
  L.push("    await new Promise((r) => setTimeout(r, 100));");
  L.push("    const rows = document.querySelectorAll('#msgs .row');");
  L.push("    const row = rows[rows.length - 1];");
  L.push("    const bubble = row ? row.querySelector('.bubble') : null;");
  L.push("    const len = bubble ? bubble.textContent.length : 0;");
  L.push("    if (len > 0 && !firstText) firstText = performance.now() - t0;");
  L.push("    const stop = document.querySelector('#stopBtn');");
  L.push("    const running = stop && !stop.hidden;");
  L.push("    if (running && bubble && /<(strong|b|code|li|h[1-6])/i.test(bubble.innerHTML)) midMarkup = true;");
  L.push("    finalLen = len;");
  L.push("    if (!running) break;");
  L.push("  }");
  L.push("  const rows = document.querySelectorAll('#msgs .row');");
  L.push("  const last = rows[rows.length - 1];");
  L.push("  const bubble = last ? last.querySelector('.bubble') : null;");
  L.push("  out.firstTextMs = Math.round(firstText || 0);");
  L.push("  out.midMarkup = midMarkup;");
  L.push("  out.finalLen = finalLen;");
  L.push("  out.finalMarkup = !!bubble && /<(strong|b|code|li|h[1-6])/i.test(bubble.innerHTML);");
  L.push("  // 用完恢复默认，别影响后续探针");
  L.push("  const st = JSON.parse(localStorage.getItem('localai.settings') || '{}'); st.streamLite = false;");
  L.push("  localStorage.setItem('localai.settings', JSON.stringify(st));");
  L.push("  return out;");
  L.push("})()");
  return L.join("\n");
}
async function main() {
  for (let i = 0; i < 60; i += 1) { try { await fetch(CDP + "/json/version"); break; } catch {} await sleep(250); }
  const list = await (await fetch(CDP + "/json/list")).json();
  const page = list.find((t) => t.type === "page" && /127\.0\.0\.1:8099/.test(t.url)) || list.find((t) => t.type === "page");
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
  await sleep(2500);
  await send("Runtime.evaluate", { expression: expr(), returnByValue: true });
  // 等页面 reload 完 + 应用启动完（会话列表/模型状态加载），否则 send() 会因为 loaded=false 直接返回
  for (let i = 0; i < 40; i += 1) {
    await sleep(250);
    const r = await send("Runtime.evaluate", { expression: "document.readyState + '|' + typeof send + '|' + !!document.querySelector('#q')", returnByValue: true });
    if (String(r.result.value) === "complete|function|true") break;
  }
  await sleep(1500);
  const r = await send("Runtime.evaluate", { expression: expr2(), returnByValue: true, awaitPromise: true });
  console.log(JSON.stringify(r.result.value, null, 2));
  console.log("exceptions=" + JSON.stringify(errors));
  ws.close();
}
main().catch((e) => { console.error("perf-lite: " + (e && e.message)); process.exit(1); });

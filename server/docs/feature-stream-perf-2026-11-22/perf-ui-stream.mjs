// 端到端：真实发一条消息，量首字/增量平滑度 + 新模式 chip / 极简流式开关是否存在
const CDP = "http://127.0.0.1:9333";
const BASE = "http://127.0.0.1:8099/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function expr() {
  const L = [];
  L.push("(async () => {");
  L.push("  const out = {};");
  L.push("  out.hasChip = !!document.querySelector('#genModeChip');");
  L.push("  out.hasLite = !!document.querySelector('#setStreamLite');");
  L.push("  const chip = document.querySelector('#genModeChip');");
  L.push("  out.chipHiddenIdle = chip ? chip.hidden : null;");
  L.push("  const tk = document.querySelector('#toolChk');");
  L.push("  tk.click(); updateModeChip();");
  L.push("  out.chipTextToolsOn = chip ? chip.textContent : '';");
  L.push("  tk.click(); updateModeChip();");
  L.push("  out.chipHiddenAfter = chip ? chip.hidden : null;");
  L.push("  const t0 = performance.now();");
  L.push("  send('用三行要点说明 KV 缓存为什么能加速多轮对话');");
  L.push("  let firstTextAt = 0, growths = 0, lastLen = 0, samples = 0;");
  L.push("  for (let i = 0; i < 400; i += 1) {");
  L.push("    await new Promise((r) => setTimeout(r, 100));");
  L.push("    const rows = document.querySelectorAll('#msgs .row');");
  L.push("    const row = rows[rows.length - 1];");
  L.push("    const bubble = row ? row.querySelector('.bubble') : null;");
  L.push("    const len = bubble ? bubble.textContent.length : 0;");
  L.push("    if (len > 0 && !firstTextAt) firstTextAt = performance.now() - t0;");
  L.push("    if (len > lastLen) { growths += 1; lastLen = len; }");
  L.push("    samples += 1;");
  L.push("    const stop = document.querySelector('#stopBtn');");
  L.push("    if (stop && stop.hidden) break;");
  L.push("  }");
  L.push("  const rows = document.querySelectorAll('#msgs .row');");
  L.push("  const last = rows[rows.length - 1];");
  L.push("  const bubble = last ? last.querySelector('.bubble') : null;");
  L.push("  out.firstTextMs = Math.round(firstTextAt || 0);");
  L.push("  out.samples = samples;");
  L.push("  out.growths = growths;");
  L.push("  out.finalLen = lastLen;");
  L.push("  out.hasMarkup = !!bubble && /<(strong|b|code|li|h[1-6])/i.test(bubble.innerHTML);");
  L.push("  out.streamingClass = !!(last && last.classList.contains('streaming'));");
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
  for (let i = 0; i < 80; i += 1) { await sleep(250); const r = await send("Runtime.evaluate", { expression: "document.readyState + '|' + typeof send + '|' + typeof updateModeChip", returnByValue: true }); if (String(r.result.value).startsWith("complete|function|function")) { ready = true; break; } }
  console.log("ready=" + ready);
  if (!ready) process.exit(2);
  const r = await send("Runtime.evaluate", { expression: expr(), returnByValue: true, awaitPromise: true });
  console.log(JSON.stringify(r.result.value, null, 2));
  console.log("exceptions=" + JSON.stringify(errors));
  ws.close();
}
main().catch((e) => { console.error("perf-ui: " + (e && e.message)); process.exit(1); });

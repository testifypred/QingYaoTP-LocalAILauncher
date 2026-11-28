/**
 * 工具调用 UI 探针：勾选「调用工具」→ 发问 → 工具卡片 → 正文 → 重新加载后卡片仍在。
 *
 *   node probe-ui-tools.mjs [cdpBase] [appBase] [shotDir]
 *
 * 前置：目标服务已加载一个支持工具调用的模型（如 qwen2.5-7b），且 workspace\note.txt 存在。
 */
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const CDP = process.argv[2] || "http://127.0.0.1:9333";
const APP = process.argv[3] || "http://127.0.0.1:8096";
const OUT = process.argv[4] || "D:/LocalModels/server/docs/ui-new";

let pass = 0;
let fail = 0;
function ok(name, cond, extra = "") {
  if (cond) { pass += 1; console.log(`  ✅ ${name}${extra ? " — " + extra : ""}`); }
  else { fail += 1; console.log(`  ❌ ${name}${extra ? " — " + extra : ""}`); }
}

const targets = await (await fetch(`${CDP}/json`)).json();
const page = targets.find((t) => t.type === "page" && t.url.includes(APP.replace(/^https?:\/\//, "")));
if (!page) { console.log("没找到页面目标"); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
await new Promise((r) => ws.addEventListener("open", r));
const cmd = (method, params) =>
  new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (x) => {
  const r = await cmd("Runtime.evaluate", { expression: x, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? "eval failed");
  return r.result?.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await cmd("Page.enable");
await mkdir(OUT, { recursive: true });
async function shot(name) {
  const r = await cmd("Page.captureScreenshot", { format: "png" });
  await writeFile(path.join(OUT, `ui-${name}.png`), Buffer.from(r.result.data, "base64"));
  console.log("    截图:", path.join(OUT, `ui-${name}.png`));
}

await cmd("Page.reload", { ignoreCache: true });
await sleep(4000);

console.log("\n== A. 前置 ==");
{
  const st = JSON.parse(await ev(`JSON.stringify({
    loaded: loaded,
    chkExists: !!document.getElementById('toolChk'),
    chkDisabled: document.getElementById('toolChk').disabled,
  })`));
  ok("模型已加载", !!st.loaded, String(st.loaded));
  ok("「调用工具」可勾选", st.chkExists && st.chkDisabled === false);
  if (!st.loaded) { console.log("   （需要先在服务端加载模型）"); process.exit(1); }
}

console.log("\n== B. 发一轮需要工具的问题 ==");
{
  await ev(`newChat()`);
  await sleep(600);
  await ev(`(() => { const c = document.getElementById('toolChk'); c.checked = true; c.dispatchEvent(new Event('change')); return c.checked; })()`);
  ok("已勾选调用工具", (await ev(`document.getElementById('toolChk').checked`)) === true);

  await ev(`(() => { const q = document.getElementById('q'); q.value = '现在几点了？请用工具查，不要猜。'; q.dispatchEvent(new Event('input')); document.getElementById('send').click(); return 1; })()`);
  console.log("    已发送，等待工具执行与回答…");

  let cards = 0;
  let bubble = "";
  let waited = 0;
  for (;;) {
    await sleep(2000);
    waited += 2;
    const st = JSON.parse(await ev(`(() => {
      const row = [...document.querySelectorAll('#msgs .row.assistant')].pop();
      const b = row ? row.querySelector('.bubble') : null;
      return JSON.stringify({
        cards: document.querySelectorAll('#msgs .tool').length,
        bubble: b ? b.textContent : '',
        sendDisabled: document.getElementById('send').disabled,
        status: document.getElementById('statusText').textContent,
      });
    })()`));
    cards = st.cards;
    bubble = st.bubble;
    if (cards > 0 && !st.sendDisabled && bubble && !bubble.includes('…')) break;
    if (waited > 180) break;
  }
  ok("界面上出现了工具卡片", cards >= 1, `${cards} 张，用时 ${waited}s`);
  ok("回答正文非空", bubble.trim().length > 6, bubble.slice(0, 60));
  ok("正文里没有原始调用块", !bubble.includes('<tool_call>'), bubble.slice(0, 40));
  ok("回答里带上了真实时间", /20\d\d/.test(bubble), bubble.slice(0, 40));

  const card = JSON.parse(await ev(`(() => {
    const el = document.querySelector('#msgs .tool');
    if (!el) return '{}';
    return JSON.stringify({ text: el.textContent, name: el.querySelector('b') ? el.querySelector('b').textContent : '' });
  })()`));
  ok("卡片标了工具名", (card.name || '').includes('get_current_time'), card.name);
  ok("卡片里有输入与结果", (card.text || '').includes('输入') && (card.text || '').includes('结果'), (card.text || '').slice(0, 70));

  const stats = await ev(`(() => { const s = [...document.querySelectorAll('#msgs .stats')].pop(); return s ? s.textContent : ''; })()`);
  ok("指标行含工具耗时/次数", /工具\s*\d/.test(stats), stats.slice(0, 80));
  await shot("16-tools-agent");
}

console.log("\n== C. 刷新后工具卡片仍在（存档）==");
{
  // 刷新前先等「助手消息真正落盘」：app.html 存对话是 400ms 防抖 + PUT（saveTranscript），
  // 生成刚结束就 Page.reload，导航会取消防抖计时器 → 会话里只剩 user 那条（v1.11.2 全量实测复现）。
  // 轮询 /api/sessions/<id> 直到出现 assistant 消息（最多 10s）；超时则照旧刷新，C 段红了即说明存盘窗口真的丢了。
  const sid0 = await ev("localStorage.getItem('localai.lastSession') || ''");
  let persisted = false;
  for (let i = 0; i < 40 && sid0; i++) {
    try {
      const s = await (await fetch(`${APP}/api/sessions/${encodeURIComponent(sid0)}`)).json();
      if ((s.messages || []).some((m) => m.role === "assistant")) { persisted = true; break; }
    } catch {}
    await sleep(250);
  }
  if (!persisted) console.log("  ! 等落盘超时（10s），继续刷新（若 C 段红＝存盘窗口真的丢了）");
  await cmd("Page.reload", { ignoreCache: true });
  await sleep(4200);
  // 10-24 起启动页固定是新对话，最近一条只放在右下角卡片上：不点它，刷新后就是空页面
  await ev("(() => { const r = document.getElementById('recentWrap'); if (r && !r.hidden) { document.getElementById('recentOpen').click(); return 1; } return 0; })()");
  await sleep(1600);
  const st = JSON.parse(await ev(`JSON.stringify({
    cards: document.querySelectorAll('#msgs .tool').length,
    bubble: (() => { const r = [...document.querySelectorAll('#msgs .row.assistant')].pop(); const b = r && r.querySelector('.bubble'); return b ? b.textContent : ''; })(),
  })`));
  ok("刷新后工具卡片被恢复", st.cards >= 1, st.cards + " 张");
  ok("刷新后正文被恢复", st.bubble.trim().length > 6, st.bubble.slice(0, 50));
}

console.log(`\n== 结果: ${pass} 通过 / ${fail} 失败 ==\n`);
ws.close();
process.exit(fail ? 1 : 0);

/**
 * 界面端「@ 第二意见」全链路探针：会真的发一轮对话（约 40-90 秒）。
 *
 *   node probe-ui-second.mjs [cdpBase] [shotDir]
 *
 * 断言：主回答出现 → 第二意见行出现并能换模型作答 → 标签被清空 → 主模型仍就绪。
 */
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const CDP = process.argv[2] || "http://127.0.0.1:9333";
const OUT = process.argv[3] || "D:/LocalModels/server/docs/ui-new";
const SECOND = "Phi-4-mini-instruct-Q4_K_M.gguf";
const QUESTION = "用两句话解释什么是 KV 缓存。";

let pass = 0;
let fail = 0;
function ok(name, cond, extra = "") {
  if (cond) { pass += 1; console.log(`  ✅ ${name}${extra ? " — " + extra : ""}`); }
  else { fail += 1; console.log(`  ❌ ${name}${extra ? " — " + extra : ""}`); }
}

const list = await (await fetch(`${CDP}/json`)).json();
const page = list.find((t) => t.type === "page" && t.url.includes("127.0.0.1:8098"));
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
  new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("超时 " + method)); }, 30000);
    pending.set(id, (m) => { clearTimeout(timer); resolve(m); });
    ws.send(JSON.stringify({ id, method, params }));
  });
const ev = async (expression) => {
  const r = await cmd("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text);
  return r.result?.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await mkdir(OUT, { recursive: true });
async function shot(name) {
  const r = await cmd("Page.captureScreenshot", { format: "png" });
  const p = path.join(OUT, `ui-${name}.png`);
  await writeFile(p, Buffer.from(r.result.data, "base64"));
  console.log("    截图:", p);
}

// 干净起步：点「新对话」（懒建会话，真正发第一句时才落盘）
console.log("\n== 准备 ==");
await ev(`newChat()`);
await sleep(800);
ok("起始为空对话（未落盘）", (await ev(`sessionId`)) === null, String(await ev(`sessionId`)));

const loaded = await ev(`loaded`);
console.log("    当前加载模型:", loaded);
if (!loaded) {
  console.log("  ❌ 没有已加载的模型，先跑 probe-second-opinion 或用 /api/load 加载一个");
  process.exit(1);
}

// 选一个不是当前的模型
await ev(`document.getElementById('atBtn').click()`);
await sleep(300);
const picked = await ev(`(() => {
  const b = [...document.querySelectorAll('#atMenu .atItem')].find(x => !x.disabled && x.textContent.includes('Phi-4'));
  if (!b) return null;
  b.click();
  document.body.click();
  return b.textContent;
})()`);
ok("已选中 Phi-4 作为第二意见", !!picked, String(picked).replace(/\s+/g, " ").trim());

// 发问
await ev(`(() => { const q = document.getElementById('q'); q.value = ${JSON.stringify(QUESTION)}; q.dispatchEvent(new Event('input')); document.getElementById('send').click(); return q.value; })()`);
console.log("    已发送，等待主回答 + 第二意见（最长 180 秒）…");

// 等第二意见行「收工」：不再有 streaming 类，且发送按钮恢复可用
let secondText = "";
let waited = 0;
for (;;) {
  await sleep(2000);
  waited += 2;
  const st = JSON.parse(await ev(`(() => {
    const rows = [...document.querySelectorAll('.row.assistant.second')];
    const r = rows[rows.length - 1];
    return JSON.stringify({
      has: !!r,
      streaming: r ? r.classList.contains('streaming') : false,
      text: r && r.querySelector('.bubble') ? r.querySelector('.bubble').textContent : '',
      sendDisabled: document.getElementById('send').disabled,
    });
  })()`));
  if (st.has && !st.streaming && !st.sendDisabled) { secondText = st.text; break; }
  if (waited > 240) { secondText = st.text; break; }
}
ok("第二意见消息已渲染", secondText.length > 8, `${waited}s, ${secondText.length} 字: ${secondText.slice(0, 50)}`);

const state = JSON.parse(await ev(`JSON.stringify({
  who: [...document.querySelectorAll('.row.assistant.second .who')].map(x => x.textContent),
  hasSpeak: !!document.querySelector('.row.assistant.second .stats .speak'),
  chips: document.querySelectorAll('#askChips .chip').length,
  atOn: document.getElementById('atBtn').classList.contains('on'),
  busy: document.getElementById('send').disabled,
  loaded: loaded,
  status: document.getElementById('statusText').textContent,
  transcript: (window.transcript || []).length,
})`));
ok("第二意见行标了模型名", state.who.some((w) => w.includes("第二意见")), state.who.join(" / "));
ok("第二意见有朗读按钮", state.hasSpeak);
ok("发完后标签被清空", state.chips === 0 && state.atOn === false);
ok("发完后输入框恢复可用", state.busy === false);
ok("状态栏是正常模型信息", state.status.length > 0, state.status.slice(0, 60));
ok("发完第一句后会话已落盘", (await ev(`!!sessionId`)) === true, await ev(`sessionId`));
ok("主模型没被换掉", state.loaded === loaded, state.loaded);

// 存档里应该有这条第二意见
const inStore = await ev(`(async () => {
  const s = await (await fetch('/api/sessions/' + sessionId)).json();
  return JSON.stringify((s.messages || []).map(m => [m.role, m.kind || '', (m.content || '').length]));
})()`);
ok("第二意见已写进会话存档", inStore.includes('"second"'), inStore);

await ev(`document.getElementById('msgs').scrollTop = document.getElementById('msgs').scrollHeight`);
await sleep(400);
await shot("8-second-opinion");

console.log(`\n== 结果: ${pass} 通过 / ${fail} 失败 ==\n`);
ws.close();
process.exit(fail ? 1 : 0);

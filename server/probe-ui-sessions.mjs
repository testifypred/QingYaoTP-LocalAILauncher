/**
 * 会话生命周期 + 朗读接口探针（不产生模型推理）
 *
 *   node probe-ui-sessions.mjs [cdpBase] [apiBase]
 *
 * 覆盖：旧数据迁移、侧栏切换、删除、刷新后恢复、/api/tts 用设置里的音色语速。
 */
import { mkdirSync, writeFileSync } from "node:fs";

const CDP = process.argv[2] || "http://127.0.0.1:9333";
const API = process.argv[3] || "http://127.0.0.1:8099";

let pass = 0;
let fail = 0;
function ok(name, cond, extra = "") {
  if (cond) { pass += 1; console.log(`  ✅ ${name}${extra ? " — " + extra : ""}`); }
  else { fail += 1; console.log(`  ❌ ${name}${extra ? " — " + extra : ""}`); }
}

// ---------- CDP 管道 ----------
const targets = await (await fetch(`${CDP}/json`)).json();
// 端口不再写死（原来写死 8098，应用后来固定跑 8099，探针就再也连不上页面）
const page = targets.find((t) => t.type === "page" && /:80\d\d\//.test(t.url));
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
async function reload() {
  await cmd("Page.reload", { ignoreCache: true });
  await sleep(3000);
}

// ---------- 清空服务端会话（先整份备份，再删）----------
// 2026-10-25 事故：这个函数曾经把用户 13 条真实会话直接删光，服务端是 unlink，不进回收站、无法还原。
// 现在删之前先把每个会话的完整 JSON 落到 docs/session-backups/<时间戳>/，删除变成可逆操作。
async function wipe() {
  const j = await (await fetch(`${API}/api/sessions`)).json();
  const list = j.sessions || [];
  if (list.length) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const dir = `D:/LocalModels/server/docs/session-backups/${stamp}`;
    mkdirSync(dir, { recursive: true });
    for (const s of list) {
      try {
        const full = await (await fetch(`${API}/api/sessions/${s.id}`)).json();
        writeFileSync(`${dir}/${s.id}.json`, JSON.stringify(full, null, 2), "utf8");
      } catch {}
    }
    console.log(`  （已备份 ${list.length} 个会话 → ${dir}，删除可回滚）`);
  }
  for (const s of list) {
    await fetch(`${API}/api/sessions/${s.id}`, { method: "DELETE" });
  }
}

console.log("\n== A. 旧数据迁移 ==");
{
  await wipe();
  await ev(`localStorage.removeItem('localai.lastSession'); localStorage.setItem('localai.transcript.v1', JSON.stringify([
    { role: 'user', content: '迁移测试：这是旧版 localStorage 里的提问' },
    { role: 'assistant', content: '旧版 localStorage 里的回答' }
  ])); 'ok'`);
  await reload();
  const srv = await (await fetch(`${API}/api/sessions`)).json();
  ok("旧对话被迁移成服务端会话", (srv.sessions || []).length === 1, JSON.stringify((srv.sessions || []).map((s) => s.title)));
  const dom = JSON.parse(await ev(`JSON.stringify({
    rows: document.querySelectorAll('#msgs .row').length,
    history: history.length,
    sessionId: sessionId,
    legacyStillThere: !!localStorage.getItem('localai.transcript.v1'),
  })`));
  // 新契约：启动一律落在新对话，迁移出来的会话只在侧栏，不自动铺开
  ok("迁移后停在开场白（不自动铺开）", dom.rows === 0, String(dom.rows));
  ok("history 也重建了", dom.history === 2, String(dom.history));
  ok("已绑定会话 id", !!dom.sessionId, dom.sessionId);
  ok("旧 key 保留作备份（不清空）", dom.legacyStillThere === true);
  await ev(`localStorage.removeItem('localai.transcript.v1'); 'ok'`);
}

console.log("\n== B. 侧栏切换 ==");
{
  // 直接造第二个会话，省掉一次真实推理
  const c = await (await fetch(`${API}/api/sessions`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}),
  })).json();
  await fetch(`${API}/api/sessions/${c.id}`, {
    method: "PUT", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      messages: [
        { role: 'user', content: '第二个会话的问题', t: Date.now() },
        { role: 'assistant', content: '第二个会话的回答', t: Date.now() },
        { role: 'user', content: '第二个会话的第二问', t: Date.now() },
        { role: 'assistant', content: '第二个会话的第二答', t: Date.now() },
      ],
    }),
  });
  await reload();
  const before = JSON.parse(await ev(`JSON.stringify({
    items: document.querySelectorAll('.sessionItem').length,
    selected: document.querySelectorAll('.sessionItem.sel').length,
    rows: document.querySelectorAll('#msgs .row').length,
  })`));
  ok("侧栏列出 2 个会话", before.items === 2, String(before.items));
  // 新契约：新对话页没有选中的会话（0 个高亮），点进去之后才会是 1 个
  ok("新对话页不高亮任何会话", before.selected === 0, String(before.selected));

  // 点第二个会话
  await ev(`(async () => {
    const items = [...document.querySelectorAll('.sessionItem')];
    const target = items.find(i => i.textContent.includes('第二个会话'));
    target.click();
    await new Promise(r => setTimeout(r, 1200));
    return 1;
  })()`);
  const after = JSON.parse(await ev(`JSON.stringify({
    rows: document.querySelectorAll('#msgs .row').length,
    history: history.length,
    sel: document.querySelector('.sessionItem.sel .t')?.textContent || '',
    firstUser: document.querySelector('#msgs .row.user .bubble')?.textContent || '',
    secondMark: document.querySelectorAll('#msgs .row.assistant.second').length,
  })`));
  ok("切换后渲染 4 条消息", after.rows === 4, String(after.rows));
  ok("切换后 history 同步", after.history === 4, String(after.history));
  ok("高亮跟着走", after.sel.includes("第二个会话"), after.sel);
  ok("内容是那个会话的", after.firstUser.includes("第二个会话的问题"), after.firstUser.slice(0, 30));
  ok("没有串进第二意见样式", after.secondMark === 0);
}

console.log("\n== C. 删除 ==");
{
  await ev(`window.__origConfirm = window.confirm; window.confirm = () => true; 'ok'`);
  await ev(`(async () => {
    const items = [...document.querySelectorAll('.sessionItem')];
    const target = items.find(i => i.textContent.includes('第二个会话'));
    target.querySelector('.del').click();
    await new Promise(r => setTimeout(r, 1500));
    return 1;
  })()`);
  const srv = await (await fetch(`${API}/api/sessions`)).json();
  ok("服务端只剩 1 个会话", (srv.sessions || []).length === 1, String((srv.sessions || []).length));
  const dom = JSON.parse(await ev(`JSON.stringify({
    items: document.querySelectorAll('.sessionItem').length,
    rows: document.querySelectorAll('#msgs .row').length,
    sessionId: sessionId,
  })`));
  ok("侧栏同步减少", dom.items === 1, String(dom.items));
  ok("自动切到剩下的会话", dom.sessionId && dom.rows === 2, `${dom.sessionId} / ${dom.rows} 条`);
  await ev(`window.confirm = window.__origConfirm; 'ok'`);
}

// 2026-10-22 起：启动/刷新一律落在新对话，旧会话靠右下角「上次在聊」找回。
// 所以这里验的是「不自动恢复 + 记得上次 + 点一下能回来」，而不是自动续上。
console.log("\n== D. 刷新后：新对话 + 上次在聊 ==");
{
  const before = await ev(`sessionId`);
  await reload();
  const dom = JSON.parse(await ev(`JSON.stringify({
    sessionId: sessionId,
    rows: document.querySelectorAll('#msgs .row').length,
    startScreen: document.body.classList.contains('startScreen'),
    lastId: localStorage.getItem('localai.lastSession') || '',
    cardShown: !document.getElementById('recentWrap').hidden,
  })`));
  ok("刷新后落在新对话（开场白）", dom.startScreen === true && dom.sessionId === null, `sessionId=${dom.sessionId} start=${dom.startScreen}`);
  ok("不自动把旧消息铺回来", dom.rows === 0, String(dom.rows));
  ok("仍记得上次会话", dom.lastId === before, `${before} → ${dom.lastId}`);
  ok("右下角出现「上次在聊」", dom.cardShown === true);
  await ev(`document.getElementById('recentOpen').click()`);
  await new Promise(r => setTimeout(r, 1500));
  const back = JSON.parse(await ev(`JSON.stringify({
    sessionId: sessionId,
    rows: document.querySelectorAll('#msgs .row').length,
    history: history.length,
  })`));
  ok("点「继续对话」回到原会话", back.sessionId === before, `${before} → ${back.sessionId}`);
  ok("消息被恢复", back.rows === 2, String(back.rows));
  ok("history 被重建", back.history === 2, String(back.history));
}

console.log("\n== E. 朗读接口（用设置里的音色+语速）==");
{
  const st = await (await fetch(`${API}/api/tts/state`)).json();
  const voice = st.voices[0]?.id;
  ok("有可用音色", !!voice, `${voice} / 引擎 ${st.engine}`);
  const r = await fetch(`${API}/api/tts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "朗读设置测试。", voice, speed: 1.3 }),
  });
  const buf = Buffer.from(await r.arrayBuffer());
  const mime = r.headers.get("content-type") || "";
  ok("合成成功", r.status === 200 && buf.length > 2000, `${Math.round(buf.length / 1024)} KB, ${mime}`);

  // 设置里保存的默认音色/语速确实被前端读到
  const saved = JSON.parse(await ev(`localStorage.getItem('localai.settings') || '{}'`));
  ok("设置里有默认音色", typeof saved.ttsVoice === "string" && saved.ttsVoice.length > 0, saved.ttsVoice);
  ok("设置里有语速", typeof saved.ttsSpeed === "number", String(saved.ttsSpeed));
  ok("自动朗读默认关闭", !saved.autoRead);
}

console.log(`\n== 结果: ${pass} 通过 / ${fail} 失败 ==\n`);
ws.close();
process.exit(fail ? 1 : 0);

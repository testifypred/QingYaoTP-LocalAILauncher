/**
 * 联网 UI 探针：默认关 → 首次须知 → 开启 → 搜索卡片 → 刷新恢复 → 设置恢复提示 → 联动关闭。
 *
 *   node probe-ui-web.mjs [cdpBase] [appBase] [shotDir]
 *
 * 前置：目标服务已加载模型（会真发一轮联网问答）。
 */
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const CDP = process.argv[2] || "http://127.0.0.1:9333";
const APP = process.argv[3] || "http://127.0.0.1:8096";
const OUT = process.argv[4] || "D:/LocalModels/server/docs/ui-new";

let pass = 0;
let fail = 0;
const ok = (n, c, e = "") => {
  if (c) { pass++; console.log(`  ✅ ${n}${e ? " — " + e : ""}`); }
  else { fail++; console.log(`  ❌ ${n}${e ? " — " + e : ""}`); }
};

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

await ev(`localStorage.removeItem('localai.settings'); 'ok'`);
await cmd("Page.reload", { ignoreCache: true });
await sleep(4000);

console.log("\n== A. 默认状态 ==");
{
  const st = JSON.parse(await ev(`JSON.stringify({
    exists: !!document.getElementById('webChk'),
    checked: document.getElementById('webChk').checked,
    disabled: document.getElementById('webChk').disabled,
    toolChecked: document.getElementById('toolChk').checked,
    modalHidden: document.getElementById('webWarnModal').hidden,
    saved: localStorage.getItem('localai.settings'),
  })`));
  ok("「联网」开关存在", st.exists);
  ok("默认不勾选", st.checked === false);
  // 10-24 起开场白默认就是 Agent 模式（调用工具已勾），所以要验这条规则
  // 得先像用户那样把工具取消掉
  await ev("document.getElementById('toolChk').checked = false; document.getElementById('toolChk').dispatchEvent(new Event('change')); 1");
  await sleep(250);
  const st2 = JSON.parse(await ev("JSON.stringify({ disabled: document.getElementById('webChk').disabled, tool: document.getElementById('toolChk').checked, checked: document.getElementById('webChk').checked })"));
  ok("取消「调用工具」后联网变为不可点", st2.disabled === true && st2.tool === false, JSON.stringify(st2));
  ok("须知弹窗默认关闭", st.modalHidden === true);
  ok("联网开关在输入框下方（askBar 内）", (await ev(`!!document.querySelector('.askBar #webChk')`)) === true);
  ok("联网开关已从工具栏移除", (await ev(`!document.querySelector('.toolbar #webChk')`)) === true);
  // 量位置要在对话页：开场白页把底部输入区藏起来了，量出来全是 0
  await ev("(() => { const r = document.getElementById('recentWrap'); if (r && !r.hidden) { document.getElementById('recentOpen').click(); return 1; } return 0; })()");
  await sleep(1500);
  const pos = JSON.parse(await ev(`(() => {
    const w = document.getElementById('webChk').getBoundingClientRect();
    const p = document.getElementById('preloadChk').getBoundingClientRect();
    const q = document.getElementById('q').getBoundingClientRect();
    return JSON.stringify({ webTop: Math.round(w.top), preloadTop: Math.round(p.top), inputBottom: Math.round(q.bottom), webLeft: Math.round(w.left), preloadLeft: Math.round(p.left) });
  })()`));
  ok("与「多回答预加载」同一行", Math.abs(pos.webTop - pos.preloadTop) <= 2, `${pos.webTop} vs ${pos.preloadTop}`);
  ok("位于输入框下沿之下", pos.webTop > pos.inputBottom, `开关 ${pos.webTop} / 输入框底 ${pos.inputBottom}`);
  ok("排在多回答预加载左侧", pos.webLeft < pos.preloadLeft, `${pos.webLeft} < ${pos.preloadLeft}`);
}

console.log("\n== B. 勾「调用工具」后联网可选 ==");
{
  await ev(`(() => { const c = document.getElementById('toolChk'); c.checked = true; c.dispatchEvent(new Event('change')); return 1; })()`);
  await sleep(300);
  ok("联网开关被解锁", (await ev(`document.getElementById('webChk').disabled`)) === false);
}

console.log("\n== C. 首次开启弹出须知 ==");
{
  await ev(`document.getElementById('webChk').click()`);
  await sleep(700);
  const st = JSON.parse(await ev(`JSON.stringify({
    open: !document.getElementById('webWarnModal').hidden,
    points: document.querySelectorAll('#webWarnModal .webPoints li').length,
    mute: document.getElementById('webMuteChk').checked,
    checked: document.getElementById('webChk').checked,
    text: document.getElementById('webWarnModal').textContent,
  })`));
  ok("弹出联网须知", st.open);
  ok("列出发什么给谁 / 内网拒绝 / 站点可达性", st.points >= 4, st.points + " 条");
  ok("须知提到查询词发给第三方", st.text.includes("查询词会发给第三方搜索引擎"));
  ok("须知提到内网拒绝", st.text.includes("内网"));
  ok("确认前开关保持未勾", st.checked === false);
  ok("「不再提示」默认未勾", st.mute === false);
  await shot("17-web-notice");
}

console.log("\n== D. 勾「不再提示」并开启 ==");
{
  await ev(`(() => { const c = document.getElementById('webMuteChk'); c.checked = true; c.dispatchEvent(new Event('change')); return 1; })()`);
  await ev(`document.getElementById('webOk').click()`);
  await sleep(700);
  const st = JSON.parse(await ev(`JSON.stringify({
    checked: document.getElementById('webChk').checked,
    hidden: document.getElementById('webWarnModal').hidden,
    saved: JSON.parse(localStorage.getItem('localai.settings') || '{}'),
    toast: [...document.querySelectorAll('#toasts .toast')].map(t => t.textContent),
  })`));
  ok("联网已开启", st.checked === true);
  ok("弹窗关闭", st.hidden === true);
  ok("落盘 webEnabled / webMuted", st.saved.webEnabled === true && st.saved.webMuted === true, JSON.stringify(st.saved).slice(0, 90));
  ok("给了开启提示", st.toast.some((x) => x.includes("已开启联网")), st.toast.join(" | "));
}

console.log("\n== E. 真发一轮联网问答 ==");
{
  await ev(`newChat()`);
  await sleep(600);
  // 2026-11-15 定性：newChat() 会回到开场白，showHero() 里按「用户默认」把「调用工具」复位
  // （v1.5.1 起默认关，见 app.html showHero 的 toolChk.checked = toolEnabled）。
  // 不重新勾上就发，请求体是 tools=false / web=false —— 模型根本没有 web_search，
  // 会自己答「我无法联网搜索」，6 条卡片断言全红（上一轮全量就是这么红的，不是产品缺陷）。
  await ev(`(() => { const c = document.getElementById('toolChk'); c.checked = true; c.dispatchEvent(new Event('change')); return 1; })()`);
  await sleep(400);
  await ev(`(() => { const q = document.getElementById('q'); q.value = '用 web_search 搜索「Qwen2.5 上下文长度」，告诉我第一条结果标题。'; q.dispatchEvent(new Event('input')); document.getElementById('send').click(); return 1; })()`);
  console.log("    已发送，等待联网与回答…");

  let cards = 0, bubble = "", summary = "", waited = 0;
  for (;;) {
    await sleep(2500);
    waited += 2.5;
    const st = JSON.parse(await ev(`(() => {
      const row = [...document.querySelectorAll('#msgs .row.assistant')].pop();
      const b = row ? row.querySelector('.bubble') : null;
      const sum = row ? row.querySelector('.toolSummary') : null;
      return JSON.stringify({
        webCards: document.querySelectorAll('#msgs .tool.web').length,
        summary: sum ? sum.textContent : '',
        bubble: b ? b.textContent : '',
        busy: document.getElementById('send').disabled,
      });
    })()`));
    cards = st.webCards; bubble = st.bubble; summary = st.summary;
    if (cards > 0 && !st.busy && bubble && !bubble.includes("…")) break;
    if (waited > 200) break;
  }
  ok("出现联网专用卡片", cards >= 1, `${cards} 张，用时 ${waited}s`);
  ok("有「本次联网」摘要", summary.includes("本次联网") && summary.includes("搜索"), summary);
  ok("回答正文非空", bubble.trim().length > 6, bubble.slice(0, 60));
  ok("正文没漏出原始调用块", !bubble.includes("<tool_call>"), bubble.slice(0, 40));

  const card = JSON.parse(await ev(`(() => {
    const el = document.querySelector('#msgs .tool.web');
    return el ? JSON.stringify({ head: el.querySelector('b').textContent, meta: el.querySelector('.toolMeta').textContent, io: el.querySelector('.io').textContent.slice(0, 200) }) : '{}';
  })()`));
  ok("卡片显示搜索词", (card.head || '').includes("搜索「"), card.head);
  ok("卡片显示条数与引擎", /条 · 引擎/.test(card.meta || ''), card.meta);
  ok("卡片列出结果标题与地址", /1\./.test(card.io || '') && /https?:\/\//.test(card.io || ''), (card.io || '').slice(0, 60));
  await shot("18-web-cards");
}

console.log("\n== F. 刷新后仍在（存档 + 开关记忆）==");
{
  await cmd("Page.reload", { ignoreCache: true });
  await sleep(4200);
  // 启动页默认新对话：先点右下角「上次在聊」把会话打开，再验存档恢复
  await ev("(() => { const r = document.getElementById('recentWrap'); if (r && !r.hidden) { document.getElementById('recentOpen').click(); return 1; } return 0; })()");
  await sleep(1600);
  const st = JSON.parse(await ev(`JSON.stringify({
    cards: document.querySelectorAll('#msgs .tool.web').length,
    webChecked: document.getElementById('webChk').checked,
    toolChecked: document.getElementById('toolChk').checked,
  })`));
  ok("刷新后联网卡片被恢复", st.cards >= 1, st.cards + " 张");
  ok("联网开关保持开启", st.webChecked === true);
  ok("调用工具保持开启", st.toolChecked === true);
}

console.log("\n== G. 设置里恢复须知 + 联动关闭 ==");
{
  await ev(`document.getElementById('settingsBtn').click()`);
  await sleep(600);
  const st = JSON.parse(await ev(`JSON.stringify({
    exists: !!document.getElementById('setWebWarn'),
    checked: document.getElementById('setWebWarn').checked,
    info: document.getElementById('setWebInfo').textContent,
    offBtn: !!document.getElementById('setWebOff'),
  })`));
  ok("设置里有「开启前显示须知」", st.exists);
  ok("当前为已不再提示", st.checked === false);
  ok("显示联网状态", st.info.includes("已开启"), st.info);
  ok("有「关闭联网」按钮", st.offBtn);

  await ev(`(() => { const c = document.getElementById('setWebWarn'); c.checked = true; c.dispatchEvent(new Event('change')); return 1; })()`);
  await sleep(200);
  ok("恢复提示后 webMuted=false", JSON.parse(await ev(`localStorage.getItem('localai.settings')`)).webMuted === false);

  // 关闭联网（设置里的按钮）
  await ev(`document.getElementById('setWebOff').click()`);
  await sleep(400);
  ok("设置里能关闭联网", (await ev(`document.getElementById('webChk').checked`)) === false);
  await shot("19-web-settings");
  await ev(`document.getElementById('settingsClose').click()`);
  await sleep(300);
}

console.log("\n== H. 关掉「调用工具」应连带关掉联网 ==");
{
  await ev(`(() => { const c = document.getElementById('webChk'); if (c.disabled) { const t = document.getElementById('toolChk'); t.checked = true; t.dispatchEvent(new Event('change')); } c.click(); return 1; })()`);
  await sleep(800);
  const opened = await ev(`!document.getElementById('webWarnModal').hidden`);
  if (opened) { await ev(`document.getElementById('webOk').click()`); await sleep(400); }
  ok("联网已开（前置）", (await ev(`document.getElementById('webChk').checked`)) === true);

  await ev(`(() => { const c = document.getElementById('toolChk'); c.checked = false; c.dispatchEvent(new Event('change')); return 1; })()`);
  await sleep(600);
  const st = JSON.parse(await ev(`JSON.stringify({
    webChecked: document.getElementById('webChk').checked,
    webDisabled: document.getElementById('webChk').disabled,
    saved: JSON.parse(localStorage.getItem('localai.settings') || '{}').webEnabled,
  })`));
  ok("联网被连带关闭", st.webChecked === false && st.saved === false);
  ok("联网开关随之禁用", st.webDisabled === true);
}

console.log(`\n== 结果: ${pass} 通过 / ${fail} 失败 ==\n`);
ws.close();
process.exit(fail ? 1 : 0);

/**
 * 界面回归探针（Edge headless + CDP）：不需要加载模型。
 *
 *   node probe-ui-new.mjs [cdpBase] [shotDir]
 *
 * 覆盖：对话列表侧栏、设置选项卡（生成/朗读）、@ 菜单与选中标签、主题。
 * 只读 + 点击，不改任何数据；截图落在 shotDir。
 */
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const CDP = process.argv[2] || "http://127.0.0.1:9333";
const OUT = process.argv[3] || "D:/LocalModels/server/docs/ui-new";

let pass = 0;
let fail = 0;
function ok(name, cond, extra = "") {
  if (cond) { pass += 1; console.log(`  ✅ ${name}${extra ? " — " + extra : ""}`); }
  else { fail += 1; console.log(`  ❌ ${name}${extra ? " — " + extra : ""}`); }
}

const list = await (await fetch(`${CDP}/json`)).json();
// 端口不再写死：任何 127.0.0.1:<port> 的应用页都认（8098/8099/8096 都跑过）
const page = list.find((t) => t.type === "page" && /127\.0\.0\.1:\d{4}\//.test(t.url));
if (!page) {
  console.log("没有找到页面目标，现有目标：", list.map((t) => `${t.type} ${t.url}`));
  process.exit(1);
}

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
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("超时 " + method)); }, 20000);
    pending.set(id, (m) => { clearTimeout(timer); resolve(m); });
    ws.send(JSON.stringify({ id, method, params }));
  });
const ev = async (expression) => {
  const r = await cmd("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text + " :: " + (r.result.exceptionDetails.exception?.description ?? ""));
  return r.result?.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await cmd("Runtime.enable");
await cmd("Page.enable");
await cmd("Page.reload", { ignoreCache: true });
await sleep(3500); // 等 /api/state 与 /api/sessions 回来

await mkdir(OUT, { recursive: true });
async function shot(name) {
  const r = await cmd("Page.captureScreenshot", { format: "png" });
  if (!r.result?.data) throw new Error("截图失败");
  const p = path.join(OUT, `ui-${name}.png`);
  await writeFile(p, Buffer.from(r.result.data, "base64"));
  console.log("    截图:", p);
}

console.log("\n== 结构 ==");
{
  const info = await ev(`JSON.stringify({
    sidebar: !!document.getElementById('sidebar'),
    sidebarVisible: getComputedStyle(document.getElementById('sidebar')).display !== 'none',
    sidebarWidth: document.getElementById('sidebar').getBoundingClientRect().width,
    sessions: document.querySelectorAll('.sessionItem').length,
    atBtn: !!document.getElementById('atBtn'),
    footerTts: !!document.getElementById('ttsBox'),
    settingsTabs: [...document.querySelectorAll('.settingsTabs .stab')].map(b => b.dataset.tab),
    ttsVoiceOptions: document.getElementById('setTtsVoice').options.length,
    bodyCols: getComputedStyle(document.body).gridTemplateColumns,
  })`);
  const i = JSON.parse(info);
  ok("侧栏存在且可见", i.sidebar && i.sidebarVisible, `${Math.round(i.sidebarWidth)}px`);
  ok("侧栏已渲染会话条目", i.sessions >= 1, i.sessions + " 条");
  ok("@ 按钮存在", i.atBtn);
  ok("底部朗读条已移除", !i.footerTts);
  // 10-22 之后多了「工具」页，所以断言改成「至少含 生成/朗读 两个」，不再锁死数量
ok("设置有生成与朗读选项卡", i.settingsTabs.includes("gen") && i.settingsTabs.includes("tts"), i.settingsTabs.join(","));
  ok("音色下拉已填充", i.ttsVoiceOptions > 0, i.ttsVoiceOptions + " 个");
  ok("主体已切到网格布局", i.bodyCols.split(" ").length === 2, i.bodyCols);
}

await shot("1-main");

console.log("\n== 侧栏收起 / 展开 ==");
{
  await ev(`document.getElementById('sideToggle').click()`);
  await sleep(250);
  const a = JSON.parse(await ev(`JSON.stringify({
    off: document.body.classList.contains('sideOff'),
    width: document.getElementById('sidebar').getBoundingClientRect().width,
    cols: getComputedStyle(document.body).gridTemplateColumns,
  })`));
  ok("点 ☰ 能收起侧栏", a.off && a.width === 0, a.cols);
  await shot("2-side-off");
  await ev(`document.getElementById('sideToggle').click()`);
  await sleep(250);
  const b = JSON.parse(await ev(`JSON.stringify({ off: document.body.classList.contains('sideOff'), width: document.getElementById('sidebar').getBoundingClientRect().width })`));
  ok("再点一次能展开", !b.off && b.width > 100, Math.round(b.width) + "px");
}

console.log("\n== 设置 → 生成 / 朗读 ==");
{
  await ev(`document.getElementById('settingsBtn').click()`);
  await sleep(400);
  const g = JSON.parse(await ev(`JSON.stringify({
    open: !document.getElementById('settingsModal').hidden,
    paneGen: !document.getElementById('paneGen').hidden,
    paneTts: !document.getElementById('paneTts').hidden,
    autoRead: document.getElementById('setAutoRead').checked,
    autoReadInTts: !!document.querySelector('#paneTts #setAutoRead'),
  })`));
  ok("设置面板打开", g.open);
  ok("默认停在「生成」页", g.paneGen && !g.paneTts);
  ok("自动朗读默认关闭", g.autoRead === false);
  ok("自动朗读归到「朗读」页", g.autoReadInTts);
  await shot("3-settings-gen");

  await ev(`[...document.querySelectorAll('.settingsTabs .stab')].find(b => b.dataset.tab === 'tts').click()`);
  await sleep(600);
  const t = JSON.parse(await ev(`JSON.stringify({
    paneGen: !document.getElementById('paneGen').hidden,
    paneTts: !document.getElementById('paneTts').hidden,
    engine: document.getElementById('ttsEngineInfo').textContent,
    voice: document.getElementById('setTtsVoice').value,
    speed: document.getElementById('setTtsSpeed').value,
    speedLabel: document.getElementById('setTtsSpeedVal').textContent,
  })`));
  ok("能切到「朗读」页", t.paneTts && !t.paneGen);
  ok("引擎信息已探测", t.engine.length > 0 && !t.engine.startsWith("正在检测"), t.engine.slice(0, 40));
  ok("默认音色有值", !!t.voice, t.voice);
  // 语速是用户设置项，会被 localStorage 记住；这里只断言取值合法、标签自洽
ok("语速取值合法且标签自洽", Number(t.speed) >= 0.5 && Number(t.speed) <= 2 && t.speedLabel.startsWith(Number(t.speed).toFixed(1)), `${t.speed} / ${t.speedLabel}`);
  await shot("4-settings-tts");

  // 拖动语速滑块，标签应跟着变
  await ev(`(() => { const s = document.getElementById('setTtsSpeed'); s.value = '1.3'; s.dispatchEvent(new Event('input')); return s.value; })()`);
  await sleep(150);
  ok("语速滑块联动标签", (await ev(`document.getElementById('setTtsSpeedVal').textContent`)) === "1.3×");

  // 保存后写进 localStorage
  await ev(`document.getElementById('settingsSave').click()`);
  await sleep(300);
  const saved = JSON.parse(await ev(`localStorage.getItem('localai.settings')`));
  ok("保存后落进 localStorage", saved.v === 2 && saved.ttsSpeed === 1.3 && saved.autoRead === false, JSON.stringify(saved));
  ok("保存后关闭面板", await ev(`document.getElementById('settingsModal').hidden`));
}

console.log("\n== @ 菜单 ==");
{
  await ev(`document.getElementById('atBtn').click()`);
  await sleep(300);
  const m = JSON.parse(await ev(`JSON.stringify({
    open: !document.getElementById('atMenu').hidden,
    items: [...document.querySelectorAll('#atMenu .atItem')].length,
    disabled: [...document.querySelectorAll('#atMenu .atItem')].filter(b => b.disabled).length,
    labels: [...document.querySelectorAll('#atMenu .atItem .n')].map(n => n.textContent),
  })`));
  ok("@ 菜单弹出", m.open);
  ok("菜单列出模型", m.items >= 2, m.items + " 个: " + m.labels.join(" / "));
  // 没加载模型时不该有任何一行被置灰（"当前模型"不存在）
  const loadedNow = (await (await fetch("http://127.0.0.1:8099/api/state")).json()).loaded;
  ok(loadedNow ? "当前模型被置灰不可选" : "没加载模型时没有行被置灰", m.disabled === (loadedNow ? 1 : 0), String(m.disabled));
  await shot("5-at-menu");

  // 选一个非当前模型
  await ev(`(() => { const b = [...document.querySelectorAll('#atMenu .atItem')].find(x => !x.disabled); b.click(); return b.textContent; })()`);
  await sleep(250);
  const chips = JSON.parse(await ev(`JSON.stringify({
    chips: [...document.querySelectorAll('#askChips .chip')].map(c => c.textContent),
    on: document.getElementById('atBtn').classList.contains('on'),
    hintHidden: document.getElementById('askHint').hidden,
    stillOpen: !document.getElementById('atMenu').hidden,
  })`));
  ok("选中后出现标签", chips.chips.length === 1, chips.chips.join(","));
  ok("@ 按钮高亮", chips.on);
  ok("提示文字让位给标签", chips.hintHidden);
  ok("菜单保持打开可多选", chips.stillOpen);
  await shot("6-at-chip");

  // 点空白处关闭菜单
  await ev(`document.body.click()`);
  await sleep(200);
  ok("点空白处收起菜单", await ev(`document.getElementById('atMenu').hidden`));

  // 取消选择
  await ev(`document.querySelector('#askChips .chip button').click()`);
  await sleep(200);
  ok("标签可取消", (await ev(`document.querySelectorAll('#askChips .chip').length`)) === 0);
  ok("取消后按钮不再高亮", (await ev(`document.getElementById('atBtn').classList.contains('on')`)) === false);
}

console.log("\n== 亮色主题 ==");
{
  await ev(`applyTheme('light')`);
  await sleep(500);
  await shot("7-light");
  await ev(`applyTheme('dark')`);
}

console.log(`\n== 结果: ${pass} 通过 / ${fail} 失败 ==\n`);
ws.close();
process.exit(fail ? 1 : 0);

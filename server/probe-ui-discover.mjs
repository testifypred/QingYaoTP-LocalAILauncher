/**
 * 嗅探面板 UI 探针（配合 fake-models fixture，不需要真模型）
 *
 *   node probe-ui-discover.mjs [cdpBase] [appBase] [shotDir]
 */
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const CDP = process.argv[2] || "http://127.0.0.1:9333";
const APP = process.argv[3] || "http://127.0.0.1:8096";
const OUT = process.argv[4] || "D:/LocalModels/server/docs/ui-new";
const FIX = "D:\\Test For DSH Harness\\fake-models\\src";

let pass = 0;
let fail = 0;
function ok(name, cond, extra = "") {
  if (cond) { pass += 1; console.log(`  ✅ ${name}${extra ? " — " + extra : ""}`); }
  else { fail += 1; console.log(`  ❌ ${name}${extra ? " — " + extra : ""}`); }
}

const targets = await (await fetch(`${CDP}/json`)).json();
const page = targets.find((t) => t.type === "page" && t.url.includes(APP.replace(/^https?:\/\//, "")));
if (!page) { console.log("没找到页面目标。现有：", targets.map((t) => `${t.type} ${t.url}`)); process.exit(1); }
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

// 开场复位：把「已询问」标记和模型目录清干净，保证本轮可重复
{
  const { rm, mkdir } = await import("node:fs/promises");
  const MODELDIR = process.argv[5] || "D:\\Test For DSH Harness\\fake-models\\library";
  await rm(MODELDIR, { recursive: true, force: true });
  await mkdir(MODELDIR, { recursive: true });
  await fetch(`${APP}/api/discover/config`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ onboarded: false, customDirs: [] }),
  });
  console.log("（已复位：onboarded=false、模型目录清空）\n");
}

await cmd("Page.reload", { ignoreCache: true });

await sleep(3500);
await mkdir(OUT, { recursive: true });
async function shot(name) {
  const r = await cmd("Page.captureScreenshot", { format: "png" });
  await writeFile(path.join(OUT, `ui-${name}.png`), Buffer.from(r.result.data, "base64"));
  console.log("    截图:", path.join(OUT, `ui-${name}.png`));
}

console.log("\n== A. 初次使用自动询问 ==");
{
  const st = JSON.parse(await ev(`JSON.stringify({
    open: !document.getElementById('discoverModal').hidden,
    title: document.getElementById('dscTitle').textContent,
    intro: document.getElementById('dscIntro').textContent.slice(0, 24),
    roots: document.querySelectorAll('#dscRoots .dscRoot').length,
    btn: !!document.getElementById('discoverBtn'),
  })`));
  ok("首次进入自动弹出嗅探面板", st.open);
  ok("标题是初次使用语气", st.title.includes("初次使用"), st.title);
  ok("工具栏有「嗅探」入口", st.btn);
  ok("列出了本机真实存在的常见位置", st.roots >= 1, st.roots + " 个");
  await shot("9-discover-first");
}

console.log("\n== B. 添加自定义目录 ==");
{
  await ev(`(() => { const i = document.getElementById('dscDirInput'); i.value = ${JSON.stringify(FIX)}; i.dispatchEvent(new Event('input')); document.getElementById('dscDirAdd').click(); return 1; })()`);
  await sleep(900);
  const st = JSON.parse(await ev(`JSON.stringify({
    chips: [...document.querySelectorAll('#dscCustoms .dscCustom')].map(c => c.querySelector('span').textContent),
    hint: document.getElementById('dscScanHint').textContent,
  })`));
  ok("自定义目录变成标签", st.chips.includes(FIX), st.chips.join(" | "));
  ok("提示已保存", st.hint.includes("已保存") || st.hint.includes("生效"), st.hint);

  // 非法路径要被挡住
  await ev(`(() => { const i = document.getElementById('dscDirInput'); i.value = 'relative\\dir'; i.dispatchEvent(new Event('input')); document.getElementById('dscDirAdd').click(); return 1; })()`);
  await sleep(300);
  ok("相对路径被拒", (await ev(`document.getElementById('dscScanHint').textContent`)).includes("绝对路径"));
}

console.log("\n== C. 扫描 ==");
{
  await ev(`document.getElementById('dscScan').click()`);
  await sleep(4000);
  const st = JSON.parse(await ev(`JSON.stringify({
    meta: document.getElementById('discoverMeta').textContent,
    items: [...document.querySelectorAll('#dscResults .dscItem')].map(el => ({
      name: el.querySelector('.nm').textContent,
      size: el.querySelector('.sz').textContent,
      badge: el.querySelector('.dscBadge') ? el.querySelector('.dscBadge').textContent : '',
      checked: el.querySelector('input').checked,
      disabled: el.querySelector('input').disabled,
    })),
    adoptText: document.getElementById('dscAdopt').textContent,
    adoptDisabled: document.getElementById('dscAdopt').disabled,
    foot: document.getElementById('dscFootHint').textContent,
  })`));
  ok("扫描出结果列表", st.items.length >= 3, st.items.length + " 条");
  ok("显示扫描统计", /个模型/.test(st.meta), st.meta);
  ok("假 gguf 不在列表里", !st.items.some((i) => i.name.includes("not-a-model")));
  ok("小文件不在列表里", !st.items.some((i) => i.name.includes("tiny")));
  ok("新发现的默认勾选", st.items.filter((i) => i.badge === "新发现").every((i) => i.checked));
  ok("按钮显示选中数量", /收录选中（\d+）/.test(st.adoptText), st.adoptText);
  ok("底部说明提到硬链接", st.foot.includes("硬链接"), st.foot.slice(0, 40));
  await shot("10-discover-scan");
}

console.log("\n== D. 收录 ==");
{
  const before = await ev(`[...document.querySelectorAll('#modelSel .tab')].length`);
  await ev(`document.getElementById('dscAdopt').click()`);
  await sleep(6000);
  const st = JSON.parse(await ev(`JSON.stringify({
    foot: document.getElementById('dscFootHint').textContent,
    color: document.getElementById('dscFootHint').style.color,
    already: [...document.querySelectorAll('#dscResults .dscItem')].filter(el => el.className.includes('already')).length,
    badges: [...document.querySelectorAll('#dscResults .dscBadge')].map(b => b.textContent),
    tabs: [...document.querySelectorAll('#modelSel .tab')].length,
  })`));
  ok("收录成功提示", st.foot.includes("收录成功"), st.foot);
  ok("提示是成功色", st.color.includes("ok") || st.color.includes("52") || st.color === "var(--ok)", st.color);
  ok("已收录项标记出来", st.already >= 3, st.already + " 项");
  ok("模型选项卡出现新模型", st.tabs >= before + 1, `${before} → ${st.tabs}`);
  await shot("11-discover-adopted");
}

console.log("\n== E. 关闭后不再打扰 ==");
{
  await ev(`document.getElementById('discoverClose').click()`);
  await sleep(700);
  ok("面板已关闭", await ev(`document.getElementById('discoverModal').hidden`));
  const cfg = await (await fetch(`${APP}/api/discover/config`)).json();
  ok("服务端记下已询问", cfg.onboarded === true, String(cfg.onboarded));
  ok("自定义目录已持久化", (cfg.customDirs || []).includes("D:\\Test For DSH Harness\\fake-models\\src"));

  await cmd("Page.reload", { ignoreCache: true });
  await sleep(3500);
  ok("刷新后不再自动弹出", await ev(`document.getElementById('discoverModal').hidden`));

  await ev(`document.getElementById('discoverBtn').click()`);
  await sleep(800);
  const t = await ev(`document.getElementById('dscTitle').textContent`);
  ok("手动打开是常规语气", !t.includes("初次使用"), t);
  await shot("12-discover-manual");
}

console.log(`\n== 结果: ${pass} 通过 / ${fail} 失败 ==\n`);
ws.close();
process.exit(fail ? 1 : 0);

/**
 * 「多回答预加载」UI 探针：开关、能力检查弹窗、不再提醒、设置里的提醒开关。
 *
 *   node probe-ui-preload.mjs [cdpBase] [appBase] [shotDir]
 *
 * 注意：最后一段会真的预加载一个小模型（约 12 秒），用来验证「选中 @ 即预加载」的接线。
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

// 从干净状态开始：清设置并确保服务端没有常驻模型
await fetch(`${APP}/api/preload/clear`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
await ev(`localStorage.removeItem('localai.settings'); 'ok'`);
await cmd("Page.reload", { ignoreCache: true });
await sleep(3500);

console.log("\n== A. 默认状态 ==");
{
  const st = JSON.parse(await ev(`JSON.stringify({
    exists: !!document.getElementById('preloadChk'),
    checked: document.getElementById('preloadChk').checked,
    label: document.getElementById('preloadChk').parentElement.textContent.trim(),
    state: document.getElementById('preloadState').textContent,
    modal: document.getElementById('preloadWarnModal').hidden,
    saved: localStorage.getItem('localai.settings'),
  })`));
  ok("开关存在", st.exists);
  ok("默认不勾选", st.checked === false);
  ok("文案是「多回答预加载」", st.label.includes("多回答预加载"), st.label);
  ok("没有常驻模型时不显示状态", st.state === "", st.state);
  ok("弹窗默认关闭", st.modal === true);
}

console.log("\n== B. 开启时弹窗并出示能力账单 ==");
{
  await ev(`document.getElementById('preloadChk').click()`);
  await sleep(1200);
  const st = JSON.parse(await ev(`JSON.stringify({
    open: !document.getElementById('preloadWarnModal').hidden,
    checkedAfterClick: document.getElementById('preloadChk').checked,
    ram: document.getElementById('preloadRamMeta').textContent,
    rows: [...document.querySelectorAll('#capTableBox tbody tr')].map(r => r.textContent),
    advice: document.getElementById('capAdvice').textContent,
    adviceClass: document.getElementById('capAdvice').className,
    muteChecked: document.getElementById('preloadMuteChk').checked,
    okDisabled: document.getElementById('preloadOk').disabled,
  })`));
  ok("弹出能力检查", st.open);
  ok("确认前开关保持未勾选", st.checkedAfterClick === false);
  ok("显示内存总量/可用量", /GB/.test(st.ram), st.ram);
  ok("逐模型列出占用", st.rows.length >= 1, st.rows.length + " 行");
  ok("结论文字非空", st.advice.length > 0, st.advice.slice(0, 40));
  ok("结论带语义色", /capAdvice (ok|tight|insufficient)/.test(st.adviceClass), st.adviceClass);
  ok("「不再提醒」默认未勾", st.muteChecked === false);
  ok("有余量时允许开启", st.okDisabled === false);
  await shot("13-preload-warn");
}

console.log("\n== C. 勾选「不再提醒」后开启 ==");
{
  await ev(`(() => { const c = document.getElementById('preloadMuteChk'); c.checked = true; c.dispatchEvent(new Event('change')); return 1; })()`);
  await ev(`document.getElementById('preloadOk').click()`);
  await sleep(900);
  const st = JSON.parse(await ev(`JSON.stringify({
    open: !document.getElementById('preloadWarnModal').hidden,
    checked: document.getElementById('preloadChk').checked,
    saved: JSON.parse(localStorage.getItem('localai.settings') || '{}'),
  })`));
  ok("确认后关闭弹窗", st.open === false);
  ok("开关真正勾上", st.checked === true);
  ok("落盘 preloadMulti", st.saved.preloadMulti === true);
  ok("落盘 preloadMuted", st.saved.preloadMuted === true);
}

console.log("\n== D. 再次开启不再打扰 ==");
{
  await ev(`document.getElementById('preloadChk').click()`); // 关
  await sleep(700);
  await ev(`document.getElementById('preloadChk').click()`); // 再开
  await sleep(900);
  const st = JSON.parse(await ev(`JSON.stringify({
    modal: document.getElementById('preloadWarnModal').hidden,
    checked: document.getElementById('preloadChk').checked,
  })`));
  ok("已勾不再提醒时直接开启", st.checked === true);
  ok("不弹窗", st.modal === true);
}

console.log("\n== E. 设置里恢复提醒 ==");
{
  await ev(`document.getElementById('settingsBtn').click()`);
  await sleep(600);
  const st = JSON.parse(await ev(`JSON.stringify({
    exists: !!document.getElementById('setPreloadWarn'),
    checked: document.getElementById('setPreloadWarn').checked,
    info: document.getElementById('setPreloadInfo').textContent,
    clearBtn: !!document.getElementById('setPreloadClear'),
  })`));
  ok("设置里有提醒开关", st.exists);
  ok("当前为关闭提醒（与已确认一致）", st.checked === false);
  ok("有清空预加载按钮", st.clearBtn);
  ok("显示常驻状态", st.info.length > 0, st.info);

  // 重新打开提醒
  await ev(`(() => { const c = document.getElementById('setPreloadWarn'); c.checked = true; c.dispatchEvent(new Event('change')); return 1; })()`);
  await sleep(300);
  const saved = JSON.parse(await ev(`localStorage.getItem('localai.settings')`));
  ok("勾上后 preloadMuted 变 false", saved.preloadMuted === false);
  await shot("14-preload-settings");

  await ev(`document.getElementById('settingsClose').click()`);
  await sleep(300);
  // 关再开，应该重新弹窗
  await ev(`document.getElementById('preloadChk').click()`);
  await sleep(600);
  await ev(`document.getElementById('preloadChk').click()`);
  await sleep(1200);
  ok("恢复提醒后重新弹窗", (await ev(`!document.getElementById('preloadWarnModal').hidden`)) === true);
  await ev(`document.getElementById('preloadCancel').click()`);
  await sleep(400);
  ok("取消后开关保持关闭", (await ev(`document.getElementById('preloadChk').checked`)) === false);
}

console.log("\n== F. 选中 @ 模型即预加载 ==");
{
  // 走静默路径（关掉提醒），避免又弹窗
  await ev(`(() => { const c = document.getElementById('setPreloadWarn'); if (!c.checked) { c.checked = true; c.dispatchEvent(new Event('change')); } return 1; })()`);
  await ev(`document.getElementById('settingsBtn').click()`);
  await sleep(300);
  await ev(`document.getElementById('settingsClose').click()`);
  await sleep(200);
  // 直接置开关为开（preloadMuted 现在 false，会弹窗；这里点开再确认）
  await ev(`document.getElementById('preloadChk').click()`);
  await sleep(1000);
  const open = await ev(`!document.getElementById('preloadWarnModal').hidden`);
  if (open) {
    await ev(`document.getElementById('preloadOk').click()`);
    await sleep(500);
  }
  ok("预加载开关已开启", (await ev(`document.getElementById('preloadChk').checked`)) === true);

  // 开启时（还没选 @ 模型）应给一条提示
  const atEnable = await ev(`[...document.querySelectorAll('#toasts .toast')].map(t => t.textContent)`);
  ok("开启时给出左下角提示", atEnable.some((x) => x.includes('已开启多回答预加载')), atEnable.join(' | '));

  // 选一个非主模型
  await ev(`document.getElementById('atBtn').click()`);
  await sleep(300);
  const picked = await ev(`(() => {
    const b = [...document.querySelectorAll('#atMenu .atItem')].find(x => !x.disabled && x.textContent.includes('Phi-4'));
    if (!b) return '';
    b.click();
    document.body.click();
    return b.textContent;
  })()`);
  ok("选中了 Phi-4", picked.includes("Phi-4"), picked.replace(/\s+/g, " ").trim());

  // 等常驻
  let text = "";
  const seen = new Set();
  for (let i = 0; i < 30; i += 1) {
    await sleep(1000);
    text = await ev(`document.getElementById('preloadState').textContent`);
    for (const x of await ev(`[...document.querySelectorAll('#toasts .toast')].map(t => t.textContent)`)) seen.add(x);
    if (text.includes("已常驻")) break;
  }
  ok("选中后自动预加载", text.includes("已常驻"), text);
  ok(
    "提示了「已完成 + 占用 X GB」",
    [...seen].some((x) => /预加载【.*】已完成，占用 \d+\.\d{2} GB 内存/.test(x)),
    [...seen].join(' | '),
  );
  const srv = await (await fetch(`${APP}/api/preload`)).json();
  ok("服务端确认真常驻", (srv.extras?.files || []).some((f) => f.file.includes("Phi-4")), JSON.stringify(srv.extras));
  await shot("15-preload-resident");

  // 取消该标签应释放。卸载模型是异步的（页面要等 /api/preload/clear 回来才弹提示），
  // 固定 sleep 会抢在提示之前读——改成按「服务端已空 + 提示已出现」轮询（2026-11-02 实测偶发红）。
  await ev(`document.querySelector('#askChips .chip button').click()`);
  let after = { extras: { files: [] } };
  let cancelToasts = [];
  for (let i = 0; i < 40; i++) {
    await sleep(300);
    after = await (await fetch(`${APP}/api/preload`)).json();
    cancelToasts = await ev(`[...document.querySelectorAll('#toasts .toast')].map(t => t.textContent)`);
    if ((after.extras?.files || []).length === 0 && cancelToasts.some((x) => /已取消，释放/.test(x))) break;
  }
  ok("取消 @ 后释放常驻", (after.extras?.files || []).length === 0, JSON.stringify(after.extras));
  ok(
    "提示了「已取消 + 释放 X GB」",
    cancelToasts.some((x) => /预加载【.*】已取消，释放 \d+\.\d{2} GB 内存/.test(x)),
    cancelToasts.join(' | '),
  );
  await sleep(5200);
  ok("提示会自动消失", (await ev(`document.querySelectorAll('#toasts .toast').length`)) === 0);
}

console.log(`\n== 结果: ${pass} 通过 / ${fail} 失败 ==\n`);
ws.close();
process.exit(fail ? 1 : 0);

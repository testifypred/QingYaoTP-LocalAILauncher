/**
 * 视觉图片入口 UI 探针（CDP 9333）
 *
 *   node probe-ui-vision.mjs [cdpBase] [appBase] [shotDir]
 *
 * 覆盖（契约 §5.2）：
 *  1) #imgBtn / #imgInput / #imgPreview 存在；
 *  2) 用 DataTransfer 注入一张 64x64 PNG -> #imgPreview 出现 1 个 .imgThumb；
 *  3) 点 .imgDel -> 预览消失；
 *  4) 设置里的视觉入口存在；有 pair 时含组合下拉 + 状态文案 + 启动/停止按钮；
 *  5) 无 pair 时点 #imgBtn 弹 toast 提示缺视觉模型（按 /api/vision/state.pairs 条件断言）；
 *  6) 不发真实视觉请求（太慢，发送路径由 probe-vision-api 覆盖）。
 * 自复位：清 localStorage 的 localai.visionPair、清预览与残留 toast；不加载/卸载模型。
 */
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const CDP = process.argv[2] || "http://127.0.0.1:9333";
const APP = process.argv[3] || "http://127.0.0.1:8099";
const OUT = process.argv[4] || "D:/LocalModels/server/docs/feature-vision-sidecar-2026-11-07";
// 64x64 PNG：蓝底白点（Pillow 生成后转 base64 常量）
const PNG64 = "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAuklEQVR42u3Y0Q2AIAxFUSDOoWO4lc7iVjqGmziAJkb6SIO9fBpTeiggksdlTz23kjpvAAAAAAAAAAAAAAAAAADAqw2N4p7bfH84rYe8oyz/qX9MvR1DCXhNvQWjuGRf8X5bQF02EkPxyl5lCP8dsA+hMULsCqh2EksczkIAAADoGKA6UVrihJ9C9iIYI7CIbUNoL2BxXIWSPUA2hb5mo9rBuJX4370QRwkAAAAAAAAAAAAAAAAACAK4APO1NXVLRxTvAAAAAElFTkSuQmCC";

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass += 1; console.log("  ok   " + name + (extra ? "  [" + extra + "]" : "")); }
  else { fail += 1; console.log("  FAIL " + name + "  " + (extra || "")); }
}

const targets = await (await fetch(CDP + "/json")).json();
const page = targets.find((t) => t.type === "page" && t.url.includes(APP.replace(/^https?:\/\//, "")));
if (!page) { console.log("没找到页面目标（CDP " + CDP + "）"); process.exit(2); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
await new Promise((r) => ws.addEventListener("open", r));
const cmd = (method, params) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
async function ev(expression) {
  const r = await cmd("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.result && r.result.exceptionDetails) {
    const d = r.result.exceptionDetails;
    throw new Error(String((d.exception && d.exception.description) || d.text || "eval failed"));
  }
  return r.result && r.result.result ? r.result.result.value : undefined;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await cmd("Page.enable");
await cmd("Runtime.enable");
// 点 #imgBtn 可能触发文件选择框：拦截掉，别让探针挂住
await cmd("Page.setInterceptFileChooserDialog", { enabled: true });
await mkdir(OUT, { recursive: true });
async function shot(name) {
  const r = await cmd("Page.captureScreenshot", { format: "png" });
  const file = path.join(OUT, name + ".png");
  await writeFile(file, Buffer.from(r.result.data, "base64"));
  console.log("    截图: " + file);
}

// 服务端有没有可用 pair：决定 toast / 下拉这些条件断言
let pairs = [];
let apiOk = false;
try {
  const r = await fetch(APP + "/api/vision/state", { signal: AbortSignal.timeout(10000) });
  if (r.ok) {
    const v = await r.json();
    pairs = Array.isArray(v.pairs) ? v.pairs : [];
    apiOk = true;
  }
} catch {}
console.log("\n== 目标 " + APP + "，CDP " + CDP + " ==");
console.log("  /api/vision/state: " + (apiOk ? pairs.length + " 组 pair" : "接口不可用"));

// 从干净状态开始：清掉上次选的组合
await ev("localStorage.removeItem('localai.visionPair'); 1");
await cmd("Page.reload", { ignoreCache: true });
await sleep(3500);

console.log("\n== A. 输入区 DOM ==");
const dom = JSON.parse(await ev("JSON.stringify({" +
  "btn: !!document.getElementById('imgBtn')," +
  "input: !!document.getElementById('imgInput')," +
  "preview: !!document.getElementById('imgPreview')," +
  "btnDisabled: !!(document.getElementById('imgBtn') || {}).disabled," +
  "inputType: (document.getElementById('imgInput') || {}).type || ''," +
  "accept: (document.getElementById('imgInput') || {}).accept || ''," +
  "previewHidden: !!document.getElementById('imgPreview') && document.getElementById('imgPreview').hidden" +
  "})"));
ok("#imgBtn 存在", dom.btn);
ok("#imgInput 存在且 type=file", dom.input && dom.inputType === "file", "type=" + dom.inputType);
ok("#imgInput 接受图片", /image/i.test(dom.accept), "accept=" + dom.accept);
ok("#imgPreview 存在且初始隐藏", dom.preview && dom.previewHidden, "hidden=" + dom.previewHidden);
ok("#imgBtn 未禁用", dom.btn && !dom.btnDisabled);

console.log("\n== B. DataTransfer 注入 64x64 PNG ==");
const inject = await ev("(async () => {" +
  " const bin = atob(" + JSON.stringify(PNG64) + ");" +
  " const arr = new Uint8Array(bin.length);" +
  " for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);" +
  " const file = new File([arr], 'probe-vision-64.png', { type: 'image/png' });" +
  " const dt = new DataTransfer();" +
  " dt.items.add(file);" +
  " const input = document.getElementById('imgInput');" +
  " if (!input) return 'no-input';" +
  " input.files = dt.files;" +
  " const n = dt.files.length;" +   // 前端处理完会清空 input.files（允许重选同一张），必须在 dispatch 前取数
  " input.dispatchEvent(new Event('change', { bubbles: true }));" +
  " return 'ok:' + n;" +
  "})()");
ok("注入 change 事件成功", String(inject).indexOf("ok:1") === 0, String(inject));

let thumb = { n: 0, hidden: true, src: "", del: false };
for (let i = 0; i < 25; i++) {
  await sleep(300);
  thumb = JSON.parse(await ev("(() => {" +
    " const box = document.getElementById('imgPreview');" +
    " const thumbs = [...document.querySelectorAll('#imgPreview .imgThumb')];" +
    " const img = thumbs[0] ? thumbs[0].querySelector('img') : null;" +
    " return JSON.stringify({" +
    "  n: thumbs.length," +
    "  hidden: box ? box.hidden : true," +
    "  src: img ? String(img.getAttribute('src') || '').slice(0, 30) : ''," +
    "  del: !!(thumbs[0] && thumbs[0].querySelector('.imgDel'))" +
    " });" +
    "})()"));
  if (thumb.n >= 1) break;
}
ok("注入后预览出现 1 个 .imgThumb", thumb.hidden === false && thumb.n === 1, "thumbs=" + thumb.n + " hidden=" + thumb.hidden);
ok("缩略图有图片源（dataURL / blob）", /^(data:image\/|blob:)/.test(thumb.src), thumb.src);
ok("缩略图内有 .imgDel 删除按钮", thumb.del === true);
await shot("ui-vision-preview");

console.log("\n== C. 删除预览 ==");
await ev("(() => { const b = document.querySelector('#imgPreview .imgDel'); if (b) b.click(); return 1; })()");
let cleared = false;
for (let i = 0; i < 15; i++) {
  await sleep(200);
  const c = JSON.parse(await ev("JSON.stringify({ n: document.querySelectorAll('#imgPreview .imgThumb').length })"));
  if (c.n === 0) { cleared = true; break; }
}
ok("点 .imgDel 后预览清空", cleared);

console.log("\n== D. 设置里的视觉入口 ==");
await ev("document.getElementById('settingsBtn').click(); 1");
await sleep(500);
const tabs = JSON.parse(await ev("JSON.stringify([...document.querySelectorAll('.settingsTabs .stab')].map((b) => ({ tab: b.dataset.tab || '', text: (b.textContent || '').trim() })))"));
const visTab = tabs.find((t) => /视觉/.test(t.text) || /vision/i.test(t.tab));
console.log("  页签: " + tabs.map((t) => t.text).join(" / "));
let visionEntry = null;
if (visTab) {
  await ev("[...document.querySelectorAll('.settingsTabs .stab')].find((b) => (b.dataset.tab || '') === " + JSON.stringify(visTab.tab) + ").click(); 1");
  await sleep(500);
  visionEntry = JSON.parse(await ev("(() => {" +
    " const bodies = [...document.querySelectorAll('.settingsBody')].filter((b) => !b.hidden);" +
    " const pick = bodies.find((b) => /vision/i.test(b.id || '') || /vision/i.test(b.dataset.pane || '')) || bodies.find((b) => /视觉|mmproj/i.test(b.textContent || ''));" +
    " if (!pick) return 'null';" +
    " return JSON.stringify({" +
    "  id: pick.id || ''," +
    "  text: String(pick.textContent || '').slice(0, 800)," +
    "  selects: [...pick.querySelectorAll('select')].map((s) => s.options.length)," +
    "  buttons: [...pick.querySelectorAll('button')].map((b) => String(b.textContent || '').trim()).filter(Boolean).slice(0, 12)" +
    " });" +
    "})()"));
  ok("设置里有「视觉」页签", true, visTab.text);
} else {
  // 契约允许「或生成页里一段」：退而检查生成页里是否提到视觉
  await ev("[...document.querySelectorAll('.settingsTabs .stab')].find((b) => (b.dataset.tab || '') === 'gen').click(); 1");
  await sleep(400);
  const genHit = JSON.parse(await ev("(() => {" +
    " const bodies = [...document.querySelectorAll('.settingsBody')].filter((b) => !b.hidden);" +
    " const hit = bodies.find((b) => /视觉模型|mmproj/i.test(b.textContent || ''));" +
    " return JSON.stringify(!!hit);" +
    "})()"));
  ok("设置里有视觉配置入口（页签或生成页内一段）", genHit === true, "没有「视觉」页签（契约允许内联）");
}
if (visionEntry) {
  ok("视觉面板定位成功", true, visionEntry.id || "(无 id)");
  if (pairs.length > 0) {
    ok("视觉面板有模型组合下拉", visionEntry.selects.length >= 1, "select=" + visionEntry.selects.length);
    ok("下拉能选到 pair（选项数 >= pair 数）", visionEntry.selects.some((n) => n >= pairs.length), "options=" + visionEntry.selects.join(",") + " pairs=" + pairs.length);
    ok("视觉面板有运行状态文案", /(未启动|未运行|未加载|运行中|启动中|已停止|状态)/.test(visionEntry.text), visionEntry.text.replace(/\s+/g, " ").slice(0, 90));
    ok("视觉面板有启动/停止按钮", visionEntry.buttons.some((t) => /启动|停止/.test(t)), visionEntry.buttons.join(" / "));
  } else {
    ok("无 pair 时视觉面板提示缺 mmproj", /(mmproj|没有可用的视觉模型|视觉模型)/.test(visionEntry.text), visionEntry.text.replace(/\s+/g, " ").slice(0, 90));
  }
  await shot("ui-vision-settings");
}

if (pairs.length === 0) {
  console.log("\n== E. 无 pair 时点 #imgBtn 的 toast ==");
  await ev("(() => {" +
    " const m = document.getElementById('settingsModal'); if (m) m.hidden = true;" +
    " document.querySelectorAll('#toasts .toast').forEach((t) => t.remove());" +
    " return 1;" +
    "})()");
  await sleep(250);
  await ev("(() => { const b = document.getElementById('imgBtn'); if (b) b.click(); return 1; })()");
  let toastText = "";
  for (let i = 0; i < 24; i++) {
    await sleep(250);
    toastText = String(await ev("[...document.querySelectorAll('#toasts .toast')].map((t) => t.textContent).join(' | ')"));
    if (/视觉模型|mmproj/.test(toastText)) break;
  }
  ok("无 pair 时点 #imgBtn 弹 toast 提示缺视觉模型", /视觉模型|mmproj/.test(toastText), toastText.slice(0, 100));
} else {
  console.log("\n== E. 有 pair：不发真实视觉请求（由 probe-vision-api 覆盖）==");
}

console.log("\n== F. 自复位 ==");
await ev("(() => {" +
  " localStorage.removeItem('localai.visionPair');" +
  " const input = document.getElementById('imgInput');" +
  " if (input) { try { input.value = ''; } catch (e) {} }" +
  " document.querySelectorAll('#imgPreview .imgDel').forEach((b) => b.click());" +
  " document.querySelectorAll('#toasts .toast').forEach((t) => t.remove());" +
  " const modal = document.getElementById('settingsModal');" +
  " if (modal) modal.hidden = true;" +
  " return 1;" +
  "})()");
await sleep(300);
const left = JSON.parse(await ev("JSON.stringify({" +
  "pair: localStorage.getItem('localai.visionPair')," +
  "thumbs: document.querySelectorAll('#imgPreview .imgThumb').length," +
  "settingsOpen: !document.getElementById('settingsModal').hidden" +
  "})"));
ok("localStorage 的 localai.visionPair 已清空", left.pair === null, "pair=" + left.pair);
ok("预览已清空", left.thumbs === 0, "thumbs=" + left.thumbs);
ok("设置弹窗已关闭", left.settingsOpen === false);

console.log("\n== 结果: " + pass + " 通过 / " + fail + " 失败 ==\n");
ws.close();
process.exit(fail ? 1 : 0);

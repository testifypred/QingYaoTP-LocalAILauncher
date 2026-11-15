// ui-check-cdp.mjs —— 视觉增强包卡片前端自检（CDP 9334 + 临时服务 8299）
// 用法：node ui-check-cdp.mjs <cdpBase> <appBase> <shotDir> [fixtureRoot]
//
// 覆盖：
//  A. 现有视觉相关 id 全部还在（#setVisionPair/#setVisionState/#setVisionStart/#setVisionStop/#setVisionHint/
//     #setVisionEdge/#setVisionParams/#setVisionLog/#imgBtn/#imgInput/#imgPreview）
//  B. 真后端「未安装」态：data-installed=0、状态行、安装目录、检测到本地包、启动键/组合下拉禁用、#imgBtn 只弹 toast
//  C. 真后端「一键安装」→ data-installed=1、来源=包安装、启动键恢复 → 「卸载」(confirm) → 回未安装
//  D. stub 三条状态：未安装（2 个本地包）/ 已安装(包，53 文件 101.1MB) / 已安装(开发目录不可卸) + 老版本自带
//  E. 兜底：接口 404（旧后端）、网络失败 —— 不白屏、不抛未捕获异常
//  F. 上传进度 UI（确定进度 47% / 不确定进度条）
//  G. 全程 Runtime.consoleAPICalled / Log.entryAdded 无 error（favicon 之类静态资源除外）
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const CDP = process.argv[2] || "http://127.0.0.1:9334";
const APP = process.argv[3] || "http://127.0.0.1:8299";
const OUT = process.argv[4] || "D:/LocalModels/server/docs/feature-vision-pack-2026-11-15";
const FIX = process.argv[5] || "";

const report = [];
let pass = 0, fail = 0;
function log(s) { report.push(s); console.log(s); }
function ok(name, cond, extra) {
  const tail = extra === undefined || extra === null || extra === "" ? "" : "  [" + String(extra).slice(0, 220) + "]";
  if (cond) { pass += 1; log("  ok   " + name + tail); }
  else { fail += 1; log("  FAIL " + name + tail); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------- CDP 连接 ----------------
const targets = await (await fetch(CDP + "/json")).json();
const page = targets.find((t) => t.type === "page" && String(t.url).indexOf("127.0.0.1:8299") >= 0);
if (!page) { console.log("没找到页面目标（CDP " + CDP + "）：" + JSON.stringify(targets.map((t) => t.url))); process.exit(2); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
const errors = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
    errors.push("console.error: " + m.params.args.map((a) => a.value || a.description || "").join(" "));
  }
  if (m.method === "Log.entryAdded" && m.params.entry.level === "error") {
    errors.push("log.error: " + m.params.entry.text + " " + (m.params.entry.url || ""));
  }
});
await new Promise((r) => ws.addEventListener("open", r));
const cmd = (method, params) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
async function ev(expression) {
  const r = await cmd("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.result && r.result.exceptionDetails) {
    const d = r.result.exceptionDetails;
    throw new Error("页面异常：" + String((d.exception && d.exception.description) || d.text || "eval failed"));
  }
  return r.result && r.result.result ? r.result.result.value : undefined;
}
async function waitFor(expression, timeoutMs, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const v = await ev(expression);
    if (v) return v;
    await sleep(120);
  }
  throw new Error("等待超时：" + label);
}
await cmd("Page.enable");
await cmd("Runtime.enable");
await cmd("Log.enable");
await cmd("Page.setInterceptFileChooserDialog", { enabled: true });
await mkdir(OUT, { recursive: true });
async function shot(name) {
  const r = await cmd("Page.captureScreenshot", { format: "png" });
  const file = path.join(OUT, name + ".png");
  await writeFile(file, Buffer.from(r.result.data, "base64"));
  log("    截图: " + file);
}

// 读卡片全状态（页面内 DOM → JSON）。不用模板字符串/正则，避免多层转义。
const CARD_EXPR = [
  "(function () {",
  "  var $ = function (id) { return document.getElementById(id); };",
  "  var txt = function (id) { var e = $(id); return e ? String(e.textContent).trim() : ''; };",
  "  var c = $('vpCard');",
  "  if (!c) return null;",
  "  var btnText = function () { return Array.prototype.map.call(document.querySelectorAll('#vpDetected button'), function (b) { return b.textContent; }); };",
  "  return {",
  "    installed: c.getAttribute('data-installed'),",
  "    status: txt('vpStatus'),",
  "    detail: txt('vpDetail'),",
  "    hint: txt('vpHint'),",
  "    detected: txt('vpDetected'),",
  "    detectedHidden: !!$('vpDetected') && $('vpDetected').hidden,",
  "    detectedBtns: btnText(),",
  "    installDisabled: !!$('vpInstallBtn') && $('vpInstallBtn').disabled,",
  "    uninstallDisabled: !!$('vpUninstallBtn') && $('vpUninstallBtn').disabled,",
  "    startDisabled: !!$('setVisionStart') && $('setVisionStart').disabled,",
  "    pairDisabled: !!$('setVisionPair') && $('setVisionPair').disabled,",
  "    imgDisabled: !!$('imgBtn') && $('imgBtn').disabled,",
  "    progressHidden: !!$('vpProgress') && $('vpProgress').hidden,",
  "    progressText: txt('vpProgressText'),",
  "    toasts: txt('toasts'),",
  "    html: c.outerHTML.slice(0, 240)",
  "  };",
  "})()",
].join(String.fromCharCode(10));
const card = () => ev(CARD_EXPR);
const clearToasts = () => ev("(function () { var t = document.getElementById('toasts'); if (t) t.textContent = ''; return 1; })()");

async function openVisionTab() {
  await ev("(function () { var s = document.getElementById('settingsBtn'); if (s) s.click(); return 1; })()");
  await sleep(180);
  const hit = await ev("(function () { var b = Array.prototype.find.call(document.querySelectorAll('.settingsTabs .stab'), function (x) { return x.getAttribute('data-tab') === 'vision'; }); if (b) b.click(); return !!b; })()");
  await waitFor("(function () { var s = document.getElementById('vpStatus'); var c = document.getElementById('vpCard'); var p = document.getElementById('paneVision'); var m = document.getElementById('settingsModal'); return !!s && !!c && !!p && !!m && m.hidden === false && p.hidden === false && String(s.textContent).indexOf('正在读取') < 0 && c.getAttribute('data-installed') !== null; })()", 10000, "视觉页卡片就绪（设置弹窗可见）");
  return hit;
}
// 用 stub 包住 GET /api/vision/pack：其余请求透传真 fetch
async function setStub(payload) {
  const bodyLiteral = JSON.stringify(JSON.stringify(payload)); // 页面里 new Response("<json>", ...)
  await ev("(function () { window.__vpOrigFetch = window.__vpOrigFetch || window.fetch; window.fetch = function (u, o) { var s = String(u); var m = (o && o.method) ? String(o.method).toUpperCase() : 'GET'; if (m === 'GET' && s.indexOf('/api/vision/pack') === 0) { return Promise.resolve(new Response(" + bodyLiteral + ", { status: 200, headers: { 'content-type': 'application/json' } })); } return window.__vpOrigFetch(u, o); }; return 1; })()");
}
async function setStub404() {
  await ev("(function () { window.__vpOrigFetch = window.__vpOrigFetch || window.fetch; window.fetch = function (u, o) { var s = String(u); var m = (o && o.method) ? String(o.method).toUpperCase() : 'GET'; if (m === 'GET' && s.indexOf('/api/vision/pack') === 0) { return Promise.resolve(new Response('{\"error\":{\"message\":\"no route\"}}', { status: 404, headers: { 'content-type': 'application/json' } })); } return window.__vpOrigFetch(u, o); }; return 1; })()");
}
async function setStubThrow() {
  await ev("(function () { window.__vpOrigFetch = window.__vpOrigFetch || window.fetch; window.fetch = function (u, o) { var s = String(u); if (s.indexOf('/api/vision/pack') === 0) { return Promise.reject(new Error('模拟网络失败')); } return window.__vpOrigFetch(u, o); }; return 1; })()");
}
async function restoreFetch() {
  await ev("(function () { if (window.__vpOrigFetch) window.fetch = window.__vpOrigFetch; return 1; })()");
}
// 清掉 state 缓存，保证兜底分支真的走 pack 接口
const clearStateCache = () => ev("(function () { visionStateLoaded = false; visionStateCache = null; return 1; })()");

const stubUninstalled = {
  ok: true, installed: false, dir: "C:\\Temp\\vp-ui-test\\llama", target: "C:\\Temp\\vp-ui-test\\llama",
  source: "none", version: "1.6.0", sidecar: "b12144", files: 0, bytes: 0, installedAt: "",
  uninstallable: false, running: false,
  available: [
    { path: "C:\\Temp\\vp-ui-test\\packs\\QingYaoTP-AILauncher-v1.6.0-vision-pack.zip", name: "QingYaoTP-AILauncher-v1.6.0-vision-pack.zip", bytes: 41234567, version: "1.6.0" },
    { path: "C:\\Temp\\vp-ui-test\\packs\\QingYaoTP-AILauncher-v1.5.1-vision-pack.zip", name: "QingYaoTP-AILauncher-v1.5.1-vision-pack.zip", bytes: 40500000, version: "1.5.1" }
  ],
  note: ""
};
const stubInstalledPack = {
  ok: true, installed: true, dir: "C:\\app\\llama", target: "C:\\app\\llama",
  source: "pack", version: "1.6.0", sidecar: "b12144", files: 53, bytes: 106004121,
  installedAt: "2026-11-15T04:20:00.000Z", uninstallable: true, running: false,
  available: stubUninstalled.available, note: ""
};
const stubInstalledLegacy = {
  ok: true, installed: true, dir: "D:\\LocalModels\\dist\\QingYaoTP AILauncher\\app\\llama", target: "D:\\LocalModels\\dist\\QingYaoTP AILauncher\\app\\llama",
  source: "legacy", version: "", sidecar: "", files: 53, bytes: 106004121,
  installedAt: "", uninstallable: true, running: false, available: [], note: "老版本自带（没有 .vision-pack.json 标记）"
};
const stubInstalledTools = {
  ok: true, installed: true, dir: "D:\\LocalModels\\tools\\llama.cpp", target: "C:\\app\\llama",
  source: "tools", version: "", sidecar: "", files: 53, bytes: 106004121,
  installedAt: "", uninstallable: false, running: false, available: [], note: "开发目录（不可卸载）"
};

// ---------------- A. 现有 id 保留 ----------------
log("== A. 现有 id 保留 ==");
const ids = ["vpCard", "setVisionPair", "setVisionState", "setVisionStart", "setVisionStop", "setVisionHint", "setVisionEdge", "setVisionParams", "setVisionLog", "imgBtn", "imgInput", "imgPreview", "vpStatus", "vpDetail", "vpInstallBtn", "vpUninstallBtn", "vpFile", "vpHint", "vpDetected", "vpProgress"];
const missing = await ev("(function () { var need = " + JSON.stringify(ids) + "; return need.filter(function (id) { return !document.getElementById(id); }); })()");
ok("契约要求的 20 个 id 全在", Array.isArray(missing) && missing.length === 0, "缺: " + JSON.stringify(missing));
ok("#vpFile 是 accept=.zip 的隐藏 file input", await ev("(function () { var f = document.getElementById('vpFile'); return !!f && f.type === 'file' && f.accept === '.zip' && f.hidden; })()"));
ok("视觉设置页在设置弹窗里", await ev("(function () { return !!document.getElementById('settingsModal') && !!document.getElementById('paneVision'); })()"));

// ---------------- B. 真后端：未安装态 ----------------
log("");
log("== B. 真后端「未安装」态 ==");
ok("点到了「设置 → 视觉」页签", (await openVisionTab()) === true);
await sleep(400);
let c = await card();
ok("卡片已渲染（#vpCard 存在）", !!c);
ok("data-installed = 0", c && c.installed === "0", c && c.installed);
ok("状态行写「未安装」", c && c.status.indexOf("未安装") >= 0, c && c.status);
ok("明细里有安装目录", c && c.detail.indexOf("安装目录") >= 0, c && c.detail);
ok("#vpDetected 可见且有「一键安装」按钮", c && !c.detectedHidden && (c.detectedBtns || []).indexOf("一键安装") >= 0, c && c.detected.slice(0, 120));
ok("#vpDetected 列出了本地增强包名字", c && c.detected.indexOf("vision-pack") >= 0, c && c.detected.slice(0, 160));
ok("#setVisionStart 已禁用", c && c.startDisabled === true);
ok("#setVisionPair 组合下拉已禁用", c && c.pairDisabled === true);
ok("#vpUninstallBtn 已禁用（未安装）", c && c.uninstallDisabled === true);
await clearToasts();
const imgClick = await ev("(function () { var b = document.getElementById('imgBtn'); if (!b) return 'no-btn'; b.click(); return 'clicked'; })()");
await sleep(500);
let after = await card();
ok("#imgBtn 未安装时仍可点（不置灰）", imgClick === "clicked" && after && after.imgDisabled === false);
ok("#imgBtn 点后只弹「视觉增强包未安装…」toast", after && after.toasts.indexOf("视觉增强包未安装") >= 0 && after.toasts.indexOf("设置 → 视觉") >= 0, after && after.toasts.slice(0, 160));
ok("未安装时没有打开文件选择框（仍停在视觉页）", await ev("(function () { return document.getElementById('paneVision') && !document.getElementById('paneVision').hidden; })()"));
await ev("(function () { var t = document.getElementById('toasts'); if (t) t.textContent = ''; var s = document.querySelector('#settingsModal .settingsBody'); if (s) s.scrollTop = 0; return 1; })()");
await shot("ui-pack-card");

// ---------------- C. 真后端：一键安装 → 卸载 ----------------
log("");
log("== C. 真后端「一键安装」→ 已安装 → 卸载 ==");
const clicked = await ev("(function () { var b = Array.prototype.find.call(document.querySelectorAll('#vpDetected button'), function (x) { return x.textContent.indexOf('一键安装') >= 0; }); if (!b) return false; b.click(); return true; })()");
ok("点到「一键安装」", clicked === true);
await waitFor("(function () { var c = document.getElementById('vpCard'); return !!c && c.getAttribute('data-installed') === '1'; })()", 20000, "安装完成 data-installed=1");
await sleep(400);
c = await card();
ok("安装后 data-installed = 1", c && c.installed === "1");
ok("状态行写「已安装 v1.6.0 · 8 个文件」", c && c.status.indexOf("已安装") >= 0 && c.status.indexOf("v1.6.0") >= 0 && c.status.indexOf("8 个文件") >= 0, c && c.status);
ok("明细写「来源：包安装」", c && c.detail.indexOf("来源：包安装") >= 0, c && c.detail);
ok("安装目录指向临时安装目标", c && c.detail.indexOf(path.resolve(FIX || ".", "llama")) >= 0, c && c.detail.slice(0, 200));
ok("安装后 #vpUninstallBtn 可用", c && c.uninstallDisabled === false);
ok("安装后 #setVisionStart 可用（有 pair 且未运行）", c && c.startDisabled === false);
ok("安装后 #setVisionPair 可用", c && c.pairDisabled === false);
ok("安装后 #imgBtn 仍可用", c && c.imgDisabled === false);
ok("磁盘上安装目录里有 llama-server.exe", FIX ? existsSync(path.join(FIX, "llama", "llama-server.exe")) : true, FIX ? path.join(FIX, "llama", "llama-server.exe") : "");
await ev("(function () { var s = document.querySelector('#settingsModal .settingsBody'); if (s) s.scrollTop = 0; return 1; })()");
await shot("ui-pack-installed");

const confirmed = await ev("(function () { window.__vpOrigConfirm = window.confirm; window.confirm = function () { return true; }; return true; })()");
ok("卸载前把 confirm 改成自动确认（模拟用户点确定）", confirmed === true);
await ev("(function () { var b = document.getElementById('vpUninstallBtn'); if (!b) return false; b.click(); return true; })()");
await waitFor("(function () { var c = document.getElementById('vpCard'); return !!c && c.getAttribute('data-installed') === '0'; })()", 20000, "卸载完成 data-installed=0");
await sleep(400);
c = await card();
ok("卸载后 data-installed = 0", c && c.installed === "0");
ok("卸载后状态行回到「未安装」", c && c.status.indexOf("未安装") >= 0, c && c.status);
ok("卸载后 #setVisionStart 再次禁用", c && c.startDisabled === true);
ok("卸载后 #setVisionPair 再次禁用", c && c.pairDisabled === true);
ok("磁盘上安装目录已删除", FIX ? !existsSync(path.join(FIX, "llama")) : true, FIX ? path.join(FIX, "llama") : "");
await ev("(function () { if (window.__vpOrigConfirm) window.confirm = window.__vpOrigConfirm; return 1; })()");

// ---------------- C2. 选 zip 上传（XHR 原始字节） ----------------
log("");
log("== C2. 选 zip 上传安装（XHR 原始字节）→ 再卸载 ==");
if (FIX) {
  const zipBytes = await readFile(path.join(FIX, "packs", "QingYaoTP-AILauncher-v1.6.0-vision-pack.zip"));
  const zipB64 = zipBytes.toString("base64");
  const picked = await ev("(async function () { var bin = atob('" + zipB64 + "'); var arr = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i); var f = new File([arr], 'QingYaoTP-AILauncher-v1.6.0-vision-pack.zip', { type: 'application/zip' }); var dt = new DataTransfer(); dt.items.add(f); var inp = document.getElementById('vpFile'); inp.files = dt.files; var n = dt.files.length; inp.dispatchEvent(new Event('change', { bubbles: true })); return n; })()");
  ok("#vpFile 选包后触发上传（change 事件派发成功）", picked === 1, String(picked));
  await waitFor("(function () { var c = document.getElementById('vpCard'); return !!c && c.getAttribute('data-installed') === '1'; })()", 20000, "上传安装完成 data-installed=1");
  await sleep(400);
  c = await card();
  ok("上传安装成功：data-installed=1", c && c.installed === "1");
  ok("上传安装成功：来源=包安装、状态行已安装", c && c.status.indexOf("已安装") >= 0 && c.detail.indexOf("来源：包安装") >= 0, c && (c.status + " | " + c.detail));
  ok("上传安装成功：toast 提示已安装", c && c.toasts.indexOf("视觉增强包已安装") >= 0, c && c.toasts.slice(0, 120));
  ok("上传安装成功：进度条已收起", c && c.progressHidden === true);
  await ev("(function () { window.__vpOrigConfirm = window.confirm; window.confirm = function () { return true; }; return 1; })()");
  await ev("(function () { var b = document.getElementById('vpUninstallBtn'); if (b) b.click(); return 1; })()");
  await waitFor("(function () { var c = document.getElementById('vpCard'); return !!c && c.getAttribute('data-installed') === '0'; })()", 20000, "上传安装后再卸载");
  await ev("(function () { if (window.__vpOrigConfirm) window.confirm = window.__vpOrigConfirm; return 1; })()");
  ok("上传安装后能卸载回未安装", (await card()).installed === "0");
} else {
  ok("上传安装（跳过了：没传 fixtureRoot）", false);
}

// ---------------- D. stub 三条状态 ----------------
log("");
log("== D. stub 状态渲染（未安装 / 已安装包 / 开发目录 / 老版本自带） ==");
await setStub(stubUninstalled);
await ev("(function () { return loadVisionTab(); })()");
c = await card();
ok("[stub 未安装] data-installed=0", c && c.installed === "0");
ok("[stub 未安装] 检测到 2 个本地包、2 个一键安装按钮", c && !c.detectedHidden && (c.detectedBtns || []).length === 2 && c.detected.indexOf("v1.5.1") >= 0, c && c.detected.slice(0, 200));
ok("[stub 未安装] 启动键 / 组合下拉禁用", c && c.startDisabled === true && c.pairDisabled === true);
await shot("ui-pack-stub-uninstalled");

await setStub(stubInstalledPack);
await ev("(function () { return loadVisionTab(); })()");
c = await card();
ok("[stub 已安装包] data-installed=1", c && c.installed === "1");
ok("[stub 已安装包] 状态行 = 已安装 v1.6.0 · 53 个文件 / 101.1 MB", c && c.status.indexOf("已安装 v1.6.0") >= 0 && c.status.indexOf("53 个文件") >= 0 && c.status.indexOf("101.1 MB") >= 0, c && c.status);
ok("[stub 已安装包] 明细 = 安装目录 + 来源：包安装 + sidecar b12144", c && c.detail.indexOf("来源：包安装") >= 0 && c.detail.indexOf("b12144") >= 0 && c.detail.indexOf("安装于 2026-11-15") >= 0, c && c.detail);
ok("[stub 已安装包] 卸载可用 / 启动键可用 / 重装文案", c && c.uninstallDisabled === false && c.startDisabled === false && c.installDisabled === false, c && c.hint);
await shot("ui-pack-stub-installed");

await setStub(stubInstalledTools);
await ev("(function () { return loadVisionTab(); })()");
c = await card();
ok("[stub 开发目录] data-installed=1", c && c.installed === "1");
ok("[stub 开发目录] 明细 = 来源：开发目录", c && c.detail.indexOf("来源：开发目录") >= 0, c && c.detail);
ok("[stub 开发目录] 卸载按钮禁用 + hint 说明不可卸", c && c.uninstallDisabled === true && c.hint.indexOf("开发目录") >= 0, c && c.hint);
await shot("ui-pack-stub-tools");

await setStub(stubInstalledLegacy);
await ev("(function () { return loadVisionTab(); })()");
c = await card();
ok("[stub 老版本自带] 来源显示「老版本自带」", c && c.detail.indexOf("来源：老版本自带") >= 0, c && c.detail);
ok("[stub 老版本自带] 卸载可用（target 下可卸）", c && c.uninstallDisabled === false);

// ---------------- E. 兜底：404 / 网络失败 ----------------
log("");
log("== E. 兜底：旧后端 404 / 网络失败（不白屏、不抛未捕获异常） ==");
await clearStateCache();
await setStub404();
const r404 = await ev("(function () { return loadVisionPack(true).then(function () { return 'ok'; }, function (e) { return 'REJECT: ' + e.message; }); })()");
ok("404 时 loadVisionPack 不 reject", r404 === "ok", r404);
c = await card();
ok("404 兜底：data-installed=1（旧后端视觉随主包）、状态说明不支持", c && c.installed === "1" && c.status.indexOf("不支持") >= 0, c && c.status);
ok("404 兜底：安装 / 卸载按钮禁用", c && c.installDisabled === true && c.uninstallDisabled === true);
await ev("(function () { var s = document.querySelector('#settingsModal .settingsBody'); if (s) s.scrollTop = 0; return 1; })()");
await shot("ui-pack-fallback-404");

await clearStateCache();
await setStubThrow();
const rNet = await ev("(function () { return loadVisionPack(true).then(function () { return 'ok'; }, function (e) { return 'REJECT: ' + e.message; }); })()");
ok("网络失败时 loadVisionPack 不 reject", rNet === "ok", rNet);
c = await card();
ok("网络失败兜底：状态行写读取失败、不白屏", c && c.status.indexOf("读取") >= 0 && c.status.indexOf("失败") >= 0, c && c.status);
ok("网络失败兜底：hint 提示可重试", c && c.hint.indexOf("重试") >= 0, c && c.hint);
ok("网络失败兜底：不误禁用 #imgBtn", c && c.imgDisabled === false);
await restoreFetch();

// ---------------- F. 进度 UI ----------------
log("");
log("== F. 进度 UI ==");
await ev("(function () { showVisionPackProgress('上传中 47%（18.6 MB / 39.3 MB）', false, 47); return 1; })()");
c = await card();
ok("确定进度：显示「上传中 47%」", c && c.progressHidden === false && c.progressText.indexOf("47%") >= 0, c && c.progressText);
ok("确定进度：进度条宽度 47%", (await ev("(function () { var f = document.getElementById('vpProgressFill'); return f ? f.style.width : ''; })()")) === "47%");
await ev("(function () { showVisionPackProgress('上传完成 100% · 正在解压安装…', true); return 1; })()");
ok("不确定进度：文案「正在解压安装…」+ vpIndet 类", (await ev("(function () { var f = document.getElementById('vpProgressFill'); var t = document.getElementById('vpProgressText'); return !!f && f.classList.contains('vpIndet') && String(t.textContent).indexOf('解压') >= 0; })()")) === true);
await ev("(function () { hideVisionPackProgress(); return 1; })()");
ok("hideVisionPackProgress 后 #vpProgress 隐藏", (await card()).progressHidden === true);

// 收尾：恢复真 fetch / 真状态
await restoreFetch();
await ev("(function () { visionStateLoaded = false; visionStateCache = null; visionPackLoaded = false; return loadVisionPack(true); })()");
await sleep(300);
c = await card();
ok("收尾：回到真后端状态（未安装 data-installed=0）", c && c.installed === "0", c && c.status);

// ---------------- G. 控制台错误 ----------------
log("");
log("== G. 控制台 ==");
const realErrors = errors.filter((e) => e.indexOf("favicon") < 0 && e.indexOf("manifest.json") < 0);
ok("全程无 Runtime/Log error（favicon 资源除外）", realErrors.length === 0, realErrors.slice(0, 3).join(" | "));
if (errors.length) log("  （已忽略的环境噪声：" + errors.length + " 条）");

// ---------------- 汇总 ----------------
log("");
log("== 汇总：PASS " + pass + " / FAIL " + fail + " ==");
await writeFile(path.join(OUT, "ui-check-result.txt"), report.join(String.fromCharCode(10)) + String.fromCharCode(10), "utf8");
console.log("报告: " + path.join(OUT, "ui-check-result.txt"));
if (fail) { console.log("有失败项"); process.exit(1); }
console.log("全部通过");
process.exit(0);

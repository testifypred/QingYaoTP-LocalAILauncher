/**
 * 显卡页 UI 探针（设置 → 显卡：独显调动入口）
 *
 *   node probe-ui-gpu.mjs [cdpBase] [appBase]
 *
 * 覆盖：页签存在、设备列表与 /api/gpus 一致、「自动」选项、选中设备 0 保存后 config=0、
 *       恢复「自动」后 config 为空、界面提示重启、无未捕获 JS 异常。
 * 会临时改 config.ini 的 vkDevices，跑完恢复成空。
 */
import WebSocket from "ws";
const CDP = process.argv[2] || "http://127.0.0.1:9333";
const APP = process.argv[3] || "http://127.0.0.1:8099";
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) { pass++; console.log("  ok   " + n + (d ? "  [" + d + "]" : "")); } else { fail++; console.log("  FAIL " + n + "  " + d); } };

const list = await (await fetch(CDP + "/json/list")).json();
const page = list.find((t) => t.type === "page" && t.url.includes(APP.replace(/^https?:\/\//, "")));
if (!page) { console.log("没找到页面"); process.exit(2); }
const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise((r, j) => { ws.once("open", r); ws.once("error", j); });
let id = 0; const pend = new Map();
ws.on("message", (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) throw new Error(String(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text).slice(0, 200)); return r.result?.result?.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const j = async (method, p, body) => {
  const r = await fetch(APP + p, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  return await r.json();
};

const errors = [];
ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.method === "Runtime.exceptionThrown") errors.push(String(m.params?.exceptionDetails?.exception?.description || "").slice(0, 120));
  if (m.method === "Runtime.consoleAPICalled" && m.params?.type === "error") errors.push((m.params.args || []).map((a) => a.value).join(" ").slice(0, 120));
});
await send("Page.enable"); await send("Runtime.enable");
await send("Page.reload", { ignoreCache: true }); await sleep(3200);

const api0 = await j("GET", "/api/gpus");
await ev("document.getElementById('settingsBtn').click(); 1"); await sleep(500);
ok("设置里有「显卡」页签", (await ev("!!document.querySelector('.settingsTabs .stab[data-tab=gpu]')")) === true);
await ev("showSettingsTab('gpu'); 1"); await sleep(1200);
const info = String(await ev("(document.getElementById('gpuBackendInfo')||{}).textContent||''"));
ok("显示后端信息", /后端：/.test(info) && /vulkan|cpu/i.test(info), info.slice(0, 60));
const rows = Number(await ev("document.querySelectorAll('#gpuList input[name=gpuDev]').length"));
const want = (api0.devices || []).length;
ok("设备选项数 = 服务端设备数 + 自动", rows === want + (want ? 1 : 0), "rows=" + rows + " devices=" + want);
ok("有「自动」选项", (await ev("!!document.querySelector('#gpuList input[name=gpuDev][value=\"\"]')")) === true);
if (want > 0) {
  await ev("(() => { const r = document.querySelector('#gpuList input[name=gpuDev][value=\"0\"]'); r.checked = true; return 1; })()");
  await ev("document.getElementById('gpuSave').click(); 1"); await sleep(1200);
  const saved = await j("GET", "/api/gpus");
  const hint = String(await ev("(document.getElementById('gpuHint')||{}).textContent||''"));
  if (api0.configWritable === false) {
    // 源码模式（node app.mjs）没有 config.ini：服务端只回 note 不写盘，这里断言「给了说明」而不是 config=0
    ok("保存设备 0 后未写盘并给出说明（开发目录）", String(saved.config) === "" && /config\.ini|没写盘|环境变量/.test(hint), "config=" + String(saved.config) + " hint=" + hint.slice(0, 40));
  } else {
    ok("保存设备 0 后 config=0", String(saved.config) === "0", "config=" + saved.config);
    ok("界面提示已保存/要重启", /已保存|重启|config\.ini/.test(hint), hint.slice(0, 60));
  }
  // 恢复「自动」
  await ev("(() => { const r = document.querySelector('#gpuList input[name=gpuDev][value=\"\"]'); r.checked = true; return 1; })()");
  await ev("document.getElementById('gpuSave').click(); 1"); await sleep(1200);
  const back = await j("GET", "/api/gpus");
  ok("恢复「自动」后 config 为空", String(back.config) === "", "config=" + back.config);
}
ok("没有未捕获的 JS 错误", errors.length === 0, errors.join(" | ").slice(0, 160));

console.log("\n== 结果: " + pass + " 通过 / " + fail + " 失败 ==\n");
ws.close();
process.exit(fail ? 1 : 0);

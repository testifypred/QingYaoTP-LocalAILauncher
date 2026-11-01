/**
 * 「关于」页探针（Edge CDP，需服务已在跑 + headless Edge 开着 9333）
 *
 *   node probe-ui-version.mjs [cdp] [base]
 *
 * 覆盖：设置有「关于」页 → 点开只显示这一页 → 版本/构建/运行三行有内容且与服务端一致
 *       → 「复制版本信息」能写进剪贴板 → 切回生成页后关于页收起。
 */
import WebSocket from "ws";

const CDP = process.argv[2] || "http://127.0.0.1:9333";
const BASE = process.argv[3] || "http://127.0.0.1:8099";

const list = await (await fetch(CDP + "/json/list")).json();
const page = list.find((t) => t.type === "page" && t.url.includes("8099"));
if (!page) { console.log("no page"); process.exit(2); }

const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise((r, j) => { ws.once("open", r); ws.once("error", j); });
let id = 0; const pend = new Map();
ws.on("message", (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (e) => {
  const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text + " " + (r.result.exceptionDetails.exception?.description || ""));
  return r.result?.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) { pass++; console.log("  ok   " + n + (d ? "  [" + d + "]" : "")); } else { fail++; console.log("  FAIL " + n + "  " + d); } };

const ver = await (await fetch(BASE + "/api/version")).json();
console.log("\n== 界面 " + page.url + " / 服务端 v" + ver.version + " ==\n");

await send("Page.enable"); await send("Runtime.enable");
// headless 默认不给剪贴板权限，显式授一次，否则「复制」只能走降级分支
try { await send("Browser.grantPermissions", { origin: "http://127.0.0.1:8099", permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"] }); } catch {}
await send("Page.reload", { ignoreCache: true });
await sleep(2800);

await ev("document.getElementById('settingsBtn').click(); 1");
await sleep(400);
const tabs = await ev("[...document.querySelectorAll('.settingsTabs .stab')].map(b => b.textContent)");
ok("设置里有「关于」页", tabs.includes("关于"), JSON.stringify(tabs));

await ev("[...document.querySelectorAll('.settingsTabs .stab')].find(b => b.dataset.tab === 'about').click(); 1");
await sleep(400);
const shown = await ev("({ about: !document.getElementById('paneAbout').hidden, gen: !document.getElementById('paneGen').hidden, tools: !document.getElementById('paneTools').hidden })");
ok("点开只显示关于页", shown.about === true && shown.gen === false && shown.tools === false, JSON.stringify(shown));

const txt = await ev("({v: document.getElementById('aboutVersion').textContent, b: document.getElementById('aboutBuild').textContent, r: document.getElementById('aboutRuntime').textContent, d: document.getElementById('aboutDir').textContent})");
ok("版本行是 v 版本号", txt.v === "v" + ver.version, txt.v);
ok("构建行点明了来源", /提交于|打包于|不可用/.test(txt.b || ""), txt.b);
ok("运行行有 node 与端口", String(txt.r).includes("Node") && String(txt.r).includes(String(ver.port)), txt.r);
ok("目录行填了服务端目录", String(txt.d).length > 3, txt.d);

const copied = await ev("(async () => {" +
  "document.getElementById('aboutCopy').click();" +
  "await new Promise((r) => setTimeout(r, 700));" +
  "let clip = ''; try { clip = await navigator.clipboard.readText(); } catch {}" +
  "return { btn: document.getElementById('aboutCopy').textContent, clip: clip };" +
"})()");
ok("复制按钮给出反馈", /已复制|复制失败/.test(String(copied.btn)), copied.btn);
ok("剪贴板里是版本信息", /QingYaoTP AILauncher v\d+\.\d+\.\d+/.test(String(copied.clip || "")), String(copied.clip).slice(0, 90));

await ev("[...document.querySelectorAll('.settingsTabs .stab')].find(b => b.dataset.tab === 'gen').click(); 1");
await sleep(250);
ok("切回生成页后关于页收起", await ev("document.getElementById('paneAbout').hidden"));
await ev("document.getElementById('settingsClose').click(); 1");

console.log("\nRESULT " + pass + "/" + (pass + fail));
ws.close();
process.exit(fail ? 1 : 0);

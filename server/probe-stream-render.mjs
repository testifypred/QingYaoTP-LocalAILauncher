/**
 * 主页面流式渲染 / 首字税探针（2026-11-22 输出优化）
 *
 *   node probe-stream-render.mjs [cdp] [base]
 *
 * 覆盖：
 *  A) 增量渲染器存在；块级切分（head 子节点）、最终 KaTeX 与 Markdown 正确；
 *  B) 6000 字 × 200 帧：新 update 明显快于旧「每帧整段 renderAssistant」；
 *  C) 首字税 chip（工具/思考）与「极简流式」设置项存在、可切换；
 *  D) 极简流式分支：生成中纯文本、结束后套 Markdown。
 *
 * 前置：Edge headless 在 9333，页面已导航到 BASE；纯页面内渲染测试，不真发消息、不写数据。
 */
import WebSocket from "ws";

const CDP = process.argv[2] || "http://127.0.0.1:9333";
const BASE = process.argv[3] || "http://127.0.0.1:8099";

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass += 1; console.log("  ok   " + name + (extra ? "  [" + extra + "]" : "")); }
  else { fail += 1; console.log("  FAIL " + name + "  " + (extra || "")); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const list = await (await fetch(CDP + "/json/list")).json();
const page = list.find((t) => t.type === "page" && String(t.url).startsWith(BASE));
if (!page) {
  console.log("  FAIL 找不到 " + BASE + " 的页面目标（现有：" + list.map((t) => t.type + " " + t.url).join(" | ") + "）");
  process.exit(2);
}
const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise((r, j) => { ws.once("open", r); ws.once("error", j); });
let seq = 0;
const pending = new Map();
const exceptions = [];
ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.method === "Runtime.exceptionThrown") {
    exceptions.push(String(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 200));
  }
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const cmd = (method, params) => new Promise((resolve, reject) => {
  const id = ++seq;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error("超时 " + method)); }, 30000);
  pending.set(id, (m) => { clearTimeout(timer); resolve(m); });
  ws.send(JSON.stringify({ id, method, params: params || {} }));
});
const ev = async (expression) => {
  const r = await cmd("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.result && r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.text);
  return r.result && r.result.result ? r.result.result.value : undefined;
};
/** 把 Node 里写的函数源码原样丢进页面执行（避免在探针里拼长字符串） */
const evFn = (fn) => ev("(" + fn.toString() + ")()");

function pageChipIdle() {
  var t = document.querySelector("#toolChk");
  var k = document.querySelector("#thinkChk");
  window.__origTools = t.checked;
  window.__origThink = k.checked;
  t.checked = false;
  k.checked = false;
  updateModeChip();
  var chip = document.querySelector("#genModeChip");
  return { hidden: chip.hidden, text: chip.textContent };
}
function pageChipOn() {
  var t = document.querySelector("#toolChk");
  t.checked = true;
  updateModeChip();
  var chip = document.querySelector("#genModeChip");
  var out = { hidden: chip.hidden, text: chip.textContent };
  t.checked = false;
  updateModeChip();
  return out;
}
function pagePerf() {
  var BT = String.fromCharCode(96);
  var FENCE = BT + BT + BT;
  var block = [
    "## 小结", "",
    "正文里有 $x^2+y^2=z^2$，还有 **粗体** 与 " + BT + "code" + BT + "。", "",
    "$$\\int_0^1 x^2\\,dx=\\frac{1}{3}$$", "",
    "- 列表项一", "- 列表项二", "",
    FENCE + "js", "const a = 1;", FENCE, "", "",
  ].join("\n");
  var text = "";
  while (text.length < 6000) text += block;
  text = text.slice(0, 6000);
  var d1 = document.createElement("div");
  var d2 = document.createElement("div");
  d1.style.cssText = "position:absolute;left:-9999px;top:0;width:760px";
  d2.style.cssText = d1.style.cssText;
  document.body.append(d1, d2);
  var frames = 200;
  var view = createStreamView(d1);
  var t0 = performance.now();
  for (var i = 1; i <= frames; i += 1) view.update(text.slice(0, Math.floor(text.length * i / frames)));
  var newMs = (performance.now() - t0) / frames;
  var head = d1.firstElementChild;
  var blocks = head ? head.children.length : -1;
  t0 = performance.now();
  for (var j = 1; j <= frames; j += 1) renderAssistant(d2, text.slice(0, Math.floor(text.length * j / frames)));
  var oldMs = (performance.now() - t0) / frames;
  view.finish(text);
  var out = {
    newMs: +newMs.toFixed(2),
    oldMs: +oldMs.toFixed(2),
    blocks: blocks,
    katex: d1.querySelectorAll(".katex").length,
    html: d1.innerHTML.slice(0, 4000),
  };
  d1.remove();
  d2.remove();
  return out;
}
function pageLite() {
  document.querySelector("#setStreamLite").checked = true;
  document.querySelector("#settingsSave").click();
  var d = document.createElement("div");
  document.body.appendChild(d);
  var view = createStreamView(d);
  view.update("**粗体** 与 $x^2$");
  var mid = { children: d.children.length, text: d.textContent };
  view.finish("**粗体** 与 $x^2$");
  var fin = { hasStrong: /<(strong|b)/i.test(d.innerHTML), katex: d.querySelectorAll(".katex").length };
  d.remove();
  document.querySelector("#setStreamLite").checked = false;
  document.querySelector("#settingsSave").click();
  document.querySelector("#toolChk").checked = !!window.__origTools;
  document.querySelector("#thinkChk").checked = !!window.__origThink;
  updateModeChip();
  return { mid: mid, fin: fin };
}

console.log("\n== 目标页面 " + BASE + " ==");
await cmd("Runtime.enable");
await cmd("Log.enable");

ok("页面有增量渲染器 createStreamView", (await ev("typeof createStreamView === 'function'")) === true);
ok("页面有首字税 chip #genModeChip", (await ev("!!document.querySelector('#genModeChip')")) === true);
ok("设置里有「极简流式」#setStreamLite", (await ev("!!document.querySelector('#setStreamLite')")) === true);

const idle = await evFn(pageChipIdle);
ok("工具/思考都关时 chip 收起", idle.hidden === true && idle.text === "", JSON.stringify(idle));

const on = await evFn(pageChipOn);
ok("勾「调用工具」后 chip 提示正文首字约 7s", on.hidden === false && /工具开/.test(on.text) && /首字/.test(on.text), on.text);
ok("取消后 chip 再次收起", (await ev("document.querySelector('#genModeChip').hidden === true")) === true);

const perf = await evFn(pagePerf);
ok("增量 update 单帧 < 2ms（6000 字 × 200 帧）", perf.newMs < 2, "new=" + perf.newMs + "ms");
ok("比旧「每帧整段渲染」快 3 倍以上", perf.oldMs > perf.newMs * 3, "new=" + perf.newMs + "ms old=" + perf.oldMs + "ms");
ok("块级切分产生了多个已完成块", perf.blocks >= 5, "blocks=" + perf.blocks);
ok("结束后公式被 KaTeX 排版", perf.katex >= 1, "katex=" + perf.katex);
ok("结束后 Markdown 生效（标题/列表/粗体）", /<h2|<li|<strong|<b>/i.test(perf.html));

const lite = await evFn(pageLite);
ok("极简流式：生成中只有纯文本（不建块）", lite.mid.children === 0 && lite.mid.text.indexOf("**粗体**") >= 0, "children=" + lite.mid.children);
ok("极简流式：结束后套回 Markdown", lite.fin.hasStrong === true);
ok("极简流式：结束后公式排版", lite.fin.katex >= 1, "katex=" + lite.fin.katex);
ok("页面全程无 JS 异常", exceptions.length === 0, JSON.stringify(exceptions.slice(0, 2)));

console.log("\n== 结果: " + pass + " 通过 / " + fail + " 失败 ==\n");
ws.close();
process.exit(fail ? 1 : 0);

// 上下文余量浮窗的界面探针：位置、数值、隐藏/显示、配色状态、截图
import WebSocket from "ws";
import fs from "node:fs";

const CDP = process.env.CDP || "http://127.0.0.1:9333";
const OUT = process.env.OUT || "D:/LocalModels/server/docs/ui-new";
fs.mkdirSync(OUT, { recursive: true });

const list = await (await fetch(CDP + "/json/list")).json();
const page = list.find((t) => t.type === "page" && t.url.includes("8099"));
if (!page) { console.log("no page target"); process.exit(2); }

const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });
let id = 0;
const pending = new Map();
ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise((res) => {
  const i = ++id;
  pending.set(i, res);
  ws.send(JSON.stringify({ id: i, method, params }));
});
const evaluate = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text + " " + (r.result.exceptionDetails.exception?.description || ""));
  return r.result?.result?.value;
};
const shot = async (name) => {
  const r = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(OUT + "/" + name, Buffer.from(r.result.data, "base64"));
  return name;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await send("Page.enable");
await send("Runtime.enable");
await send("Page.reload", { ignoreCache: true });
await sleep(2500);

let pass = 0, fail = 0;
const check = (name, cond, detail = "") => {
  if (cond) { pass++; console.log("ok   " + name + (detail ? "  [" + detail + "]" : "")); }
  else { fail++; console.log("FAIL " + name + "  " + detail); }
};

const snap = () => evaluate(`(() => {
  const h = document.querySelector('header').getBoundingClientRect();
  const p = document.getElementById('ctxPanel');
  const b = p.getBoundingClientRect();
  const btn = document.getElementById('ctxBtn');
  return {
    hidden: p.hidden,
    top: Math.round(b.top), right: Math.round(innerWidth - b.right),
    headerBottom: Math.round(h.bottom),
    width: Math.round(b.width),
    pct: document.getElementById('ctxPct').textContent,
    left: document.getElementById('ctxLeft').textContent,
    used: document.getElementById('ctxUsed').textContent,
    foot: document.getElementById('ctxFoot').textContent,
    cls: p.className,
    fill: document.getElementById('ctxFill').style.width,
    btnOn: btn.classList.contains('on'),
    btnPressed: btn.getAttribute('aria-pressed'),
  };
})()`);

let s = await snap();
check("面板默认可见", s.hidden === false, "hidden=" + s.hidden);
check("贴在顶栏下方", s.top >= s.headerBottom && s.top - s.headerBottom <= 16, "top=" + s.top + " headerBottom=" + s.headerBottom);
check("靠右悬空", s.right === 18, "right=" + s.right);
check("默认窗口 16K", s.used.includes("16,384"), s.used);
// 上下文下拉：K 值档位（模型本身支持更长，能不能装下看内存）
const ctxOpts = await evaluate("[...document.querySelectorAll('#ctxSel option')].map(o => o.value)");
check("上下文下拉含 8K/16K/32K/64K/128K", ["8192", "16384", "32768", "65536", "131072"].every((v) => ctxOpts.includes(v)), JSON.stringify(ctxOpts));
// 页面会恢复上次会话，可能有历史用量：这里校验格式与百分比自洽，而不是假定为 0
const m0 = s.used.match(/已用 ([\d,]+) \/ 16,384/);
const used0 = m0 ? Number(m0[1].replace(/,/g, "")) : -1;
check("初始用量与百分比自洽", used0 >= 0 && s.pct === Math.round(used0 / 16384 * 100) + "%", "used=" + used0 + " pct=" + s.pct);
await shot("ctx-1-default.png");

// 模拟一轮 9.8k 输入 + 620 输出
await evaluate("noteCtxUsage({prompt_tokens: 9800, completion_tokens: 620})");
s = await snap();
check("已用 = prompt + completion", s.used.includes("10,420") && s.used.includes("16,384"), s.used);
check("剩余正确", s.left.includes("5,964"), s.left);
check("百分比 64%", s.pct === "64%", s.pct);
check("进度条宽度", s.fill === "64%", s.fill);
check("常态不告警", !s.cls.includes("warn") && !s.cls.includes("danger"), s.cls);
await shot("ctx-2-normal.png");

// 高占用：14.6k / 16.4k ≈ 89% → danger
await evaluate("noteCtxUsage({prompt_tokens: 14000, completion_tokens: 600})");
s = await snap();
check("超 85% 进入告警", s.cls.includes("danger"), s.cls);
check("告警文案", s.foot.includes("接近上限"), s.foot);
await shot("ctx-3-danger.png");

// 隐藏
await evaluate("document.getElementById('ctxBtn').click()");
await sleep(120);
s = await snap();
check("点按钮可隐藏", s.hidden === true && s.btnOn === false && s.btnPressed === "false", JSON.stringify({ h: s.hidden, on: s.btnOn }));
check("隐藏后记住选择", (await evaluate("localStorage.getItem('localai.ctxPanel')")) === "0");
await shot("ctx-4-hidden.png");

// 刷新后仍保持隐藏（选择落盘，不靠内存）
await send("Page.reload", { ignoreCache: true });
await sleep(2200);
s = await snap();
check("刷新后仍隐藏", s.hidden === true && s.btnPressed === "false", "hidden=" + s.hidden);

// 再显示
await evaluate("document.getElementById('ctxBtn').click()");
await sleep(150);
s = await snap();
check("再点可显示", s.hidden === false && s.btnOn === true);
check("显示后记住选择", (await evaluate("localStorage.getItem('localai.ctxPanel')")) === "1");
await send("Page.reload", { ignoreCache: true });
await sleep(2200);
s = await snap();
check("刷新后仍显示", s.hidden === false && s.btnOn === true, "hidden=" + s.hidden);

// 关闭按钮
await evaluate("document.getElementById('ctxClose').click()");
await sleep(120);
s = await snap();
check("✕ 可隐藏", s.hidden === true);
await evaluate("document.getElementById('ctxBtn').click()");

// ---- 真跑一轮：验证流式 usage 落到浮窗（会新建一个会话，测完删掉） ----
{
  await evaluate("newChat()");
  await sleep(400);
  await evaluate("(() => { const q = document.getElementById('q'); q.value = '只回复两个字：收到'; q.dispatchEvent(new Event('input', { bubbles: true })); q.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return q.value; })()");
  let done = false;
  for (let i = 0; i < 140; i++) {
    await sleep(500);
    done = await evaluate("(!document.getElementById('send').disabled) && document.querySelectorAll('.row.assistant').length > 0");
    if (done) break;
  }
  await sleep(500);
  const after = await snap();
  check("真跑一轮：浮窗出现本轮用量", /本轮 ↓[\d,]+ tok/.test(after.foot), after.foot);
  const m1 = after.used.match(/已用 ([\d,]+) /);
  check("真跑一轮：已用量 > 0", !!m1 && Number(m1[1].replace(/,/g, "")) > 0, after.used);
  check("真跑一轮：未超过窗口", !!m1 && Number(m1[1].replace(/,/g, "")) <= 16384, after.used);
  await shot("ctx-6-real-turn.png");
  // 先切到新对话：否则 flushTranscript 会把刚删掉的会话又写回来
  await evaluate("newChat()");
  await sleep(600);
  // 清掉测试会话，别留垃圾。会话是异步落盘的，列表可能晚一步才出现，重试几次
  for (let attempt = 0; attempt < 4; attempt++) {
    await sleep(700);
    const list = await evaluate("(async () => (await (await fetch('/api/sessions')).json()))()");
    const arr = Array.isArray(list) ? list : (list.sessions || []);
    const hit = arr.find((s) => String(s.title || "").includes("收到"));
    if (!hit) break;
    await evaluate(`(async () => { await fetch('/api/sessions/${hit.id}', { method: 'DELETE' }); return 1; })()`);
  }
  const left = await evaluate("(async () => (await (await fetch('/api/sessions')).json()))()");
  const leftArr = Array.isArray(left) ? left : (left.sessions || []);
  check("测试会话已清理", !leftArr.some((s) => String(s.title || "").includes("收到")), "剩 " + leftArr.length + " 个会话");
}

// 窗口变窄：位置跟着顶栏走
await send("Emulation.setDeviceMetricsOverride", { width: 980, height: 720, deviceScaleFactor: 1, mobile: false });
await sleep(300);
s = await snap();
check("窄窗仍贴顶栏", s.top >= s.headerBottom && s.top - s.headerBottom <= 16, "top=" + s.top + " hb=" + s.headerBottom);
await shot("ctx-5-narrow.png");
await send("Emulation.clearDeviceMetricsOverride");

console.log("\nRESULT " + pass + "/" + (pass + fail) + " passed");
ws.close();
process.exit(fail ? 1 : 0);
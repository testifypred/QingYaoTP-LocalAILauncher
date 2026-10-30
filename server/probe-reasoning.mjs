/**
 * 验证「模板里没声明思考机制的推理模型」能不能被正确拆分：
 *   1. 通过 /api/load 加载指定 gguf
 *   2. 在真实窗口里问一题，读 DOM 看思维过程是否进了折叠区、正文是否干净
 *   3. 截图
 *
 *   node probe-reasoning.mjs <模型文件名> [问题]
 */
import { writeFile } from "node:fs/promises";

const BASE = "http://127.0.0.1:8099";
const file = process.argv[2];
const question = process.argv[3] ?? "9.11 和 9.9 哪个大？用一句话说明理由。";
if (!file) throw new Error("用法: node probe-reasoning.mjs <模型文件名> [问题]");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const t0 = Date.now();
const before = await (await fetch(`${BASE}/api/state`)).json();
if (before.loaded === file) {
  console.log(`1) ${file} 已在内存里，跳过加载`);
} else {
  console.log(`1) 加载 ${file}`);
  const lr = await fetch(`${BASE}/api/load`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file, contextSize: 16384 }),
  });
  const lj = await lr.json();
  if (!lr.ok) throw new Error("加载失败: " + JSON.stringify(lj));
  console.log(`   就绪，耗时 ${lj.seconds}s，上下文 ${lj.context}，${lj.layers} 层`);
}

const st = await (await fetch(`${BASE}/api/state`)).json();
console.log(`   服务端判定思考能力: ${st.supportsThinking ? "支持" : "不支持"}（决定界面「深度思考」是否可勾）`);

// ---- 通过 CDP 在真实窗口里发问 ----
const list = await (await fetch("http://127.0.0.1:9222/json")).json();
const page = list.find((t) => t.type === "page" && t.url.includes("127.0.0.1"));
if (!page) throw new Error("没找到 WebView2 页面（启动器要用 --remote-debugging-port 启动）");
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pend = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) {
    pend.get(m.id)(m);
    pend.delete(m.id);
  }
});
await new Promise((r) => ws.addEventListener("open", r));
const cmd = (method, params) =>
  new Promise((res, rej) => {
    const i = ++id;
    const t = setTimeout(() => rej(new Error("CDP 超时 " + method)), 20000);
    pend.set(i, (m) => {
      clearTimeout(t);
      res(m);
    });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
const ev = async (expr) => {
  const r = await cmd("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  return r.result?.result?.value ?? r.result?.exceptionDetails?.text;
};

console.log("2) 刷新页面（让新模型出现在选项卡里）");
await cmd("Page.reload", { ignoreCache: true });
await sleep(2500);
console.log("   选项卡:", await ev(`[...document.querySelectorAll('#modelSel .tab')].map(t=>t.querySelector('.meta b').textContent).join(' | ')`));

console.log("3) 提问:", question);
await cmd("Runtime.evaluate", {
  expression: `send(${JSON.stringify(question)}).catch(()=>{})`,
  awaitPromise: false,
  returnByValue: false,
});
// 推理模型可能要想很久（10 tok/s），最多等 4 分钟
for (let i = 0; i < 240; i++) {
  const busy = await ev(`typeof busy !== 'undefined' ? busy : null`);
  if (busy === false) break;
  await sleep(1000);
}

const dom = JSON.parse(
  await ev(`(() => {
    const rows = [...document.querySelectorAll('#msgs .row.assistant')];
    const last = rows[rows.length - 1];
    if (!last) return JSON.stringify({ rows: 0 });
    const think = last.querySelector('details.think .thinkText');
    const bubble = last.querySelector('.bubble');
    return JSON.stringify({
      rows: rows.length,
      thinkHidden: last.querySelector('details.think') ? last.querySelector('details.think').hidden : null,
      thinkChars: think ? think.textContent.length : 0,
      thinkHead: think ? think.textContent.slice(0, 80) : '',
      contentChars: bubble ? bubble.textContent.length : 0,
      contentHead: bubble ? bubble.textContent.slice(0, 120) : '',
      stats: (last.querySelector('.stats') || {}).textContent || '',
      rawTagInContent: bubble ? /think/i.test(bubble.textContent) : null,
    });
  })()`),
);

console.log("\n4) 结果");
console.log(`   助手消息行数: ${dom.rows}`);
console.log(`   思维过程: ${dom.thinkHidden === false ? "已展开显示" : dom.thinkHidden === true ? "有但折叠" : "无"}，${dom.thinkChars} 字`);
console.log(`     └ ${dom.thinkHead.replace(/\s+/g, " ")}`);
console.log(`   正文: ${dom.contentChars} 字`);
console.log(`     └ ${dom.contentHead.replace(/\s+/g, " ")}`);
console.log(`   正文里还有 think 标签吗: ${dom.rawTagInContent ? "有（拆分失败）" : "没有"}`);
console.log(`   指标行: ${dom.stats}`);

for (const t of ["dark", "light"]) {
  await ev(`applyTheme('${t}')`);
  await sleep(400);
  const r = await cmd("Page.captureScreenshot", { format: "png" });
  const p = `D:/LocalModels/server/docs/deepseek-${t}.png`;
  await writeFile(p, Buffer.from(r.result.data, "base64"));
  console.log("   截图:", p);
}
ws.close();
console.log(`\n（模型加载 ${((Date.now() - t0) / 1000).toFixed(0)}s 内完成）`);

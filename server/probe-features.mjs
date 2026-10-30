/**
 * 新功能验收：停止生成 / 重新生成 / 导出 / 设置持久化 / 刷新后仍记得上下文
 *   node probe-features.mjs
 */
import { writeFile } from "node:fs/promises";

const CDP = "http://127.0.0.1:9222";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const list = await (await fetch(`${CDP}/json`)).json();
const page = list.find((t) => t.type === "page" && t.url.includes("127.0.0.1"));
if (!page) throw new Error("没找到页面目标");
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
    const t = setTimeout(() => rej(new Error("超时 " + method)), 30000);
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
const shot = async (name) => {
  const r = await cmd("Page.captureScreenshot", { format: "png" });
  const p = `D:/LocalModels/server/docs/feat-${name}.png`;
  await writeFile(p, Buffer.from(r.result.data, "base64"));
  console.log("   截图:", p);
};

await cmd("Page.reload", { ignoreCache: true });
await sleep(3000);

console.log("1) 刷新后是否还记得上下文（history 重建）");
console.log("   ", await ev(`JSON.stringify({ historyLen: history.length, transcriptLen: transcript.length, speakBtns: document.querySelectorAll('#msgs .stats .speak').length, regenBtns: document.querySelectorAll('#msgs .stats .actBtn').length })`));

console.log("2) 发一条长问题，中途点停止");
await cmd("Runtime.evaluate", {
  expression: `send('请写一篇 500 字左右的短文，介绍本地大模型的优势。').catch(()=>{})`,
  awaitPromise: false,
});
await sleep(2500);
console.log("   停止按钮可见:", await ev(`!document.getElementById('stopBtn').hidden`));
await ev(`document.getElementById('stopBtn').click()`);
await sleep(1200);
console.log("   点停止后:", await ev(`JSON.stringify({ stopHidden: document.getElementById('stopBtn').hidden, lastBubble: [...document.querySelectorAll('#msgs .row.assistant .bubble')].pop().textContent.slice(-30) })`));

console.log("3) 设置：max_tokens 2048 / 温度 0.3 / 自动朗读开");
await ev(`(() => {
  document.getElementById('settingsBtn').click();
  document.getElementById('setMaxTokens').value = 2048;
  document.getElementById('setTemp').value = 0.3;
  document.getElementById('setTemp').dispatchEvent(new Event('input'));
  document.getElementById('setAutoRead').checked = true;
  document.getElementById('settingsSave').click();
  return 'ok';
})()`);
await sleep(300);
console.log("   ", await ev(`JSON.stringify({ stored: localStorage.getItem('localai.settings'), max: genMaxTokens, temp: genTemp, auto: autoRead })`));

console.log("4) 导出对话");
await ev(`document.getElementById('settingsBtn').click()`);
await sleep(200);
console.log("   导出结果:", await ev(`(async () => { document.getElementById('exportBtn').click(); await new Promise(r=>setTimeout(r,1500)); const h=document.getElementById('exportHint'); return h.textContent; })()`));

console.log("5) 重新生成最后一条");
const before = await ev(`transcript.length`);
await ev(`(() => { const b=[...document.querySelectorAll('#msgs .stats .actBtn')]; if(b.length) b[b.length-1].click(); return b.length; })()`);
await sleep(1500);
console.log("   点击前 transcript:", before, "→ 等待生成后:", await ev(`JSON.stringify({ busy: busy, len: transcript.length })`));
for (let i = 0; i < 90; i++) {
  if ((await ev(`busy`)) === false) break;
  await sleep(1000);
}
console.log("   重生成后:", await ev(`JSON.stringify({ len: transcript.length, lastUser: (transcript.filter(e=>e.role==='user').pop()||{}).content, lastAssistant: (transcript[transcript.length-1]||{}).content?.slice(0,40) })`));

await ev(`applyTheme('dark')`);
await sleep(300);
await shot("dark");
ws.close();

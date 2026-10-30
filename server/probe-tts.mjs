/**
 * 验证界面的朗读功能：
 *   1. 底部语音控件是否出现、音色列表是否正确
 *   2. 发一条消息后，统计行是否多出 🔊 按钮
 *   3. 点按钮 → /api/tts 返回音频 → audio 元素真的解码成功（duration > 0）
 *   4. 再点一次能停
 *
 *   node probe-tts.mjs
 */
import { writeFile } from "node:fs/promises";

const CDP = "http://127.0.0.1:9222";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const list = await (await fetch(`${CDP}/json`)).json();
const page = list.find((t) => t.type === "page" && t.url.includes("127.0.0.1"));
if (!page) throw new Error("没找到 WebView2 页面");
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
    const t = setTimeout(() => rej(new Error("CDP 超时 " + method)), 30000);
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

await cmd("Page.reload", { ignoreCache: true });
await sleep(3000);

console.log("1) 底部语音控件");
console.log(
  await ev(`JSON.stringify({
    boxHidden: document.getElementById('ttsBox').hidden,
    voices: [...document.querySelectorAll('#ttsVoice option')].map(o => o.textContent),
    selected: document.getElementById('ttsVoice').value,
    speed: document.getElementById('ttsSpeed').value
  })`),
);

console.log("2) 发一条短消息");
await cmd("Runtime.evaluate", { expression: `send('说一句鼓励的话，不超过二十个字。').catch(()=>{})`, awaitPromise: false });
for (let i = 0; i < 120; i++) {
  const busy = await ev(`typeof busy !== 'undefined' ? busy : null`);
  if (busy === false) break;
  await sleep(1000);
}
console.log(
  await ev(`JSON.stringify({
    assistantRows: document.querySelectorAll('#msgs .row.assistant').length,
    speakButtons: document.querySelectorAll('#msgs .stats .speak').length,
    lastStats: (() => { const s=[...document.querySelectorAll('#msgs .stats')].pop(); return s ? s.textContent.trim().slice(0,60) : ''; })()
  })`),
);

console.log("3) 点最后一条的朗读按钮，等音频解码");
const btnIndex = await ev(`(() => { const b=[...document.querySelectorAll('#msgs .stats .speak')]; return b.length ? b.length-1 : -1; })()`);
if (btnIndex < 0) throw new Error("没有找到朗读按钮");
await cmd("Runtime.evaluate", {
  expression: `[...document.querySelectorAll('#msgs .stats .speak')][${btnIndex}].click()`,
  awaitPromise: false,
});
let info = null;
for (let i = 0; i < 40; i++) {
  await sleep(500);
  const raw = await ev(`JSON.stringify({
    playing: playingBtn !== null,
    loading: [...document.querySelectorAll('#msgs .stats .speak')][${btnIndex}].classList.contains('loading'),
    duration: audio ? audio.duration : null,
    paused: audio ? audio.paused : null,
    err: [...document.querySelectorAll('#msgs .stats .speak')][${btnIndex}].classList.contains('err')
  })`);
  info = JSON.parse(raw);
  if (info.duration > 0 || info.err) break;
}
console.log("   ", JSON.stringify(info));

// 截图
for (const t of ["light", "dark"]) {
  await ev(`applyTheme('${t}')`);
  await sleep(400);
  const r = await cmd("Page.captureScreenshot", { format: "png" });
  const p = `D:/LocalModels/server/docs/tts-${t}.png`;
  await writeFile(p, Buffer.from(r.result.data, "base64"));
  console.log("   截图:", p);
}

console.log("4) 再点一次应该停止");
await cmd("Runtime.evaluate", {
  expression: `[...document.querySelectorAll('#msgs .stats .speak')][${btnIndex}].click()`,
  awaitPromise: false,
});
await sleep(600);
console.log("   播放中:", await ev(`playingBtn !== null`), "| audio 存在:", await ev(`audio !== null`));
ws.close();

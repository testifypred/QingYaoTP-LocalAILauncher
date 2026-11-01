/**
 * 端到端验证「内嵌 WebView2 窗口里的界面」真的能用：
 * 直接通过 CDP 在页面里调用 send() 发两句话，然后把页面渲染结果截图存盘。
 *
 * 前置：启动器以 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 启动。
 * 用法：node probe-ui-e2e.mjs [输出前缀]
 */
import { writeFile } from "node:fs/promises";

const CDP = "http://127.0.0.1:9222";
const outPrefix = process.argv[2] ?? "D:/LocalModels/dist/QingYaoTP AILauncher/ui";

const list = await (await fetch(`${CDP}/json`)).json();
const page = list.find((t) => t.type === "page" && t.url.includes("127.0.0.1"));
if (!page) throw new Error("没找到页面目标");
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
});
await new Promise((r) => ws.addEventListener("open", r));
const send = (method, params) =>
  new Promise((resolve, reject) => {
    const myId = ++id;
    const timer = setTimeout(() => {
      pending.delete(myId);
      reject(new Error(`CDP 超时：${method}（页面可能已关闭或换了目标）`));
    }, 45000);
    pending.set(myId, (m) => {
      clearTimeout(timer);
      resolve(m);
    });
    ws.send(JSON.stringify({ id: myId, method, params }));
  });

async function ev(expression, awaitPromise = false) {
  const r = await send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true });
  if (r.result?.exceptionDetails) return { error: r.result.exceptionDetails.text + " " + (r.result.exceptionDetails.exception?.description ?? "") };
  return { value: r.result?.result?.value };
}

async function shot(name) {
  const r = await send("Page.captureScreenshot", { format: "png" });
  const b64 = r.result?.data;
  if (!b64) return console.log(`  截图失败：${JSON.stringify(r.error ?? r.result)}`);
  const p = `${outPrefix}-${name}.png`;
  await writeFile(p, Buffer.from(b64, "base64"));
  console.log(`  截图：${p}`);
}

const status = async () => (await ev(`JSON.stringify({
  status: document.getElementById('statusText').textContent,
  loaded: (() => { try { return loaded; } catch { return null; } })(),
  busy: (() => { try { return busy; } catch { return null; } })(),
  inputDisabled: document.getElementById('q').disabled,
  msgs: document.querySelectorAll('#msgs .row').length,
  stats: [...document.querySelectorAll('#msgs .stats')].map(e => e.textContent)
})`)).value;

console.log("1) 等模型就绪");
for (let i = 0; i < 90; i++) {
  const s = JSON.parse(await status());
  if (s.loaded && !s.busy) { console.log("  就绪:", s.status); break; }
  await new Promise((r) => setTimeout(r, 1000));
}

async function ask(text, label) {
  console.log(`2) 发送：${text}`);
  const r = await ev(`send(${JSON.stringify(text)}).then(() => 'done').catch(e => 'error: ' + e.message)`);
  if (r.error) console.log("  发送异常:", r.error);
  for (let i = 0; i < 120; i++) {
    const s = JSON.parse(await status());
    if (s.busy === false && s.msgs >= 2) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  const s = JSON.parse(await status());
  console.log(`  消息行数=${s.msgs} 指标行=${JSON.stringify(s.stats)}`);
  await shot(label);
  return s;
}

await ask("用 Markdown 表格对比 KV 缓存和普通缓存（3 行），再给一段 6 行的 Python 示例代码。", "1");
await ask("把 E=mc^2 和 \\int_0^1 x^2 dx 用 LaTeX 写出来，各占一行。", "2");

console.log("\n最终状态:");
console.log(await status());
ws.close();

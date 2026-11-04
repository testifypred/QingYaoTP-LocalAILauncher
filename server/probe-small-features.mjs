import WebSocket from "ws";
const APP = "http://127.0.0.1:8099";
const list = await (await fetch("http://127.0.0.1:9333/json/list")).json();
const page = list.find((t) => t.type === "page" && t.url.includes("8099"));
const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise((r, j) => { ws.once("open", r); ws.once("error", j); });
let id = 0; const pend = new Map();
ws.on("message", (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text); return r.result?.result?.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (n, c, d = "") => { if (c) { pass++; console.log("ok   " + n + (d ? "  [" + d + "]" : "")); } else { fail++; console.log("FAIL " + n + "  " + d); } };

await send("Page.enable"); await send("Runtime.enable");
// 这条探针要验「回答上的复制按钮」，不能靠环境里碰巧有会话：没有就自己造一个带回答的
try {
  const ses = await (await fetch(APP + "/api/sessions")).json();
  const arr = Array.isArray(ses.sessions) ? ses.sessions : [];
  if (!arr.some((s) => Number(s.count) >= 2)) {
    const now = Date.now();
    await fetch(APP + "/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "探针临时会话",
        messages: [
          { role: "user", content: "探针预置：验证复制按钮的消息。", t: now },
          { role: "assistant", content: "收到，这是预置回答。", t: now + 1000 },
        ],
      }),
    });
  }
} catch {}
await send("Page.reload", { ignoreCache: true });
await sleep(3200);
// 清掉所有会话草稿：上一条探针（公式面板「插入输入框」）会把 $E=mc^2$ 留在 'new' 的草稿里，
// 不清就会被这条探针当成"切会话带了草稿"（测试互相污染，不是应用缺陷）
await ev("Object.keys(localStorage).filter((k) => k.startsWith('localai.draft.')).forEach((k) => localStorage.removeItem(k)); 1");
await ev("document.getElementById('recentOpen').click(); 1");
// 等消息渲染出来（固定 sleep 在机器忙时会抢跑）
let copyCount = 0;
for (let i = 0; i < 20; i++) {
  await sleep(300);
  copyCount = Number(await ev("document.querySelectorAll('.copyBtn').length")) || 0;
  if (copyCount > 0) break;
}

// 1) 复制按钮
check("回答上有复制按钮", copyCount > 0, "count=" + copyCount);
await ev("(() => { window.__copied = ''; navigator.clipboard.writeText = (t) => { window.__copied = t; return Promise.resolve(); }; return 1; })()");
await ev("document.querySelector('.copyBtn').click(); 1");
await sleep(300);
const copied = await ev("window.__copied || ''");
check("点复制拿到正文", copied.length > 3, copied.slice(0, 30));

// 2) 草稿按会话保存
await ev("document.getElementById('sideNew').click(); 1");
await sleep(400);
await ev("(() => { const q = document.getElementById('q'); q.value = '草稿测试ABC'; q.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()");
await sleep(500);
await ev("document.querySelector('.sessionItem').click(); 1");
await sleep(900);
const afterSwitch = await ev("document.getElementById('q').value");
check("切到别的会话不带草稿", afterSwitch === "", JSON.stringify(afterSwitch));
await ev("document.getElementById('sideNew').click(); 1");
await sleep(400);
const restored = await ev("document.getElementById('q').value");
check("回到新对话草稿还在", restored === "草稿测试ABC", JSON.stringify(restored));

// 3) 回到最新
await ev("document.getElementById('recentOpen').click(); 1");
await sleep(1200);
await ev("(() => { const m = document.getElementById('msgs'); for (let i = 0; i < 40; i++) { const d = document.createElement('div'); d.className = 'row'; d.style.height = '80px'; d.textContent = 'filler ' + i; m.appendChild(d); } m.scrollTop = 0; m.dispatchEvent(new Event('scroll')); return 1; })()");
await sleep(400);
check("滚上去后出现「回到最新」", (await ev("!document.getElementById('toBottom').hidden")) === true);
await ev("document.getElementById('toBottom').click(); 1");
await sleep(900);
const gap = await ev("(() => { const m = document.getElementById('msgs'); return m.scrollHeight - m.scrollTop - m.clientHeight; })()");
check("点击后回到底部", gap < 200, "gap=" + Math.round(gap));

await ev("localStorage.removeItem('localai.draft.new'); 1");
await send("Page.reload", { ignoreCache: true });
console.log("\nRESULT " + pass + "/" + (pass + fail));
ws.close(); process.exit(fail ? 1 : 0);

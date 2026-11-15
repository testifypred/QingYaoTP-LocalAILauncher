// 补充校验：用合成 compare 事件确定性地验 verdict 徽标 class 与四类差异清单（不跑模型）
const fs = require("node:fs");
const BASE = "http://127.0.0.1:8099";
const CDP = "http://127.0.0.1:9334";
const OUT = "D:/LocalModels/server/docs/feature-code-review-verify-2026-11-15";
const NL = String.fromCharCode(10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const list = await (await fetch(CDP + "/json/list")).json();
  const page = list.find((t) => t.type === "page" && t.url.indexOf("127.0.0.1:8099") >= 0);
  if (!page) { console.log("no page"); process.exit(3); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pend = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
  const send = (method, params) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  const ev = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.text + " " + ((r.result.exceptionDetails.exception || {}).description || ""));
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  await send("Page.enable");
  await send("Page.navigate", { url: BASE + "/" });
  await sleep(3000);
  await ev("(() => { ['firstModal','readmeModal'].forEach((x) => { const el = document.getElementById(x); if (el) el.hidden = true; }); return 1; })()");
  for (let i = 0; i < 40; i++) { if (await ev("typeof cwApplyCompare === 'function'")) break; await sleep(200); }
  await ev("openCodePanel()"); await sleep(800);
  const mk = (line, sev, title) => ({ line: line, endLine: line, severity: sev, title: title, detail: "合成用例：" + title, fix: "改掉" });
  const cases = [
    { name: "consistent", ev: { verdict: "consistent", stats: { primary: 1, second: 1, matched: 1, agree: 1, onlyPrimary: 0, onlySecond: 0, conflicts: 0 }, agree: [{ primary: mk(2, "error", "两边都看出来的问题"), second: mk(2, "error", "两边都看出来的问题") }], onlyPrimary: [], onlySecond: [], conflicts: [] }, want: "ok", wantDiff: { agree: 1 } },
    { name: "differs", ev: { verdict: "differs", stats: { primary: 2, second: 2, matched: 1, agree: 1, onlyPrimary: 1, onlySecond: 1, conflicts: 0 }, agree: [{ primary: mk(2, "error", "两边都看出来的问题"), second: mk(2, "error", "两边都看出来的问题") }], onlyPrimary: [mk(5, "warn", "只有原审查说的")], onlySecond: [mk(7, "info", "只有他人复审说的")], conflicts: [] }, want: "warn", wantDiff: { agree: 1, onlyP: 1, onlyS: 1 } },
    { name: "contradicts", ev: { verdict: "contradicts", stats: { primary: 1, second: 1, matched: 1, agree: 0, onlyPrimary: 0, onlySecond: 0, conflicts: 1 }, agree: [], onlyPrimary: [], onlySecond: [], conflicts: [{ primary: mk(3, "error", "同一行严重度不同"), second: mk(3, "info", "同一行严重度不同"), reason: "严重度不一致：error vs info" }] }, want: "err", wantDiff: { conflict: 1 } }
  ];
  let pass = 0, fail = 0;
  const check = (n, c, d) => { if (c) { pass++; console.log("ok   " + n + (d ? "  [" + d + "]" : "")); } else { fail++; console.log("FAIL " + n + "  " + (d || "")); } };
  for (const c of cases) {
    const r = JSON.parse(await ev("(() => { cwApplyCompare(" + JSON.stringify(c.ev) + "); const v = document.getElementById('cwCrossVerdict'); const d = [...document.querySelectorAll('#cwCrossDiff .cwDiffItem')]; const cls = {}; d.forEach((x) => { ['agree','onlyP','onlyS','conflict'].forEach((k) => { if (x.classList.contains(k)) cls[k] = (cls[k] || 0) + 1; }); }); return JSON.stringify({ cls: v.className, text: v.textContent, diff: cls, panel: !document.getElementById('cwCrossPanel').hidden }); })()"));
    check("verdict=" + c.name + " -> 徽标 ." + c.want, r.cls === "cwVerdict " + c.want && r.panel === true, r.cls + " | " + String(r.text).slice(0, 80));
    const got = JSON.stringify(r.diff);
    check("verdict=" + c.name + " -> 差异清单 " + JSON.stringify(c.wantDiff), got === JSON.stringify(c.wantDiff), got);
  }
  // 收尾截图（contradicts 状态）+ 复位面板
  try { const r = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(OUT + "/ui-v180-cross-verdicts.png", Buffer.from(r.result.data, "base64")); console.log("  截图 ui-v180-cross-verdicts.png"); } catch (e) {}
  ws.close();
  console.log(NL + "补充校验: " + pass + "/" + (pass + fail) + " 通过");
  fs.writeFileSync(OUT + "/ui-v180-synthetic-compare.txt", ["# 合成 compare 校验（不跑模型；验 verdict 徽标 .ok/.warn/.err 与四类差异清单）", "通过 " + pass + " / 失败 " + fail, ""].join(NL));
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.log("ERR", e); process.exit(4); });

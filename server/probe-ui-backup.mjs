/**
 * 会话备份 UI 探针（设置 → 工具 → 会话备份）
 *
 *   node probe-ui-backup.mjs [cdpBase] [appBase] [shotDir] [targetDir]
 *
 * 覆盖：控件存在且可见、磁盘选择、立即备份出结果、服务端配置真的落盘、关掉后配置清空。
 * 自复位：跑完关掉备份、清空目录、删掉临时目标目录。
 */
import WebSocket from "ws";
import fs from "node:fs";
import { rm } from "node:fs/promises";

const CDP = process.argv[2] || "http://127.0.0.1:9333";
const APP = process.argv[3] || "http://127.0.0.1:8099";
const OUT = process.argv[4] || "D:/LocalModels/server/docs/probe-full-2026-10-27/shots";
const TARGET = process.argv[5] || "D:\\LocalModels\\server\\docs\\probe-full-2026-10-27\\backup-ui-target";

let pass = 0, fail = 0;
const check = (n, c, d = "") => { if (c) { pass++; console.log("ok   " + n + (d ? "  [" + d + "]" : "")); } else { fail++; console.log("FAIL " + n + "  " + d); } };
const list = await (await fetch(CDP + "/json/list")).json();
const page = list.find((t) => t.type === "page" && t.url.includes(APP.replace(/^https?:\/\//, "")));
if (!page) { console.log("没找到页面目标"); process.exit(2); }
const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise((r, j) => { ws.once("open", r); ws.once("error", j); });
let id = 0; const pend = new Map();
ws.on("message", (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text + " :: " + String(r.result.exceptionDetails.exception?.description || "").slice(0, 300)); return r.result?.result?.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (p, opt) => { const r = await fetch(APP + p, opt); const j = await r.json().catch(() => ({})); return { status: r.status, j }; };
async function waitFor(expr, ms = 12000, step = 250) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < ms) { last = await ev(expr).catch(() => null); if (last) return last; await sleep(step); }
  return last;
}

await send("Page.enable"); await send("Runtime.enable");
await send("Page.reload", { ignoreCache: true });
await sleep(3000);

// 打开设置 → 工具
await ev('document.getElementById("settingsBtn").click(); 1');
await sleep(400);
await ev('showSettingsTab("tools"); 1');
await sleep(400);

const ui = JSON.parse(await ev('JSON.stringify((() => {' +
  ' const pick = (i) => { const e = document.getElementById(i); return e ? { exists: true, visible: e.offsetParent !== null } : { exists: false }; };' +
  ' return { on: pick("setBackupOn"), dir: pick("setBackupDir"), pickBtn: pick("setBackupPick"), now: pick("setBackupNow"), info: pick("setBackupInfo"), warn: pick("backupWarn") };' +
  '} )())'));
check("备份开关存在且可见", ui.on.exists && ui.on.visible);
check("备份目录输入框存在且可见", ui.dir.exists && ui.dir.visible);
check("「选磁盘…」按钮存在", ui.pickBtn.exists && ui.pickBtn.visible);
check("「立即备份」按钮存在", ui.now.exists && ui.now.visible);
check("状态文字存在", ui.info.exists && ui.info.visible);
check("同盘提醒位置存在", ui.warn.exists);

// 磁盘列表
await ev('document.getElementById("setBackupPick").click(); 1');
await sleep(900);
const drives = JSON.parse(await ev('JSON.stringify([...document.querySelectorAll("#backupDrives button")].map((b) => b.textContent))') || "[]");
check("点了「选磁盘」列出可用磁盘", Array.isArray(drives) && drives.length >= 1, JSON.stringify(drives).slice(0, 120));
check("磁盘按钮带剩余空间", drives.length > 0 && /剩\s*[\d.]+\s*GB/.test(drives[0]), drives[0] || "");

// 填目录 + 打开开关 + 立即备份
await ev('(() => { const d = document.getElementById("setBackupDir"); d.value = ' + JSON.stringify(TARGET) + '; d.dispatchEvent(new Event("input", { bubbles: true })); document.getElementById("setBackupOn").checked = true; return 1; })()');
await ev('document.getElementById("setBackupNow").click(); 1');
const infoText = await waitFor('(() => { const t = document.getElementById("setBackupInfo").textContent || ""; return /已备份|复制|失败/.test(t) ? t : ""; })()', 15000);
check("立即备份给出结果文字", /已备份|复制/.test(String(infoText || "")), String(infoText || "").slice(0, 100));

const st = await api("/api/backup");
check("服务端配置已保存", st.j?.config?.enabled === true && !!st.j?.config?.dir, JSON.stringify(st.j?.config || {}));
check("服务端也记下了这次备份", st.j?.status?.ok === true, JSON.stringify(st.j?.status?.errors ?? ""));
const warn = String(await ev('document.getElementById("backupWarn").textContent') || "");
check("同盘会给出提醒", /同一块盘|整盘损坏/.test(warn), warn.slice(0, 80));

const shot = await send("Page.captureScreenshot", { format: "png" });
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(OUT + "/settings-backup.png", Buffer.from(shot.result.data, "base64"));


// 从备份恢复：按钮 → 面板 → 至少一行 → 有关闭入口
await ev('(() => { const b = document.getElementById("setBackupRestore"); return b ? "ok" : "missing"; })()').then((v) => check("「从备份恢复…」按钮存在", v === "ok"));
await ev('document.getElementById("setBackupRestore").click(); 1');
await sleep(1200);
const bk = JSON.parse(await ev('JSON.stringify({ open: !document.getElementById("bkModal").hidden, rows: document.querySelectorAll("#bkList .snapRow").length, restoreBtns: [...document.querySelectorAll("#bkList .snapRow button")].map((b) => b.textContent), path: (document.getElementById("bkPath").textContent || "") })'));
check("面板打开", bk.open === true);
check("列出了备份里的会话", bk.rows >= 1, "rows=" + bk.rows);
check("每行都有「恢复」按钮", bk.restoreBtns.length >= 1 && /恢复/.test(bk.restoreBtns[0] || ""), JSON.stringify(bk.restoreBtns).slice(0, 60));
check("面板显示备份目录", String(bk.path).includes("backup-ui-target"), String(bk.path).slice(0, 80));
await ev('document.getElementById("bkDone").click(); 1');
await sleep(300);
check("能关掉面板", (await ev('document.getElementById("bkModal").hidden')) === true);

// 关掉 + 清空目录 → 保存
await ev('(() => { document.getElementById("setBackupOn").checked = false; const d = document.getElementById("setBackupDir"); d.value = ""; d.dispatchEvent(new Event("input", { bubbles: true })); document.getElementById("settingsSave").click(); return 1; })()');
await sleep(1500);
const st2 = await api("/api/backup");
check("关掉后配置真的清空", st2.j?.config?.enabled === false && (st2.j?.config?.dir || "") === "", JSON.stringify(st2.j?.config || {}));
const info2 = String(await ev('document.getElementById("setBackupInfo").textContent') || "");
check("关掉后状态文字回到未开启", /未开启/.test(info2), info2.slice(0, 80));

await rm(TARGET, { recursive: true, force: true }).catch(() => {});
await api("/api/backup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: false, dir: "" }) }).catch(() => {});
console.log("\n== 结果: " + pass + " 通过 / " + fail + " 失败 ==\n");
ws.close();
process.exit(fail ? 1 : 0);

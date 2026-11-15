#!/usr/bin/env node
/**
 * tui-faketty-smoke.mjs —— 无控制台环境下冒烟 localai-tui 的交互循环
 *
 * 做不了真 TTY，就用 --require 预载 tui-faketty.cjs 把管道伪装成终端，
 * 然后像用户那样喂按键，最后在抓到的 ANSI 输出里断言提示条/补全/工具结果。
 *
 *   Phase A：/to → Tab → Enter（执行 /tool 用法）→ /tool get_current_time → Enter → /help → Enter → Ctrl+C ×2
 *   Phase B：Tab（空输入出 /）→ Tab → Tab（连按切换候选到 /run）→ Esc（收起提示条）
 *            → /hel → →（接受行内补全）→ Enter（执行 /help）→ Ctrl+C ×2
 *
 * 用法：node tui-faketty-smoke.mjs [base]
 * 退出码 0 = 全过。
 */
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(here, "..", "..");
const tui = path.join(serverDir, "localai-tui.mjs");
const preload = path.join(here, "tui-faketty.cjs");
const url = process.argv[2] || process.env.LOCALAI_URL || "http://127.0.0.1:8099";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 起一个伪终端 TUI；keys=[{k, wait}]；marks 记录每个按键写入时的输出位置 */
function runPhase(keys) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [tui, "--url", url], {
      cwd: serverDir,
      env: { ...process.env, NODE_OPTIONS: "--require " + preload },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "", err = "", started = false, exited = false;
    const marks = [];
    const timer = setTimeout(() => { if (!exited) { try { child.kill(); } catch {} } }, 60000);
    child.stdout.on("data", (b) => {
      out += b.toString("utf8");
      if (out.length > 6_000_000) out = out.slice(-3_000_000);
      if (!started && out.includes("\u001b[?1049h")) { started = true; feed(); }
    });
    child.stderr.on("data", (b) => { err += b.toString("utf8"); });
    async function feed() {
      await sleep(150);
      for (const step of keys) {
        marks.push({ key: step.k, at: out.length });
        child.stdin.write(step.k);
        await sleep(step.wait);
      }
      child.stdin.write("\u0003");
      await sleep(200);
      child.stdin.write("\u0003");
    }
    child.on("close", (code) => { exited = true; clearTimeout(timer); resolve({ code, out, err, marks, started }); });
  });
}

const stripAnsi = (s) => String(s)
  .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
  .replace(/\u001b[@-Z\\-_]/g, "")
  .replace(/\r/g, "");
/** 把整段输出按「帧」切开（每帧以 cursor home 开头） */
const frames = (s) => String(s).split("\u001b[H");

const checks = [];
const ok = (label, cond, extra) => checks.push({ label, cond: !!cond, extra });

// ---------------- Phase A ----------------
const a = await runPhase([
  { k: "/to", wait: 220 },
  { k: "\t", wait: 220 },
  { k: "\r", wait: 320 },
  { k: "/tool get_current_time", wait: 220 },
  { k: "\r", wait: 1200 },
  { k: "/help", wait: 220 },
  { k: "\r", wait: 400 },
]);
const aText = stripAnsi(a.out);
ok("A1 进入全屏渲染", a.started);
ok("A2 命令提示条出现（高亮 ▸）", aText.includes("▸ /tool"));
ok("A3 提示条底部按键说明", aText.includes("Tab 切换候选"));
ok("A4 Tab 补全后执行 /tool 用法", aText.includes("用法：/tool <name>"));
ok("A5 工具调用结果 localTime", aText.includes("localTime"));
ok("A6 /help 输出", aText.includes("命令与用法总览"));
ok("A7 正常退出（exit 0）", a.code === 0, "code=" + a.code + " err=" + String(a.err || "").slice(0, 100));

// ---------------- Phase B ----------------
const b = await runPhase([
  { k: "\t", wait: 250 },        // 空输入 → "/"（提示条：全部命令）
  { k: "\t", wait: 250 },        // → /new
  { k: "\t", wait: 250 },        // → /run
  { k: "\u001b", wait: 350 },    // Esc 收起提示条
  { k: "/hel", wait: 250 },      // 行内灰字补全 "p"
  { k: "\u001b[C", wait: 250 },  // → 接受行内补全
  { k: "\r", wait: 500 },        // 执行 /help
]);
const bText = stripAnsi(b.out);
ok("B1 空输入 Tab 出 / 并显示提示条", bText.includes("▸ /"));
ok("B2 连按 Tab 切换候选（/run）", frames(b.out).some((f) => stripAnsi(f).includes("› /run")));
const escMark = b.marks[3] ? b.marks[3].at : b.out.length;
const afterEsc = b.out.slice(escMark, b.marks[4] ? b.marks[4].at : b.out.length);
const escFrames = frames(afterEsc).filter((f) => stripAnsi(f).trim().length);
const escLast = escFrames.length ? stripAnsi(escFrames[escFrames.length - 1]) : "";
ok("B3 Esc 收起提示条（末帧无 ▸ / 提示条）", !escLast.includes("▸ ") && escLast.includes("Enter 发送"));
ok("B4 → 接受行内补全并执行 /help", bText.includes("命令与用法总览"));
ok("B5 正常退出（exit 0）", b.code === 0, "code=" + b.code + " err=" + String(b.err || "").slice(0, 100));

let bad = 0;
for (const c of checks) {
  console.log((c.cond ? "PASS  " : "FAIL  ") + c.label + (c.cond ? "" : "  " + (c.extra || "")));
  if (!c.cond) bad += 1;
}
if (a.err.trim()) console.log("A stderr: " + a.err.trim().slice(0, 800));
if (b.err.trim()) console.log("B stderr: " + b.err.trim().slice(0, 800));
console.log((bad ? "TUI 伪终端冒烟失败 " + bad + " 项" : "TUI 伪终端冒烟通过（" + checks.length + " 项）"));
process.exit(bad ? 1 : 0);

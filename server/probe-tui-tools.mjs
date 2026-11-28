/**
 * 终端 TUI 工具探针（v1.7.0 契约 §3 / §4）
 *
 *   node probe-tui-tools.mjs [base]
 *
 * 覆盖：
 *  A) --hint-test "/to"        -> 补全出 /tool 与 /tools，每行「cmd<TAB>说明」；
 *  B) --hint-test "/tool "     -> /tool 的提示条列出可用工具（来自 GET /api/tools，含 get_current_time）；
 *  C) --hint-test "/"          -> 至少 11 条命令（/help /clear /new /model /state /tools /tool /run /web /think /exit）；
 *  D) --plain 管道喂 /tools、/tool get_current_time、/exit -> 打印工具名 + 调用结果（含时间），不出现「未知命令」。
 *  E) v2.0.0 终端升级：--version（自身 + 主程序版本）、--faces（原创颜文字）、--selftest、
 *     --snapshot（线框输入框 / 光标 / Markdown 降级 / 能力面板 / 等待动画）、--bench（渲染耗时）。
 *
 * 前置：服务在跑。没加载模型时探针先加载 4B（否则 TUI 的 ensureModel 会自己挑最小的，把后续探针环境搞乱）。
 * 不写任何文件，纯读接口。
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const TUI = path.join(SERVER_DIR, "localai-tui.mjs");
const BASE = process.argv[2] || "http://127.0.0.1:8099";
const MODEL = "qwen3-5-4B-Q4_K_M.gguf";

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass += 1; console.log("  ok   " + name + (extra ? "  [" + extra + "]" : "")); }
  else { fail += 1; console.log("  FAIL " + name + "  " + (extra || "")); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 跑一次 TUI，可选喂 stdin；返回 {code, out, err, timedOut} */
function runTui(args, input, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [TUI, ...args], { cwd: SERVER_DIR, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "", timedOut = false;
    child.stdout.on("data", (d) => { out += String(d); });
    child.stderr.on("data", (d) => { err += String(d); });
    const timer = setTimeout(() => { timedOut = true; try { child.kill(); } catch {} }, timeoutMs || 60000);
    child.on("error", (e) => { clearTimeout(timer); resolve({ code: -1, out, err: err + String(e && e.message), timedOut }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code: code === null ? -1 : code, out, err, timedOut }); });
    if (input !== undefined && input !== null) {
      try { child.stdin.end(input); } catch {}
    } else {
      try { child.stdin.end(); } catch {}
    }
  });
}

async function getJson(p) {
  try {
    const r = await fetch(BASE + p, { signal: AbortSignal.timeout(15000) });
    const t = await r.text();
    let d = null; try { d = JSON.parse(t); } catch {}
    return { status: r.status, data: d };
  } catch (e) {
    return { status: 0, data: null, error: String((e && e.message) || e) };
  }
}

console.log("\n== 目标 " + BASE + " · TUI " + path.basename(TUI) + " ==\n");

try {
  // ---------- 0. 前置：服务 + 模型 + 工具清单 ----------
  const boot = await getJson("/api/state");
  ok("GET /api/state -> 200", boot.status === 200, "HTTP " + boot.status);
  if (!String((boot.data && boot.data.loaded) || "")) {
    await fetch(BASE + "/api/load", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ file: MODEL, contextSize: 8192 }) });
    let loaded = "";
    for (let i = 0; i < 150; i++) {
      await sleep(1000);
      const s = await getJson("/api/state");
      loaded = String((s.data && s.data.loaded) || "");
      if (loaded) break;
    }
    ok("前置：模型已加载（避免 TUI 自己挑最小的）", loaded.length > 0, "loaded=" + loaded);
  } else {
    ok("前置：模型已加载", true, "loaded=" + boot.data.loaded);
  }
  const toolsResp = await getJson("/api/tools");
  const toolNames = Array.isArray(toolsResp.data && toolsResp.data.tools) ? toolsResp.data.tools.map((t) => String(t.name || "")) : [];
  ok("GET /api/tools 带回工具清单", toolsResp.status === 200 && toolNames.length >= 3, "n=" + toolNames.length + " 例如 " + toolNames.slice(0, 4).join(","));

  // ---------- A. --hint-test "/to" ----------
  console.log("\n== A. --hint-test \"/to\"：补全出 /tool 与 /tools ==");
  const hint = await runTui(["--hint-test", "/to"], null, 30000);
  const hintLines = String(hint.out || "").split(/\r?\n/).filter(Boolean);
  ok("--hint-test \"/to\" 退出码 0", hint.code === 0 && !hint.timedOut, "code=" + hint.code + " timedOut=" + hint.timedOut + " err=" + String(hint.err || "").slice(0, 80));
  ok("输出至少 2 行补全结果", hintLines.length >= 2, "lines=" + hintLines.length + " " + JSON.stringify(hintLines.slice(0, 4)));
  ok("补全结果里有 /tool", hintLines.some((l) => /^\/tool\t/.test(l)), JSON.stringify(hintLines.filter((l) => l.startsWith("/tool")).slice(0, 2)));
  ok("补全结果里有 /tools", hintLines.some((l) => /^\/tools\t/.test(l)), JSON.stringify(hintLines.filter((l) => l.startsWith("/tools")).slice(0, 2)));
  ok("每行是「cmd<TAB>说明」且说明非空", hintLines.every((l) => /\t\S/.test(l)), JSON.stringify(hintLines.slice(0, 3)));

  // ---------- B. --hint-test "/tool "（列工具） ----------
  console.log("\n== B. --hint-test \"/tool \"：列出可用工具 ==");
  const hintTool = await runTui(["--hint-test", "/tool "], null, 30000);
  const toolOut = String(hintTool.out || "");
  ok("--hint-test \"/tool \" 退出码 0", hintTool.code === 0 && !hintTool.timedOut, "code=" + hintTool.code);
  const listed = toolNames.filter((n) => n && toolOut.includes(n));
  ok("提示条列出至少 3 个工具名", listed.length >= 3, "命中=" + listed.slice(0, 6).join(",") + " / 共 " + toolNames.length);
  ok("提示条包含 get_current_time", toolOut.includes("get_current_time"));
  ok("提示条带工具说明（不是只有名字）", /[\u4e00-\u9fa5]{2,}|returns|当前/.test(toolOut), toolOut.replace(/\s+/g, " ").slice(0, 100));

  // ---------- C. --hint-test "/"（命令全集） ----------
  console.log("\n== C. --hint-test \"/\"：命令全集 ==");
  const hintAll = await runTui(["--hint-test", "/"], null, 30000);
  const allOut = String(hintAll.out || "");
  const needCmds = ["/help", "/clear", "/new", "/model", "/state", "/tools", "/tool", "/run", "/web", "/think", "/exit"];
  const missing = needCmds.filter((c) => !new RegExp("^" + c.replace("/", "\\/") + "\\b", "m").test(allOut));
  ok("--hint-test \"/\" 退出码 0", hintAll.code === 0 && !hintAll.timedOut, "code=" + hintAll.code);
  ok("至少 11 条命令", (allOut.match(/^\/[a-z-]+/gm) || []).length >= 11, "n=" + (allOut.match(/^\/[a-z-]+/gm) || []).length);
  ok("包含全部必需命令（help/clear/new/model/state/tools/tool/run/web/think/exit）", missing.length === 0, missing.length ? "缺=" + missing.join(",") : "齐");

  // 非 / 开头的输入：hint-test 不该崩
  const hintPlain = await runTui(["--hint-test", "abc"], null, 20000);
  ok("--hint-test 非命令输入也能正常退出（不崩）", hintPlain.code === 0 && !hintPlain.timedOut, "code=" + hintPlain.code);

  // ---------- D. --plain 管道：/tools + /tool + /exit ----------
  console.log("\n== D. --plain 管道：/tools、/tool get_current_time、/exit ==");
  const plain = await runTui(["--plain", "--url", BASE], "/tools\n/tool get_current_time\n/exit\n", 180000);
  const plainOut = String(plain.out || "");
  ok("--plain 管道退出码 0（/exit 生效）", plain.code === 0 && !plain.timedOut, "code=" + plain.code + " timedOut=" + plain.timedOut + " err=" + String(plain.err || "").slice(0, 100));
  ok("/tools 打印了工具名", toolNames.length > 0 && toolNames.filter((n) => plainOut.includes(n)).length >= 3, "命中=" + toolNames.filter((n) => plainOut.includes(n)).slice(0, 5).join(","));
  ok("/tools 打印了参数（args）", /参数|args|query|name/i.test(plainOut), plainOut.replace(/\s+/g, " ").slice(0, 140));
  ok("/tool 调用结果里带工具名 get_current_time", plainOut.includes("get_current_time"));
  ok("/tool 调用结果里有时间（年份/带时间的 JSON）", /20\d{2}[-\/年]|"time"|:\s*"[^"]*\d{2}:\d{2}/.test(plainOut), plainOut.replace(/\s+/g, " ").slice(0, 160));
  ok("没有出现「未知命令」", !/未知命令/.test(plainOut), (plainOut.match(/未知命令[^\n]*/) || [""])[0]);
  ok("没有 HTTP 错误 / 异常堆栈", !/HTTP 4\d\d|HTTP 5\d\d|Error:|throw /.test(plainOut + String(plain.err || "")), (plainOut + String(plain.err || "")).replace(/\s+/g, " ").slice(0, 120));

  // ---------- E. v2.0.0：终端升级 ==========
  console.log("\n== E. --version / --faces / --selftest / --snapshot / --bench ==");

  /** 终端显示宽度（CJK 与 emoji 按 2 列），用来断言线框不歪 */
  const cw = (ch) => {
    const cp = ch.codePointAt(0);
    return (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe6f) || (cp >= 0xff00 && cp <= 0xff60) ||
      (cp >= 0x1f300 && cp <= 0x1f9ff) ? 2 : 1;
  };
  const dispWidth = (s) => [...String(s)].reduce((n, ch) => n + cw(ch), 0);

  const ver = await runTui(["--version"], null, 30000);
  const verOut = String(ver.out || "");
  ok("--version 退出码 0", ver.code === 0 && !ver.timedOut, "code=" + ver.code + " " + String(ver.err || "").slice(0, 60));
  ok("--version 打出终端自身版本 localai tui 2.0.0", verOut.includes("localai tui 2.0.0"), verOut.replace(/\s+/g, " ").slice(0, 80));
  ok("--version 附带主程序版本（v + 数字）", /主程序\s+v\d+\.\d+\.\d+/.test(verOut), (verOut.match(/主程序[^\n]*/) || [""])[0]);
  ok("--version 带 Node 与服务地址", /Node\s+v\d/.test(verOut) && verOut.includes(BASE), (verOut.match(/Node[^\n]*/) || [""])[0]);

  const faces = await runTui(["--faces"], null, 20000);
  const faceLines = String(faces.out || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  ok("--faces 退出码 0", faces.code === 0 && !faces.timedOut, "code=" + faces.code);
  ok("--faces 至少 12 个颜文字", faceLines.length >= 12, "n=" + faceLines.length);
  ok("--faces 没有重复", new Set(faceLines).size === faceLines.length, "unique=" + new Set(faceLines).size);
  ok("--faces 形如括号颜文字（含 ( 与 )）", faceLines.every((f) => f.includes("(") && f.includes(")")), JSON.stringify(faceLines.slice(0, 3)));

  const st2 = await runTui(["--selftest"], null, 60000);
  const stOut = String(st2.out || "");
  ok("--selftest 退出码 0", st2.code === 0 && !st2.timedOut, "code=" + st2.code + " " + String(st2.err || "").slice(0, 80));
  ok("--selftest 全部通过", /SELFTEST 通过/.test(stOut), stOut.replace(/\s+/g, " ").slice(0, 100));
  const stN = Number((/通过（(\d+) 项）/.exec(stOut) || [])[1] || 0);
  ok("--selftest 覆盖 ≥ 50 项（v2.0.0 新增 Markdown/LaTeX/线框/光标/面板）", stN >= 50, "n=" + stN);

  const snap = await runTui(["--snapshot", "--no-color", "--cols", "96", "--rows", "26", "--main-ver", "1.11.2"], null, 30000);
  const snapOut = String(snap.out || "");
  const snapLines = snapOut.split(/\r?\n/).filter((l) => l.startsWith("|") && l.endsWith("|"));
  ok("--snapshot 退出码 0", snap.code === 0 && !snap.timedOut, "code=" + snap.code);
  ok("--snapshot 有输入框线框（╭ ╮ ╰ ╯）", ["╭", "╮", "╰", "╯"].every((c) => snapOut.includes(c)));
  ok("--snapshot 输入框标题是「输入」", snapOut.includes("输入"));
  ok("--snapshot 头部同时有终端与主程序版本", snapOut.includes("tui 2.0.0") && snapOut.includes("主程序 v1.11.2"), (snapOut.match(/主程序[^\n|]*/) || [""])[0]);
  ok("--snapshot 显示输入光标（NO_COLOR 下是 ▏）", snapOut.includes("▏"));
  ok("--snapshot Markdown 标记已降级（不出现 **）", !snapOut.includes("**"));
  ok("--snapshot 有标题/列表符号（▌ 或 •）", snapOut.includes("▌") || snapOut.includes("•"));
  const innerLines = snapLines.map((l) => l.slice(1, -1));
  ok("--snapshot 每一帧内容宽度都等于 96", innerLines.length >= 20 && innerLines.every((l) => dispWidth(l) === 96), "n=" + innerLines.length + " bad=" + JSON.stringify(innerLines.filter((l) => dispWidth(l) !== 96).slice(0, 2)));

  const snapMenu = await runTui(["--snapshot", "--no-color", "--cols", "96", "--rows", "30", "--menu", "--main-ver", "1.11.2"], null, 30000);
  const menuOut = String(snapMenu.out || "");
  ok("--snapshot --menu 退出码 0", snapMenu.code === 0 && !snapMenu.timedOut, "code=" + snapMenu.code);
  ok("能力面板有线框与标题", menuOut.includes("能力面板") && menuOut.includes("╭"));
  ok("能力面板列出 /tool 与 /version", menuOut.includes("/tool") && menuOut.includes("/version"));
  ok("能力面板有选中标记与快捷键说明", menuOut.includes("▸") && /↑↓|Tab/.test(menuOut));

  const snapGen = await runTui(["--snapshot", "--no-color", "--cols", "96", "--rows", "22", "--gen"], null, 30000);
  const genOut = String(snapGen.out || "");
  ok("--snapshot --gen 显示等待动画", snapGen.code === 0 && genOut.includes("生成中"), "code=" + snapGen.code);
  ok("等待动画是旋转斜杠 + 颜文字", /[\/\\\-|] \(∫_∫\)/.test(genOut), (genOut.split(/\r?\n/).find((l) => l.includes("∫_∫")) || "").trim());
  ok("等待动画带已用时间（3.2s）", /3\.\d s|3\.\ds/.test(genOut) || genOut.includes("3.2s"));

  const bench = await runTui(["--bench"], null, 120000);
  const benchOut = String(bench.out || "");
  const frameLine = benchOut.split(/\r?\n/).find((l) => l.trim().startsWith("frame ")) || "";
  const frameMs = Number((/每次 ([\d.]+)ms/.exec(frameLine) || [])[1] || 9999);
  ok("--bench 退出码 0", bench.code === 0 && !bench.timedOut, "code=" + bench.code);
  ok("--bench 同时报告 Markdown 解析与整帧渲染", benchOut.includes("md ") && benchOut.includes("frame "));
  ok("整帧渲染 < 5ms（终端比界面快的基础）", frameMs < 5, "frame=" + frameMs + "ms");

} catch (e) {
  fail += 1;
  console.log("  FAIL 探针异常中断: " + String((e && e.message) || e));
}

console.log("\n== 结果: " + pass + " 通过 / " + fail + " 失败 ==\n");
process.exit(fail ? 1 : 0);

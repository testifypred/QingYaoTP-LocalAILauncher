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
} catch (e) {
  fail += 1;
  console.log("  FAIL 探针异常中断: " + String((e && e.message) || e));
}

console.log("\n== 结果: " + pass + " 通过 / " + fail + " 失败 ==\n");
process.exit(fail ? 1 : 0);

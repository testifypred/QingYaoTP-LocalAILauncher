/**
 * Debugging Tool 探针（接口 + 独立程序，不需要 CDP）
 *
 *   node probe-debug.mjs [base]
 *
 * 覆盖：/debug 页面可访问、/api/diag 结构完整（检查项 level 合法、summary 自洽）、
 *       日志接口能读（含编码字段）、清崩溃记录与打开调试窗口都要令牌、
 *       独立程序 localai-debug.mjs 的文本与 --json 两种输出。
 * 自复位：清掉的崩溃记录会原样写回。
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const BASE = process.argv[2] || "http://127.0.0.1:8099";
const HERE = "D:\\LocalModels\\server";
const CRASH = HERE + "\\vulkan-crash.log";

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) { pass++; console.log("  ok   " + n + (d ? "  [" + d + "]" : "")); } else { fail++; console.log("  FAIL " + n + "  " + d); } };
const j = async (m, p, body, headers) => {
  const r = await fetch(BASE + p, {
    method: m,
    headers: Object.assign({}, body ? { "content-type": "application/json" } : {}, headers || {}),
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  let data = null; try { data = JSON.parse(t); } catch {}
  return { status: r.status, data, text: t };
};

console.log("\n== 目标 " + BASE + " ==\n");

// ---- 页面 ----
const page = await j("GET", "/debug");
ok("/debug 页面可访问", page.status === 200 && page.text.includes("Debugging Tool"), "HTTP " + page.status + " · " + page.text.length + " 字节");
ok("页面自带检查项容器", page.text.includes('id="checks"') && page.text.includes('id="logBox"'));

// ---- 诊断 ----
const d = await j("GET", "/api/diag");
const diag = d.data || {};
ok("/api/diag 可用", d.status === 200 && Array.isArray(diag.checks), "HTTP " + d.status);
ok("检查项足够多（>=12）", (diag.checks || []).length >= 12, "checks=" + (diag.checks || []).length);
ok("每项都有 id/level/title", (diag.checks || []).every((c) => c.id && c.title && ["ok", "warn", "error"].includes(c.level)));
ok("summary 与检查项自洽", (() => {
  const c = diag.checks || [];
  const s = diag.summary || {};
  return s.ok === c.filter((x) => x.level === "ok").length &&
         s.warn === c.filter((x) => x.level === "warn").length &&
         s.error === c.filter((x) => x.level === "error").length;
})(), JSON.stringify(diag.summary));
ok("带版本信息", !!(diag.version && diag.version.version), JSON.stringify(diag.version || {}));
ok("带服务与系统信息", !!(diag.server && diag.system && diag.system.node), (diag.server && diag.server.port) + " / " + (diag.system && diag.system.node));
ok("带路径（含日志与崩溃记录）", !!(diag.paths && diag.paths.logs && diag.paths.crashLog), (diag.paths && diag.paths.crashLog) || "");

// ---- 日志 ----
const la = await j("GET", "/api/diag/logs?which=app&lines=20");
ok("日志接口可用", la.status === 200 && typeof la.data?.text === "string", "HTTP " + la.status);
ok("日志报出文件与编码", !!(la.data?.file && la.data?.encoding), (la.data?.file || "") + " · " + (la.data?.encoding || ""));
ok("日志内容不是空字符乱码", !String(la.data?.text || "").includes("\u0000"), String(la.data?.text || "").slice(0, 40));
const lc = await j("GET", "/api/diag/logs?which=crash&lines=10");
ok("崩溃日志接口结构完整", lc.status === 200 && typeof lc.data?.text === "string", "HTTP " + lc.status);

// ---- 令牌 ----
ok("清崩溃记录必须带令牌", (await j("POST", "/api/diag/clear-crash", {})).status === 403);
ok("打开调试窗口必须带令牌", (await j("POST", "/api/debug/open", {})).status === 403);

// ---- 清崩溃记录（带令牌，跑完还原） ----
const st = await j("GET", "/api/state");
const tok = st.data?.localToken || "";
const backup = existsSync(CRASH) ? readFileSync(CRASH) : null;
const cleared = await j("POST", "/api/diag/clear-crash", {}, { "x-local-token": tok });
ok("带令牌能清崩溃记录", cleared.status === 200 && cleared.data?.ok === true, JSON.stringify(cleared.data || {}));
ok("清完文件真的没了", !existsSync(CRASH));
if (backup) { writeFileSync(CRASH, backup); ok("已把崩溃记录写回（探针自复位）", existsSync(CRASH)); }
else { ok("原本没有崩溃记录，无需还原", true); }

// ---- 独立程序 ----
const run = (args) => {
  try {
    const out = execFileSync(process.execPath, ["localai-debug.mjs"].concat(args), { cwd: HERE, encoding: "utf8", timeout: 30000 });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: String(e.stdout || "") + String(e.stderr || "") };
  }
};
const cli = run([]);
ok("命令行版能跑（服务在跑时）", cli.code === 0 && cli.out.includes("检查项"), "exit=" + cli.code);
ok("命令行版列出检查项", /\[ok\]|✓/.test(cli.out) || cli.out.includes("✓"), "");
const js = run(["--json"]);
let parsed = null;
try { parsed = JSON.parse(js.out); } catch {}
ok("--json 输出可解析", js.code === 0 && !!parsed, "exit=" + js.code);
ok("--json 里也有 checks", !!(parsed && Array.isArray(parsed.checks) && parsed.checks.length >= 12), "n=" + (parsed?.checks?.length ?? 0));
const lg = run(["--logs", "app", "5"]);
ok("--logs 能读日志", lg.code === 0 && lg.out.includes("# "), "exit=" + lg.code);

console.log("\nRESULT " + pass + "/" + (pass + fail));
process.exit(fail ? 1 : 0);

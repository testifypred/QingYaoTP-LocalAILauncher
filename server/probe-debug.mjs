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
// 崩溃记录的真实路径从 /api/diag 的 paths.crashLog 取：
// 跑源码时是 server\vulkan-crash.log，跑发布包时是 dist\LocalAI\app\vulkan-crash.log
let CRASH = HERE + "\\vulkan-crash.log";

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
ok("调试页声明了自己的图标", page.text.includes('rel="icon"') && page.text.includes("/debug-icon.png"));
const iconResp = await fetch(BASE + "/debug-icon.png");
ok("调试工具图标可取（png）", iconResp.status === 200 && String(iconResp.headers.get("content-type") || "").includes("image/png"), "HTTP " + iconResp.status + " · " + iconResp.headers.get("content-type"));

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
if (diag.paths && diag.paths.crashLog) CRASH = diag.paths.crashLog;

// ---- 日志 ----
const la = await j("GET", "/api/diag/logs?which=app&lines=20");
ok("日志接口可用", la.status === 200 && typeof la.data?.text === "string", "HTTP " + la.status);
ok("日志报出文件与编码", !!(la.data?.file && la.data?.encoding), (la.data?.file || "") + " · " + (la.data?.encoding || ""));
ok("日志内容不是空字符乱码", !String(la.data?.text || "").includes("\u0000"), String(la.data?.text || "").slice(0, 40));
const lc = await j("GET", "/api/diag/logs?which=crash&lines=10");
ok("崩溃日志接口结构完整", lc.status === 200 && typeof lc.data?.text === "string", "HTTP " + lc.status);

// ---- 实时资源（调试页 2 秒轮询的只读接口）----
// 采样两次：第一次可能正好是服务启动后的首采（CPU 没有基准，usagePct=null），
// 第二次必然有基准，所以 CPU 数值只断言第二次，避免抖动。
const num = (v) => typeof v === "number" && Number.isFinite(v);
const r1 = await j("GET", "/api/diag/resources");
const res1 = r1.data || {};
ok("资源接口可用（无令牌 GET）", r1.status === 200 && !!res1.now, "HTTP " + r1.status);
ok("资源字段形状完整（含 ISO 时间）", !!(
  !Number.isNaN(Date.parse(res1.now || "")) &&
  res1.cpu && num(res1.cpu.cores) && res1.cpu.cores > 0 &&
  res1.mem && num(res1.mem.totalGB) && num(res1.mem.usedGB) && num(res1.mem.freeGB) && num(res1.mem.usedPct) &&
  res1.proc && num(res1.proc.pid) && num(res1.proc.rssMB) && num(res1.proc.heapUsedMB) &&
  res1.model && typeof res1.model.file === "string" && num(res1.model.context)
), "cpu/mem/proc/model/now");
ok("内存 已用+空闲 ≈ 总量（±0.1 GB）",
  Math.abs((res1.mem.usedGB + res1.mem.freeGB) - res1.mem.totalGB) <= 0.1,
  res1.mem.usedGB + " + " + res1.mem.freeGB + " vs " + res1.mem.totalGB);
ok("内存百分比与用量自洽（0–100）",
  res1.mem.usedPct >= 0 && res1.mem.usedPct <= 100 &&
  Math.abs(res1.mem.usedPct - (res1.mem.usedGB / res1.mem.totalGB) * 100) <= 2,
  res1.mem.usedPct + "%");
ok("进程 RSS > 0 且 heap 合理", res1.proc.rssMB > 0 && res1.proc.heapUsedMB >= 0, "RSS " + res1.proc.rssMB + " MB · heap " + res1.proc.heapUsedMB + " MB");
ok("磁盘剩余可读（disk 为 null 或 freeGB ≥ 0）",
  res1.disk === null || (res1.disk && num(res1.disk.freeGB) && res1.disk.freeGB >= 0 && num(res1.disk.totalGB) && res1.disk.totalGB > 0),
  res1.disk ? res1.disk.freeGB + " / " + res1.disk.totalGB + " GB" : "null");
await new Promise((r) => setTimeout(r, 1300));
const r2 = await j("GET", "/api/diag/resources");
const res2 = r2.data || {};
const cpu2 = res2.cpu?.usagePct;
ok("第二次采样 CPU 占用是 0–100 的数字", typeof cpu2 === "number" && cpu2 >= 0 && cpu2 <= 100, "usagePct=" + JSON.stringify(cpu2));
ok("第二次采样 now 推进", r2.status === 200 && Date.parse(res2.now) > Date.parse(res1.now), res1.now + " → " + res2.now);
const st2 = await j("GET", "/api/state");
ok("模型 KV 量化与 /api/state 一致", typeof res1.model.kvQuant === "string" && res1.model.kvQuant.length > 0 && res1.model.kvQuant === st2.data?.kvQuant,
  res1.model.kvQuant + " vs " + (st2.data?.kvQuant ?? "?"));
// 只看「我们请求了什么」不够：LlamaContext 的 getter 反映实际生效的类型（8=q8_0、1=f16）
const kvActual2 = st2.data?.kvQuantActual || {};
ok("KV 量化实际生效类型与配置一致（LlamaContext getter）",
  typeof kvActual2.key === "string" && kvActual2.key === st2.data?.kvQuant && res1.model.kvQuantActual?.key === kvActual2.key,
  "actual=" + (kvActual2.key || "null") + " · configured=" + (st2.data?.kvQuant ?? "?") + " · resources=" + (res1.model.kvQuantActual?.key || "null"));

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

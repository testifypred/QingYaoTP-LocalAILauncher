/**
 * 插件启用/禁用探针
 *
 *   node probe-plugins.mjs [base]
 *
 * 覆盖：临时插件能被发现 → 禁用后不再注册成工具 → 状态落盘（workspace\\plugins.json）
 *       → 重新启用后工具回来 → 删文件后从列表消失。
 * 自复位：删临时插件、清空禁用名单、重载。
 */
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const BASE = process.argv[2] || "http://127.0.0.1:8099";
const FILE = "probe_tmp_plugin.mjs";
const TOOL = "probe_tmp_tool";

// 插件目录/禁用名单要按「服务端实际用的目录」来，不要自己猜：
//   服务端 PLUGIN_DIR = process.env.PLUGIN_DIR ?? <HERE>\..\plugins
//   → 源码模式 HERE=server 时是 D:\LocalModels\plugins（不是 server\plugins！），
//     发布包 HERE=...\app 时是 ...\plugins。猜错过一次（2026-11-07 全量在源码模式跑时 5 条红）。
// /api/plugins 直接返回 dir，用它；拿不到再退回 diag 推断。
const diag = await (await fetch(BASE + "/api/diag")).json();
const HERE_DIR = String(diag?.paths?.dir || "");
const pluginsApi = await (await fetch(BASE + "/api/plugins")).json().catch(() => ({}));
const PLUGIN_DIR = process.argv[3] || String(pluginsApi?.dir || "") || path.resolve(HERE_DIR, "..", "plugins");
const CONFIG = path.join(path.dirname(String(diag?.paths?.sessions || path.join(HERE_DIR, "workspace", "sessions"))), "plugins.json");

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) { pass++; console.log("  ok   " + n + (d ? "  [" + d + "]" : "")); } else { fail++; console.log("  FAIL " + n + "  " + d); } };
const j = async (method, p, body) => {
  const r = await fetch(BASE + p, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let data = null; try { data = JSON.parse(t); } catch {}
  return { status: r.status, data, text: t };
};
const toolNames = async () => ((await j("GET", "/api/tools")).data?.tools || []).map((t) => t.name);

console.log("\n== 目标 " + BASE + " / 插件目录 " + PLUGIN_DIR + " ==\n");

const src = [
  "export const name = \"" + TOOL + "\";",
  "export const description = \"探针用的临时插件\";",
  "export async function run() { return { ok: true }; }",
  "",
].join("\n");

await writeFile(path.join(PLUGIN_DIR, FILE), src, "utf8");
try {
  let r = await j("POST", "/api/plugins/reload");
  ok("重载后发现临时插件", r.data?.count >= 1, "count=" + r.data?.count);
  ok("插件出现在工具清单", (await toolNames()).includes(TOOL));

  r = await j("POST", "/api/plugins/toggle", { file: FILE, enabled: false });
  ok("禁用接口成功", r.status === 200 && r.data?.ok === true);
  const item = (await j("GET", "/api/plugins")).data?.items?.find((x) => x.file === FILE);
  ok("列表里标记为已禁用", item?.disabled === true, JSON.stringify(item || {}).slice(0, 100));
  ok("禁用后不再注册成工具", !(await toolNames()).includes(TOOL), JSON.stringify(await toolNames()).slice(0, 120));
  const cfg = JSON.parse(await readFile(CONFIG, "utf8").catch(() => "{}"));
  ok("禁用状态落了盘", (cfg.disabled || []).includes(FILE), JSON.stringify(cfg));

  r = await j("POST", "/api/plugins/toggle", { file: FILE, enabled: true });
  ok("重新启用", r.status === 200 && (await toolNames()).includes(TOOL));
  ok("启用后不再标禁用", (await j("GET", "/api/plugins")).data?.items?.find((x) => x.file === FILE)?.disabled === false);

  const bad = await j("POST", "/api/plugins/toggle", { file: "../evil.mjs", enabled: false });
  ok("非法文件名被拒", bad.status === 400, "status=" + bad.status);
} finally {
  await rm(path.join(PLUGIN_DIR, FILE), { force: true });
  await writeFile(CONFIG, JSON.stringify({ disabled: [] }, null, 2), "utf8").catch(() => {});
  await j("POST", "/api/plugins/reload");
}
ok("删掉文件后从列表消失", !(await j("GET", "/api/plugins")).data?.items?.some((x) => x.file === FILE));
ok("工具清单也干净了", !(await toolNames()).includes(TOOL));

console.log("\n== 结果: " + pass + " 通过 / " + fail + " 失败 ==\n");
process.exit(fail ? 1 : 0);
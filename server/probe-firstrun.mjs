/**
 * 首次启动「自动检查用户配置」探针
 *
 *   node probe-firstrun.mjs [base]
 *
 * 覆盖：
 *  1) 纯推荐逻辑（config-recommend.mjs）：8GB+2GB 显存老本 / 32GB+已有 7B / Vulkan 不可用；
 *  2) /api/sysinfo：产品名、硬件字段、检查项、推荐字段；
 *  3) /api/firstrun/apply：可用、返回写配置结果、重复调用不报错（开发目录不写 config.ini）。
 * 不用模型、不碰会话；apply 若发现推荐模型已在本地会加载它（可能花十几秒）。
 */
import { recommendConfig } from "./config-recommend.mjs";

const BASE = process.argv[2] || "http://127.0.0.1:8099";
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) { pass++; console.log("  ok   " + n + (d ? "  [" + d + "]" : "")); } else { fail++; console.log("  FAIL " + n + "  " + d); } };
const j = async (p, opt) => {
  const r = await fetch(BASE + p, opt);
  const t = await r.text();
  let data = null; try { data = JSON.parse(t); } catch {}
  return { status: r.status, data, text: t };
};

console.log("\n== 目标 " + BASE + " ==\n");

// ---- 1. 纯推荐逻辑 ----
const tiny = recommendConfig({ ramTotalGB: 7.9, ramFreeGB: 3, vramGB: 2, hasVulkan: true, cpuCores: 8, models: [] });
ok("8GB+2GB 显存 → tiny 档 + 4K 上下文", tiny.tier === "tiny" && tiny.contextSize === 4096, tiny.tier + "/" + tiny.contextSize);
ok("8GB 推荐 0.5B 模型（来自下载目录）", tiny.model.catalog === true && /0\.5b/i.test(tiny.model.file), tiny.model.file);
ok("低内存也默认 KV 量化 q8_0", tiny.kvQuant === "q8_0", tiny.kvQuant);
ok("Vulkan 可用时 gpu=auto", tiny.gpu === "auto", tiny.gpu);
ok("显存小会给出提示", (tiny.notes || []).some((n) => /显存/.test(n)), (tiny.notes || []).join(" | "));

const large = recommendConfig({ ramTotalGB: 31.4, ramFreeGB: 6.1, vramGB: 2, hasVulkan: true, cpuCores: 22, models: [{ file: "qwen2.5-7b-instruct-1m-q4_k_m.gguf" }] });
ok("32GB + 已有 7B → large 档、用已有模型", large.tier === "large" && large.model.existing === true && /7b/i.test(large.model.file), large.tier + "/" + large.model.file);
ok("32GB → 16K 上下文", large.contextSize === 16384, String(large.contextSize));

const noVk = recommendConfig({ ramTotalGB: 8, ramFreeGB: 4, vramGB: 0, hasVulkan: false, cpuCores: 8, models: [] });
ok("Vulkan 不可用 → gpu=cpu", noVk.gpu === "cpu", noVk.gpu);

// 2026-11-02 实测：内存 31.4GB + 模型目录为空时，reason 写「可用 7B 级模型」却推荐 0.5B（自相矛盾）。
// 现在没有本地大模型就推荐能单文件下完的 1.5B，并把「本机还没有 7B」写进文案。
const largeNoBig = recommendConfig({ ramTotalGB: 31.4, ramFreeGB: 6.1, vramGB: 2, hasVulkan: true, cpuCores: 22, models: [] });
ok("32GB + 本机没有大模型 → 推荐下载 1.5B", largeNoBig.tier === "large" && largeNoBig.model.catalog === true && /1\.5b/i.test(largeNoBig.model.file), largeNoBig.model.file);
ok("文案与推荐一致（说明本机还没有 7B、先下 1.5B）", /本机还没有/.test(largeNoBig.reason) && /1\.5B/.test(largeNoBig.reason), largeNoBig.reason);

const mid = recommendConfig({ ramTotalGB: 20, ramFreeGB: 10, vramGB: 0, hasVulkan: true, cpuCores: 8, models: [] });
ok("20GB（medium）→ 1.5B + 8K", mid.tier === "medium" && /1\.5b/i.test(mid.model.file) && mid.contextSize === 8192, mid.tier + "/" + mid.model.file + "/" + mid.contextSize);

// ---- 2. /api/sysinfo ----
const s = await j("/api/sysinfo");
const d = s.data || {};
ok("/api/sysinfo 可用", s.status === 200 && !!s.data, "HTTP " + s.status);
ok("带产品名与版本", d.app?.name === "QingYaoTP AILauncher" && /^\d+\.\d+\.\d+$/.test(String(d.app?.version || "")), (d.app?.name || "?") + " v" + (d.app?.version || "?"));
ok("带硬件字段", typeof d.cpu === "string" && typeof d.cores === "number" && typeof d.ramTotalGB === "number" && typeof d.ramFreeGB === "number" && Array.isArray(d.gpus) && typeof d.hasVulkan === "boolean");
ok("带检查项（≥6，字段完整）", Array.isArray(d.checks) && d.checks.length >= 6 && d.checks.every((c) => c.id && c.level && c.title && typeof c.detail === "string"), (d.checks || []).length + " 项");
ok("推荐字段完整", !!d.recommend && !!d.recommend.model && Number(d.recommend.contextSize) > 0 && d.recommend.kvQuant === "q8_0", JSON.stringify({ ctx: d.recommend?.contextSize, kv: d.recommend?.kvQuant }));
ok("推荐模型有 id 或已存在", !!(d.recommend?.model?.id || d.recommend?.model?.existing), d.recommend?.model?.file || "");
ok("带 firstRunDone 标记", typeof d.firstRunDone === "boolean", String(d.firstRunDone));
const cat = await j("/api/download/catalog");
ok("下载目录里有 1.5B 单文件档", (cat.data?.models || []).some((m) => m.id === "qwen25-15b-q4km" && /1\.5b/i.test(m.file)), (cat.data?.models || []).map((m) => m.id).join(","));

// ---- 3. /api/firstrun/apply ----
const opt = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dryRun: true }) };
const a = await j("/api/firstrun/apply", opt);
ok("/api/firstrun/apply 可用（dry-run）", a.status === 200 && a.data?.ok === true && a.data?.dryRun === true, "HTTP " + a.status);
ok("dry-run 只给建议、不写配置不加载", !!a.data?.recommended && a.data?.applied === null && a.data?.loaded === false, "applied=" + JSON.stringify(a.data?.applied));
const a2 = await j("/api/firstrun/apply", opt);
ok("重复 apply 不报错（幂等）", a2.status === 200 && a2.data?.ok === true, "HTTP " + a2.status);

console.log("\nRESULT " + pass + "/" + (pass + fail));
process.exit(fail ? 1 : 0);

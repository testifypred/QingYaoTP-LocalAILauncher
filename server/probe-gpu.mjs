/**
 * 显卡（Vulkan 设备）选择探针 —— 「独显调动入口」
 *
 *   node probe-gpu.mjs [base]
 *
 * 覆盖：/api/gpus 形状、设备清单、非法/越界设备号被拒、选择写入 config.ini（开发目录跳过写盘）、
 *       读回来的 config 与 current/needRestart 自洽、恢复原值、/api/diag 里有「显卡选择」检查项。
 * 不加载模型；只在发布包（有 config.ini）上会真的写盘，跑完恢复成空（自动）。
 */
const BASE = process.argv[2] || "http://127.0.0.1:8099";
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) { pass++; console.log("  ok   " + n + (d ? "  [" + d + "]" : "")); } else { fail++; console.log("  FAIL " + n + "  " + d); } };
const j = async (method, p, body) => {
  const r = await fetch(BASE + p, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  let data = null;
  try { data = JSON.parse(t); } catch {}
  return { status: r.status, data, text: t };
};

console.log("\n== 目标 " + BASE + " ==\n");

const g0 = await j("GET", "/api/gpus");
const d0 = g0.data || {};
ok("/api/gpus 可用", g0.status === 200 && d0.ok === true, "HTTP " + g0.status);
ok("后端字段是 vulkan/cpu", ["vulkan", "cpu"].includes(String(d0.backend)), String(d0.backend));
ok("devices 是数组", Array.isArray(d0.devices), "n=" + (d0.devices || []).length);
ok("设备项带 index/name", (d0.devices || []).every((x) => Number.isInteger(x.index) && typeof x.name === "string" && x.name.length > 0), JSON.stringify((d0.devices || []).map((x) => x.index + ":" + x.name)));
ok("current/config/needRestart 字段齐全", typeof d0.current === "string" && typeof d0.config === "string" && typeof d0.needRestart === "boolean", "current=" + d0.current + " config=" + d0.config + " needRestart=" + d0.needRestart);

const bad = await j("POST", "/api/gpus", { devices: "abc" });
ok("非法设备号被拒（400）", bad.status === 400, "HTTP " + bad.status);

const over = await j("POST", "/api/gpus", { devices: "99" });
ok("越界设备号被拒（400）", (d0.devices || []).length === 0 || over.status === 400, "HTTP " + over.status);

const saved = await j("POST", "/api/gpus", { devices: "0" });
const sd = saved.data || {};
ok("保存设备 0（200）", saved.status === 200 && sd.ok === true, "HTTP " + saved.status + " saved=" + sd.saved);
ok("保存结果回显 vkDevices=0", String(sd.config) === "0", "config=" + sd.config);
ok("写盘结果与 configWritable 一致", d0.configWritable === true ? sd.saved === true : sd.saved === false, "configWritable=" + d0.configWritable + " saved=" + sd.saved);

const g1 = await j("GET", "/api/gpus");
const d1 = g1.data || {};
if (d0.configWritable === true) {
  ok("读回来 config 已是 0", String(d1.config) === "0", "config=" + d1.config);
} else {
  ok("开发目录不写盘：config 仍为空", String(d1.config) === "", "config=" + d1.config);
}

const restored = await j("POST", "/api/gpus", { devices: "" });
ok("恢复「自动」（200）", restored.status === 200 && String(restored.data?.config) === "", "HTTP " + restored.status + " config=" + restored.data?.config);
const g2 = await j("GET", "/api/gpus");
ok("恢复后读回来是空", String(g2.data?.config) === "", "config=" + g2.data?.config);

const diag = await j("GET", "/api/diag");
const vk = (diag.data?.checks || []).find((c) => c.id === "vkdevices");
ok("/api/diag 里有「显卡选择」项", !!vk && typeof vk.detail === "string", vk ? vk.detail : "");

console.log("\n== 结果: " + pass + " 通过 / " + fail + " 失败 ==\n");
process.exit(fail ? 1 : 0);

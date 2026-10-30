/**
 * 本地模型嗅探模块探针（不需要真模型，配合 fake-models 目录使用）
 *
 *   node probe-discover.mjs [base] [fixtureDir] [modelDir]
 *
 * 覆盖：配置读写、扫描（魔数/深度/大小过滤/去重）、收录（硬链接/已存在/非法文件）。
 */
const BASE = process.argv[2] || "http://127.0.0.1:8096";
const FIX = process.argv[3] || "D:\\Test For DSH Harness\\fake-models\\src";
/** 被探服务端的 MODEL_DIR：收录都往这里放，和源目录必须是两个地方 */
const MODELDIR = process.argv[4] || "D:\\Test For DSH Harness\\fake-models\\library";

let pass = 0;
let fail = 0;
function ok(name, cond, extra = "") {
  if (cond) { pass += 1; console.log(`  ✅ ${name}${extra ? " — " + extra : ""}`); }
  else { fail += 1; console.log(`  ❌ ${name}${extra ? " — " + extra : ""}`); }
}
async function j(method, path, body) {
  const r = await fetch(BASE + path, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  return { status: r.status, data };
}

console.log(`\n== 目标 ${BASE}\n   固定目录 ${FIX}\n   模型目录 ${MODELDIR} ==\n`);

// 每轮从干净状态开始：上一轮收录过的模型会让「已收录/已存在」判定提前命中
{
  const { rm, mkdir } = await import("node:fs/promises");
  await rm(MODELDIR, { recursive: true, force: true });
  await mkdir(MODELDIR, { recursive: true });
  console.log("（已清空模型目录，保证本轮可重复）\n");
}

console.log("== A. 配置 ==");
{
  const r = await j("GET", "/api/discover/config");
  ok("GET config 200", r.status === 200);
  ok("返回 modelDir", r.data?.modelDir === MODELDIR, r.data?.modelDir);
  ok("初次未引导（onboarded=false）", r.data?.onboarded === false, String(r.data?.onboarded));
  ok("常见位置列表非空", (r.data?.common || []).length > 3, String((r.data?.common || []).length));
  ok("返回只含存在的位置", Array.isArray(r.data?.existing));

  const w = await j("POST", "/api/discover/config", { onboarded: true, customDirs: ["D:\\Test For DSH Harness"] });
  ok("POST config 生效", w.status === 200 && w.data?.onboarded === true && w.data?.customDirs?.length === 1);
  const back = await j("GET", "/api/discover/config");
  ok("配置已持久化", back.data?.onboarded === true && back.data?.customDirs?.[0] === "D:\\Test For DSH Harness");
  // 复位，后面还要测首次引导的语义
  await j("POST", "/api/discover/config", { onboarded: false, customDirs: [] });
}

console.log("\n== B. 扫描（只扫 fixture 目录）==");
let scan = null;
{
  const r = await j("POST", "/api/discover/scan", { includeDefaults: false, dirs: [FIX] });
  ok("scan 200", r.status === 200);
  scan = r.data.candidates || [];
  const names = scan.map((c) => c.targetName).sort();
  ok("魔数过滤：假 gguf 被排除", !names.includes("not-a-model.gguf"), names.join(", "));
  ok("大小过滤：10KB 被排除", !names.includes("tiny.gguf"));
  ok("递归找到深层模型", names.includes("fake-model-c.gguf"));
  ok("正常模型全找到", names.includes("fake-model-a.gguf") && names.includes("fake-model-b.gguf"), names.join(", "));
  ok("候选数 = 4（3 个整模型 + 分片首片）", scan.length === 4, String(scan.length));
  ok("按体积降序", scan[0].sizeBytes >= scan[scan.length - 1].sizeBytes, scan.map((c) => c.sizeGB).join(" / "));
  ok("标记未收录", scan.every((c) => c.already === false));
  ok("返回扫描统计", typeof r.data.scannedFiles === "number" && typeof r.data.ms === "number", `${r.data.scannedFiles} 文件 / ${r.data.ms}ms`);
  ok("后续分片被过滤", !names.some((n) => /-0000[2-9]-of-/.test(n)));
  ok("首片保留", names.filter((n) => /-00001-of-/.test(n)).length === 1);
  ok("未截断", r.data.truncated === false);
}

console.log("\n== C. 收录 ==");
{
  const target = scan.find((c) => c.targetName === "fake-model-a.gguf");
  const r = await j("POST", "/api/discover/adopt", { paths: [target.path] });
  const one = r.data?.results?.[0];
  ok("adopt 200", r.status === 200);
  ok("收录成功", one?.ok === true, JSON.stringify(one));
  ok("同盘走硬链接", one?.method === "hardlink", String(one?.method));
  ok("目标落在模型目录", one?.target === `${MODELDIR}\\fake-model-a.gguf`, one?.target);
  ok("收录后返回模型列表", Array.isArray(r.data?.models) && r.data.models.length >= 1, String(r.data?.models?.length));

  const again = await j("POST", "/api/discover/adopt", { paths: [target.path] });
  ok("重复收录被识别为已存在", again.data?.results?.[0]?.method === "existing", String(again.data?.results?.[0]?.method));

  const rescan = await j("POST", "/api/discover/scan", { includeDefaults: false, dirs: [FIX] });
  const a = (rescan.data.candidates || []).find((c) => c.targetName === "fake-model-a.gguf");
  ok("重扫后标记为已收录", a?.already === true);
}

console.log("\n== D. 非法输入 ==");
{
  const bad = await j("POST", "/api/discover/adopt", { paths: [`${FIX}\\not-a-model.gguf`] });
  ok("魔数不对的文件拒绝收录", bad.data?.results?.[0]?.ok === false, bad.data?.results?.[0]?.error);
  const missing = await j("POST", "/api/discover/adopt", { paths: [`${FIX}\\nope.gguf`] });
  ok("不存在的文件报错", missing.data?.results?.[0]?.ok === false, missing.data?.results?.[0]?.error);
  const empty = await j("POST", "/api/discover/adopt", { paths: [] });
  ok("空选择被拒", empty.status === 400, "status=" + empty.status);
  const rel = await j("POST", "/api/discover/scan", { includeDefaults: false, dirs: ["relative\\path"] });
  ok("相对路径被忽略", rel.status === 200 && (rel.data.roots || []).every((x) => x.kind !== "custom"), JSON.stringify((rel.data.roots || []).map((x) => x.label)));
}

console.log("\n== E. 常见位置扫描（同机真实目录）==");
{
  const r = await j("POST", "/api/discover/scan", { includeDefaults: true });
  ok("默认扫描 200", r.status === 200);
  ok("有目录被扫", (r.data.roots || []).length >= 1, (r.data.roots || []).map((x) => x.label).join(", "));
  ok("模型目录内的候选都标了已收录", r.data.candidates.filter((c) => c.path.startsWith(MODELDIR)).every((c) => c.already === true));
  ok("耗时可接受", r.data.ms < 20000, r.data.ms + "ms");
}

console.log(`\n== 结果: ${pass} 通过 / ${fail} 失败 ==\n`);
process.exit(fail ? 1 : 0);

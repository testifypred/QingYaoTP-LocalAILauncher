/**
 * 多回答预加载端到端探针（会真加载两个小模型，约 30–60 秒）
 *
 *   node probe-preload.mjs [base]
 *
 * 验证：能力核算 → 预加载常驻 → 第二意见走常驻作答（不再装卸主模型）→ 释放
 */
const BASE = process.argv[2] || "http://127.0.0.1:8096";
const MAIN = process.argv[3] || "qwen3-5-4B-Q4_K_M.gguf";
const EXTRA = process.argv[4] || "Phi-4-mini-instruct-Q4_K_M.gguf";

let pass = 0;
let fail = 0;
function ok(name, cond, extra = "") {
  if (cond) { pass += 1; console.log(`  ✅ ${name}${extra ? " — " + extra : ""}`); }
  else { fail += 1; console.log(`  ❌ ${name}${extra ? " — " + extra : ""}`); }
}
const t = () => new Date().toISOString().slice(11, 19);
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

console.log(`\n== 目标 ${BASE}\n   主模型 ${MAIN}\n   预加载 ${EXTRA} ==\n`);

console.log("== A. 能力核算 ==");
{
  const r = await j("GET", `/api/capacity?files=${encodeURIComponent(EXTRA)}`);
  ok("capacity 200", r.status === 200);
  const c = r.data || {};
  ok("报出内存总量与可用量", typeof c.ram?.totalGB === "number" && typeof c.ram?.freeGB === "number",
    `${c.ram?.totalGB}GB / 可用 ${c.ram?.freeGB}GB`);
  ok("给出目标模型占用估算", c.targets?.[0]?.costGB > 0, String(c.targets?.[0]?.costGB) + " GB");
  ok("给出结论与建议", ["ok", "tight", "insufficient"].includes(c.verdict) && !!c.advice, `${c.verdict}：${c.advice}`);
  // 容差 0.15GB：freeGB 服务端只保留 1 位小数、costGB 2 位，严格 0.05 会在四舍五入边界上偶发红（2026-11-04 实测）
  ok("余量 = 可用 − 占用", Math.abs((c.ram.freeGB - c.targets[0].costGB) - c.targets[0].marginGB) < 0.15,
    `${c.ram.freeGB} - ${c.targets[0].costGB} = ${c.targets[0].marginGB}`);
}

console.log("\n== B. 加载主模型 ==");
{
  const t0 = Date.now();
  const r = await j("POST", "/api/load", { file: MAIN, contextSize: 4096 });
  ok("主模型就绪", r.status === 200, `${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (r.status !== 200) { console.log(r.data); process.exit(1); }
}

console.log("\n== C. 预加载（主模型不动）==");
{
  const before = (await j("GET", "/api/state")).data;
  const r = await j("POST", "/api/preload", { files: [EXTRA] });
  ok("preload 200", r.status === 200);
  ok("预加载成功", r.data?.results?.[0]?.ok === true, JSON.stringify(r.data?.results?.[0]));
  ok("标记为常驻", r.data?.results?.[0]?.resident === true);
  ok("返回常驻清单", (r.data?.extras?.files || []).some((f) => f.file === EXTRA), JSON.stringify(r.data?.extras));
  const after = (await j("GET", "/api/state")).data;
  ok("主模型没被顶掉", after.loaded === before.loaded && after.loaded === MAIN, String(after.loaded));
  ok("state 里能看到常驻模型", (after.extras?.files || []).some((f) => f.file === EXTRA));

  const again = await j("POST", "/api/preload", { files: [EXTRA] });
  ok("重复预加载直接复用", again.data?.results?.[0]?.reused === true, JSON.stringify(again.data?.results?.[0]));
}

console.log("\n== D. 第二意见走常驻（关键）==");
{
  const t0 = Date.now();
  const r = await fetch(BASE + "/api/second-opinion", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      models: [EXTRA],
      messages: [
        { role: "user", content: "用一句话说明内存和硬盘的区别。" },
        { role: "assistant", content: "内存快但断电就丢，硬盘慢但能长期保存。" },
        { role: "user", content: "（以上是主模型的回答。请你以「第二意见」的身份补充差异，300 字以内。）" },
      ],
      max_tokens: 200,
      temperature: 0.3,
    }),
  });
  ok("接口 200", r.status === 200);
  const phases = [];
  let answer = null;
  let done = null;
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done: fin, value } = await reader.read();
    if (fin) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop();
    for (const p of parts) {
      const line = p.replace(/^data:\s*/, "").trim();
      if (!line) continue;
      let ev; try { ev = JSON.parse(line); } catch { continue; }
      phases.push(ev.phase);
      if (ev.phase === "answer") answer = ev;
      if (ev.phase === "done") done = ev;
    }
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  ok("没有出现 loading（不用换模型）", !phases.includes("loading"), phases.join(","));
  ok("事件顺序为 thinking→answer→done", phases.join(",") === "thinking,answer,done", phases.join(","));
  ok("answer 标了 preloaded", answer?.preloaded === true);
  ok("拿到了内容", typeof answer?.content === "string" && answer.content.trim().length > 0, (answer?.content || "").slice(0, 40));
  ok("done 说明没换过模型", done?.swapped === false, `swapped=${done?.swapped}`);
  // 10-18 首测 13.9s；2026-10-27 这台机器上 17-19s 属正常（预加载本身就要 17.8s）。
  // 判据是"远小于卸掉 A 再装 B"（30-45s），不是卡死某个绝对值。
  // 语义由上一行的 swapped=false 保证（没换模型）；这里只看「没退化到装卸量级」。
  // 机器忙时实测 29s（同参数平时 13–15s），25s 太紧，放宽到 45s（装卸一轮 30–45s 起）。
  ok("全程耗时没有退化到装卸量级（<45s）", Number(secs) < 45, secs + "s");

  const st = (await j("GET", "/api/state")).data;
  ok("主模型仍在原地", st.loaded === MAIN, String(st.loaded));
  ok("常驻模型仍在（没被释放）", (st.extras?.files || []).some((f) => f.file === EXTRA));
}

console.log("\n== E. 释放与收尾 ==");
{
  const r = await j("POST", "/api/preload/clear", {});
  ok("clear 200", r.status === 200);
  ok("常驻清单已空", (r.data?.extras?.files || []).length === 0, JSON.stringify(r.data?.extras));
  const u = await j("POST", "/api/unload", {});
  ok("卸载也释放常驻", u.status === 200, `freedExtras=${u.data?.freedExtras}`);
  const st = (await j("GET", "/api/state")).data;
  ok("主模型已卸载", !st.loaded, String(st.loaded));
}

console.log(`\n== 结果: ${pass} 通过 / ${fail} 失败 ==\n`);
process.exit(fail ? 1 : 0);

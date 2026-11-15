/**
 * v1.7.0 后端自测（Lead 冒烟）：/api/tools|/api/tool + /api/code/review/stream + /api/code/fix
 *   node lead-smoke-code.mjs [base] [model]
 */
const BASE = process.argv[2] || "http://127.0.0.1:8099";
const MODEL = process.argv[3] || "qwen3-5-4B-Q4_K_M.gguf";
const FENCE = String.fromCharCode(96).repeat(3);
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log("  ok   " + n + (x ? "  [" + x + "]" : "")); } else { fail++; console.log("  FAIL " + n + "  " + (x || "")); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const json = async (p, opt = {}) => {
  const r = await fetch(BASE + p, { ...opt, signal: AbortSignal.timeout(opt.timeout || 30000) });
  return { status: r.status, data: await r.json().catch(() => null) };
};
const CODE = ["function sum(list) {", "  let total;", "  for (let i = 0; i <= list.length; i++) {", "    total += list[i];", "  }", "  return total;", "}", "const out = sum([1, 2, 3]);", "console.log('sum=', out.toFixed(2));", ""].join("\n");

const st = await json("/api/state");
const token = st.data?.localToken || "";
console.log("== 令牌 " + (token ? "ok" : "拿不到") + " / 当前模型 " + (st.data?.loaded || "无") + " ==");

if (!st.data?.loaded) {
  console.log("  加载模型 " + MODEL + " ...");
  const lr = await json("/api/load", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ file: MODEL, contextSize: 8192 }), timeout: 300000 });
  ok("加载模型", lr.status === 200, "HTTP " + lr.status);
  for (let i = 0; i < 60; i++) { await sleep(2000); const s = await json("/api/state"); if (s.data?.loaded) { console.log("  已加载 " + s.data.loaded); break; } }
}

const tools = await json("/api/tools");
ok("GET /api/tools 200", tools.status === 200);
const toolList = tools.data?.tools || [];
ok("tools 数组 >=8", Array.isArray(toolList) && toolList.length >= 8, toolList.length + " 个");
const ws = toolList.find((t) => t.name === "web_search");
ok("web_search 有 args 数组且 query 必填", Boolean(ws && Array.isArray(ws.args) && ws.args.some((a) => a.name === "query" && a.required)), JSON.stringify(ws && ws.args));
ok("保留旧字段 params", Boolean(ws && Array.isArray(ws.params) && ws.params.includes("query")), JSON.stringify(ws && ws.params));

const t403 = await json("/api/tool", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "get_current_time", args: {} }) });
ok("POST /api/tool 无令牌 403", t403.status === 403, "HTTP " + t403.status);
const t404 = await json("/api/tool", { method: "POST", headers: { "content-type": "application/json", "x-local-token": token }, body: JSON.stringify({ name: "no_such_tool", args: {} }) });
ok("未知工具 404", t404.status === 404, "HTTP " + t404.status);
const tOK = await json("/api/tool", { method: "POST", headers: { "content-type": "application/json", "x-local-token": token }, body: JSON.stringify({ name: "get_current_time", args: {} }) });
const tr = tOK.data?.result || {};
ok("get_current_time 200 且有结果", tOK.status === 200 && tOK.data?.ok === true && Object.keys(tr).length > 0, JSON.stringify(tr).slice(0, 120));
const tCalc = await json("/api/tool", { method: "POST", headers: { "content-type": "application/json", "x-local-token": token }, body: JSON.stringify({ name: "calculate", args: { expression: "12*12+1" } }) });
ok("calculate = 145", tCalc.status === 200 && JSON.stringify(tCalc.data?.result || {}).includes("145"), JSON.stringify(tCalc.data?.result || null).slice(0, 120));
const tLs = await json("/api/tool", { method: "POST", headers: { "content-type": "application/json", "x-local-token": token }, body: JSON.stringify({ name: "list_workspace_files", args: {} }) });
ok("list_workspace_files 200", tLs.status === 200 && tLs.data?.ok === true, JSON.stringify(tLs.data?.result || null).slice(0, 100));

async function readSse(pathname, body, ms = 300000) {
  const r = await fetch(BASE + pathname, {
    method: "POST",
    headers: { "content-type": "application/json", "x-local-token": token },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(ms),
  });
  if (!(r.headers.get("content-type") || "").includes("text/event-stream")) {
    return { sse: false, status: r.status, data: await r.json().catch(() => null), events: [] };
  }
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const events = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const raw = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 2);
      if (!raw.startsWith("data:")) continue;
      try { events.push(JSON.parse(raw.slice(5).trim())); } catch {}
    }
  }
  return { sse: true, status: r.status, events };
}
const noTok = await fetch(BASE + "/api/code/review/stream", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "x" }), signal: AbortSignal.timeout(20000) });
ok("review/stream 无令牌 403", noTok.status === 403, "HTTP " + noTok.status);
const badCode = await json("/api/code/review/stream", { method: "POST", headers: { "content-type": "application/json", "x-local-token": token }, body: JSON.stringify({}) });
ok("review/stream 缺 code 400", badCode.status === 400, "HTTP " + badCode.status);
const badModel = await json("/api/code/review/stream", { method: "POST", headers: { "content-type": "application/json", "x-local-token": token }, body: JSON.stringify({ code: "a", model: "no-such-model.gguf" }) });
ok("review/stream 非法模型 404", badModel.status === 404, "HTTP " + badModel.status);

console.log("  真跑审查（4B，可能要 30-90s）...");
const t0 = Date.now();
const rev = await readSse("/api/code/review/stream", { code: CODE, lang: "javascript", file: "sum.js", intent: "算数组和，检查有没有 bug", max_tokens: 900 });
const secs = ((Date.now() - t0) / 1000).toFixed(1);
ok("review SSE 200", rev.sse && rev.status === 200, "HTTP " + rev.status + " " + secs + "s events=" + rev.events.length);
const types = rev.events.map((e) => e.type);
ok("事件顺序 meta→delta+→findings→done", types[0] === "meta" && types.includes("delta") && types.includes("findings") && types[types.length - 1] === "done", types.slice(0, 3).join(",") + "..." + types.slice(-2).join(","));
const metaEv = rev.events.find((e) => e.type === "meta");
ok("meta 带 model/contextSize", Boolean(metaEv && metaEv.model && metaEv.contextSize >= 2048), JSON.stringify(metaEv));
const deltas = rev.events.filter((e) => e.type === "delta").map((e) => e.text).join("");
ok("delta 非空（审查思路流式）", deltas.length > 20, deltas.length + " 字");
ok("delta 里没有裸 json 块", !deltas.includes('"issues"') && !deltas.toLowerCase().includes(FENCE + "json"), deltas.slice(-80).replace(/\n/g, " "));
const findings = rev.events.find((e) => e.type === "findings");
const issues = (findings && findings.issues) || [];
ok("findings 结构完整", Boolean(findings && typeof findings.summary === "string" && Array.isArray(findings.issues)), "issues=" + issues.length);
ok("issues 字段齐全且行号合法", issues.length > 0 && issues.every((i) => i.line >= 1 && i.line <= 10 && i.endLine >= i.line && ["error", "warn", "info"].includes(i.severity) && typeof i.title === "string" && typeof i.fix === "string"), JSON.stringify(issues[0] || null).slice(0, 160));

console.log("  真跑修正（可能要 30-90s）...");
const t1 = Date.now();
const fix = await readSse("/api/code/fix", { code: CODE, lang: "javascript", file: "sum.js", intent: "修 bug", scope: "all", issues: issues, max_tokens: 1200 });
const fsecs = ((Date.now() - t1) / 1000).toFixed(1);
ok("fix SSE 200", fix.sse && fix.status === 200, "HTTP " + fix.status + " " + fsecs + "s");
const res = fix.events.find((e) => e.type === "result");
ok("result 带修正后代码", Boolean(res && typeof res.code === "string" && res.code.length > 20), res ? res.code.length + " 字" : "无");
ok("changes 是非空有序区间", Boolean(res && Array.isArray(res.changes) && res.changes.length >= 1 && res.changes.every((c) => c.start >= 1 && c.end >= c.start) && res.changes.every((c, i, arr) => i === 0 || c.start > arr[i - 1].end)), JSON.stringify(res && res.changes));
ok("lineCount 与代码行数一致", Boolean(res && res.lineCount === res.code.split("\n").length), res ? res.lineCount + " vs " + res.code.split("\n").length : "无");
ok("修正后的代码里 total 有初始化", Boolean(res && /total\s*=\s*0/.test(res.code)), (res?.code || "").split("\n").slice(0, 4).join(" | ").slice(0, 120));

console.log("\n结果: " + pass + "/" + (pass + fail) + " 通过" + (fail ? "，" + fail + " 失败" : ""));
process.exit(fail ? 1 : 0);

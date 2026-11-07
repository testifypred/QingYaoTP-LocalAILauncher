/**
 * 代码工作区后端探针（纯 API）
 *
 *   node probe-code-workspace.mjs [base]
 *
 * 覆盖：/api/code/capture 正常收录（200 / saved 路径以 code/ 开头 / 真的能 list 到 / 内容可读回）、
 *       缺 files 与空 files → 400、超过 20 个 → 400、单文件超 200,000 字符 → 413、
 *       名字含 ../ 只取 basename 落 code/、content 为空 → 400；
 *       /api/code/review 缺 code → 400、空 code → 400、超 20,000 字符 → 413、无模型 → 409（按 /api/state.loaded 条件断言）。
 * 跑完删掉自己建的文件（自复位）。不加载模型，不动别人的代码文件。
 */
const BASE = process.argv[2] || "http://127.0.0.1:8099";
const STAMP = Date.now().toString(36);
let pass = 0, fail = 0, skip = 0;
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
const del = (p) => j("POST", "/api/workspace/delete", { path: p }).catch(() => ({}));
const readOf = (p) => j("GET", "/api/workspace/read?path=" + encodeURIComponent(p));

// 探针自己建的文件，收尾统一删掉（只删 code/ 下的安全路径）
const created = [];

console.log("\n== 目标 " + BASE + " ==\n");

try {
  // ---------- 前置：状态与 code/ 目录 ----------
  const st = await j("GET", "/api/state");
  const loadedModel = String(st.data?.loaded || "");
  console.log("  当前模型: " + (loadedModel || "（未加载）"));

  const l0 = await j("GET", "/api/workspace/list?dir=code");
  ok("code/ 目录可列出（200）", l0.status === 200 && Array.isArray(l0.data?.entries), "HTTP " + l0.status);

  // ---------- capture：正常 2 个文件 ----------
  const files = [
    { name: "ws-probe-" + STAMP + ".py", content: 'print("api probe")' },
    { name: "ws-probe-" + STAMP + ".js", content: "console.log(1 + 1);" },
  ];
  const cap = await j("POST", "/api/code/capture", { files });
  const saved = Array.isArray(cap.data?.saved) ? cap.data.saved : [];
  ok("capture 2 个文件 → 200", cap.status === 200 && cap.data?.ok === true, "HTTP " + cap.status);
  ok("capture 返回 2 条 saved", saved.length === 2, "saved=" + saved.length);
  ok("saved 路径都以 code/ 开头", saved.length === 2 && saved.every((x) => typeof x.path === "string" && x.path.startsWith("code/")), JSON.stringify(saved.map((x) => x.path)));
  ok("saved 带 bytes 且大于 0", saved.length === 2 && saved.every((x) => Number.isFinite(x.bytes) && x.bytes > 0), JSON.stringify(saved.map((x) => x.bytes)));

  for (const x of saved) if (typeof x.path === "string" && /^code\/[^/\\]+$/.test(x.path)) created.push(x.path);

  const l1 = await j("GET", "/api/workspace/list?dir=code");
  const listed = new Set((l1.data?.entries || []).map((e) => e.path));
  ok("capture 的文件真的能 list 到", saved.length === 2 && saved.every((x) => listed.has(x.path)), "list=" + listed.size);

  const rd0 = await readOf(saved[0]?.path || "");
  ok("capture 内容可读回且一致", rd0.status === 200 && rd0.data?.content === files[0].content, "HTTP " + rd0.status + " len=" + String(rd0.data?.content ?? "").length);

  // ---------- capture：参数校验 ----------
  const miss = await j("POST", "/api/code/capture", {});
  ok("capture 缺 files → 400", miss.status === 400, "HTTP " + miss.status + " " + (miss.data?.error?.message || ""));
  const missMsg = String(miss.data?.error?.message || "");
  ok("缺 files 的错误信息提到 files", /files/i.test(missMsg), missMsg);

  const empty = await j("POST", "/api/code/capture", { files: [] });
  ok("capture 空 files → 400", empty.status === 400, "HTTP " + empty.status);

  const emptyContent = await j("POST", "/api/code/capture", { files: [{ name: "ws-empty-" + STAMP + ".txt", content: "" }] });
  ok("capture 空 content → 400", emptyContent.status === 400, "HTTP " + emptyContent.status);

  const many = Array.from({ length: 21 }, (_, i) => ({ name: "ws-many-" + STAMP + "-" + i + ".txt", content: "x" }));
  const over = await j("POST", "/api/code/capture", { files: many });
  ok("capture 超过 20 个文件 → 400", over.status === 400, "HTTP " + over.status);

  const big = await j("POST", "/api/code/capture", { files: [{ name: "ws-big-" + STAMP + ".txt", content: "a".repeat(200001) }] });
  ok("capture 单文件 > 200,000 字符 → 413", big.status === 413, "HTTP " + big.status);

  // ---------- capture：../ 路径穿越只取 basename ----------
  const evilName = "../evil-" + STAMP + ".js";
  const evil = await j("POST", "/api/code/capture", { files: [{ name: evilName, content: "console.log('evil');" }] });
  const evilPath = String(evil.data?.saved?.[0]?.path || "");
  ok("名字含 ../ 仍收录成功（200）", evil.status === 200 && evilPath.length > 0, "HTTP " + evil.status + " path=" + evilPath);
  ok("落盘路径以 code/ 开头且不含 ..", evilPath.startsWith("code/") && !evilPath.includes(".."), "path=" + evilPath);
  ok("穿越名只保留 basename", evilPath === "code/evil-" + STAMP + ".js", "path=" + evilPath);
  const evilIntended = "code/evil-" + STAMP + ".js";
  // 只把 code/ 下的安全路径交给清理；兜底再删一次预期目标（不存在时接口返回 400，忽略）
  if (/^code\/[^/\\]+$/.test(evilPath) && !created.includes(evilPath)) created.push(evilPath);
  if (!created.includes(evilIntended)) created.push(evilIntended);

  const l2 = await j("GET", "/api/workspace/list?dir=code");
  ok("../ 收录的文件落在 code/ 列表里", (l2.data?.entries || []).some((e) => e.path === "code/evil-" + STAMP + ".js"), "n=" + (l2.data?.entries || []).length);

  // ---------- review：参数校验 ----------
  const rMiss = await j("POST", "/api/code/review", {});
  ok("review 缺 code → 400", rMiss.status === 400, "HTTP " + rMiss.status + " " + (rMiss.data?.error?.message || ""));

  const rEmpty = await j("POST", "/api/code/review", { code: "   " });
  ok("review 空 code → 400", rEmpty.status === 400, "HTTP " + rEmpty.status);

  const rBig = await j("POST", "/api/code/review", { code: "x".repeat(20001) });
  ok("review 超过 20,000 字符 → 413", rBig.status === 413, "HTTP " + rBig.status);

  if (!loadedModel) {
    const rNoModel = await j("POST", "/api/code/review", { code: "print(1)", file: "probe.py", lang: "python" });
    const msg = String(rNoModel.data?.error?.message || "");
    ok("无模型时 review → 409 且提示先加载模型", rNoModel.status === 409 && /模型/.test(msg), "HTTP " + rNoModel.status + " " + msg);
  } else {
    skip++;
    console.log("  skip 无模型 409 断言（当前已加载 " + loadedModel + "）");
  }
} catch (e) {
  fail++;
  console.log("  FAIL 探针异常中断: " + String(e?.message ?? e));
} finally {
  // ---------- 清理：删掉自己建的文件并复核 ----------
  let removed = 0;
  for (const p of created) {
    const r = await del(p);
    if (r.status === 200) removed++;
  }
  const l3 = await j("GET", "/api/workspace/list?dir=code");
  const left = (l3.data?.entries || []).map((e) => e.path).filter((p) => created.includes(p));
  ok("清理自己建的文件（自复位）", left.length === 0, left.length ? "残留=" + left.join(",") : "已删除 " + removed + " 个");
}

console.log("\nRESULT " + pass + "/" + (pass + fail) + (skip ? "（跳过 " + skip + " 条）" : ""));
process.exit(fail ? 1 : 0);

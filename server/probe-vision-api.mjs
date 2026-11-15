/**
 * 视觉 sidecar 后端探针（纯 API）
 *
 *   node probe-vision-api.mjs [base]
 *
 * 覆盖（契约 §5.1）：
 *  1) GET /api/vision/state -> 200，结构含 running / port / pairs / selected；
 *  2) 有 pair：POST /api/vision/start -> running:true、port:8101、GET /health 返回 ok；
 *  3) 用内置 320x180 PNG（红底白字 QWEN 42）发一帧：
 *     POST /v1/chat/completions {stream:false, images:[dataURL], messages:[...]} -> 200 且 content 含 QWEN；
 *  4) POST /api/vision/stop -> running:false，8101 不再监听；
 *  5) 无 pair：start -> 400/409 且提示「视觉模型」，带图请求 -> 409，跳过 2-4；
 *  6) state.pack 结构（v1.6.0 视觉增强包）：pack 是对象、pack.installed === true
 *     （装好后 sidecar 才可用；dev 下指向 tools\llama.cpp 也算已安装 / source=tools）。
 *     断言 25 -> 27 条。
 *
 * 前置：服务在跑。start 会按契约先卸载 nlc 文本模型（内存互斥），所以本探针会改变「是否加载文本模型」；
 *       在 run-full 里排在最后一条。收尾一定 stop sidecar；不加载文本模型（驱动负责预加载）。
 */
const BASE = process.argv[2] || "http://127.0.0.1:8099";
const SIDECAR = "http://127.0.0.1:8101";
// 内置测试图：320x180、红底白字 QWEN 42（Pillow 生成后转 base64 常量；不写文件、不进 workspace）
const IMG_B64 = "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";
const IMG = "data:image/png;base64," + IMG_B64;
// /api/vision/* 目前不校验本地令牌；若后端将来加了校验，探针带上即可（/api/state 里能拿到）
let TOKEN = "";

let pass = 0, fail = 0, skip = 0;
function ok(name, cond, extra) {
  if (cond) { pass += 1; console.log("  ok   " + name + (extra ? "  [" + extra + "]" : "")); }
  else { fail += 1; console.log("  FAIL " + name + "  " + (extra || "")); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function http(method, url, body, ms) {
  const opt = { method, signal: AbortSignal.timeout(ms || 20000) };
  if (body) {
    opt.headers = { "content-type": "application/json" };
    opt.body = JSON.stringify(body);
  }
  if (TOKEN) opt.headers = Object.assign({}, opt.headers || {}, { "x-local-token": TOKEN });
  try {
    const r = await fetch(url, opt);
    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch {}
    return { status: r.status, data, text };
  } catch (e) {
    return { status: 0, data: null, text: "", error: String((e && e.message) || e) };
  }
}
const api = (method, p, body, ms) => http(method, BASE + p, body, ms);
const errText = (r) => String((r.data && r.data.error && r.data.error.message) || r.text || r.error || "").slice(0, 120);
// 8101 是否已被占用：/health 有任何响应就算在监听
async function sidecarUp(ms) {
  const r = await http("GET", SIDECAR + "/health", null, ms || 1200);
  return r.status !== 0;
}
async function sidecarDown(ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 15000)) {
    if (!(await sidecarUp(800))) return true;
    await sleep(400);
  }
  return false;
}
async function waitHealth(ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 8000)) {
    const r = await http("GET", SIDECAR + "/health", null, 2000);
    if (r.status === 200) return { ok: true, text: r.text, status: r.status };
    await sleep(500);
  }
  return { ok: false, text: "", status: 0 };
}

console.log("\n== 目标 " + BASE + " ==\n");

let started = false;
try {
  // 先拿本地令牌（服务不可用时留空，后面的断言会照常报红）
  const boot = await api("GET", "/api/state", null, 10000);
  TOKEN = String((boot.data && boot.data.localToken) || "");

  // ---------- 1. state 结构 ----------
  const st = await api("GET", "/api/vision/state", null, 15000);
  const v = st.data || {};
  const pairs = Array.isArray(v.pairs) ? v.pairs : [];
  ok("GET /api/vision/state -> 200", st.status === 200, "HTTP " + st.status + (st.error ? " " + st.error : ""));
  ok("state.ok === true", v.ok === true);
  ok("state.port === 8101", Number(v.port) === 8101, "port=" + v.port);
  ok("state.running 为布尔", typeof v.running === "boolean", "running=" + v.running);
  ok("state.pairs 是数组", Array.isArray(v.pairs), "pairs=" + (Array.isArray(v.pairs) ? v.pairs.length : typeof v.pairs));
  ok("pairs 每项含 model 与 mmproj", pairs.every((p) => p && typeof p.model === "string" && typeof p.mmproj === "string"), "n=" + pairs.length);
  ok("selected 形状正确（对象或 null）", v.selected === null || (typeof v.selected === "object" && typeof v.selected.model === "string" && typeof v.selected.mmproj === "string"), JSON.stringify(v.selected));
  // v1.6.0：视觉增强包（契约 §3）——state 里挂 pack 摘要，装好（含 dev 的 tools\llama.cpp）才算有 sidecar
  ok("state.pack 是对象", Boolean(v.pack && typeof v.pack === "object" && !Array.isArray(v.pack)), JSON.stringify(v.pack));
  ok("state.pack.installed === true（视觉 sidecar 可用）", Boolean(v.pack && v.pack.installed === true), JSON.stringify(v.pack && { installed: v.pack.installed, source: v.pack.source, dir: v.pack.dir }));

  if (pairs.length === 0) {
    // ---------- 5. 无 pair 分支 ----------
    console.log("\n== B. 无可用 pair：走降级分支 ==");
    ok("无 pair 时 selected 为 null", v.selected === null);
    ok("note 提示指定 visionModel / visionMmproj", /视觉模型|mmproj|config\.ini/i.test(String(v.note || "")), String(v.note || "").slice(0, 80));

    const s = await api("POST", "/api/vision/start", {}, 30000);
    const sMsg = errText(s);
    ok("无 pair 时 start -> 400/409", s.status === 400 || s.status === 409, "HTTP " + s.status + " " + sMsg);
    ok("start 错误信息提到「视觉模型」", /视觉模型/.test(sMsg), sMsg);

    const c = await api("POST", "/v1/chat/completions", {
      stream: false,
      images: [IMG],
      messages: [{ role: "user", content: "图里的文字是什么？" }],
    }, 60000);
    const cMsg = errText(c);
    ok("无 pair 时带图聊天 -> 409", c.status === 409, "HTTP " + c.status + " " + cMsg);
    ok("409 提示缺少视觉模型 / mmproj", /视觉模型|mmproj/.test(cMsg), cMsg);

    skip += 4;
    console.log("  skip 有 pair 分支：start 成功 / health / 发图 / stop（当前无可用 pair）");
  } else {
    // ---------- 2. start ----------
    console.log("\n== B. 有可用 pair（" + pairs.length + " 组）：启动 sidecar ==");
    console.log("  selected: " + JSON.stringify(v.selected || pairs[0]));
    ok("有 pair 时 selected 非空", v.selected !== null && typeof v.selected === "object");
    const main = await api("GET", "/api/state", null, 10000);
    const loaded = String((main.data && main.data.loaded) || "");
    if (loaded) console.log("  当前已加载文本模型 " + loaded + "：start 会先卸载它（内存互斥，契约 3.2）");

    // 上一轮若残留 sidecar，先清掉，保证从 running:false 起步
    if (v.running) {
      console.log("  发现残留 sidecar，先 stop 再重来 ...");
      await api("POST", "/api/vision/stop", {}, 60000);
      await sidecarDown(15000);
    }

    const startBody = v.selected && v.selected.model ? { model: v.selected.model, mmproj: v.selected.mmproj } : {};
    const t0 = Date.now();
    const s = await api("POST", "/api/vision/start", startBody, 150000);
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    started = s.status === 200 && s.data && s.data.running === true;
    ok("POST /api/vision/start -> 200", s.status === 200, "HTTP " + s.status + " " + errText(s) + "（" + secs + "s）");
    ok("start 后 running:true", Boolean(s.data && s.data.running === true), "running=" + (s.data && s.data.running));
    ok("start 返回 port:8101", Number(s.data && s.data.port) === 8101, "port=" + (s.data && s.data.port));
    ok("start 返回 pid", Number(s.data && s.data.pid) > 0, "pid=" + (s.data && s.data.pid));
    ok("start 后 model/mmproj 非空", Boolean(s.data && s.data.model && s.data.mmproj), (s.data && s.data.model) + " + " + (s.data && s.data.mmproj));

    const st1 = await api("GET", "/api/vision/state", null, 15000);
    ok("再查 state：running 仍为 true", Boolean(st1.data && st1.data.running === true), "running=" + (st1.data && st1.data.running));
    // 内存互斥（契约 3.2）：start 必须先卸载 nlc 文本模型，不能两边同时占显存/内存
    const mainNow = await api("GET", "/api/state", null, 10000);
    const loadedNow = String((mainNow.data && mainNow.data.loaded) || "");
    ok("start 后 nlc 文本模型已卸载（内存互斥）", loadedNow === "", "loaded=" + (loadedNow || "(空)"));

    const health = await waitHealth(8000);
    ok("GET http://127.0.0.1:8101/health -> ok", health.ok && /ok/i.test(health.text), "HTTP " + health.status + " " + String(health.text).slice(0, 60));

    if (started) {
      // ---------- 3. 发一帧真图 ----------
      console.log("\n== C. 发一帧 320x180 PNG（视觉推理约十几秒）==");
      const t1 = Date.now();
      const c = await api("POST", "/v1/chat/completions", {
        stream: false,
        max_tokens: 256,
        temperature: 0,
        images: [IMG],
        messages: [{ role: "user", content: "图里的文字是什么？只回答图中的文字。" }],
      }, 180000);
      const infer = ((Date.now() - t1) / 1000).toFixed(1);
      const content = String((c.data && c.data.choices && c.data.choices[0] && c.data.choices[0].message && c.data.choices[0].message.content) || "");
      ok("带图聊天 -> 200", c.status === 200, "HTTP " + c.status + " 用时 " + infer + "s " + errText(c));
      ok("返回 choices 数组", Boolean(c.data && Array.isArray(c.data.choices)), "n=" + (c.data && c.data.choices && c.data.choices.length));
      ok("content 非空", content.trim().length > 0, content.trim().slice(0, 80) || "(空)");
      const strict = /QWEN/i.test(content) && /42/.test(content);
      ok("content 含 QWEN（宽松：含 42 也算）", /QWEN|42/i.test(content), "严格 QWEN 42：" + (strict ? "达成" : "未达成") + "；原文 " + content.trim().replace(/\s+/g, " ").slice(0, 80));

      // ---------- 4. stop ----------
      console.log("\n== D. 停止 sidecar 并确认 8101 释放 ==");
      const t2 = Date.now();
      const sp = await api("POST", "/api/vision/stop", {}, 60000);
      ok("POST /api/vision/stop -> 200", sp.status === 200, "HTTP " + sp.status + " " + errText(sp));
      ok("stop 后 running:false", Boolean(sp.data && sp.data.running === false), "running=" + (sp.data && sp.data.running));
      started = false;
      const down = await sidecarDown(15000);
      ok("8101 已释放（/health 不可达）", down, ((Date.now() - t2) / 1000).toFixed(1) + "s");
      const st2 = await api("GET", "/api/vision/state", null, 15000);
      ok("收尾 state.running:false", Boolean(st2.data && st2.data.running === false), "running=" + (st2.data && st2.data.running));
    } else {
      skip += 4;
      console.log("  skip 发图 / stop 断言：sidecar 没起来（详见上面 start 的失败项）");
    }
  }
} catch (e) {
  fail += 1;
  console.log("  FAIL 探针异常中断: " + String((e && e.message) || e));
} finally {
  // ---------- 自复位：无论走到哪一步，结束前一定停掉 sidecar ----------
  try {
    const st = await api("GET", "/api/vision/state", null, 10000);
    if (st.data && st.data.running) {
      console.log("  收尾：stop 残留 sidecar ...");
      await api("POST", "/api/vision/stop", {}, 60000);
      await sidecarDown(15000);
    }
    const after = await api("GET", "/api/vision/state", null, 10000);
    const stillUp = Boolean(after.data && after.data.running === true) || (await sidecarUp(800));
    ok("自复位：sidecar 已停止、8101 无监听", !stillUp, stillUp ? "仍在运行，需要人工处理" : "干净");
  } catch (e) {
    fail += 1;
    console.log("  FAIL 自复位异常: " + String((e && e.message) || e));
  }
}

console.log("\n== 结果: " + pass + " 通过 / " + fail + " 失败" + (skip ? "（跳过 " + skip + " 项）" : "") + " ==\n");
process.exit(fail ? 1 : 0);

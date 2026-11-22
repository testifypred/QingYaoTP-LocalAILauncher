/**
 * 审查卡死 P0 的看门狗探针（前端空闲闸 / 总时长闸 / 兜底保险丝 + 后端生成停滞闸）
 *
 *   node probe-review-watchdog.mjs [cdp] [base]
 *
 * 背景：4B 审 22 行 python 偶发 >360s 无 findings，页面卡在「模型正在结合意图读代码…」，
 * cwReviewBusy 一直 true（质询 / 他人复审 / 一键纠正 / 重新审查全禁用）。修复分两层 + 两道兜底：
 *   F1 server/app.html  cwStreamSSE 内部 120s 没有任何 SSE 事件 -> abort，界面必须恢复（A 段验）；
 *   C  server/app.html  cwRunReviewStream 的单次审查总时长闸（默认 300s）-> 到点 abort（C 段验）；
 *   F2 server/app.mjs  审查第一阶段 120s 没有 delta -> abort + error(504)，释放 codeJob 锁（B 段验）；
 *   D  server/app.html  cwReleaseOrphanBusy：busy 卡在 try 之前且无 SSE 在读时，
 *      未处理拒绝/错误 -> 强制收尾，避免按钮永远全灰（D 段验）。
 * 本探针用**确定性手段**按 A -> C -> D -> B 的顺序验证这四道防线：
 *
 * A. 前端看门狗（纯 CDP，不调模型）
 *    打开 #codeModal / 审查面板，CodeMirror setValue 填一段 python，覆盖 CW_SSE_IDLE_TIMEOUT_MS=2500；
 *    页面内替换 window.fetch：对 /api/code/review/stream 返回「只 push 一条 meta 后永不 close、
 *    不再 push」的 ReadableStream Response（其它 URL 走原 fetch），然后调 cwReviewCode() 并等它的 Promise。
 *    断言：<12s 结束、cwReviewBusy 回 false、#cwReview 可点且文案「模型审查」、
 *    #cwReviewState 含「没有任何响应」、全程无 JS 异常、收尾恢复 fetch / 超时变量 / 关面板。
 *    注意：stub 把 fetch 的 init.signal 与流绑定——真 fetch 在 abort 后会让 pending read 拒绝，
 *    合成流也必须这样，否则 F1 的 abort 解不开卡住的 reader.read()；再留一个 2× 阈值兜底定时器，
 *    万一 F1 完全没落地也不会让页面/探针永久挂住（只在失败时触发，正常跑不会到）。
 *
 * C. 单次审查总时长闸（纯 CDP，不调模型）
 *    同一套 pageSetup/cleanup，页面内 CW_REVIEW_MAX_MS = 3000；stub 换成「steady」版本：
 *    每 150ms enqueue 一条 delta、永不 close —— 空闲看门狗不会触发，只有总时长闸会到点 abort，
 *    消息为「审查超过 N 秒还没完成…」。断言：<12s、busy 释放、状态行含「超过」+「还没完成」、
 *    #cwReview 恢复、收尾恢复 fetch / CW_REVIEW_MAX_MS=300000 / 面板。
 *
 * D. 兜底保险丝（纯 CDP，不调模型；A/C 之后跑）
 *    模拟 P0「结构残根」：页面内 cwReviewBusy=true + cwRefreshActionButtons()，但没有任何 SSE 在读
 *    （cwSseActive===0），随后 setTimeout 抛一个没人 catch 的 Promise 拒绝 -> window 'unhandledrejection'
 *    -> cwReleaseOrphanBusy -> cwEndJob + 状态行「审查失败：流程异常（…）」。断言：600ms 后 busy 释放、
 *    状态行含「流程异常」、#cwReview 恢复，收尾 cwEndJob + 清状态行复位。
 *
 * B. 后端看门狗（确定性，~60s，自带临时实例，不依赖 8099 的模型状态）
 *    在 docs\feature-review-watchdog-2026-11-22\ 下建临时 MODEL_DIR（同盘），用 fs.link 把真实
 *    4B qwen3-5-4B-Q4_K_M.gguf **硬链接**进去（只链 4B；不复制 2.5GB，也绝不删/移动真实模型）。
 *    选空闲端口（8198 起，最多试 8205），spawn 独立 app.mjs（MODEL_DIR=临时目录，
 *    CODE_JOB_IDLE_TIMEOUT_MS=1000），stdout/stderr 落临时文件；/api/load 载入 4B 后
 *    POST /api/code/review/stream（22 行 python，内联），断言：HTTP 200 且第一事件 meta、
 *    收到 error 且消息含「没有任何输出」、<60s、没有 findings/done、随后 /api/load 返回 200
 *    （证明 codeJob 锁已释放，不是 409）。finally 一定 kill 子进程 + 删临时目录（含硬链接）。
 *
 * 前置：A/C/D 段需要 Edge headless 在 9333 且页面已导航到 BASE（同其它 cdp 探针）；
 *      B 段自己起实例，不读 8099。全绿 exit 0，失败 exit 1。
 *      Edge 158 的坑：别用 --headless=new 加命令行 URL（会报 Multiple targets），
 *      用 docs\feature-review-watchdog-2026-11-22\run-probe-with-edge.ps1（about:blank + PUT /json/new）。
 * 备注：只验前端时可设 PROBE_SKIP_B=1 跳过 B 段（run-full 不设，默认 A+C+D+B 全跑）。
 */
import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { link, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const CDP = process.argv[2] || "http://127.0.0.1:9333";
const BASE = process.argv[3] || "http://127.0.0.1:8099";
const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
/** 临时模型目录必须和真实模型同盘（D:）才能 fs.link；放证据目录下，跑完删干净 */
const NIGHT_DIR = path.join(SERVER_DIR, "docs", "feature-review-watchdog-2026-11-22");
const MODEL_SRC = path.join(SERVER_DIR, "..", "qwen3-5-4B-Q4_K_M.gguf");
const MODEL_NAME = "qwen3-5-4B-Q4_K_M.gguf";
const CODE_IDLE_MS = 1000;
/** B 段端口（8198 起找空闲，最多走到 8205） */
const PORTS = [8198, 8199, 8200, 8201, 8202, 8203, 8204, 8205];
/** 22 行 python（workspace\code\python-210407-1.py 的前 22 行，内联避免依赖工作区种子） */
const PY22 = [
  "import turtle",
  "",
  "# 设置画布",
  "screen = turtle.Screen()",
  'screen.title("红色五角星")',
  "",
  "# 创建画笔",
  "t = turtle.Turtle()",
  "t.speed(2)",
  "t.pensize(3)",
  't.color("red")',
  "",
  "# 绘制五角星",
  "# 五角星的每个外角是 144 度 (360 - 72)",
  "for _ in range(5):",
  "    t.forward(100)",
  "    t.right(144)",
  "",
  "# 隐藏画笔头",
  "t.ht()",
  "",
].join("\n");

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass += 1; console.log("  ok   " + name + (extra ? "  [" + extra + "]" : "")); }
  else { fail += 1; console.log("  FAIL " + name + "  " + (extra || "")); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errText = (r) => String((r && r.data && r.data.error && r.data.error.message) || (r && r.text) || (r && r.error) || "").slice(0, 160);

console.log("\n== 目标 CDP " + CDP + " · 页面 " + BASE + "（B 段自起临时实例）==");

// ================================================================ A. 前端看门狗（CDP）

/** 页面内：开弹窗 / 填代码 / 覆盖阈值 / 换掉 fetch（返回 ok:false 表示前置不满足） */
function pageSetup(mode) {
  mode = mode || "hang";
  const modal = document.querySelector("#codeModal");
  if (!modal) return { error: "no #codeModal" };
  const panel = document.querySelector("#cwReviewPanel");
  if (!panel) return { error: "no #cwReviewPanel" };
  if (typeof cwReviewCode !== "function") return { error: "no cwReviewCode" };
  const cm = cwEnsureEditor();
  window.__wdProbe = {
    modalHidden: !!modal.hidden,
    modalStyle: modal.hasAttribute("style") ? modal.getAttribute("style") : null,
    panelHidden: !!panel.hidden,
    code: cm ? cm.getValue() : cwEditorEl.value,
    dirty: typeof cwDirty === "boolean" ? cwDirty : false,
    fileText: cwFileEl ? cwFileEl.textContent : "",
    idle: typeof CW_SSE_IDLE_TIMEOUT_MS === "number" ? CW_SSE_IDLE_TIMEOUT_MS : null,
    maxMs: typeof CW_REVIEW_MAX_MS === "number" ? CW_REVIEW_MAX_MS : null,
    reviewOpenKey: null,
    origFetch: window.fetch,
    stub: { hits: 0, aborted: 0, fallback: 0, fallbackTimer: null, timer: null },
  };
  const P = window.__wdProbe;
  try { P.reviewOpenKey = localStorage.getItem("localai.cwReviewOpen"); } catch (e) {}
  modal.hidden = false;
  modal.style.cssText = "display:block;position:fixed;left:0;top:0;width:900px;height:600px;z-index:99999;background:#fff";
  try { cwApplyReviewOpen(true); } catch (e) {}
  const code = [
    "import turtle",
    "",
    "# 设置画布",
    "screen = turtle.Screen()",
    'screen.title("红色五角星")',
    "",
    "# 创建画笔",
    "t = turtle.Turtle()",
    "t.speed(2)",
    "t.pensize(3)",
    't.color("red")',
    "",
    "# 绘制五角星",
    "# 五角星的每个外角是 144 度 (360 - 72)",
    "for _ in range(5):",
    "    t.forward(100)",
    "    t.right(144)",
    "",
    "# 隐藏画笔头",
    "t.ht()",
    "",
  ].join("\n");
  if (cm) { cm.setOption("mode", "python"); cm.setValue(code); cm.refresh(); }
  else cwEditorEl.value = code;
  // 契约要求「确认 cwReviewBusy 可读写」：写一下再还原，不触发渲染/回调
  const busyBefore = cwReviewBusy;
  cwReviewBusy = true;
  const busyWritable = cwReviewBusy === true;
  cwReviewBusy = busyBefore;
  CW_SSE_IDLE_TIMEOUT_MS = 2500;
  // C 段：把「单次审查总时长闸」压到 3s；steady 流每 150ms 一个事件，空闲闸不会触发，只有它到点
  if (mode === "steady") CW_REVIEW_MAX_MS = 3000;
  // 页面内 fetch stub：/api/code/review/stream -> A 段只发 meta 后挂死 / C 段持续 delta 永不 close
  const orig = P.origFetch;
  function abortErr(reason) {
    if (reason && typeof reason === "object" && reason.name) return reason;
    try { return new DOMException("The operation was aborted.", "AbortError"); }
    catch (e) { const er = new Error("aborted"); er.name = "AbortError"; return er; }
  }
  window.fetch = function (input, init) {
    const url = String(typeof input === "string" ? input : ((input && input.url) || ""));
    if (!/\/api\/code\/review\/stream/.test(url)) return orig.apply(this, arguments);
    P.stub.hits += 1;
    const signal = init && init.signal;
    const enc = new TextEncoder();
    const sseChunk = function (obj) { return enc.encode("data: " + JSON.stringify(obj) + "\n\n"); };
    const stream = new ReadableStream({
      start(controller) {
        if (mode === "steady") {
          // C 段：每 150ms 一条 delta，永不 close —— 空闲看门狗不会触发，只有总时长闸会
          controller.enqueue(sseChunk({ type: "meta", model: "qwen3-5-4B-Q4_K_M.gguf", modelFile: "qwen3-5-4B-Q4_K_M.gguf", contextSize: 8192, switchedModel: false, startedAt: Date.now() }));
          controller.enqueue(sseChunk({ type: "delta", text: "x" }));
          P.stub.timer = setInterval(function () {
            try { controller.enqueue(sseChunk({ type: "delta", text: "x" })); }
            catch (e) { if (P.stub.timer) { clearInterval(P.stub.timer); P.stub.timer = null; } }
          }, 150);
          return;
        }
        // A 段：只发一条 meta 后挂死；abort 时让 pending read 拒绝（真 fetch 的语义）
        controller.enqueue(sseChunk({ type: "meta", model: "qwen3-5-4B-Q4_K_M.gguf", modelFile: "qwen3-5-4B-Q4_K_M.gguf", contextSize: 8192, switchedModel: false, startedAt: Date.now() }));
        const failOnce = () => { try { controller.error(abortErr(signal && signal.reason)); } catch (e) {} };
        if (signal) {
          if (signal.aborted) failOnce();
          else signal.addEventListener("abort", () => { P.stub.aborted += 1; failOnce(); }, { once: true });
        }
        // 兜底：F1 万一没落地（既不 abort 也不 race），2× 阈值后主动断流，别让页面/探针永久挂住
        P.stub.fallbackTimer = setTimeout(() => {
          if (P.stub.aborted) return;
          P.stub.fallback += 1;
          failOnce();
        }, 5000);
      },
      cancel() {
        if (P.stub.timer) { clearInterval(P.stub.timer); P.stub.timer = null; }
      },
    });
    return Promise.resolve(new Response(stream, { status: 200, statusText: "OK", headers: { "content-type": "text/event-stream; charset=utf-8" } }));
  };
  return {
    ok: true,
    busyWritable: busyWritable,
    busyBefore: busyBefore,
    mode: mode,
    idleNow: CW_SSE_IDLE_TIMEOUT_MS,
    maxNow: typeof CW_REVIEW_MAX_MS === "number" ? CW_REVIEW_MAX_MS : null,
    stubInstalled: window.fetch !== orig,
    editor: cm ? "codemirror" : "textarea",
    saved: { modalHidden: P.modalHidden, panelHidden: P.panelHidden, idle: P.idle, maxMs: P.maxMs, codeLen: P.code.length },
  };
}

/** 页面内：调 cwReviewCode() 并等 Promise（最多 11s），回传计时与界面状态 */
async function pageRunReview() {
  const t0 = performance.now();
  let completed = false;
  let err = "";
  try {
    const out = await Promise.race([
      cwReviewCode().then(function () { return "done"; }, function (e) { err = String((e && e.message) || e); return "rejected"; }),
      new Promise(function (res) { setTimeout(function () { res("timeout"); }, 11000); }),
    ]);
    completed = out !== "timeout";
    if (out === "rejected" && !err) err = "rejected";
  } catch (e) { err = String((e && e.message) || e); }
  const btn = document.querySelector("#cwReview");
  return {
    elapsed: Math.round(performance.now() - t0),
    completed: completed,
    err: err,
    busy: cwReviewBusy,
    reviewDisabled: btn ? btn.disabled : null,
    reviewText: btn ? btn.textContent : null,
    stateText: String((document.querySelector("#cwReviewState") || {}).textContent || ""),
    stub: { hits: window.__wdProbe.stub.hits, aborted: window.__wdProbe.stub.aborted, fallback: window.__wdProbe.stub.fallback },
  };
}

/** 页面内：恢复 fetch / 阈值 / 编辑器内容 / 面板与弹窗状态（务必 finally 调用） */
function pageCleanup() {
  const P = window.__wdProbe || null;
  if (!P) return { ok: false, error: "no __wdProbe（setup 没跑到换 fetch 那步，无需复位）" };
  let forced = false;
  const wasBusy = typeof cwReviewBusy === "boolean" ? cwReviewBusy : false;
  try {
    // 正常跑完（busy 已释放）就停兜底定时器；没跑完则留着它，5s 后自己断流，别让页面永久挂住
    if (P.stub && P.stub.timer) { clearInterval(P.stub.timer); P.stub.timer = null; }
    if (P.stub && P.stub.fallbackTimer && !wasBusy) clearTimeout(P.stub.fallbackTimer);
    if (P.origFetch) window.fetch = P.origFetch;
    if (typeof P.idle === "number") CW_SSE_IDLE_TIMEOUT_MS = P.idle;
    if (typeof P.maxMs === "number") CW_REVIEW_MAX_MS = P.maxMs;
    if (wasBusy) { try { cwEndJob(); forced = true; } catch (e) {} }
    const cm = typeof cwEnsureEditor === "function" ? cwEnsureEditor() : null;
    if (cm) cm.setValue(P.code == null ? "" : P.code);
    else if (typeof cwEditorEl !== "undefined") cwEditorEl.value = P.code == null ? "" : P.code;
    // setValue 会触发 changes 回调（标记未保存、改文件头），复位成打开前的样子
    if (typeof P.dirty === "boolean") cwDirty = P.dirty;
    if (cwFileEl && typeof P.fileText === "string") cwFileEl.textContent = P.fileText;
    try {
      if (P.reviewOpenKey === null) localStorage.removeItem("localai.cwReviewOpen");
      else localStorage.setItem("localai.cwReviewOpen", P.reviewOpenKey);
    } catch (e) {}
    try { cwApplyReviewOpen(!P.panelHidden); } catch (e) {}
    const modal = document.querySelector("#codeModal");
    if (modal) {
      if (P.modalStyle === null) modal.removeAttribute("style");
      else if (typeof P.modalStyle === "string") modal.setAttribute("style", P.modalStyle);
      modal.hidden = !!P.modalHidden;
    }
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
  const modalEl = document.querySelector("#codeModal");
  const out = {
    ok: true,
    forced: forced,
    fetchRestored: !!P.origFetch && window.fetch === P.origFetch,
    idleRestored: typeof P.idle === "number" ? CW_SSE_IDLE_TIMEOUT_MS === P.idle : true,
    maxRestored: typeof P.maxMs === "number" ? CW_REVIEW_MAX_MS === P.maxMs : true,
    modalRestored: !!modalEl && modalEl.hidden === !!P.modalHidden,
    busy: typeof cwReviewBusy === "boolean" ? cwReviewBusy : false,
  };
  try { delete window.__wdProbe; } catch (e) {}
  return out;
}

/**
 * 页面内（D 段）：模拟 P0「结构残根」——cwReviewBusy=true 但没有任何 SSE 在读（cwSseActive===0），
 * 然后抛一个没人 catch 的拒绝；window 'unhandledrejection' 应触发 cwReleaseOrphanBusy -> cwEndJob + 状态行。
 */
async function pageOrphanBusyProbe(waitMs) {
  const btn = document.querySelector("#cwReview");
  cwReviewBusy = true;
  try { cwRefreshActionButtons(); } catch (e) {}
  const during = {
    busy: cwReviewBusy,
    disabled: btn ? btn.disabled : null,
    text: btn ? btn.textContent : null,
    active: typeof cwSseActive === "number" ? cwSseActive : null,
  };
  setTimeout(function () { Promise.reject(new Error("probe-orphan-busy")); }, 0);
  const t0 = performance.now();
  await new Promise(function (r) { setTimeout(r, waitMs || 700); });
  const waited = Math.round(performance.now() - t0);
  const b2 = document.querySelector("#cwReview");
  return {
    during: during,
    waited: waited,
    busy: cwReviewBusy,
    disabled: b2 ? b2.disabled : null,
    text: b2 ? b2.textContent : null,
    stateText: String((document.querySelector("#cwReviewState") || {}).textContent || ""),
    active: typeof cwSseActive === "number" ? cwSseActive : null,
  };
}

/** 页面内（D 段收尾）：cwEndJob 复位按钮/计时，再清掉状态行 */
function pageOrphanCleanup() {
  try { if (typeof cwEndJob === "function") cwEndJob(); } catch (e) {}
  try { if (typeof cwSetReviewState === "function") cwSetReviewState(""); } catch (e) {}
  const btn = document.querySelector("#cwReview");
  return {
    ok: true,
    busy: typeof cwReviewBusy === "boolean" ? cwReviewBusy : false,
    disabled: btn ? btn.disabled : null,
    text: btn ? btn.textContent : null,
    stateText: String((document.querySelector("#cwReviewState") || {}).textContent || ""),
  };
}

/** 连 CDP + 找页面 target + 开 Runtime 异常收集（A / C / D 三段共用；失败返回 null 并已记 FAIL） */
async function openCdp() {
  let list = null;
  try {
    const r = await fetch(CDP + "/json/list", { signal: AbortSignal.timeout(5000) });
    list = await r.json();
  } catch (e) {
    ok("前置：CDP 可访问（" + CDP + "）", false, "连接失败：" + String((e && e.message) || e));
    return null;
  }
  const target = (Array.isArray(list) ? list : []).find((t) => t.type === "page" && String(t.url).startsWith(BASE));
  ok("前置：找到 " + BASE + " 的页面目标", Boolean(target), target ? target.url : "CDP 里没有起始于 " + BASE + " 的页面");
  if (!target) return null;
  const ws = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false });
  const exceptions = [];
  let seq = 0;
  const pending = new Map();
  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.method === "Runtime.exceptionThrown") {
      const d = m.params && m.params.exceptionDetails;
      exceptions.push(String((d && d.exception && d.exception.description) || (d && d.text) || "exception").slice(0, 200));
    }
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  const cmd = (method, params) => new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("CDP 超时 " + method)); }, 20000);
    pending.set(id, (m) => { clearTimeout(timer); resolve(m); });
    ws.send(JSON.stringify({ id: id, method: method, params: params || {} }));
  });
  const ev = async (expr) => {
    const r = await cmd("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result && r.result.exceptionDetails) {
      const d = r.result.exceptionDetails;
      throw new Error(String((d.exception && d.exception.description) || d.text || "evaluate 异常"));
    }
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  try {
    await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });
    await cmd("Runtime.enable");
  } catch (e) {
    try { ws.close(); } catch (e2) {}
    throw e;
  }
  return { ws: ws, cmd: cmd, ev: ev, exceptions: exceptions, close: function () { try { ws.close(); } catch (e) {} } };
}

async function runA() {
  console.log("\n== A. 前端 SSE 空闲看门狗（页面 stub 挂死流，不调模型）==");
  const cdp = await openCdp();
  if (!cdp) return;
  const ev = cdp.ev;
  try {
    const pre = await ev("({ idle: typeof CW_SSE_IDLE_TIMEOUT_MS, review: typeof cwReviewCode, sse: typeof cwStreamSSE, busy: typeof cwReviewBusy === 'boolean' ? cwReviewBusy : null })");
    ok("A 前置：F1 已落地（CW_SSE_IDLE_TIMEOUT_MS 是顶层可变变量）", Boolean(pre) && pre.idle === "number", JSON.stringify(pre));
    ok("A 前置：页面空闲（cwReviewBusy === false）且 cwReviewCode / cwStreamSSE 存在", Boolean(pre) && pre.busy === false && pre.review === "function" && pre.sse === "function", JSON.stringify(pre));
    if (!pre || pre.busy !== false || pre.review !== "function") return;

    const setup = await ev("(" + pageSetup.toString() + ")('hang')");
    ok("打开 #codeModal / 审查面板，CodeMirror setValue 填入 22 行 python", Boolean(setup) && setup.ok === true, JSON.stringify(setup && setup.error ? setup : (setup && setup.editor)));
    if (!setup || setup.ok !== true) return;
    ok("cwReviewBusy 可读写（写 true 读到 true，已还原）", setup.busyWritable === true, "busyBefore=" + setup.busyBefore);
    ok("CW_SSE_IDLE_TIMEOUT_MS 覆盖为 2500", setup.idleNow === 2500, "idleNow=" + setup.idleNow);
    ok("页面 fetch 已被 stub 接管（不调真模型）", setup.stubInstalled === true);

    const run = await ev("(" + pageRunReview.toString() + ")()");
    console.log("  用时 " + run.elapsed + "ms · busy=" + run.busy + " · 按钮=" + JSON.stringify(run.reviewText) + " · stub=" + JSON.stringify(run.stub) + (run.err ? " · err=" + run.err : ""));
    console.log("  状态行: " + String(run.stateText || "").slice(0, 180));
    ok("A1 全程 < 12s（实际 " + run.elapsed + "ms）", run.elapsed < 12000);
    ok("A2 cwReviewCode() 自己结束（未被 Promise.race 兜超时，也没向外抛）", run.completed === true && !run.err, run.err || ("completed=" + run.completed));
    ok("A3 空闲超时后 cwReviewBusy 已释放（false）", run.busy === false, "busy=" + run.busy);
    ok("A4 #cwReview 恢复：可点 + 文案「模型审查」", run.reviewDisabled === false && run.reviewText === "模型审查", "disabled=" + run.reviewDisabled + " text=" + JSON.stringify(run.reviewText));
    ok("A5 #cwReviewState 含「没有任何响应」（F1 明确报错）", /没有任何响应/.test(String(run.stateText || "")), "state=" + String(run.stateText || "").slice(0, 120));
    ok("A6 页面 stub 被用到（hits=" + run.stub.hits + "，没发真请求）", run.stub.hits >= 1);
    ok("A7 全程无 JS 异常", cdp.exceptions.length === 0, JSON.stringify(cdp.exceptions.slice(0, 2)));

    const cleaned = await ev("(" + pageCleanup.toString() + ")()");
    ok("A8 收尾恢复 fetch / 超时变量 / 面板与弹窗，busy=false", Boolean(cleaned) && cleaned.ok === true && cleaned.fetchRestored === true && cleaned.idleRestored === true && cleaned.maxRestored === true && cleaned.modalRestored === true && cleaned.busy === false, JSON.stringify(cleaned));
  } catch (e) {
    ok("A 段执行（无异常中断）", false, String((e && e.message) || e));
    // 尽力恢复页面（哪怕上面中途抛错）
    try { await ev("(" + pageCleanup.toString() + ")()"); } catch (e2) {}
  } finally {
    cdp.close();
  }
}

/** C 段：事件一直在流（steady stub），只有「单次审查总时长闸」会到点 */
async function runC() {
  console.log("\n== C. 单次审查总时长闸（steady 事件流，不调模型）==");
  const cdp = await openCdp();
  if (!cdp) return;
  const ev = cdp.ev;
  try {
    const pre = await ev("({ idle: typeof CW_SSE_IDLE_TIMEOUT_MS, max: typeof CW_REVIEW_MAX_MS === 'number' ? CW_REVIEW_MAX_MS : null, review: typeof cwReviewCode, sse: typeof cwStreamSSE, busy: typeof cwReviewBusy === 'boolean' ? cwReviewBusy : null })");
    ok("C 前置：总时长闸已落地（CW_REVIEW_MAX_MS 是顶层可变变量，默认 300000）", Boolean(pre) && pre.max === 300000, JSON.stringify(pre));
    ok("C 前置：页面空闲（cwReviewBusy === false）且 cwReviewCode / cwStreamSSE 存在", Boolean(pre) && pre.busy === false && pre.review === "function" && pre.sse === "function", JSON.stringify(pre));
    if (!pre || pre.busy !== false || pre.review !== "function") return;

    const setup = await ev("(" + pageSetup.toString() + ")('steady')");
    ok("打开 #codeModal / 审查面板，CodeMirror setValue 填入 22 行 python", Boolean(setup) && setup.ok === true, JSON.stringify(setup && setup.error ? setup : (setup && setup.editor)));
    if (!setup || setup.ok !== true) return;
    ok("CW_REVIEW_MAX_MS 覆盖为 3000（空闲阈值仍 2500，但 steady 流每 150ms 重置）", setup.maxNow === 3000 && setup.idleNow === 2500, JSON.stringify({ idleNow: setup.idleNow, maxNow: setup.maxNow }));
    ok("页面 fetch 已被 steady stub 接管（持续 delta，不调真模型）", setup.stubInstalled === true);

    const base = cdp.exceptions.length;
    const run = await ev("(" + pageRunReview.toString() + ")()");
    console.log("  用时 " + run.elapsed + "ms · busy=" + run.busy + " · 按钮=" + JSON.stringify(run.reviewText) + " · stub=" + JSON.stringify(run.stub) + (run.err ? " · err=" + run.err : ""));
    console.log("  状态行: " + String(run.stateText || "").slice(0, 180));
    ok("C1 全程 < 12s（实际 " + run.elapsed + "ms）", run.elapsed < 12000);
    ok("C2 cwReviewCode() 自己结束（未被 Promise.race 兜超时，也没向外抛）", run.completed === true && !run.err, run.err || ("completed=" + run.completed));
    ok("C3 总时长闸触发后 cwReviewBusy 已释放（false）", run.busy === false, "busy=" + run.busy);
    ok("C4 #cwReviewState 含「超过」且含「还没完成」（总时长闸文案）", /超过/.test(String(run.stateText || "")) && /还没完成/.test(String(run.stateText || "")), "state=" + String(run.stateText || "").slice(0, 140));
    ok("C5 #cwReview 恢复可用（可点 + 文案「模型审查」）", run.reviewDisabled === false && run.reviewText === "模型审查", "disabled=" + run.reviewDisabled + " text=" + JSON.stringify(run.reviewText));
    ok("C6 本段无 JS 异常", cdp.exceptions.length - base === 0, JSON.stringify(cdp.exceptions.slice(base, base + 2)));

    const cleaned = await ev("(" + pageCleanup.toString() + ")()");
    ok("C7 收尾恢复 fetch / CW_REVIEW_MAX_MS=300000 / 面板与弹窗，busy=false", Boolean(cleaned) && cleaned.ok === true && cleaned.fetchRestored === true && cleaned.maxRestored === true && cleaned.idleRestored === true && cleaned.modalRestored === true && cleaned.busy === false, JSON.stringify(cleaned));
  } catch (e) {
    ok("C 段执行（无异常中断）", false, String((e && e.message) || e));
    try { await ev("(" + pageCleanup.toString() + ")()"); } catch (e2) {}
  } finally {
    cdp.close();
  }
}

/** D 段：兜底保险丝——busy 卡死但没有 SSE 在读时，未处理拒绝应自动收尾（P0 结构残根） */
async function runD() {
  console.log("\n== D. 兜底保险丝（busy 卡死但无 SSE 在跑 -> 未处理拒绝自动收尾）==");
  const cdp = await openCdp();
  if (!cdp) return;
  const ev = cdp.ev;
  try {
    const pre = await ev("({ busy: typeof cwReviewBusy === 'boolean' ? cwReviewBusy : null, active: typeof cwSseActive === 'number' ? cwSseActive : null, fn: typeof cwReleaseOrphanBusy, end: typeof cwEndJob })");
    ok("D 前置：兜底保险丝已落地（cwSseActive / cwReleaseOrphanBusy 存在，页面空闲且无 SSE 在读）", Boolean(pre) && pre.active === 0 && pre.fn === "function" && pre.end === "function" && pre.busy === false, JSON.stringify(pre));
    if (!pre || pre.busy !== false || pre.active !== 0 || pre.fn !== "function") return;

    const base = cdp.exceptions.length;
    const r = await ev("(" + pageOrphanBusyProbe.toString() + ")(700)");
    console.log("  模拟残根: busy=" + r.during.busy + " · 按钮 disabled=" + r.during.disabled + " · cwSseActive=" + r.during.active);
    console.log("  等 " + r.waited + "ms 后: busy=" + r.busy + " · 按钮=" + JSON.stringify(r.text) + " · 状态行=" + String(r.stateText || "").slice(0, 140));
    ok("D1 未处理拒绝触发兜底后 cwReviewBusy 已释放（false）", r.busy === false, "busy=" + r.busy);
    ok("D2 #cwReviewState 含「流程异常」（cwReleaseOrphanBusy 的收尾文案）", /流程异常/.test(String(r.stateText || "")), "state=" + String(r.stateText || "").slice(0, 140));
    ok("D3 #cwReview 恢复可用（可点 + 文案「模型审查」）", r.disabled === false && r.text === "模型审查", "disabled=" + r.disabled + " text=" + JSON.stringify(r.text));

    const cleaned = await ev("(" + pageOrphanCleanup.toString() + ")()");
    ok("D4 收尾复位（cwEndJob + 清状态行：busy=false、按钮可用、状态行空）", Boolean(cleaned) && cleaned.ok === true && cleaned.busy === false && cleaned.disabled === false && cleaned.text === "模型审查" && !String(cleaned.stateText || "").trim(), JSON.stringify(cleaned));

    // 诊断（不断言）：D 段预期只多出 1 条未处理拒绝（probe-orphan-busy）
    const extra = cdp.exceptions.slice(base);
    console.log("  D 段新人未处理异常 " + extra.length + " 条" + (extra.length ? "：" + JSON.stringify(extra.slice(0, 2)) : ""));
  } catch (e) {
    ok("D 段执行（无异常中断）", false, String((e && e.message) || e));
    try { await ev("(" + pageOrphanCleanup.toString() + ")()"); } catch (e2) {}
  } finally {
    cdp.close();
  }
}

// ================================================================ B. 后端看门狗（独立实例）

async function httpJson(port, method, p, body, token, ms) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers["x-local-token"] = token;
  const o = { method: method, headers: headers, signal: AbortSignal.timeout(ms || 30000) };
  if (body !== undefined) o.body = JSON.stringify(body);
  try {
    const r = await fetch("http://127.0.0.1:" + port + p, o);
    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch (e) {}
    return { status: r.status, data: data, text: text };
  } catch (e) {
    return { status: 0, data: null, text: "", error: String((e && e.message) || e) };
  }
}

/** 读一条 SSE：返回 { status, ct, events, text, ms, error }；非流式按 JSON 带回 */
async function sseReview(port, body, token, ms) {
  const t0 = Date.now();
  let res;
  try {
    res = await fetch("http://127.0.0.1:" + port + "/api/code/review/stream", {
      method: "POST",
      headers: { "content-type": "application/json", "x-local-token": token },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(ms || 65000),
    });
  } catch (e) {
    return { status: 0, ct: "", events: [], text: "", error: String((e && e.message) || e), ms: Date.now() - t0 };
  }
  const ct = String(res.headers.get("content-type") || "");
  if (!/text\/event-stream/i.test(ct)) {
    const text = await res.text().catch(() => "");
    let data = null;
    try { data = JSON.parse(text); } catch (e) {}
    return { status: res.status, ct: ct, events: [], text: text, data: data, ms: Date.now() - t0 };
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", text = "", error = "";
  const events = [];
  try {
    for (;;) {
      const step = await reader.read();
      if (step.done) break;
      const piece = dec.decode(step.value, { stream: true });
      text += piece;
      buf += piece;
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const line = block.split("\n").find((l) => l.startsWith("data:"));
        if (!line) continue;
        const raw = line.slice(5).trim();
        if (!raw || raw === "[DONE]") continue;
        let j = null;
        try { j = JSON.parse(raw); } catch (e) {}
        if (j) events.push(j);
      }
    }
  } catch (e) {
    error = String((e && e.message) || e);
  }
  return { status: res.status, ct: ct, events: events, text: text, error: error, ms: Date.now() - t0 };
}

async function waitServer(port, ms, exited) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 40000)) {
    if (exited && exited()) return { ok: false, exited: true };
    const r = await httpJson(port, "GET", "/api/state", undefined, "", 1500);
    if (r.status === 200 && r.data && Array.isArray(r.data.models)) return { ok: true, state: r.data };
    await sleep(300);
  }
  return { ok: false, exited: false };
}

async function waitLoaded(port, file, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 150000)) {
    const s = await httpJson(port, "GET", "/api/state", undefined, "", 3000);
    if (String((s.data && s.data.loaded) || "") === file) return true;
    await sleep(500);
  }
  return false;
}

async function waitPortClosed(port, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 8000)) {
    const r = await httpJson(port, "GET", "/api/state", undefined, "", 800);
    if (r.status === 0) return true;
    await sleep(250);
  }
  return false;
}

async function killChild(c) {
  if (!c) return;
  const pid = c.pid;
  if (c.exitCode === null) {
    try { c.kill(); } catch (e) {}
    const t0 = Date.now();
    while (Date.now() - t0 < 6000 && c.exitCode === null) await sleep(200);
  }
  if (c.exitCode === null) {
    try { spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); } catch (e) {}
    const t0 = Date.now();
    while (Date.now() - t0 < 6000 && c.exitCode === null) await sleep(200);
  }
}

async function runB() {
  console.log("\n== B. 后端生成空闲看门狗（独立实例 · 硬链接 4B · 阈值 1s）==");
  const st = {
    tmpRoot: "", child: null, logOut: "", logErr: "", outTail: "", errTail: "", exited: false,
    pidFile: "", pidBackup: null, port: 0, srcSize: 0,
  };
  try {
    if (!existsSync(MODEL_SRC)) {
      ok("B 前置：真实 4B 模型存在（" + MODEL_SRC + "）", false, "文件不存在，无法硬链接（不复制大文件）");
      return;
    }
    st.srcSize = (await stat(MODEL_SRC)).size;
    ok("B 前置：真实 4B 模型存在（只读硬链接，不复制不删除）", st.srcSize > 1024 ** 3, (st.srcSize / 1024 ** 3).toFixed(2) + " GB");
    const srcIno = (await stat(MODEL_SRC)).ino;

    // 1. 临时目录 + 硬链接（同盘）
    await mkdir(NIGHT_DIR, { recursive: true });
    st.tmpRoot = await mkdtemp(path.join(NIGHT_DIR, "watchdog-tmp-"));
    const modelDir = path.join(st.tmpRoot, "model");
    const pluginDir = path.join(st.tmpRoot, "plugins");
    const logsDir = path.join(st.tmpRoot, "logs");
    for (const d of [modelDir, pluginDir, logsDir]) await mkdir(d, { recursive: true });
    const linked = path.join(modelDir, MODEL_NAME);
    await link(MODEL_SRC, linked);
    const lk = await stat(linked);
    ok("临时模型目录里是硬链接（同盘同文件，不占额外空间）", lk.size === st.srcSize && (lk.ino === undefined || srcIno === undefined || lk.ino === srcIno), "size=" + (lk.size / 1024 ** 3).toFixed(2) + "GB ino=" + lk.ino + "/" + srcIno);
    console.log("  临时目录: " + st.tmpRoot);

    // 2. 空闲端口
    for (const p of PORTS) {
      const r = await httpJson(p, "GET", "/api/state", undefined, "", 1200);
      if (r.status === 0) { st.port = p; break; }
    }
    ok("在 8198–8205 里找到空闲端口", st.port > 0, st.port ? "PORT=" + st.port : "8198–8205 都被占用（可能是上次残留实例）");
    if (!st.port) return;

    // 3. 备份 server.pid（临时实例启动会覆盖、退出会删掉它，别把 8099 的弄丢）
    st.pidFile = path.join(SERVER_DIR, "server.pid");
    try { st.pidBackup = await readFile(st.pidFile, "utf8"); } catch (e) { st.pidBackup = null; }

    // 4. spawn 独立实例（CODE_JOB_IDLE_TIMEOUT_MS=1000）
    const env = Object.assign({}, process.env, {
      PORT: String(st.port),
      MODEL_DIR: modelDir,
      PLUGIN_DIR: pluginDir,
      AUTO_LOAD: "",
      VISION_IDLE_SEC: "0",
      CODE_JOB_IDLE_TIMEOUT_MS: String(CODE_IDLE_MS),
    });
    delete env.LOCALAI_LLAMA_DIR;
    delete env.LOCALAI_VISION_PACK_DIR;
    st.logOut = path.join(logsDir, "server.out.txt");
    st.logErr = path.join(logsDir, "server.err.txt");
    st.child = spawn(process.execPath, ["app.mjs"], {
      cwd: SERVER_DIR,
      env: env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    st.child.stdout.pipe(createWriteStream(st.logOut));
    st.child.stderr.pipe(createWriteStream(st.logErr));
    st.child.stdout.on("data", (d) => { st.outTail = (st.outTail + String(d)).slice(-3000); });
    st.child.stderr.on("data", (d) => { st.errTail = (st.errTail + String(d)).slice(-3000); });
    st.child.on("exit", () => { st.exited = true; });
    const boot = await waitServer(st.port, 40000, () => st.exited);
    ok("临时实例 /api/state 在 40s 内就绪（MODEL_DIR=临时目录）", boot.ok === true, boot.exited ? "子进程已退出：" + st.errTail.slice(-300) : "pid=" + (st.child && st.child.pid));
    if (!boot.ok) return;
    const token = String(boot.state.localToken || "");
    ok("拿到临时实例的本机令牌（/api/state.localToken）", token.length > 0, "len=" + token.length);
    const models = (Array.isArray(boot.state.models) ? boot.state.models : []).map((m) => String((m && m.file) || ""));
    ok("临时实例模型库里只有硬链接进来的 4B", models.includes(MODEL_NAME), JSON.stringify(models));
    ok("MODEL_DIR 环境变量生效", String(boot.state.modelDir || "").toLowerCase() === path.resolve(modelDir).toLowerCase(), "modelDir=" + boot.state.modelDir);

    // 5. 载入 4B
    console.log("  加载 4B（独立进程，Vulkan 约 10–30s）…");
    const lr = await httpJson(st.port, "POST", "/api/load", { file: MODEL_NAME }, token, 180000);
    ok("POST /api/load（4B）-> 200", lr.status === 200, "HTTP " + lr.status + " " + errText(lr));
    const loadedOk = await waitLoaded(st.port, MODEL_NAME, 150000);
    ok("4B 已加载完成（/api/state.loaded）", loadedOk, "loaded=" + String(((await httpJson(st.port, "GET", "/api/state", undefined, "", 3000)).data || {}).loaded));

    // 6. 审查请求：阈值 1s -> 第一阶段还没吐第一个 delta 就被掐掉
    console.log("  POST /api/code/review/stream（22 行 python，等 F2 空闲看门狗触发）…");
    const rev = await sseReview(st.port, {
      code: PY22,
      lang: "python",
      file: "python-210407-1.py",
      intent: "找出这段代码里的问题（重点看绘图参数与循环）",
      max_tokens: 400,
    }, token, 65000);
    const types = (rev.events || []).map((e) => String((e && e.type) || ""));
    console.log("  事件序列: " + types.join(" -> ").slice(0, 240) + "（" + (rev.ms / 1000).toFixed(1) + "s）" + (rev.error ? " · reader err=" + rev.error : ""));
    const errEv = (rev.events || []).find((e) => e && e.type === "error") || null;
    ok("POST /api/code/review/stream -> 200 且 Content-Type 是 text/event-stream", rev.status === 200 && /text\/event-stream/i.test(rev.ct), "HTTP " + rev.status + " ct=" + rev.ct + " " + (rev.error || errText(rev)));
    ok("第一个事件是 meta", types[0] === "meta", types.slice(0, 3).join(","));
    ok("收到 error 事件（不是正常 findings/done）", Boolean(errEv), types.join(","));
    ok("error 消息含「没有任何输出」（F2 生成停滞看门狗）", Boolean(errEv) && /没有任何输出/.test(String(errEv.message || "")), errEv ? String(errEv.message).slice(0, 160) : "没有 error 事件");
    ok("全程 < 60s（实际 " + (rev.ms / 1000).toFixed(1) + "s）", rev.ms < 60000);
    ok("没有 findings 事件（模型没跑完，不该有结论）", !types.includes("findings"), types.join(","));
    ok("没有 done 事件", !types.includes("done"), types.join(","));

    // 7. 锁已释放：随后 /api/load 同模型必须 200（不是 busy 409）
    let rel = null, attempts = 0;
    for (let i = 0; i < 20; i++) {
      attempts = i + 1;
      rel = await httpJson(st.port, "POST", "/api/load", { file: MODEL_NAME }, token, 180000);
      if (rel.status === 200) break;
      if (rel.status !== 409) break;
      await sleep(250);
    }
    ok("审查结束后 POST /api/load 返回 200（codeJob 锁已释放，不是 409）", Boolean(rel) && rel.status === 200, "HTTP " + (rel && rel.status) + "（第 " + attempts + " 次） " + errText(rel));

    // 8. 证据：临时实例 stdout 里应有 F2 的「停滞 1s 无输出，已中止」日志（读不到只提示，不断言）
    await sleep(400);
    let logTxt = "";
    try { logTxt = await readFile(st.logOut, "utf8"); } catch (e) {}
    const hitLog = /停滞\s*\d+s?\s*无输出/.test(logTxt);
    console.log("  F2 日志行: " + (hitLog ? "有（" + (logTxt.split(/\r?\n/).find((l) => /停滞/.test(l)) || "").trim().slice(0, 120) + "）" : "（临时实例 stdout 里暂未读到，不影响断言）"));
  } catch (e) {
    ok("B 段执行（无异常中断）", false, String((e && e.message) || e));
    if (st.errTail) console.log("  临时实例 stderr（tail）:\n" + st.errTail.split(/\r?\n/).slice(-8).join("\n"));
  } finally {
    console.log("\n== C. 收尾：杀临时实例 / 恢复 server.pid / 删临时目录 ==");
    try { await killChild(st.child); } catch (e) {}
    const childGone = !st.child || st.child.exitCode !== null || st.exited;
    ok("临时实例已退出", childGone, !st.child ? "未启动" : childGone ? (st.child.exitCode !== null ? "exitCode=" + st.child.exitCode : "已收到 exit 事件") : "仍在运行，需人工处理");
    if (st.port) {
      const portGone = await waitPortClosed(st.port, 8000);
      ok("端口 " + st.port + " 已释放", portGone, portGone ? "干净" : "仍在监听，需人工处理");
    }
    // 恢复 server.pid：子进程退出时会 unlink 它，必须把 8099 的原样写回
    let pidOk = true;
    if (st.pidFile) {
      try {
        if (st.pidBackup !== null) {
          await writeFile(st.pidFile, st.pidBackup, "utf8");
          const now = await readFile(st.pidFile, "utf8").catch(() => null);
          pidOk = now === st.pidBackup;
        } else {
          const now = await readFile(st.pidFile, "utf8").catch(() => null);
          if (now !== null && st.child && String(now).trim() === String(st.child.pid)) await rm(st.pidFile, { force: true });
          pidOk = true; // 原来没有 pid 文件：临时实例退出后不该留下自己的 pid
        }
      } catch (e) { pidOk = false; }
    }
    ok("server.pid 已恢复（没删掉 8099 的 pid 文件）", pidOk);
    if (st.tmpRoot) {
      try { await rm(st.tmpRoot, { recursive: true, force: true, maxRetries: 3 }); } catch (e) {}
      ok("临时目录（含 4B 硬链接）已删除", !existsSync(st.tmpRoot), st.tmpRoot);
    }
    if (st.srcSize > 0) {
      let srcOk = false;
      try { srcOk = existsSync(MODEL_SRC) && (await stat(MODEL_SRC)).size === st.srcSize; } catch (e) {}
      ok("真实 4B 模型还在、大小未变（硬链接没动源文件）", srcOk, MODEL_SRC);
    }
  }
}

await runA();
await sleep(600); // 等 A 段「空闲 abort 后 400ms 保险丝」先跑完（此时 busy 已释放，不会串到 C 段）
await runC();
await sleep(600); // 同理等 C 段的保险丝落掉，再进 D 段
await runD();
await sleep(300); // D 段会故意制造一条未处理拒绝，等事件收完再进 B 段
// 集成未完成时只想验前端（A/C）可设 PROBE_SKIP_B=1；run-full 不设它，默认 A+B+C 全跑
if (process.env.PROBE_SKIP_B === "1") {
  console.log("\n  skip: B 段后端看门狗（PROBE_SKIP_B=1，A/C 已跑）");
} else {
  await runB();
}

console.log("\n== 结果: " + pass + " 通过 / " + fail + " 失败 ==\n");
process.exit(fail ? 1 : 0);

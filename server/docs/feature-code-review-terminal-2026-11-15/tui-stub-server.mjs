#!/usr/bin/env node
/**
 * tui-stub-server.mjs —— 给 TUI 自检用的极简桩服务（零依赖，不碰真服务/不碰模型）
 *
 *   node tui-stub-server.mjs 8299
 *
 * 只实现 TUI 用到的接口：GET /api/state、GET /api/tools、POST /api/tool、POST /api/load。
 * POST /api/tool 校验 x-local-token（错的回 403），用来验证 TUI 的令牌读取/携带/重试逻辑。
 * 用途：在 8099 被占/被重活压住时，仍能确定性地验证 TUI 的命令提示与工具调用链路。
 */
import http from "node:http";

const port = Number(process.argv[2] || 8299);
const TOKEN = "stub-token-123";
const TOOLS = [
  {
    name: "get_current_time",
    description: "获取当前本地日期与时间（桩：固定返回）。",
    params: [],
    args: [],
    required: [],
  },
  {
    name: "calculate",
    description: "精确计算一个数学表达式（桩：返回 expression 与固定 value）。",
    params: ["expression"],
    args: [{ name: "expression", type: "string", required: true, description: "要计算的表达式" }],
    required: ["expression"],
  },
  {
    name: "stub_fail",
    description: "桩：总是返回 result.error，用来验证 TUI 的红字分支。",
    params: [],
    args: [],
    required: [],
  },
];
const STATE = {
  models: [{ file: "qwen3-5-4B-Q4_K_M.gguf", sizeGB: 2.5 }],
  modelDir: "D:\\stub\\models",
  version: "1.7.0-stub",
  loaded: "qwen3-5-4B-Q4_K_M.gguf",
  context: 8192,
  layers: 33,
  gpu: "stub",
  loading: false,
  activeChats: 0,
  localToken: TOKEN,
};

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body) });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const url = (req.url || "/").split("?")[0];
  if (req.method === "GET" && url === "/api/state") return send(res, 200, STATE);
  if (req.method === "GET" && url === "/api/tools") return send(res, 200, { tools: TOOLS });
  if (req.method === "POST" && url === "/api/load") return send(res, 200, { ok: true });
  if (req.method === "POST" && url === "/api/tool") {
    if (req.headers["x-local-token"] !== TOKEN) return send(res, 403, { error: { message: "无令牌" } });
    const chunks = [];
    for await (const c of req) chunks.push(c);
    let body = null;
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch {}
    if (!body || typeof body.args !== "object" || body.args === null || Array.isArray(body.args)) {
      return send(res, 400, { error: { message: "args 必须是对象" } });
    }
    const tool = TOOLS.find((t) => t.name === body.name);
    if (!tool) return send(res, 404, { error: { message: "没有这个工具：" + body.name } });
    const t0 = Date.now();
    if (tool.name === "stub_fail") {
      return send(res, 200, { ok: true, tool: tool.name, ms: Date.now() - t0, result: { error: "桩故意失败：文件不存在" } });
    }
    if (tool.name === "calculate") {
      return send(res, 200, { ok: true, tool: tool.name, ms: Date.now() - t0, result: { expression: body.args.expression ?? "", value: 42 } });
    }
    return send(res, 200, {
      ok: true,
      tool: tool.name,
      ms: Date.now() - t0,
      result: { localTime: "2026/11/15 00:00:00", iso: "2026-11-15T00:00:00.000Z", weekday: "星期日", note: "stub" },
    });
  }
  return send(res, 404, { error: { message: "无此路由: " + req.method + " " + url } });
});

server.listen(port, "127.0.0.1", () => console.log("stub listening http://127.0.0.1:" + port));

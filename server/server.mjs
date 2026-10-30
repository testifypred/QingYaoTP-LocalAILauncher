/**
 * Minimal OpenAI-compatible server for a local GGUF model via node-llama-cpp.
 * Implements GET /v1/models and POST /v1/chat/completions (stream + non-stream).
 *
 * NOTE: tool calling is NOT implemented. Requests carrying "tools" are answered
 * with plain text, so this endpoint is suitable for chat use, not for agent loops.
 */
import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { getLlama, LlamaChatSession } from "node-llama-cpp";

const MODEL_PATH = process.env.MODEL_PATH ?? "D:\\LocalModels\\Phi-4-mini-instruct-Q4_K_M.gguf";
const MODEL_ID = process.env.MODEL_ID ?? "phi-4-mini";
const PORT = Number(process.env.PORT ?? 8090);
const CONTEXT_SIZE = Number(process.env.CONTEXT_SIZE ?? 32768);
const GPU = process.env.GPU ?? "vulkan";
const CHAT_HTML = path.join(path.dirname(fileURLToPath(import.meta.url)), "chat.html");

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

log("loading llama.cpp ...");
const llama = await getLlama({ gpu: GPU });
log("loading model:", MODEL_PATH);
const model = await llama.loadModel({ modelPath: MODEL_PATH });
const context = await model.createContext({ contextSize: CONTEXT_SIZE });
const ctxSize = context.contextSize ?? CONTEXT_SIZE;
log(`ready: ${MODEL_ID} | context ${ctxSize} | gpu ${GPU} | layers ${model.gpuLayers ?? "?"}`);

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function toHistory(messages) {
  // OpenAI roles -> node-llama-cpp ChatHistoryItem.
  // Note the asymmetry: user items carry `text`, model items carry `response: [...]`.
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => {
      const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");
      return m.role === "user"
        ? { type: "user", text }
        : { type: "model", response: [text] };
    });
}

async function handleChat(payload, res) {
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => (typeof m.content === "string" ? m.content : ""))
    .join("\n")
    .trim();
  const history = toHistory(messages);
  const lastUser = history.filter((h) => h.type === "user").pop();
  const priorHistory = history.slice(0, Math.max(0, history.length - (lastUser ? 1 : 0)));

  if (!lastUser) return sendJson(res, 400, { error: { message: "no user message supplied" } });

  const maxTokens = Number(payload.max_tokens ?? 1024);
  const temperature = Number(payload.temperature ?? 0.7);
  const id = "chatcmpl-" + Math.random().toString(36).slice(2, 12);
  const created = Math.floor(Date.now() / 1000);

  const sequence = context.getSequence();
  try {
    const session = new LlamaChatSession({
      contextSequence: sequence,
      systemPrompt: system || undefined,
    });
    if (priorHistory.length > 0 && typeof session.setChatHistory === "function") {
      try {
        session.setChatHistory(priorHistory);
      } catch (e) {
        log("setChatHistory failed, continuing without history:", e.message);
      }
    }

    if (payload.stream === true) {
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      const chunk = (delta, finish = null) =>
        res.write(
          `data: ${JSON.stringify({
            id,
            object: "chat.completion.chunk",
            created,
            model: MODEL_ID,
            choices: [{ index: 0, delta, finish_reason: finish }],
          })}\n\n`,
        );
      chunk({ role: "assistant", content: "" });
      let out = 0;
      await session.prompt(lastUser.text, {
        maxTokens,
        temperature,
        onTextChunk: (t) => {
          out += 1;
          chunk({ content: t });
        },
      });
      chunk({}, "stop");
      res.write("data: [DONE]\n\n");
      res.end();
      log(`stream done, ${out} chunks`);
    } else {
      const text = await session.prompt(lastUser.text, { maxTokens, temperature });
      sendJson(res, 200, {
        id,
        object: "chat.completion",
        created,
        model: MODEL_ID,
        choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      });
      log(`completion done, ${text.length} chars`);
    }
  } catch (err) {
    log("ERROR", err?.message ?? err);
    if (!res.headersSent) sendJson(res, 500, { error: { message: String(err?.message ?? err) } });
    else res.end();
  } finally {
    try {
      sequence.dispose();
    } catch {}
  }
}

const server = http.createServer(async (req, res) => {
  const url = req.url ?? "";
  if (req.method === "GET" && url === "/health") {
    return sendJson(res, 200, { status: "ok", model: MODEL_ID, context: ctxSize, gpu: GPU });
  }
  if (req.method === "GET" && (url === "/" || url === "/index.html")) {
    try {
      const html = await readFile(CHAT_HTML, "utf8");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(html);
    } catch (err) {
      return sendJson(res, 500, { error: { message: `chat.html unreadable: ${err.message}` } });
    }
  }
  if (req.method === "GET" && url.startsWith("/v1/models")) {
    return sendJson(res, 200, {
      object: "list",
      data: [{ id: MODEL_ID, object: "model", created: 0, owned_by: "local", owned_by_label: "local" }],
    });
  }
  if (req.method === "POST" && url.startsWith("/v1/chat/completions")) {
    let raw = "";
    try {
      for await (const c of req) raw += c;
    } catch {
      return sendJson(res, 400, { error: { message: "failed to read request body" } });
    }
    let payload;
    try {
      payload = JSON.parse(raw || "{}");
    } catch {
      return sendJson(res, 400, { error: { message: "invalid JSON body" } });
    }
    return handleChat(payload, res);
  }
  sendJson(res, 404, { error: { message: `no route for ${req.method} ${url}` } });
});

server.listen(PORT, "127.0.0.1", () => {
  log(`listening on http://127.0.0.1:${PORT}/v1  (model: ${MODEL_ID})`);
});

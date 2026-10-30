/**
 * 工作区便签 —— 演示如何读写 ctx.workspace。
 * 模型可以把要点追加到 notes.md，也可以读回来。
 */
import { appendFile, readFile, mkdir } from "node:fs/promises";
import path from "node:path";

export const name = "workspace_note";
export const description = "往工作区的 notes.md 追加一条便签，或者读取已有便签。用户说「记一下」「把这条记到笔记里」「看看笔记」时使用。";
export const params = {
  type: "object",
  properties: {
    action: { type: "string", description: "append（追加）或 read（读取）" },
    text: { type: "string", description: "要记录的内容，action=append 时必填" },
  },
  required: ["action"],
};

export async function run(args, ctx) {
  const action = String(args?.action ?? "append").toLowerCase();
  const file = path.join(ctx.workspace, "notes.md");
  if (action === "read") {
    try {
      const txt = await readFile(file, "utf8");
      return { file: "notes.md", chars: txt.length, content: txt.slice(0, 4000) };
    } catch {
      return { file: "notes.md", content: "", note: "还没有便签" };
    }
  }
  const text = String(args?.text ?? "").trim();
  if (!text) return { error: "text 为空，没东西可记" };
  await mkdir(ctx.workspace, { recursive: true });
  const line = "- " + new Date().toLocaleString("zh-CN") + " " + text.replace(/\s+/g, " ") + "\n";
  await appendFile(file, line, "utf8");
  return { ok: true, file: "notes.md", appended: line.trim() };
}

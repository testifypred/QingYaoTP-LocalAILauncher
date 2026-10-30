/**
 * 精确检测：只读取 GGUF 的 tokenizer.chat_template 元数据，
 * 不扫词表，避免 "thought"/"reasoning" 这类普通词造成的假阳性。
 */
import { readGgufFileInfo } from "node-llama-cpp";

const MODELS = [
  ["Phi-4-mini", "D:\\LocalModels\\Phi-4-mini-instruct-Q4_K_M.gguf"],
  ["Qwen2.5-7B", "D:\\LocalModels\\qwen2.5-7b-instruct-1m-q4_k_m.gguf"],
  ["Qwen3.5-4B", "D:\\LocalModels\\qwen3-5-4B-Q4_K_M.gguf"],
];

for (const [label, path] of MODELS) {
  console.log(`\n########## ${label} ##########`);
  let info;
  try {
    info = await readGgufFileInfo(path, { readTensorInfo: false });
  } catch (e) {
    console.log("  读取失败:", e.message);
    continue;
  }
  const tpl = info?.metadata?.tokenizer?.chat_template;
  const tplStr = typeof tpl === "string" ? tpl : Array.isArray(tpl) ? tpl.join("\n") : "";
  if (!tplStr) {
    console.log("  模板: (未找到 chat_template 元数据)");
    continue;
  }
  console.log(`  模板长度: ${tplStr.length} 字符`);

  // 只在模板里找真正代表思考机制的标记
  const probes = ["enable_thinking", "thinking", "think", "reasoning", "reason", "thought"];
  for (const p of probes) {
    const idx = tplStr.toLowerCase().indexOf(p.toLowerCase());
    console.log(`  "${p}" -> ${idx >= 0 ? `有 (位置 ${idx})` : "无"}`);
  }

  // 打印所有含 think 的片段，看它到底怎么用的
  const hits = [];
  const re = /think/gi;
  let m;
  while ((m = re.exec(tplStr)) !== null && hits.length < 6) {
    const s = Math.max(0, m.index - 70);
    hits.push("    ..." + tplStr.slice(s, m.index + 70).replace(/\s+/g, " ") + "...");
  }
  if (hits.length) {
    console.log("  含 think 的片段:");
    hits.forEach((h) => console.log(h));
  } else {
    console.log("  模板中完全不含 think 字样");
  }
}

/**
 * think 标签拆分的单元测试（不需要模型，纯字符串逻辑）。
 *   node test-think-split.mjs
 *
 * 注意：本文件里不写字面量标签，全部用 LT/GT 拼出来——
 * 因为工具链会把某些标签字面量改写掉，直接写会导致测试与实现不一致。
 */
import { readFile } from "node:fs/promises";

const LT = String.fromCharCode(60);
const GT = String.fromCharCode(62);
const OPEN = LT + "think" + GT;
const CLOSE = LT + "/think" + GT;
const DS_CLOSE = LT + "｜end▁of▁thinking｜" + GT; // DeepSeek 的原生结束标记

// 从 app.mjs 里抠出三个纯函数，避免为了测试去加载模型
const src = await readFile(new URL("./app.mjs", import.meta.url), "utf8");
const grab = (name) => {
  const start = src.indexOf(name);
  if (start < 0) throw new Error("找不到 " + name);
  const i = src.indexOf("{", start);
  let depth = 0;
  for (let j = i; j < src.length; j += 1) {
    if (src[j] === "{") depth += 1;
    else if (src[j] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(start, j + 1);
    }
  }
  throw new Error("括号不配对 " + name);
};
const openDecl = src.slice(src.indexOf("const THINK_OPEN_TAG"), src.indexOf("const THINK_CLOSE_TAGS"));
const closeDecl = src.slice(src.indexOf("const THINK_CLOSE_TAGS"), src.indexOf("\n", src.indexOf("const THINK_CLOSE_TAGS")));
const code = [openDecl, closeDecl, grab("function partialSuffixLen"), grab("function createThoughtSplitter"), grab("function splitThinking"), "return { createThoughtSplitter, splitThinking };"].join("\n");
const { createThoughtSplitter, splitThinking } = new Function(code)();

let pass = 0;
let fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) {
    pass += 1;
    console.log(`  ✅ ${name}`);
  } else {
    fail += 1;
    console.log(`  ❌ ${name}\n     期望 ${JSON.stringify(want)}\n     实际 ${JSON.stringify(got)}`);
  }
}

console.log("1) 整段拆分");
check("标准 R1 输出", splitThinking(`${OPEN}\n先算 2+2。\n${DS_CLOSE}\n2+2=4。`), {
  content: "\n2+2=4。",
  thought: "先算 2+2。",
});
check("普通闭合标签", splitThinking(`${OPEN}理由${CLOSE}答案`), { content: "答案", thought: "理由" });
check("DeepSeek 原生标记", splitThinking(`${OPEN}理由${DS_CLOSE}答案`), { content: "答案", thought: "理由" });
check("没有标签的普通回复", splitThinking("你好，世界。"), { content: "你好，世界。", thought: "" });
check("只有思考没有正文", splitThinking(`${OPEN}纠结中`), { content: "", thought: "纠结中" });

console.log("2) 流式分片（标签被切断）");
function runChunks(chunks) {
  let thought = "";
  let content = "";
  const sp = createThoughtSplitter(
    (t) => (thought += t),
    (t) => (content += t),
  );
  for (const c of chunks) sp.feed(c);
  sp.finish();
  return { content, thought };
}
{
  const half = OPEN.slice(0, 3);
  const r = runChunks([half, OPEN.slice(3), "想", "一想", CLOSE.slice(0, 4), CLOSE.slice(4), "答", "案"]);
  check("开闭标签都被切断", r, { content: "答案", thought: "想一想" });
}
check("普通回复分片", runChunks(["普通", "回复", "没有标签"]), { content: "普通回复没有标签", thought: "" });
{
  const text = `${OPEN}逐字推理${DS_CLOSE}逐字作答`;
  check("逐字符喂入", runChunks([...text]), { content: "逐字作答", thought: "逐字推理" });
}
check("正文里的尖括号不被误吞", runChunks(["1 " + LT + " ", "2 是", "真", "的"]), {
  content: "1 < 2 是真的",
  thought: "",
});
{
  const r = runChunks([`${OPEN}看这个标签 `, LT + "/thi", "nkX" + GT, "还在思考", DS_CLOSE, "完成"]);
  check("思考段里的假闭合", r, { content: "完成", thought: "看这个标签 </thinkX>还在思考" });
}

console.log("3) 边界");
{
  let out = "";
  const sp = createThoughtSplitter(
    () => {},
    (t) => (out += t),
  );
  sp.feed("abc" + LT);
  sp.feed(OPEN.slice(1) + "xyz");
  sp.feed(CLOSE + "tail");
  sp.finish();
  check("正文尾部残留的 '<' 会被保留", out, "abctail");
}
{
  // 没有闭合标签就结束：整段算思考
  let thought = "";
  let content = "";
  const sp = createThoughtSplitter(
    (t) => (thought += t),
    (t) => (content += t),
  );
  sp.feed(`${OPEN}只想了没答`);
  sp.finish();
  check("未闭合时残留归入思考段", { content, thought }, { content: "", thought: "只想了没答" });
}

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);

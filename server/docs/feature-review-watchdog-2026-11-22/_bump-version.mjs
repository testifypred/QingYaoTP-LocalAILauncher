import { readFileSync, writeFileSync } from "node:fs";
const edits = [
  ["D:\\LocalModels\\server\\app.mjs", 'const APP_VERSION = "1.10.0";', 'const APP_VERSION = "1.11.0";'],
  ["D:\\LocalModels\\server\\package.json", '"version": "1.10.0"', '"version": "1.11.0"'],
  ["D:\\LocalModels\\server\\localai.mjs", 'const VERSION = "1.10.0";', 'const VERSION = "1.11.0";'],
  ["D:\\LocalModels\\server\\localai-tui.mjs", 'val("--main-ver", "1.10.0")', 'val("--main-ver", "1.11.0")'],
  ["D:\\LocalModels\\server\\probe-tui-tools.mjs", '"--main-ver", "1.10.0"', '"--main-ver", "1.11.0"'],
  ["D:\\LocalModels\\server\\probe-tui-tools.mjs", '主程序 v1.10.0', '主程序 v1.11.0'],
  ["D:\\LocalModels\\technique\\07-坑与约定.md", 'APP_VERSION（1.10.0）', 'APP_VERSION（1.11.0）'],
];
for (const [file, from, to] of edits) {
  let txt = readFileSync(file, "utf8");
  const n = txt.split(from).length - 1;
  if (n === 0) { console.log("SKIP(not found)", file, JSON.stringify(from.slice(0, 40))); continue; }
  txt = txt.split(from).join(to);
  writeFileSync(file, txt, "utf8");
  console.log("OK", n, file.split("\\").pop());
}

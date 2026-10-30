/**
 * 最小插件模板 —— 复制这个文件改名就能开工。
 *
 * 规则只有三条：
 *   1. 导出 name（字母或下划线开头）、description（模型靠它决定要不要调）
 *   2. 导出 run(args)，返回值必须能被 JSON.stringify
 *   3. 改完保存就生效，不用重启（改的是这个目录里的文件）
 *
 * 能干什么：run 里可以 import 任何 Node 模块，也可以直接用 ctx。
 */
export const name = "hello_plugin";
export const description = "示例插件：回显你给的名字与当前时间。只在用户明确要求测试插件时使用。";
export const params = {
  type: "object",
  properties: {
    who: { type: "string", description: "要打招呼的名字，可留空" },
  },
  required: [],
};

export async function run(args, ctx) {
  const who = String(args?.who ?? "世界");
  return {
    greeting: `你好，${who}。这是来自插件 hello_plugin 的回答。`,
    time: new Date().toLocaleString("zh-CN"),
    pluginDir: ctx.log ? "可用 ctx.log 写日志" : "",
  };
}

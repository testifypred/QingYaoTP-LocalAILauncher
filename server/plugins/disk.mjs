/**
 * 磁盘剩余空间 —— 一个真有用的小插件。
 * 演示：可以用 Node 内置模块，也可以访问 ctx.workspace。
 */
import { statfs } from "node:fs/promises";

export const name = "disk_space";
export const description = "查询本机各磁盘的剩余空间与总量。用户问「磁盘还剩多少」「哪个盘能放模型」时使用。";
export const params = { type: "object", properties: {}, required: [] };

export async function run() {
  const drives = [];
  for (const letter of "CDEFGH") {
    const root = letter + ":\\";
    try {
      const st = await statfs(root);
      const total = st.blocks * st.bsize;
      const free = st.bfree * st.bsize;
      if (!total) continue;
      drives.push({
        drive: root,
        totalGB: +(total / 1024 ** 3).toFixed(1),
        freeGB: +(free / 1024 ** 3).toFixed(1),
        usedPct: Math.round(((total - free) / total) * 100),
      });
    } catch {
      // 盘不存在就跳过，不要因为一个盘没插就整体失败
    }
  }
  if (!drives.length) return { error: "没有读到任何磁盘信息" };
  return { drives };
}

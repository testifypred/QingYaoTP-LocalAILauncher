/**
 * 会话备份（异地镜像）接口探针
 *
 *   node probe-backup.mjs [base] [targetDir]
 *
 * 覆盖：目录校验（相对路径/会话目录/上级目录）、保存配置、立即备份、
 *       镜像与当日快照落盘、内容未变时不重复复制、改了会话会同步、过期目录清理。
 * 自复位：跑完删掉测试会话、恢复默认配置、清掉临时目标目录。
 */
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const BASE = process.argv[2] || "http://127.0.0.1:8099";
// 目标目录默认放系统临时目录（跑完自清），不再写死某个盘上的 docs 子目录
const TARGET = process.argv[3] || path.join(os.tmpdir(), "qytp-probe-backup-target");

let pass = 0;
let fail = 0;
function ok(name, cond, extra = "") {
  if (cond) { pass += 1; console.log("  ok   " + name + (extra ? "  [" + extra + "]" : "")); }
  else { fail += 1; console.log("  FAIL " + name + (extra ? "  [" + extra + "]" : "")); }
}

// 需要令牌的接口（回滚 / 从备份恢复）
async function jt(method, p, body, token) {
  const r = await fetch(BASE + p, {
    method,
    headers: Object.assign({ "content-type": "application/json" }, token ? { "x-local-token": token } : {}),
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  return { status: r.status, data, text };
}

async function j(method, p, body) {
  const r = await fetch(BASE + p, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  return { status: r.status, data, text };
}

const dayStamp = (d = new Date()) =>
  d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");

async function exists(p) { try { await stat(p); return true; } catch { return false; } }

console.log("\n== 目标 " + BASE + " / 备份到 " + TARGET + " ==\n");

let sessionId = "";
try {
  const info = await j("GET", "/api/backup");
  ok("GET /api/backup 可用", info.status === 200 && info.data && info.data.config, "sessions=" + info.data?.sessions);
  ok("返回会话目录", typeof info.data?.sessionDir === "string" && info.data.sessionDir.includes("workspace"), info.data?.sessionDir);
  const sessDir = info.data.sessionDir;

  const rel = await j("POST", "/api/backup", { enabled: true, dir: "relative\\backup" });
  ok("拒绝相对路径", rel.status === 400, rel.data?.error?.message);

  const inside = await j("POST", "/api/backup", { enabled: true, dir: sessDir });
  ok("拒绝会话目录本身", inside.status === 400, inside.data?.error?.message);

  const upward = await j("POST", "/api/backup", { enabled: true, dir: path.dirname(sessDir) });
  ok("拒绝会话目录的上级", upward.status === 400, upward.data?.error?.message);

  const enabledNoDir = await j("POST", "/api/backup", { enabled: true, dir: "" });
  ok("开着自动备份但没目录要拒绝", enabledNoDir.status === 400, enabledNoDir.data?.error?.message);

  const save = await j("POST", "/api/backup", { enabled: true, dir: TARGET, keepDays: 9999, intervalMin: 1 });
  ok("保存合法目录", save.status === 200 && save.data?.config?.dir === path.resolve(TARGET), save.data?.config?.dir);
  ok("保留天数被夹到 365", save.data?.config?.keepDays === 365, String(save.data?.config?.keepDays));
  ok("间隔被夹到 5 分钟", save.data?.config?.intervalMin === 5, String(save.data?.config?.intervalMin));
  ok("目录被建出来了", await exists(TARGET), TARGET);

  const created = await j("POST", "/api/sessions", {
    title: "备份探针",
    messages: [
      { role: "user", content: "备份探针标记 AAAA-1111", t: 1 },
      { role: "assistant", content: "收到 AAAA-1111", t: 2 },
    ],
  });
  sessionId = created.data?.id ?? "";
  ok("先造一个会话", created.status === 200 && sessionId.length > 6, sessionId);

  const run1 = await j("POST", "/api/backup/run");
  ok("立即备份成功", run1.status === 200 && run1.data?.ok === true, JSON.stringify(run1.data?.errors ?? ""));
  ok("备份里至少有这个会话", (run1.data?.sessions || 0) >= 1, "sessions=" + run1.data?.sessions);
  ok("本轮确实复制了文件", (run1.data?.copied || 0) >= 1, "copied=" + run1.data?.copied);

  const mirrorFile = path.join(TARGET, "sessions", sessionId + ".json");
  ok("镜像文件落盘", await exists(mirrorFile), mirrorFile);
  const mirrorRaw = await readFile(mirrorFile, "utf8").catch(() => "");
  ok("镜像内容就是这个会话", mirrorRaw.includes("AAAA-1111"), mirrorRaw.length + "B");
  ok("当日快照落盘", await exists(path.join(TARGET, "daily", dayStamp(), sessionId + ".json")));
  ok("清单文件落盘", await exists(path.join(TARGET, "backup.json")));

  const run2 = await j("POST", "/api/backup/run");
  ok("内容没变时不再重复复制", run2.data?.ok === true && run2.data?.copied === 0, "copied=" + run2.data?.copied);

  const edited = await j("PUT", "/api/sessions/" + sessionId, {
    messages: [
      { role: "user", content: "备份探针标记 AAAA-1111", t: 1 },
      { role: "assistant", content: "收到 AAAA-1111", t: 2 },
      { role: "user", content: "追加一句 BBBB-2222", t: 3 },
    ],
  });
  ok("改一下会话", edited.status === 200);

  const run3 = await j("POST", "/api/backup/run");
  ok("改完会同步", run3.data?.copied >= 1, "copied=" + run3.data?.copied);
  ok("镜像拿到新内容", (await readFile(mirrorFile, "utf8")).includes("BBBB-2222"));

  // 过期目录：造一个很早的日期目录，跑一次应被清掉
  const oldDay = path.join(TARGET, "daily", "2020-01-01");
  await mkdir(oldDay, { recursive: true });
  await writeFile(path.join(oldDay, "x.json"), "{}", "utf8");
  await j("POST", "/api/backup/run");
  ok("过期当日目录被清掉", !(await exists(oldDay)));

  // 历史版本快照也要镜像过去（会话被覆盖过才有快照）
  {
    const snapRoot = path.join(TARGET, "snapshots");
    let snapFiles = [];
    try {
      for (const day of await readdir(snapRoot)) {
        const files = await readdir(path.join(snapRoot, day)).catch(() => []);
        for (const f of files) if (f.startsWith(sessionId + ".")) snapFiles.push(day + "/" + f);
      }
    } catch {}
    ok("历史版本快照也镜像了", snapFiles.length >= 1, snapFiles.slice(0, 2).join(", "));
    const st = (await j("GET", "/api/backup")).data?.status;
    ok("状态里报了快照份数", Number(st?.snapshots) >= 1, "snapshots=" + st?.snapshots);
  }

  // 写盘后 15 秒自动备份一次（不点按钮）：这是"自动"两个字的实际含义
  {
    const auto = await j("POST", "/api/sessions", {
      title: "自动备份探针",
      messages: [{ role: "user", content: "AUTO-9999", t: 1 }],
    });
    const autoId = auto.data?.id ?? "";
    const autoFile = path.join(TARGET, "sessions", autoId + ".json");
    let seen = false;
    for (let i = 0; i < 15 && !seen; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      seen = await exists(autoFile);
    }
    ok("写盘 15 秒后自动备份（不用手点）", !!autoId && seen, autoId + " seen=" + seen);
    if (autoId) await fetch(BASE + "/api/sessions/" + autoId, { method: "DELETE" }).catch(() => {});
  }

  const nowState = await j("GET", "/api/backup");
  ok("状态里能看到上次结果", nowState.data?.status?.ok === true && nowState.data?.lastRunAt > 0, "at=" + new Date(nowState.data?.lastRunAt || 0).toLocaleString("zh-CN", { hour12: false }));
  ok("同盘会有标记（这是 D 盘）", nowState.data?.sameDrive === true || nowState.data?.sameDrive === false, String(nowState.data?.sameDrive));

  const drives = await j("GET", "/api/backup/drives");
  ok("磁盘列表至少有一块", Array.isArray(drives.data?.drives) && drives.data.drives.length >= 1, JSON.stringify((drives.data?.drives || []).map((d) => d.root + " " + d.freeGB + "GB")));


  // ---- 从备份恢复（列表 / 令牌 / 覆盖本机 / 恢复前留档 / 404） ----
  {
    const token = (await j("GET", "/api/state")).data?.localToken;
    const listed = await j("GET", "/api/backup/sessions");
    const row = (listed.data?.sessions || []).find((x) => x.id === sessionId);
    ok("备份列表能列出这个会话", listed.status === 200 && !!row, JSON.stringify(row || {}).slice(0, 140));
    ok("列表标了本机也有、条数对得上", row?.inWorkspace === true && Number(row?.workspaceMessages) >= 3, (row?.workspaceMessages ?? "?") + " 条");

    // 本机再追加一条，制造「本机比备份新」；恢复后应回到备份那一版
    const extra = [
      { role: "user", content: "备份探针标记 AAAA-1111", t: 1 },
      { role: "assistant", content: "收到 AAAA-1111", t: 2 },
      { role: "user", content: "追加一句 BBBB-2222", t: 3 },
      { role: "user", content: "LOCAL-ONLY", t: 4 },
    ];
    await j("PUT", "/api/sessions/" + sessionId, { messages: extra });
    const snapsBefore = (await j("GET", "/api/sessions/" + sessionId + "/snapshots")).data?.snapshots?.length ?? 0;

    const noToken = await jt("POST", "/api/backup/restore", { id: sessionId }, "");
    ok("没令牌不给恢复", noToken.status === 403, "status=" + noToken.status);

    const restored = await jt("POST", "/api/backup/restore", { id: sessionId }, token);
    ok("从备份恢复成功", restored.status === 200 && restored.data?.ok === true, JSON.stringify(restored.data || {}).slice(0, 100));
    const now = (await j("GET", "/api/sessions/" + sessionId)).data;
    ok("恢复后回到备份那一版（3 条）", now?.messages?.length === 3, "msgs=" + now?.messages?.length);
    ok("LOCAL-ONLY 被覆盖掉", !(now?.messages || []).some((m) => m.content === "LOCAL-ONLY"));

    const snapsAfter = (await j("GET", "/api/sessions/" + sessionId + "/snapshots")).data?.snapshots?.length ?? 0;
    ok("恢复前先留了历史版本", snapsAfter > snapsBefore, snapsBefore + " -> " + snapsAfter);

    const missing = await jt("POST", "/api/backup/restore", { id: "aaaaaa-00000000" }, token);
    ok("备份里没有的 id 返回 404", missing.status === 404, "status=" + missing.status);
  }

  const disabled = await j("POST", "/api/backup", { enabled: false, dir: "" });
  ok("能关掉并清空目录", disabled.status === 200 && disabled.data?.config?.enabled === false && disabled.data?.config?.dir === "");
} catch (e) {
  fail += 1;
  console.log("  FAIL 探针异常: " + (e?.stack ?? e));
} finally {
  if (sessionId) await fetch(BASE + "/api/sessions/" + sessionId, { method: "DELETE" }).catch(() => {});
  await rm(TARGET, { recursive: true, force: true }).catch(() => {});
  await fetch(BASE + "/api/backup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ enabled: false, dir: "" }),
  }).catch(() => {});
  const st = await j("GET", "/api/backup").catch(() => ({}));
  console.log("\n复位：备份已关闭，测试会话与临时目录已清理（" + (st.data?.sessions ?? "?") + " 个会话保留）");
}

console.log("\n== 结果: " + pass + " 通过 / " + fail + " 失败 ==\n");
process.exit(fail ? 1 : 0);

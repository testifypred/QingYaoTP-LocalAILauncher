/**
 * 版本号探针（纯接口 + 读文件，不用模型、不碰会话）
 *
 *   node probe-version.mjs [base] [app.mjs 路径]
 *
 * 覆盖：/api/version 的版本、构建来源、启动时刻是否自洽；/api/state 是否同源；
 *       package.json 与 app.mjs 的常量是否一致（防「只改了代码没改包描述」）。
 * 这是一条「对账」探针：版本号写错的代价是出问题时分不清跑的是哪一版。
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const BASE = process.argv[2] || "http://127.0.0.1:8099";
const APP_MJS = process.argv[3] || "D:\\LocalModels\\server\\app.mjs";
const PKG = path.join(path.dirname(APP_MJS), "package.json");

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) { pass++; console.log("  ok   " + n + (d ? "  [" + d + "]" : "")); } else { fail++; console.log("  FAIL " + n + "  " + d); } };
const j = async (p) => {
  const r = await fetch(BASE + p);
  const t = await r.text();
  let data = null; try { data = JSON.parse(t); } catch {}
  return { status: r.status, data, text: t };
};

console.log("\n== 目标 " + BASE + " / 源码 " + APP_MJS + " ==\n");

const v = await j("/api/version");
ok("/api/version 可用", v.status === 200 && v.data && typeof v.data.version === "string", "HTTP " + v.status);
const ver = v.data || {};
ok("版本号是 semver", /^\d+\.\d+\.\d+$/.test(String(ver.version || "")), ver.version);
ok("构建来源是 git 或 mtime", ver.buildSource === "git" || ver.buildSource === "mtime", ver.buildSource);
ok("取自 git 时短哈希合法", ver.buildSource !== "git" || /^[0-9a-f]{7,}$/.test(String(ver.commit || "")), String(ver.commit));
ok("有提交/打包时间可对账", Boolean(ver.commitAt || ver.builtAt), String(ver.commitAt || ver.builtAt));
ok("git 构建带 dirty 标记", ver.buildSource !== "git" || typeof ver.dirty === "boolean", String(ver.dirty));
const started = Date.parse(ver.startedAt || "");
ok("启动时刻可解析且不在未来", Number.isFinite(started) && started <= Date.now() + 60_000, String(ver.startedAt));
ok("报了 node 版本与端口", /^v\d+\./.test(String(ver.node || "")) && Number(ver.port) > 0, ver.node + " / " + ver.port);
ok("版本接口不泄漏本地令牌", !("localToken" in ver) && !v.text.includes("localToken"));

const st = await j("/api/state");
ok("/api/state 带同一个版本号", st.data?.version === ver.version, st.data?.version + " vs " + ver.version);
ok("/api/state 的 build.commit 与 /api/version 一致", (st.data?.build?.commit || "") === (ver.commit || ""));

const pkg = JSON.parse(readFileSync(PKG, "utf8"));
ok("package.json 的 version 与接口一致", pkg.version === ver.version, "pkg=" + pkg.version);
const src = readFileSync(APP_MJS, "utf8");
const hit = src.match(/const APP_VERSION = "([^"]+)"/);
ok("app.mjs 的 APP_VERSION 与接口一致", Boolean(hit) && hit[1] === ver.version, hit ? hit[1] : "找不到常量");
ok("版本号只在一处定义", (src.match(/const APP_VERSION = /g) || []).length === 1);

console.log("\nRESULT " + pass + "/" + (pass + fail));
process.exit(fail ? 1 : 0);

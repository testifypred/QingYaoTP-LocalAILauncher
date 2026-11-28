import { readFileSync } from "node:fs";
// v1.11.2 发布脚本（用法：$env:GH_TOKEN='<有 Contents: Read/Write 的 PAT>'; node create-release-v1.11.2.mjs）
// 需要：tag v1.11.2 已推到远端；附件用本地 dist 产物。token 只在进程环境里，不写盘、不回显。
const TOKEN = process.env.GH_TOKEN;
if (!TOKEN) { console.error("NO_TOKEN: 先设置环境变量 GH_TOKEN（不要写在命令行历史里）"); process.exit(2); }
const OWNER = "testifypred";
const REPO = "QingYaoTP-LocalAILauncher";
const TAG = "v1.11.2";
const RELEASE_NAME = "v1.11.2 — 界面第二轮重做（Fluent 深色 / 暖纸白 + 思源宋体 + 图标统一）";
const body = readFileSync("D:\\LocalModels\\.github\\RELEASE-v1.11.2.md", "utf8");
const headers = { authorization: "Bearer " + TOKEN, accept: "application/vnd.github+json", "user-agent": "qytp-release-script", "x-github-api-version": "2022-11-28" };
let id = null, url = "";
const chk = await fetch("https://api.github.com/repos/" + OWNER + "/" + REPO + "/releases/tags/" + TAG, { headers });
if (chk.ok) { const j = await chk.json(); id = j.id; url = j.html_url; console.log("release already exists:", url); }
else {
  const r = await fetch("https://api.github.com/repos/" + OWNER + "/" + REPO + "/releases", {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ tag_name: TAG, name: RELEASE_NAME, body, draft: false, prerelease: false }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { console.error("create release failed", r.status, JSON.stringify(j).slice(0, 400)); process.exit(1); }
  id = j.id; url = j.html_url;
  console.log("created:", url);
}
const assets = [
  ["D:\\LocalModels\\dist\\QingYaoTP-AILauncher-v1.11.2.zip", "QingYaoTP-AILauncher-v1.11.2.zip"],
  ["D:\\LocalModels\\dist\\QingYaoTP-AILauncher-v1.6.0-vision-pack.zip", "QingYaoTP-AILauncher-v1.6.0-vision-pack.zip"],
];
// 已存在同名资产先删（GitHub 同名二次上传会 422）
const cur = await (await fetch("https://api.github.com/repos/" + OWNER + "/" + REPO + "/releases/" + id + "/assets", { headers })).json().catch(() => []);
for (const a of Array.isArray(cur) ? cur : []) {
  if (assets.some(([, n]) => n === a.name)) {
    const d = await fetch("https://api.github.com/repos/" + OWNER + "/" + REPO + "/releases/assets/" + a.id, { method: "DELETE", headers });
    console.log("deleted old asset", a.name, d.status);
  }
}
for (const [p, name] of assets) {
  const buf = readFileSync(p);
  const u = "https://uploads.github.com/repos/" + OWNER + "/" + REPO + "/releases/" + id + "/assets?name=" + encodeURIComponent(name);
  const r = await fetch(u, { method: "POST", headers: { ...headers, "content-type": "application/zip", "content-length": String(buf.length) }, body: buf });
  const j = await r.json().catch(() => ({}));
  console.log("asset", name, r.status, r.ok ? (j.state + " " + j.size + "B") : JSON.stringify(j).slice(0, 300));
}
const f = await (await fetch("https://api.github.com/repos/" + OWNER + "/" + REPO + "/releases/tags/" + TAG, { headers })).json();
console.log("FINAL", f.html_url, (f.assets || []).map((a) => a.name + ":" + a.size + ":" + (a.digest || "-")).join(" | "));

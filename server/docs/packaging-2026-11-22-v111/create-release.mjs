import { readFileSync } from "node:fs";
const TOKEN = process.env.GH_TOKEN;
if (!TOKEN) { console.error("NO_TOKEN"); process.exit(2); }
const OWNER = "testifypred";
const REPO = "QingYaoTP-LocalAILauncher";
const TAG = "v1.11.0";
const body = readFileSync("D:\\LocalModels\\.github\\RELEASE-v1.11.0.md", "utf8");
const headers = { authorization: "Bearer " + TOKEN, accept: "application/vnd.github+json", "user-agent": "qytp-release-script", "x-github-api-version": "2022-11-28" };
let id = null, url = "";
const chk = await fetch("https://api.github.com/repos/" + OWNER + "/" + REPO + "/releases/tags/" + TAG, { headers });
if (chk.ok) { const j = await chk.json(); id = j.id; url = j.html_url; console.log("release already exists:", url); }
else {
  const r = await fetch("https://api.github.com/repos/" + OWNER + "/" + REPO + "/releases", {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ tag_name: TAG, name: "v1.11.0 — 体验与稳定性", body, draft: false, prerelease: false }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { console.error("create release failed", r.status, JSON.stringify(j).slice(0, 400)); process.exit(1); }
  id = j.id; url = j.html_url;
  console.log("created:", url);
}
const assets = [
  ["D:\\LocalModels\\dist\\QingYaoTP-AILauncher-v1.11.0.zip", "QingYaoTP-AILauncher-v1.11.0.zip"],
  ["D:\\LocalModels\\dist\\QingYaoTP-AILauncher-v1.6.0-vision-pack.zip", "QingYaoTP-AILauncher-v1.6.0-vision-pack.zip"],
];
for (const [p, name] of assets) {
  const buf = readFileSync(p);
  const u = "https://uploads.github.com/repos/" + OWNER + "/" + REPO + "/releases/" + id + "/assets?name=" + encodeURIComponent(name);
  const r = await fetch(u, { method: "POST", headers: { ...headers, "content-type": "application/zip", "content-length": String(buf.length) }, body: buf });
  const j = await r.json().catch(() => ({}));
  console.log("asset", name, r.status, r.ok ? (j.state + " " + j.size + "B") : JSON.stringify(j).slice(0, 300));
}
const f = await (await fetch("https://api.github.com/repos/" + OWNER + "/" + REPO + "/releases/tags/" + TAG, { headers })).json();
console.log("FINAL", f.html_url, (f.assets || []).map((a) => a.name + ":" + a.size).join(" | "));

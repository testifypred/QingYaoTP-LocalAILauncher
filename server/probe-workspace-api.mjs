const base = "http://127.0.0.1:8099";
async function call(method, url, body) {
  const r = await fetch(base + url, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j };
}
let pass = 0, fail = 0;
const check = (n, c, d = "") => { if (c) { pass++; console.log("ok   " + n + (d ? "  [" + d + "]" : "")); } else { fail++; console.log("FAIL " + n + "  " + d); } };

let r = await call("GET", "/api/workspace/list?dir=");
check("列出工作区根目录", r.status === 200 && Array.isArray(r.j.entries), "entries=" + (r.j?.entries?.length));
r = await call("POST", "/api/workspace/save", { path: "smoke/hello.txt", content: "你好 workspace" });
check("新建文件", r.status === 200 && r.j.path === "smoke/hello.txt", JSON.stringify(r.j));
r = await call("GET", "/api/workspace/read?path=" + encodeURIComponent("smoke/hello.txt"));
check("读取内容", r.status === 200 && r.j.content === "你好 workspace", r.j?.content);
r = await call("POST", "/api/workspace/rename", { from: "smoke/hello.txt", to: "smoke/hi.txt" });
check("重命名", r.status === 200 && r.j.path === "smoke/hi.txt");
r = await call("GET", "/api/workspace/read?path=" + encodeURIComponent("smoke/hi.txt"));
check("改名后可读", r.status === 200 && r.j.content.includes("workspace"));
r = await call("GET", "/api/workspace/read?path=" + encodeURIComponent("../app.mjs"));
check("越界读取被拒", r.status === 400, r.j?.error?.message);
r = await call("POST", "/api/workspace/save", { path: "../../evil.txt", content: "x" });
check("越界写入被拒", r.status === 400, r.j?.error?.message);
r = await call("POST", "/api/workspace/delete", { path: "smoke/hi.txt" });
check("删除文件", r.status === 200 && r.j.ok === true);
r = await call("POST", "/api/workspace/delete", { path: "smoke" });
check("删除空目录", r.status === 200 && r.j.ok === true);
console.log("\nRESULT " + pass + "/" + (pass + fail));
process.exit(fail ? 1 : 0);

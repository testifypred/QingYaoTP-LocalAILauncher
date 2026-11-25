// 看门狗探针用的假服务：只实现 /health、/api/state、/api/shutdown，验证启动器的进程级自愈
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const pidFile = path.join(dir, "server.pid");
const port = Number(process.env.PORT || 8399);

const server = http.createServer((req, res) => {
  const url = String(req.url || "").split("?")[0];
  if (url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ status: "ok" }));
  }
  if (url === "/api/state") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ localToken: "probe-token", dir }));
  }
  if (url === "/api/shutdown") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    setTimeout(() => process.exit(0), 100);
    return;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end("<html><body>probe</body></html>");
});

server.listen(port, "127.0.0.1", () => {
  fs.writeFileSync(pidFile, String(process.pid));
  console.log("fake app listening " + port + " pid " + process.pid);
});

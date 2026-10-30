
import fs from "node:fs";
import path from "node:path";

const BASE = "https://hf-mirror.com/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main/";
const DEST = "D:\\LocalModels\\asr";
fs.mkdirSync(DEST, { recursive: true });

async function head(name) {
  const r = await fetch(BASE + name, { method: "HEAD", headers: { "User-Agent": "Mozilla/5.0" }, redirect: "follow" });
  return { status: r.status, len: Number(r.headers.get("content-length") || 0) };
}

async function download(name) {
  const out = path.join(DEST, name);
  const { len } = await head(name);
  let have = fs.existsSync(out) ? fs.statSync(out).size : 0;
  console.log(JSON.stringify({ ev: "start", name, totalMB: +(len/1048576).toFixed(1), haveMB: +(have/1048576).toFixed(1) }));
  const CH = 4 * 1048576;
  let fails = 0;
  while (have < len) {
    const end = Math.min(have + CH - 1, len - 1);
    try {
      const r = await fetch(BASE + name, {
        headers: { Range: "bytes=" + have + "-" + end, "User-Agent": "Mozilla/5.0" },
        redirect: "follow",
      });
      if (r.status !== 206 && r.status !== 200) throw new Error("HTTP " + r.status);
      const buf = Buffer.from(await r.arrayBuffer());
      if (have === 0 && r.status === 200) fs.writeFileSync(out, buf);
      else fs.appendFileSync(out, buf);
      have += buf.length;
      fails = 0;
      console.log(JSON.stringify({ ev: "chunk", mb: +(have/1048576).toFixed(1), pct: +(have/len*100).toFixed(1) }));
    } catch (e) {
      fails++;
      console.log(JSON.stringify({ ev: "retry", at: +(have/1048576).toFixed(1), fails, err: String(e.message).slice(0,120) }));
      if (fails > 8) throw e;
      await new Promise(r => setTimeout(r, 2000 * fails));
    }
  }
  console.log(JSON.stringify({ ev: "done", name, mb: +(have/1048576).toFixed(1) }));
}

for (const f of ["tokens.txt", "model.int8.onnx"]) {
  await download(f);
}

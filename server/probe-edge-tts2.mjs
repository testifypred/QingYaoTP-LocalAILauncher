/**
 * Edge 神经语音直连测试（带 Sec-MS-GEC 签名与浏览器请求头）。
 *   node probe-edge-tts2.mjs [音色] [输出mp3]
 */
import { writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import WebSocket from "ws";

const VOICE = process.argv[2] ?? "zh-CN-XiaoxiaoNeural";
const OUT = process.argv[3] ?? "D:/LocalModels/server/docs/edge-test.mp3";
const TEXT = process.argv[4] ?? "这句话是用边缘神经语音合成的，应该比离线模型自然得多。";

const TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const TRUSTED = TOKEN;
const CHROMIUM_VERSION = "130.0.2849.68";
const WIN_EPOCH = 11644473600;

/** 微软 2024 年加的防滥用签名：5 分钟一个时间片，SHA256 后大写十六进制 */
function secMsGec() {
  const now = Math.floor(Date.now() / 1000) + WIN_EPOCH;
  const rounded = now - (now % 300);
  const ticks = BigInt(rounded) * 10000000n; // 秒 → 100ns
  return createHash("sha256").update(`${ticks}${TRUSTED}`).digest("hex").toUpperCase();
}

const connId = randomUUID().replace(/-/g, "");
const url =
  `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1` +
  `?TrustedClientToken=${TOKEN}&Sec-MS-GEC=${secMsGec()}&Sec-MS-GEC-Version=1-${CHROMIUM_VERSION}` +
  `&ConnectionId=${connId}`;

const ssml = (text, voice, ratePercent = 0) => {
  const esc = text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));
  const rate = ratePercent >= 0 ? `+${ratePercent}%` : `${ratePercent}%`;
  return `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'>` +
    `<voice name='${voice}'><prosody pitch='+0Hz' rate='${rate}' volume='+0%'>${esc}</prosody></voice></speak>`;
};

const ws = new WebSocket(url, {
  headers: {
    Pragma: "no-cache",
    "Cache-Control": "no-cache",
    Origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
    "User-Agent":
      `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM_VERSION} Safari/537.36 Edg/${CHROMIUM_VERSION}`,
    "Accept-Encoding": "gzip, deflate, br",
    "Accept-Language": "en-US,en;q=0.9",
  },
});
ws.binaryType = "nodebuffer";

const audio = [];
const finished = new Promise((resolve) => {
  ws.on("open", () => {
    const reqId = randomUUID().replace(/-/g, "");
    ws.send(
      `X-Timestamp:${new Date().toString()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
        JSON.stringify({
          context: {
            synthesis: {
              audio: {
                metadataoptions: { sentenceBoundaryEnabled: "false", wordBoundaryEnabled: "false" },
                outputFormat: "audio-24khz-48kbitrate-mono-mp3",
              },
            },
          },
        }),
    );
    ws.send(
      `X-RequestId:${reqId}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${new Date().toString()}\r\nPath:ssml\r\n\r\n` +
        ssml(TEXT, VOICE),
    );
  });
  ws.on("message", (data) => {
    if (typeof data === "string") {
      if (data.includes("Path:turn.end")) {
        ws.close();
        resolve();
      }
      return;
    }
    const buf = Buffer.from(data);
    const headerLen = buf.readUInt16BE(0);
    const header = buf.subarray(2, 2 + headerLen).toString("ascii");
    if (!header.includes("Path:audio")) return;
    audio.push(buf.subarray(2 + headerLen));
  });
  ws.on("error", (e) => {
    console.error("错误:", e.message);
    resolve();
  });
  ws.on("close", (code, reason) => {
    if (code !== 1000) console.error("关闭:", code, reason?.toString());
    resolve();
  });
  setTimeout(() => { try { ws.close(); } catch {} resolve(); }, 20000);
});

await finished;
const mp3 = Buffer.concat(audio);
console.log(`音色 ${VOICE}：${audio.length} 帧，${(mp3.length / 1024).toFixed(1)} KB`);
if (mp3.length) {
  await writeFile(OUT, mp3);
  console.log("保存:", OUT);
} else {
  console.log("没拿到音频");
  process.exit(1);
}

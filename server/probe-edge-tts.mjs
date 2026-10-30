/**
 * 验证 Edge 神经语音（免费、无需 key）能否直连。
 * 用 Node 自带的 WebSocket，不装任何依赖。
 *
 *   node probe-edge-tts.mjs [音色] [输出mp3]
 */
import { writeFile } from "node:fs/promises";

const VOICE = process.argv[2] ?? "zh-CN-XiaoxiaoNeural";
const OUT = process.argv[3] ?? "D:/LocalModels/server/docs/edge-tts-test.mp3";
const TEXT = "这句话是用边缘神经语音合成的，应该比离线模型自然得多。";

const TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const connId = crypto.randomUUID().replace(/-/g, "");
const url =
  `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1` +
  `?TrustedClientToken=${TOKEN}&ConnectionId=${connId}`;

const CHUNK = 2048;

function ssml(text, voice, ratePercent = 0) {
  const esc = text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));
  const rate = ratePercent >= 0 ? `+${ratePercent}%` : `${ratePercent}%`;
  return (
    `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'>` +
    `<voice name='${voice}'><prosody pitch='+0Hz' rate='${rate}' volume='+0%'>${esc}</prosody></voice></speak>`
  );
}

function textFrame(path, contentType, body) {
  return `X-Timestamp:${new Date().toISOString()}\r\n` +
    `Content-Type:${contentType}\r\n` +
    `Path:${path}\r\n\r\n${body}`;
}

const ws = new WebSocket(url);
ws.binaryType = "arraybuffer";
const audio = [];
let done;
const finished = new Promise((r) => (done = r));

ws.addEventListener("open", () => {
  const reqId = crypto.randomUUID().replace(/-/g, "");
  ws.send(textFrame("speech.config", "application/json; charset=utf-8",
    JSON.stringify({ context: { synthesis: { audio: {
      metadataoptions: { sentenceBoundaryEnabled: "false", wordBoundaryEnabled: "false" },
      outputFormat: "audio-24khz-48kbitrate-mono-mp3",
    } } } })));
  const ssmlText = ssml(TEXT, VOICE);
  const head = `X-RequestId:${reqId}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${new Date().toISOString()}\r\nPath:ssml\r\n\r\n`;
  ws.send(head + ssmlText);
});

ws.addEventListener("message", async (ev) => {
  if (typeof ev.data === "string") {
    if (ev.data.includes("Path:turn.end")) {
      ws.close();
      done();
    }
    return;
  }
  const buf = Buffer.from(ev.data);
  // 二进制帧：前 2 字节是头长度（大端），随后是头文本，头之后才是音频
  if (buf.length < 2) return;
  const headerLen = buf.readUInt16BE(0);
  const header = buf.subarray(2, 2 + headerLen).toString("ascii");
  if (!header.includes("Path:audio")) return;
  audio.push(buf.subarray(2 + headerLen));
});

ws.addEventListener("error", (e) => {
  console.error("WebSocket 错误:", e.message ?? e);
  done();
});
ws.addEventListener("close", (e) => {
  if (e.code !== 1000 && e.code !== 1005) console.error("关闭码:", e.code, e.reason);
  done();
});

const timeout = setTimeout(() => {
  console.error("超时 15s");
  try { ws.close(); } catch {}
  done();
}, 15000);
await finished;
clearTimeout(timeout);

const mp3 = Buffer.concat(audio);
console.log(`音色 ${VOICE}：收到 ${audio.length} 个音频帧，共 ${(mp3.length / 1024).toFixed(1)} KB`);
if (mp3.length > 0) {
  await writeFile(OUT, mp3);
  console.log("前 4 字节:", [...mp3.subarray(0, 4)].map((b) => b.toString(16).padStart(2, "0")).join(" "));
  console.log("已保存:", OUT);
} else {
  console.log("没有拿到音频");
  process.exit(1);
}

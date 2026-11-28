import WebSocket from "ws";
import fs from "node:fs";
import { spawn } from "node:child_process";

const OUT = "D:/LocalModels/server/docs/ui-redesign";
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const CDP = "http://127.0.0.1:9333";
const BASE = process.env.UISHOT_BASE || "http://127.0.0.1:8099";
const ud = process.env.TEMP + "/edge-uishot-" + Date.now();
const edge = spawn(EDGE, ["--headless=new","--no-sandbox","--remote-debugging-port=9333","--remote-debugging-address=127.0.0.1","--user-data-dir="+ud,"--window-size=1440,900","--no-first-run","--no-default-browser-check"], { stdio: "ignore" });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let up = false;
for (let i=0;i<180;i++){ await sleep(1000); try { await fetch(CDP+"/json/version"); up = true; break; } catch {} }
if (!up) { console.log("CDP DOWN"); edge.kill(); process.exit(1); }
await fetch(CDP+"/json/new?"+BASE+"/", { method: "PUT" });
let page = null;
for (let i=0;i<90;i++){ await sleep(500); const list = await (await fetch(CDP+"/json/list")).json(); page = list.find(t=>t.type==="page" && String(t.url).startsWith(BASE)); if (page) break; }
if (!page) { console.log("PAGE NOT FOUND"); edge.kill(); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate:false });
await new Promise((r,j)=>{ ws.once("open", r); ws.once("error", j); });
let id=0; const pend=new Map();
ws.on("message", raw=>{ const m=JSON.parse(raw.toString()); if(m.id&&pend.has(m.id)){ pend.get(m.id)(m); pend.delete(m.id);} });
const send=(method,params={})=>new Promise(res=>{ const i=++id; pend.set(i,res); ws.send(JSON.stringify({id:i,method,params})); });
const ev=async(expr)=>{ const r=await send("Runtime.evaluate",{expression:expr,returnByValue:true,awaitPromise:true}); if(r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text); return r.result?.result?.value; };
await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width:1440, height:900, deviceScaleFactor:1, mobile:false });
await sleep(3000);
await ev("(() => { try { if (typeof newChat === 'function') newChat(); } catch {} return true; })()");
await sleep(600);
const variants = JSON.parse(fs.readFileSync(OUT + "/variants.json", "utf8"));
for (const v of variants) {
  const css = v.cssFile ? fs.readFileSync(OUT + "/" + v.cssFile, "utf8") : "";
  await ev("(() => { const o=document.getElementById('__shot'); if(o) o.remove(); document.documentElement.dataset.theme=" + JSON.stringify(v.theme) + "; return true; })()");
  if (css) await ev("(() => { const s=document.createElement('style'); s.id='__shot'; s.textContent=" + JSON.stringify(css) + "; document.documentElement.appendChild(s); return true; })()");
  await sleep(700);
  const r = await send("Page.captureScreenshot", { format:"png" });
  fs.writeFileSync(OUT + "/" + v.name + ".png", Buffer.from(r.result.data, "base64"));
  console.log("shot", v.name);
}
const CLIPS = [
  ["clip-topbar", { x: 1000, y: 0, width: 440, height: 58, scale: 3 }],
  ["clip-composer", { x: 455, y: 520, width: 300, height: 100, scale: 3 }],
  ["clip-send", { x: 1090, y: 520, width: 180, height: 100, scale: 4 }],
  ["clip-hero", { x: 560, y: 280, width: 520, height: 260, scale: 2 }],
];
for (const [name, clip] of CLIPS) {
  const r = await send("Page.captureScreenshot", { format:"png", clip: { x: clip.x, y: clip.y, width: clip.width, height: clip.height, scale: clip.scale } });
  fs.writeFileSync(OUT + "/" + name + ".png", Buffer.from(r.result.data, "base64"));
  console.log("clip", name);
}
ws.close(); edge.kill();
try { fs.rmSync(ud, { recursive:true, force:true }); } catch {}
console.log("done");

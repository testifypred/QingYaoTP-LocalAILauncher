import WebSocket from "ws";
import fs from "node:fs";
import { spawn } from "node:child_process";
const OUT="D:/LocalModels/server/docs/ui-redesign";
const EDGE="C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const CDP="http://127.0.0.1:9333", BASE=process.env.UISHOT_BASE||"http://127.0.0.1:8099";
const ud=process.env.TEMP+"/edge-chat-"+Date.now();
const edge=spawn(EDGE,["--headless=new","--no-sandbox","--remote-debugging-port=9333","--remote-debugging-address=127.0.0.1","--user-data-dir="+ud,"--window-size=1440,900","--no-first-run"],{stdio:"ignore"});
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
for(let i=0;i<90;i++){await sleep(1000);try{await fetch(CDP+"/json/version");break}catch{}}
try { await fetch(BASE+"/api/onboarding",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({done:true,readmeShown:true})}); } catch {}
await fetch(CDP+"/json/new?"+BASE+"/",{method:"PUT"});
let page=null;for(let i=0;i<60;i++){await sleep(500);const l=await(await fetch(CDP+"/json/list")).json();page=l.find(t=>t.type==="page"&&String(t.url).startsWith(BASE));if(page)break;}
const ws=new WebSocket(page.webSocketDebuggerUrl,{perMessageDeflate:false});
await new Promise((r,j)=>{ws.once("open",r);ws.once("error",j)});
let id=0;const pend=new Map();ws.on("message",raw=>{const m=JSON.parse(raw.toString());if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id)}});
const send=(method,params={})=>new Promise(res=>{const i=++id;pend.set(i,res);ws.send(JSON.stringify({id:i,method,params}))});
const ev=async(e)=>{const r=await send("Runtime.evaluate",{expression:e,returnByValue:true,awaitPromise:true});return r.result?.result?.value};
await send("Page.enable");await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride",{width:1440,height:900,deviceScaleFactor:1,mobile:false});
await sleep(2500);
for (const theme of ["dark","light"]) {
  await ev("document.documentElement.dataset.theme="+JSON.stringify(theme));
  await sleep(300);
  const r = await send("Page.captureScreenshot",{format:"png"});
  fs.writeFileSync(OUT+"/20-chat-"+theme+"-empty.png",Buffer.from(r.result.data,"base64"));
  console.log("shot empty",theme);
}
await ev("document.documentElement.dataset.theme=\"dark\"");
await ev("(()=>{const q=document.getElementById('q'); q.value='用一句话介绍你自己'; q.dispatchEvent(new Event('input',{bubbles:true})); document.getElementById('send').click(); return true;})()");
for (let i=0;i<120;i++){ await sleep(500); const busy=await ev("document.getElementById('send').disabled"); if(!busy) break; }
await sleep(800);
for (const theme of ["dark","light"]) {
  await ev("document.documentElement.dataset.theme="+JSON.stringify(theme));
  await sleep(300);
  const r = await send("Page.captureScreenshot",{format:"png"});
  fs.writeFileSync(OUT+"/21-chat-"+theme+".png",Buffer.from(r.result.data,"base64"));
  console.log("shot chat",theme);
}
ws.close();edge.kill();

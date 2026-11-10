# 模型下载进度条（顶栏 · 可折叠）· 契约（2026-11-10）

> 需求（用户原话）：软件下载模型时加下载进度条，挂在顶栏，可折叠（收起），显示后台下载速度、总量、余量、预计时间。
> 现状：后端 /api/download/state 已有 active/done/pct/speedMBs/etaSec/receivedMB/totalMB，但**只在首启弹窗里**有一行文字；
> 用户关掉弹窗、或从设置/模型页开始下载后，看不到任何进度，更不知道「还剩多少、要多久」。

## 一、文件所有权（只改自己那份）

| 谁 | 可写 |
|---|---|
| Lead | server/app.mjs（已加字段）、集成/dist/提交/文档 |
| ui-download | server/app.html |
| probe-download | server/probe-download-ui.mjs（新建）、server/docs/run-full.ps1（加一行驱动） |

## 二、后端契约（Lead 已实现，可直接用）

GET /api/download/state（只读、无令牌）→ 字段：

~~~jsonc
{
  "active": true, "done": false, "id": "qwen25-05b-q4km", "file": "qwen2.5-0.5b-instruct-q4_k_m.gguf",
  "received": 12345678, "total": 491520000,          // 字节
  "receivedBytes": 12345678, "totalBytes": 491520000, "remainingBytes": 479174322,
  "receivedMB": 11.8, "totalMB": 468.8, "remainingMB": 457.0,
  "pct": 3,                                            // 0–100 整数
  "speedMBs": 3.21, "speedBytes": 3365929,
  "etaSec": 148,                                       // 未知时为 null
  "error": null,
  "elapsedSec": 12,                                    // 本次已用秒
  "startedAt": 1788..., "finishedAt": 0, "updatedAt": 1788...,   // 毫秒时间戳
  "lastDataAt": 1788..., "stallSec": 0,                 // 距上一条数据的秒数
  "elapsedTotalSec": 0                                  // 完成后总用时（未完成 = 0）
}
~~~

- 空闲时：active=false, done=false, error=null, total=0, pct=0。
- 完成：done=true, finishedAt=..., pct=100, elapsedTotalSec>0（done 会一直保持，直到下一次 start 才重置）。
- 失败/取消：active=false, error="…"（取消时 error="已取消"）。
- 速度只取最近 4 秒样本；stallSec > 2.5 表示卡住。
- 已有接口不变：POST /api/download/start（令牌）、POST /api/download/cancel（令牌）、GET /api/download/catalog。

## 三、页面契约（ui-download 实现，只改 app.html）

### 1) 顶栏收起态（常驻，占用尽量小）

在 .topbar 里 #status / #totals 之后插入：

~~~html
<div id="dlWrap" class="dlWrap" hidden>
  <button id="dlChip" class="ghost dlChip" type="button" aria-expanded="false" title="模型下载：点击展开详情">
    <span id="dlChipIco" aria-hidden="true">↓</span>
    <span id="dlChipText">下载 0%</span>
    <span id="dlChipBar" class="dlChipBar"><i id="dlChipFill"></i></span>
    <span id="dlChipSpeed">—</span>
  </button>
</div>
~~~

- 下载中：#dlChipText = 「下载 42%」；#dlChipSpeed = 「3.2 MB/s」（stallSec>2.5 时改「连接中…」并把速度藏起来）；#dlChipFill 宽度 = pct%。
- 完成：#dlChipIco=✓、#dlChipText=「下载完成」、速度位显示总量（如 468.8 MB）。
- 失败：#dlChipIco=!、#dlChipText=「下载失败」（title 写错误原因）。
- 空闲：整个 #dlWrap 加 hidden（不占位）。
- 窄窗（<=1080px CSS 宽）：隐藏 #dlChipSpeed，#dlChip 最大宽 150px，文字不换行、省略号。

### 2) 展开态（详情面板）

~~~html
<section id="dlPanel" class="dlPanel" hidden aria-label="模型下载详情">
  <div class="dlHead"><span class="dlTitle">模型下载</span><span id="dlPct">0%</span>
    <button id="dlCollapse" class="dlX" type="button" title="收起（继续在后台下载）">收起</button></div>
  <div class="dlBar"><i id="dlFill"></i></div>
  <div class="dlFile" id="dlFile">—</div>
  <div class="dlNums">
    <span>已下载 <b id="dlReceived">—</b> / 总量 <b id="dlTotal">—</b></span>
    <span>剩余 <b id="dlLeft">—</b></span>
  </div>
  <div class="dlNums">
    <span>速度 <b id="dlSpeed">—</b></span>
    <span>预计剩余 <b id="dlEta">—</b></span>
    <span>已用 <b id="dlElapsed">—</b></span>
  </div>
  <div class="dlFoot"><span id="dlNote">后台下载中，可以继续聊天</span>
    <span class="spacer"></span>
    <button id="dlCancel" class="ghost danger" type="button">取消下载</button></div>
</section>
~~~

- 位置：position:fixed，右 18px，top = header.getBoundingClientRect().bottom + 8（JS 渲染/resize 时写 CSS 变量 --dl-top，参照现有 #ctxPanel 的做法），宽 min(360px, calc(100vw - 24px))，z-index 与 #ctxPanel 同层（45）。
- 展开/收起：点 #dlChip 切换；点 #dlCollapse 收起；localStorage["localai.dlPanel"] 记 "1"/"0"（默认 "1"）；**收起后下载继续**。
- 数字格式：
  - 字节用现有 fmtSize()（>0.1GB 显示 GB，否则 MB）。
  - 速度 = fmtSize(speedBytes) + /s。
  - ETA：<60s → 「约 45 秒」；<3600s → 「约 3 分 20 秒」；否则「约 1 小时 5 分」；etaSec==null → 「—」。
  - 已用：m:ss 或 h:mm:ss。
  - 总量未知（totalBytes=0）→ 进度条 class indet（indeterminate），百分比显示「—」。
- 完成/失败/取消：chip 与面板保留 **20 秒**后自动隐藏；完成时 #dlNote = 「已完成 · 用时 Xs · 可在「模型」菜单里选择」，隐藏 #dlCancel；失败时 #dlNote = 错误文案（红色），隐藏 #dlCancel。
- 轮询：单定时器；active 时 **1000ms**，其余 **4000ms**；document.hidden 时暂停，visibilitychange 回来立刻补一次；页面加载先立即取一次（刷新后能接上后台下载）。
- 完成/失败**转场**时调 showToast（完成 ok、失败 err），但如果首启弹窗开着（#firstModal 未 hidden）就不 toast，避免重复。
- 不要把现有首启弹窗的下载 UI 删掉（它是首启引导的一部分）；顶栏只是「随时可看」的另一入口。

### 3) 不得破坏

- 现有 id/功能全保留；.topbar 仍可换行、175% 缩放窄窗不横向溢出（probe-ui-debug 的窄窗断言会查 header button 高度 ≤44 且 body 不溢出）。
- 只用现有 CSS 变量与组件风格（--panel/--line/--cyan/--accent/--mono 等），亮/暗两套主题都要好看。
- 零依赖、无未捕获 JS 异常、文件名等动态文本用 textContent 或转义。

## 四、探针契约（probe-download 实现）

新建 server/probe-download-ui.mjs（CDP，复用 probe-ui-debug 的连接/ok() 写法）：

1. **空闲**：真实服务（没下载）→ #dlWrap 有 hidden，#dlPanel 有 hidden。
2. **下载中（stub）**：把 window.fetch 对 /api/download/state 的响应替换成假数据（其余透传），构造 active 状态（pct 42、speedBytes 3.2MB/s、total 468.8MB、remaining、etaSec 148），等 1.2s：
   - chip 可见、文本含 42%、速度文本含 MB/s、#dlChipFill 宽度 > 0；
   - 面板默认展开（localStorage 无值时）、#dlPct 42%、#dlTotal 含 468.8、#dlLeft 含剩余、#dlEta 含「分」或「秒」、#dlCancel 可见。
3. **收起**：点 #dlCollapse → 面板 hidden、chip 仍在、localStorage["localai.dlPanel"]==="0"；再点 chip → 面板重新出现（"1"）。
4. **卡住**：stub stallSec=9 → chip 文本/速度处显示「连接中…」。
5. **完成**：stub done → chip 文本含「完成」，panel 里 #dlCancel 隐藏、note 含「已完成」。
6. **失败**：stub error → chip 文本含「失败」，note 含错误文案。
7. **取消**：stub active + 拦截 /api/download/cancel 计数 → 点 #dlCancel 恰好调用 1 次且带 x-local-token。
8. **窄窗 850px**：stub active → body 不横向溢出，chip 不竖排（高度 ≤44）。
9. **无未捕获 JS 异常**。

要求：不真的下载模型、不调 start、不弹真实窗口；stub 之后恢复 window.fetch；探针结束把页面导航回主界面。
驱动：server/docs/run-full.ps1 加 probe-download-ui.mjs（53 → 54 条），放在 probe-ui-debug 附近；注意 .ps1 必须带 BOM 且用 PS5.1 Parser 复验。

## 五、验证

~~~powershell
node server\probe-download-ui.mjs http://127.0.0.1:9333 http://127.0.0.1:8099
node server\probe-ui-debug.mjs   http://127.0.0.1:9333 http://127.0.0.1:8099   # 回归（窄窗/顶栏）
node server\probe-start-screen.mjs http://127.0.0.1:9333 http://127.0.0.1:8099  # 回归
node server\probe-ui-new.mjs      http://127.0.0.1:9333 http://127.0.0.1:8099    # 回归
~~~

## 六、口径

- 版本号不升（仍 1.3.1）；dist 同步由 Lead 做；新增探针后全量 = **54 条**，断言口径跑完后记账。
- 不做：下载队列/多任务、断点续传、暂停（交接文档里单列的下一步）。

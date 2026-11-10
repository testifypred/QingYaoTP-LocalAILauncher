# 模型下载进度条（顶栏 · 可折叠）· 交付记录（2026-11-11）

> 需求：软件下载模型时加下载进度条，挂在顶栏，做成可折叠（收起）进度条的形式，并显示后台下载速度、总量、余量、预计时间。

## 一、做了什么

| 层 | 内容 |
|---|---|
| 后端 | `GET /api/download/state` 增字段：`receivedBytes/totalBytes/remainingBytes/remainingMB/speedBytes/startedAt/finishedAt/updatedAt/lastDataAt/stallSec/elapsedTotalSec`；速度改为**最近 4 秒**窗口；`cancelDownload()` 空闲时返回 `cancelled:false`（不再假取消） |
| 页面 | 顶栏 `#dlWrap/#dlChip`：↓ + 下载 N% + 迷你进度条 + 速度（空闲隐藏、不占位）；详情 `#dlPanel`：文件名、大进度条、已下/总量/剩余、速度、预计剩余、已用、取消、收起；`localStorage.localai.dlPanel` 记展开偏好；1s/4s 两档轮询（页面隐藏暂停）；完成/失败/取消保留 20 秒；卡住显示「连接中…」；总量未知走 indeterminate |
| 探针 | 新增 `server\probe-download-ui.mjs`（CDP + stub `/api/download/state`，**35 条**，不真下载）；全量驱动 53 → **54 条** |

## 二、接口契约（`GET /api/download/state`）

~~~jsonc
{
  "active": true, "done": false, "pct": 42,
  "receivedBytes": 206000000, "totalBytes": 491520000, "remainingBytes": 285520000,
  "receivedMB": 196.5, "totalMB": 468.8, "remainingMB": 272.3,
  "speedBytes": 3365929, "speedMBs": 3.21, "etaSec": 148,
  "error": null, "elapsedSec": 86,
  "startedAt": 0, "finishedAt": 0, "updatedAt": 0, "lastDataAt": 0,
  "stallSec": 0, "elapsedTotalSec": 0,
  "file": "qwen2.5-1.5b-instruct-q4_k_m.gguf", "id": "qwen25-15b-q4km"
}
~~~

- 空闲：`active=false, done=false, error=null, total=0, pct=0`；完成后 `done=true` 一直保留到下一次 start。
- 取消：`active=false, error="已取消"`；空闲时再点取消返回 `{ ok:true, cancelled:false, reason:"no-active-download" }`。

## 三、验证

| 探针 | dev（源码） | 发布包（exe） |
|---|---|---|
| `probe-download-ui` | **35/35** | **35/35** |
| `probe-ui-debug`（回归） | 33/33 | 33/33 |
| `probe-start-screen`（回归） | 12/12 | 12/12 |
| `probe-ui-new`（回归） | 30/30 | —（该探针按 docs 目录传参，回归只在 dev 跑） |

- 断言口径：**792 → 827**（+35）；全量驱动 **54 条**（BOM `EF BB BF`、PS5.1 Parser 0 错误）。
- 真实下载实测（本地限速源 4MB）：active 时 pct 14→38→61→84、speed≈1.0MB/s、remainingMB 递减、etaSec 倒计时；完成 pct 100 + elapsedTotalSec；空闲 cancel 返回 cancelled:false。
- dist 同步：`app.mjs` / `app.html` 与源码哈希 MATCH；发布包 `/api/download/state` 新字段齐全、首页含 `#dlWrap/#dlPanel`。

## 四、偏差与取舍（重要）

1. **窄窗断言换了口径**：不再量 `body.scrollWidth`。`header::before` 是 HUD 扫光伪元素（26% 宽、7s `translateX` 到 480%），会把 `body.scrollWidth` 按相位撑大（实测 850→878→960→1042→1126），而 `body` 是 `overflow:hidden`、用户看不见。现在量「真实 DOM 元素不越界 + `scrollTo(9999,0)` 后 `scrollX===0`」，必要时临时 `prefers-reduced-motion: reduce`。
2. `probe-ui-debug` 的窄窗断言仍用 `body.scrollWidth`，存在同样的时序脆弱性（本轮不动它，已记入 `technique\06` 的「探针过期」表）。
3. 速度用 4 秒窗口而非全程平均，避免限速/卡顿时 ETA 偏乐观。
4. 收起只改本地偏好，下载在服务端照跑；服务重启会丢当前任务（下载器本身无持久化，仍是下一步）。
5. 首启弹窗的原下载 UI 保留（引导的一部分），只加两处联动：开始下载时立刻催顶栏、完成时顶栏不重复 toast。

## 五、证据清单

- `CONTRACT.md`：本轮需求/接口/页面/探针契约（含实现记录）。
- `release-probe-download-ui.out.txt` / `release-probe-ui-debug.out.txt` / `release-probe-start-screen.out.txt`：发布包实机输出。
- `download-bar-light.png` / `download-bar-dark.png`：1440×900 亮/暗两套截图（`server/docs/**/*.png` 被 .gitignore 忽略，属本地证据）。

## 六、下一轮建议

1. 打包 v1.4.0 + 重打交付 zip（把 Debugging Tool v2 与下载进度条带进包），随后跑一次干净全量 54 条。
2. 下载队列/多任务、断点续传、暂停（当前进度条只表达单任务）。
3. 若要连「文档可横向滚」也消灭：`html{overflow:hidden}` 一行即可（本轮未做，避免越界改动）。

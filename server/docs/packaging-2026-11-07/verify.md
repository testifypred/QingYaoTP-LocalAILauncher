# 独立验证：QingYaoTP AILauncher v1.2.0 发布包 + 交付 zip

- 验证员：verifier（独立；只读 dist / zip / 8099，未改任何产物、未重启服务）
- 时间：2026-11-07 11:25 起
- 依据：technique/05-打包与部署.md「打包后必须自检」+ 本轮 Lead 附加项（代码工作区 v1.2.0）

## 0. 对象与基线

| 项 | 值 |
|---|---|
| 发布目录 | D:\LocalModels\dist\QingYaoTP AILauncher |
| 发布目录规模 | 4,087 文件 / 434,971,624 B（414.8 MiB）；其中 data\ 641 文件 / 164,209,010 B（156.6 MiB）；载荷 = 3,443 文件（去掉 data/logs/server.pid） |
| 交付 zip | D:\LocalModels\dist\QingYaoTP-AILauncher-v1.2.0.zip |
| zip 尺寸/时间 | 127,767,661 B（121.8 MiB）/ mtime 2026-11-07 11:25:21 |
| zip SHA256 | 7E6DC404FCAF4477CCE4B5ED4F61CF30F9A69C1F5C20B98546616C5BAC6E3D72 |
| zip 条目 | 3,943（目录项 500 + 文件 3,443），根 QingYaoTP AILauncher-v1.2.0/ |
| 运行中服务 | 127.0.0.1:8099，pid 20324，包路径 = dist\...\app（11:25:47 用新包重启） |

## 1. technique/05 12 项判定

| # | 检查 | 判定 | 关键值 / 说明 |
|---|---|---|---|
| 1 | app\ 关键文件齐 | 🟢 | app.mjs 262,620 / app.html 298,897 / doc-extract.mjs 10,750 / config-recommend.mjs 6,063 / debug.html 19,774 / localai-debug.mjs 8,365 / localai-debug.cmd 237 / debug-icon-64.png 3,371 / debug.ico 33,273 / localai.mjs+cmd+localai-tui.mjs+cmd 齐；vendor\katex（katex.min.js 272,868）、node_modules\node-llama-cpp 齐 |
| 2 | 根目录文件齐 | 🟢 | 启动器 57,856 / DebugTool.exe 42,496 / localai.ico 31,308 / config.ini 979 / 使用说明.txt 4,939 / WebView2 三 DLL（698,208+38,752+194,912）/ vc_redist.x64.exe 25,635,768 / runtime\node.exe 92,825,416 / plugins\*.mjs = 3（disk/hello/notes） |
| 3 | 源码 SHA256（server vs dist\app） | 🟢 | 4/4 相同（前16位）：app.mjs 98849B624597CDF8、app.html EB5AADA5D7868D0C、doc-extract.mjs 9E08B87B04751950、config-recommend.mjs FD2BD97860688F6D |
| 4 | exe 尺寸 / MZ / 构建时间 | 🟢 | 57,856 与 42,496；头 4D 5A 90 00；mtime 2026-11-07 11:24:04 / 11:24:05（与 build-portable.ps1 本轮构建时间一致） |
| 5a | dist 侧 config.ini | 🟡 | 当前 dist\config.ini 内容为 modelDir=D:\LocalModels（mtime 11:25:37）。这不是打包输出：build-portable.ps1 默认 $ModelDir=''（空），zip 于 11:25:21 生成时该文件仍是空值；11:25:37（启动器 11:25:38 启动前）被试跑前的本地化操作改写。见 §3-1。 |
| 5b | zip 侧 config.ini | 🟢 | 963 B：port=8099 / modelDir=（空）/ autoLoad=（空）/ contextSize=16384 / kvReuse=1 / gpu=auto / vkDevices=（行在）；无任何盘符绝对路径 |
| 6 | node_modules 包数 / 随包 Node | 🟢 | app\node_modules 顶层目录 41（另有 1 个 .package-lock.json）；dist\runtime\node.exe -v = v24.19.0 |
| 7 | zip 结构 | 🟢 | 3,943 条目：根目录项 QingYaoTP AILauncher-v1.2.0/ 存在；全部条目以此前缀开头（缺前缀 0）；反斜杠条目 0；盘符/绝对路径 0；含 .. 的 0；v1.1.0 残留 0；目录项 500 |
| 8 | zip 内容抽查 | 🟢 | 18 个关键条目尺寸全部命中预期：app/app.mjs 262,620、app/app.html 298,897、config.ini 963、启动器 57,856、DebugTool 42,496、使用说明.txt 4,939、runtime/node.exe 92,825,416 等；zip 内 4 份源码 SHA256 与 server\ 一致 |
| 9 | zip 卫生 | 🟢 | data\、logs\ 实际文件 0（仅空目录项）；.pid/.log/.tmp 条目 0（server.pid 已排除）；models/workspace 0；discovery.json 0；qytp-zip- 0；AppData、/Temp/、LocalModels 字样 0；models/ 仅空目录项 1 |
| 10 | 中文文件名 | 🟢 | QingYaoTP AILauncher-v1.2.0/使用说明.txt 条目名解码正确；zip 内 SHA256 前16位 652DF809364A09D9 与 dist 一致 |
| 11 | 解压冒烟 | 🟢 | 解到 %TEMP%\qytp-verify-v120-20261107-112712：3,443 文件 / 499 子目录 / 270,762,491 B（258.2 MiB），16.4s；24 个关键文件 0 缺失；4 份源码哈希与 server\ 一致；启动器/DebugTool 哈希与 dist 一致；解出的 runtime\node.exe --check 6/6 通过（app.mjs、config-recommend、doc-extract、localai-debug、localai、localai-tui，exit=0）；data/logs/models 三个目录存在且为空 |
| 12 | 与上一版 zip 差异 | 🟢 | v1.1.0 zip（3,943 条目）→ v1.2.0（3,943 条目）：新增 0、删除 0、仅 3 个条目尺寸变化：app/app.html 275,430→298,897、app/app.mjs 254,041→262,620、使用说明.txt 4,946→4,939。无文件缺失 |

> 判定：11 项 🟢 + 1 项 🟡（5a 仅指 dist 运行目录被试用改写；交付物 zip 侧 5b 为 🟢）。

## 2. 本轮附加项

| # | 检查 | 判定 | 关键值 |
|---|---|---|---|
| A1 | 版本 1.2.0 三处一致 | 🟢 | app.mjs 第 37 行 APP_VERSION = 1.2.0；server\package.json version 1.2.0；GET /api/version = 1.2.0（buildSource=mtime、builtAt=2026-11-07T02:53:57Z、node v24.19.0、dir=dist\...\app）。probe-version 日志 14/14（源码模式还核了 git 9158f0b / dirty=true） |
| A2 | zip 内代码工作区标记 | 🟢 | app.html 含 id="cwReview" / id="cwEditor" / id="cwList" / id="cwTabs" / setCodeCapture；app.mjs 含 /api/code/capture 与 /api/code/review；zip 内 app.mjs 含 const APP_VERSION = "1.2.0"。运行中 8099 的 GET /（276,964 字符）同样含上述 5 个标记 |
| A3 | zip 前缀/斜杠/消毒 | 🟢 | 同 §1-7/5b/9：前缀 100% 命中、正斜杠 100%、无 .pid/.log/.tmp、无 data/logs 实体文件、无 models/workspace、config.ini 无 D:\LocalModels |
| A4 | 解压冒烟 | 🟢 | 见 §1-11；启动器 57,856 B；extracted node --check app\app.mjs exit=0 |
| A5 | 使用说明.txt 新文案 | 🟢 | 4,939 B；含「默认用本目录的 models\（把 gguf 放进去即可）」与「modelDir（留空 = 本目录的 models\）」；不含 D:\LocalModels（dist 与 zip 内均核过） |
| A6 | 探针证据复核 | 🟢 | 51 条探针 / 718 断言可复算（§4）。首跑日志：45 条驱动全绿 + 3 条红（plugins 6/11、code-panel exit2 no page、formula-find 7/8）；新探针首跑另有 ui-gpu 7/8。4 份 rerun 日志全部转绿（plugins 11/11、code-panel 17/17+跳过1、formula-find 8/8、ui-gpu 7/7）。功能层：probe-code-workspace 22/22、probe-code-panel 18/18、E2E PASS、UI_REVIEW PASS（详见 §4） |
| T1 | 能起来（technique/05） | 🟢 | GET /api/state 200（1,542 B）；GET /api/version 200 |
| T2 | 调试工具（technique/05） | 🟢 | GET /debug 200（19,774 B）、/debug-icon.png 200（3,371 B）、/debug-icon.ico 200（33,273 B）；无令牌 POST 403 由 probe-debug 35/35 覆盖（未在本轮重复发 POST，遵守只读约束） |
| T3 | 回归 | 🟢 | 51 条 / 718 断言（§4 复算与 RESULT 完全对账） |

## 3. 异常与需 Lead 知情的点

1. **dist 运行目录 config.ini 被试用改写（🟡，不影响交付物）**：dist\config.ini mtime 11:25:37、内容 modelDir=D:\LocalModels；zip mtime 11:25:21、启动器 11:25:38 启动。即打包那一刻该文件仍是空值（build-portable.ps1 默认 ModelDir=''），随后为「用本机模型试跑」把它改成本机路径，再启动服务。建议：收尾时把 dist\config.ini 还原成 modelDir=（下次重打 zip 时 make-zip.ps1 反正会消毒，不改也不影响交付）。
2. **dist\app\server.pid 存在（5 B）**：运行中服务写的，已被 make-zip.ps1 排除，zip 内 0 条（已核）。
3. **探针轮次口径：RESULT.md 说「首跑 45+3 红、3 条复跑」，实际日志有 4 份 rerun**（多 rerun-probe-ui-gpu：首跑 7/8 系开发模式无 config.ini 分支，属新探针断言修正后复跑）。RESULT 第三节单独披露了 ui-gpu，但表头/结论句未计入，Lead 转述「3 条复跑」同理。建议下轮把「4 条复跑（含 1 条新探针口径修正）」写进表头。
4. **断言口径并存未标注**：RESULT 表二把 probe-code-workspace 记 22、probe-code-panel 记 18（无模型全量口径），而 718 求和用 21 与 17（有模型时跳过 1 条）。两个数都对，但同表出现易误读；feature RESULT 的「22/22」「18/18」是 feature 目录那次无模型运行，全量跑是 21/21+跳过1、17/17+跳过1（日志已核）。
5. **证据小缺口**：feature RESULT 的「模型审查 API 75.8s / 1193 字」只有文字（写「本文档同日实测」），没有原始日志；同表「落盘 272B」在 e2e-agent-capture.out.txt 里没有字节数（该日志只有 22s / 1 段 / 路径 code/python-110450-1.py；272 这个数出现在另一个 ui-review 日志的 editor chars）。建议补存一份 review API 原始响应。
6. **过程记录（非交付缺陷）**：backend-selftest.txt 如实登记 10:54 复测时漏写 PORT=8100，临时实例曾按默认端口在 8099 起过约 2 分钟（随后被终止，8099 当时无用户应用）。当前 8099 已是 11:25:47 用新包重启的实例（pid 20324，包路径 dist\app），本轮只做只读 GET。
7. **版本对账证据来自源码模式**：probe-version 跑的是 `cd server; node app.mjs`（git 9158f0b / dirty=true），交付包的 /api/version 是 mtime 构建（commit 空）。两者都是 1.2.0，属预期差异（包内无 .git、无 package.json），但「三处一致」的证据链要区分这两种形态。

## 4. 探针 718 断言复算（与 RESULT 对账）

- 驱动 45 条可解析探针：日志解析合计 644/650（probe-func 9 条未被其规则解析，另 kv-long/ui-metric 为信息型无断言）。
- 修正：644 +5（plugins 6→11）+1（formula-find 7→8）+17（code-panel 0→17）+9（func）= **676/676**。
- 加 3 条新探针：probe-gpu 14 + probe-ui-gpu 7 + probe-code-workspace 21 = 42 → **718/718**。
- 跳过 2 条条件断言（code-panel / code-workspace 的「无模型 409」）不计入 718，与 RESULT §四一致。
- 首跑红/复跑绿：plugins（探针目录推断错，已改读 /api/plugins 的 dir，11/11）、code-panel（瞬时 no page，17/17）、formula-find（剪贴板偶发，8/8）、ui-gpu（开发模式分支，7/7）。
- 功能层证据：probe-code-workspace 22/22（feature 目录，无模型）；probe-code-panel 18/18（同上，含截图 code-panel-mw5tf4nf.png / mw5tg3py.png）；e2e-agent-capture.out.txt = E2E PASS（qwen3-5-4B、22s、captured 1 段、wsPaths=code/python-110450-1.py）；e2e-review-ui.out.txt = UI_REVIEW PASS（86.5s、1210 字、四节结构、截图 ui-review-mw5tlyhv.png）。

## 5. 结论

- 交付物（dist + zip）与本轮源码 HEAD 一致：4 份源码哈希、3,443 文件载荷、3,943 条目 zip 全部对得上。
- zip 可移植契约满足：根前缀、正斜杠、config.ini 消毒（modelDir=/autoLoad=/vkDevices= 空）、无本机运行数据（data/logs 实体、server.pid、models/workspace、discovery.json 均 0）。
- 解压即可用：关键文件 0 缺失、6 份 JS 语法自检通过、启动器 57,856 B、随包 Node v24.19.0。
- 唯一需处理项是 §3-1（dist 运行目录 config.ini 被试用改写，非打包输出、不影响 zip）。

## 6. 证据文件（verify-files\）

| 文件 | 内容 |
|---|---|
| item1-6-dist.txt | dist 侧项 1-6 原始输出（文件清单、SHA256、exe 头/时间、config.ini、node_modules、node -v、版本三处、readme） |
| hash.txt | 4 份源码 SHA256 全值（server vs dist） |
| item7-10-zip.txt | zip 结构/内容/卫生/中文名 原始输出 |
| zip-entries.txt | zip 全 3,943 条目（名称/解压尺寸/压缩尺寸） |
| extract-check.txt | 解压冒烟全程输出（计数、哈希、config、node --check） |
| extract-dir.txt | 本次解压临时目录（%TEMP%\qytp-verify-v120-20261107-112712，可删） |
| zip-diff-v110-to-v120.txt | 与 v1.1.0 zip 的差异（0 增/0 删/3 改） |
| probe-review.txt | 55 份探针日志逐条解析 + 718 复算 |
| runtime-checks.txt | 8099 只读检查（version/state/debug/图标/workspace list/首页标记） |

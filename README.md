# QingYaoTP AILauncher（本地 AI）

> 一台 Windows 机器上的**纯本地 AI 工作台**：模型跑在本机（llama.cpp），界面是本地网页，数据不出门，能离线用、能改、能扩。
> QingYaoTP = QingYaoTestifypred；图标是**不定积分 ∫ + AI**。

---

## 这是什么

不是「又一个聊天客户端」。它要解决的是**第一次把本地大模型跑起来这件事**：首启自动体检硬件、推荐能跑的模型、一键下载、30 秒内看到第一句回答；跑起来之后，工具调用、联网、看图、代码工作区、会话管理、调试工具都在同一个窗口里。

## 能做什么

| 能力 | 入口 |
|---|---|
| 本地对话（KV 缓存复用，首字约 1 秒） | 主界面 |
| 思考型模型（R1 / Qwen3）折叠思考过程 | 输入框下方「深度思考」 |
| 工具调用：时间、计算、读文件、跑代码、插件 | 勾「调用工具」或开场白「Agent 模式」 |
| 联网：中文搜索优先百度，被拦自动回落 Bing | 勾「联网」（默认关，首次开启有须知） |
| 会话：多会话、就地改名、自动起标题、历史版本回滚、标题+正文搜索 | 侧栏 / 右键菜单 |
| 文档检索（RAG）：md/txt/log/csv + docx + pdf 建索引，模型可检索并给出处 | 勾「调用工具」 |
| 代码工作区：模型回答里的代码直接落 `workspace\code\`，可运行、可让模型审查 | 顶栏「代码」 |
| 图片输入：粘贴 / 拖拽 / 选择，独立进程看图（CPU 编码，不占显存） | 输入区 Σ / 设置 → 视觉 |
| 公式（LaTeX / 化学式）、全屏终端、命令行客户端 | 顶栏「公式」「终端」/ `localai` |
| 插件：`plugins\` 下放一个 .mjs 就多一个工具 | 设置 → 工具 |
| 调试工具：23 项体检 + 诊断历史 + 实时资源 + 导出诊断包 | 顶栏「Debug」/ `localai-debug.cmd` |
| 自定义外观：主色、缩放、背景、任意 CSS | 设置 → 外观 |

## 5 分钟跑起来（便携包）

1. 解压到**可写目录**，例如 `C:\QingYaoTP AILauncher`。**不要**放 `Program Files`，也不要套两层目录。
2. 双击 `QingYaoTP AILauncher.exe`。
3. 缺 VC++ 运行库时它会自己弹窗引导安装（安装包已随包）。
4. 首次启动会自动：体检硬件 → 嗅探本机已有的 `.gguf` → 没有就引导下载一个极小的模型（约 470MB）→ 下载完自动加载并发第一句。
5. 模型也可以自己放：把 `.gguf` 丢进 `<安装目录>\models\`（`config.ini` 的 `modelDir` 留空即用这个目录）。

> 首次启动会自动显示**本文件**；之后想再看：设置 → 关于 →「使用说明…」。

## 从源码运行 / 自己打包

前置：**Windows 10 1809+ / 11**、**Node.js 24+**（要真 `.exe`，不是 npm 的 `.cmd` 垫片）、.NET Framework 4.x 自带的 `csc.exe`（编译启动器用，Windows 自带）。

```powershell
# 1) 装依赖
cd server
npm install

# 2) 开发态直接跑（默认监听 127.0.0.1:8099）
node app.mjs
#    浏览器打开 http://127.0.0.1:8099/

# 3) 打包成便携目录（产物：dist\QingYaoTP AILauncher）
powershell -NoProfile -ExecutionPolicy Bypass -File .\build-portable.ps1
#    换输出位置：-OutDir 'E:\build\dist\QingYaoTP AILauncher'
#    指定随包 node：-NodeExe 'C:\Program Files\nodejs\node.exe'

# 4) 打成对外交付的单文件 zip（产物：dist\QingYaoTP-AILauncher-v<版本>.zip）
powershell -NoProfile -ExecutionPolicy Bypass -File .\make-zip.ps1
```

- **不写死任何盘符**：脚本里的路径都由「脚本自身位置」推导，版本号由 `server\app.mjs` 的 `APP_VERSION` 解析——换台机器、换目录都能构建。
- **视觉看图**需要 `tools\llama.cpp\` 里的 `llama-server`（约 101MB，不入库）；没有它，文本对话照常，只是发图会报错。
- **模型权重不入库**（GB 级），自己下或首启下载。

## 目录结构

```
QingYaoTP AILauncher.exe   启动器（托盘、守护、单实例、内置 WebView2 窗口）
config.ini                 端口 / 模型目录 / 自动加载 / 上下文 / 后端 / 显卡 / 视觉
runtime\node.exe           随包 Node（目标机不用装 Node）
app\                       服务端 app.mjs、界面 app.html、调试页、CLI、vendor 前端库
app\llama\                 视觉 sidecar（llama-server.exe + mtllib，约 101MB）
models\                    模型目录（modelDir 留空时用它；可放 mmproj\ 做看图）
plugins\                   插件目录（放 .mjs 即生效）
data\                      界面缓存与 localStorage（删掉 = 重置界面状态）
logs\                      运行日志（app.log、崩溃日志、诊断历史）
workspace\                 会话、代码工作区、RAG 索引等用户数据
```

## 常见问题

| 问题 | 处理 |
|---|---|
| 双击没反应 / 一闪而过 | 先看 `logs\app.log`；缺 VC++ 运行库最常见；也可运行 `localai-debug.cmd`（服务没起来也能诊断） |
| 界面打开是白屏 | 端口被占（启动器会自动改口并写回 `config.ini`）；或被安全软件拦了本地回环 |
| 生成很慢 | 设置 → 显卡 看看有没有选到独显；上下文别开到 64K 以上；第一次提问要预填充，慢是正常的 |
| 显存不够报错 | 换更小的量化（Q4_K_M）、模型或上下文档位；关掉看图（同一时刻只跑一个重模型） |
| 想换模型 | 顶栏「模型」菜单选一个即加载；行尾「删」可删（默认进回收站，可还原） |
| 开了「调用工具」后回答变慢 | 正常：工具说明要预填充（约 550 token），首字会从 1–2 秒变成 7–8 秒。**普通问答保持关着**，需要查时间/算数/读文件时再开，或从开场白点「Agent 模式」 |
| 数据在哪 | `<安装目录>\workspace\`（会话、代码、索引）与 `data\`（界面状态）；整个目录拷走就是完整备份 |
| 怎么卸载 | 直接删安装目录；没有注册表、没有系统服务、没有后台常驻（模型加载只在本进程内） |

## 数据与隐私

- 模型推理、会话、索引、检索**全部在本机**完成，默认只监听 `127.0.0.1`。
- 只有你主动开启「联网」时，模型才会把查询词发给搜索引擎并读取网页正文；本机地址与内网网段被拒绝。
- 下载模型会连 ModelScope（或你给的自定义链接）。
- 诊断包导出是本地 zip，不会自动上传。

## 第三方组件与许可

| 组件 | 用途 | 许可 |
|---|---|---|
| llama.cpp / node-llama-cpp | 本机推理 | MIT |
| KaTeX（含字体） | 公式渲染 | KaTeX MIT / 字体 SIL OFL |
| mhchem | 化学式 | Apache-2.0 |
| MathLive | 公式面板 | MIT |
| CodeMirror | 代码编辑器 | MIT |
| Microsoft Edge WebView2（运行时 DLL） | 内嵌窗口 | Microsoft 可再分发组件 |
| Microsoft VC++ Redistributable | 运行库 | Microsoft 可再分发组件 |

模型权重与视觉投影文件**不随仓库分发**，各自的许可（如 Qwen、Llama、Phi、DeepSeek、gpt-oss）由使用者遵守。

## 文档与版本

- 版本号只有一处来源：`server\app.mjs` 的 `APP_VERSION`（`package.json` 必须一致，探针会对账）。
- 现状与下一步：`交接文档.md`；时间流水与设计取舍：`DeveloperRealtimeLog.md`；技术专题：`technique\`。
- 回归靠 76 个探针（`server\probe-*.mjs`），全量驱动 `server\docs\run-full.ps1`（56 条）——这个项目没有 CI，探针就是 CI。

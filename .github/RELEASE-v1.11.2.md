# v1.11.2 — 界面第二轮重做（Fluent 深色 / 暖纸白 + 思源宋体 + 图标统一）

**发布日期**：2026-11-28 · **类型**：体验版（**纯界面层重做，产品逻辑零改动**；源码侧只同步探针断言与文档）

> 由 **卿峣Testifypred** 出品 · Powered By DeepSeek Harness

## 下载

| 文件 | 大小 | SHA256 |
|---|---|---|
| `QingYaoTP-AILauncher-v1.11.2.zip`（主包，必装） | 127,986,879 B（约 122 MB / 3,955 条目） | `646E6B58D1A3681186A6F4424C89204CB5A732786A84DEEAFE9C3F9846948DB0` |
| `QingYaoTP-AILauncher-v1.6.0-vision-pack.zip`（视觉增强包，选装） | 38,408,198 B（约 37 MB） | `D7924534B30143F3791D26C143B95656306AE1FFA08D52557EE25D56699A11D3` |

主包解压后约 **258.9 MB / 3,453 个文件**，**不含**看图 sidecar（拆成可选增强包；不看图可忽略）。包内 `app/README.md` 与仓库 README 同哈希（17,598 B）。

## 本版重点

### 1. 两套主题重做（去「科幻 HUD」，改 Fluent）

- **暗色 = Fluent 深色**（`#1c1c20` + 系统蓝 `#4cc2ff`）；**亮色 = 暖纸白**（`#f6f6f3` + `#2563eb`）；圆角 / 阴影 / 字号统一。
- 去掉旧 HUD 装饰：网格底纹、视口四角框、顶栏扫光、Logo 呼吸动画、tab 角括号、渐变文字、气泡彩色侧条、流式扫描光。
- 设计层是**覆盖式**追加（改 token + 个别组件），DOM / 事件 / 快捷键不变。

### 2. 问候语思源宋体

- `早上/中午/下午/晚上好` 用 **Noto Serif SC 700 / 46px**，副标题 400 / 18px。
- 字体是 **20 余字形的子集 woff2（5.7 KB）**，随包 `app/vendor/fonts/noto-serif-sc/`（含 `OFL.txt`，SIL OFL 1.1），`THIRD_PARTY_NOTICES.md` 已补条目。

### 3. 图标与文案

- 设置 → 线性齿轮 SVG；看图 → 自绘「相框 + Σ + 山」；发送键 → **纸飞机**（扁平描边主题色，主界面与开场白同款）。
- 导航文字 `Debug` → **调试**、`余量` → **上下文**；顶栏按钮高度 / ghost 层级统一。
- **发送键旁的模型品牌图标本版下线**（发送键只显示纸飞机；顶栏模型按钮的品牌图标保留）。

### 4. 模型菜单 / 代码面板 / 设置页 / 弹层

- 模型菜单：每行删除键从「删」文字（10.5px 下发虚）→ **垃圾桶 SVG**（悬停点亮、hover 变红）；行高 46、名称 13px / 大小 11px、菜单宽 330；「＋ 添加模型…」改虚线按钮。
- 代码面板：工具条/审查栏按钮统一 26px 高、8px 圆角；`运行` 实心主题色、`模型审查` 描边、其余 ghost；编辑器 13px / 1.62。
- 设置页：页签改 **30px chip 式**；toast 统一圆角 + 左侧主题色条。
- **弹层层级**：`.modal` z-index 90、`.toasts` 100 —— 修掉「上次在聊」浮卡（55）盖住代码面板等弹层。

### 5. 修掉两个真 bug

1. 第二版 CSS 补丁漏了一个 `}` → 浏览器把后续 3 段规则当**嵌套规则静默失效**（模型菜单/代码面板样式不生效、无报错）；已补，并把「改 CSS 校验 `{}` 平衡」写进约定。
2. 编辑 `build-portable.ps1` 时**丢了 UTF-8 BOM**（PowerShell 5.1 会按 ANSI 读中文 → 打包脚本必炸）；已恢复，Parser 0 错。

## 探针与验证

- **全量回归**（源码实例 `node server\app.mjs`，4B / ctx 16384）：70 条 / **1,523 断言**，整跑 **68 PASS + 2 条探针问题**——
  - `probe-title-ui`：顶栏重排后 `#status` 实测 93–98px（v1.11.1 为 120），几何实测 `scrollW==clientW`、文本「16K · 可思考」完整无省略号 → 阈值过期，改 `>=80`；
  - `probe-ui-tools` C 段：刷新发生在「400ms 防抖 + PUT」存盘之前 → 最后一条 assistant 未落盘，**探针时序竞态**（等 2.5s 的对照实验正常）→ 探针改为刷新前轮询 `GET /api/sessions/<id>` 等落盘；
  - 两条修正后隔离复跑 **4/4 全绿** → **有效 70/70**；本版**无环境红**（web-tools 19/19、ui-web 39/39、vision 四连全过）。
- 本版同时修了 3 条因界面改版而失效/假绿的断言：`probe-ui-debug`（Debug→调试）、`probe-model-delete`（文案→SVG）、`probe-start-screen`/`probe-start-flow`（`#sendIco` 改用 `getComputedStyle` 判可见，旧的只看 `hidden` 属性是假绿）。
- **发布包冒烟**（终版 zip 解压到**会话工作区之外**，等同新用户解压到任意目录）：**7 项 244/244 全绿** —— `probe-version` **14/14**（含包内 `app/app.mjs` 版本对账 = 1.11.2）、`probe-debug` **54/54**、`probe-code-review-stream` **45/45**（跳过 3：Phi 切换）、`probe-readme` **21/21**、`probe-code-window-ui` **10/10**、`probe-code-panel-v2` **44/44**、`probe-review-watchdog` **56/56**；跑完 `--stop` 释放端口、临时目录已删、源模型未动。
- 打包自检：无 `app/llama`、无 `data/cloud-review*`、`/data/` 与 `/logs/` 无文件、字体 woff2（5,680 B）+ OFL 在包、许可 3/3、`config.ini` 8 键消毒且无本机路径。
- 证据：`server\docs\probe-full-2026-11-27-v1112\`（RESULT.md / summary / logs / shots / isolate）、`server\docs\packaging-2026-11-27-v1112\`（RESULT.md / build2 / make-zip2 / zip-check / smoke）。

## 升级方式

1. 托盘右键 →「停止服务并退出」；
2. 把新 zip 解压**覆盖**到原安装目录；
3. 保留 `workspace\`、`data\`、`models\` 三个目录即可无损（模型不用重下）。

> 目前**没有自动更新**，请以本页版本号为准；装前可先核对 SHA256。

## 已知限制

- 仅 Windows 10/11 x64；Mac / Linux 暂不支持。
- 本地审查长代码建议用 4B（9B/20B 在 Vulkan 上审长代码会偶发卡死，属原生层问题）；Phi-4-mini 不能用作审查模型（已从下拉隐藏）。
- 云端复审只接受 https（本机回环可 http），每次调用都要确认目标域名。
- 看图固定走 CPU 编码，1440×900 截图约 40–60 秒。
- **回答刚结束 <1 秒内刷新或关闭页面，最后一条回答可能尚未落盘**（对话存盘是 400ms 防抖 + PUT）；等 1 秒再刷新即可。该窗口为低危已知问题，本版未改产品逻辑。
- 界面视觉在窄窗 / 175% 缩放下的细节仍在打磨（设置页滑杆、工具卡片、审查面板等）。

## 出品

- **出品**：**卿峣Testifypred**（QingYaoTP = QingYaoTestifypred）
- **开发工具链**：**Powered By DeepSeek Harness**

[![](https://img.shields.io/badge/powered_by_dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)

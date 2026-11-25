# v1.11.1 发布就绪审计（只读；不打包 / 不推送 / 不改版本号）

> 审计人：release-auditor（共享任务 task-2）· 审计开始：2026-11-23 23:53（Asia/Shanghai）
> 审计对象：v1.11.0（2026-11-22 已发布）之后的未发版改动 = **Apache-2.0 许可链路** + **启动器 /health 看门狗**
> 基线：`HEAD = e3aef0b`；`tag v1.11.0` → `commit e5a1b52`（tag 对象 `eddc7d8`）
> 写入范围：仅 `server/docs/prep-2026-11-24/`（本文件）
> **本轮已遵守的硬约束**：未运行 `build-portable.ps1 / make-zip.ps1 / make-vision-pack.ps1`，未跑探针、未动 8099；未执行任何 git 写操作（commit/tag/push）；未改源码、配置、版本号。本文件内所有「执行命令」都只是**待用户批准后的清单**。

---

## 〇、结论

**有条件就绪**：许可证随包链路的实现本身是正确的（build-portable 两处清单齐全、make-zip 会随 `app\` 整棵带入、CI 许可检查逻辑正确且能过 PS 5.1 语法解析）；**0 个阻断性代码缺口**。但 v1.11.1 打包前必须关闭 5 项（G1–G5，其中 G1–G3 为必须，G4 为决策，G5 为加固建议）：

| 缺口 | 级别 | 内容 | 关闭条件 |
|---|---|---|---|
| **G1** | 必须 | 版本号：5 个文件 7 处要升到 1.11.1，其中 `probe-tui-tools.mjs` 3 处**连 CI 都不检查**（漏改会让发布包冒烟直接红） | 按 §二 清单逐处改 |
| **G2** | 必须 | 文档/数字：README、README-技术版、交接文档、新会话启动词、交接词、technique、handover 里「当前版本/当前交付包/探针口径」的位置要更新；另有 **3 处现有事实错误**（见 §四 高亮行）；且要新建 `.github/RELEASE-v1.11.1.md` | 按 §四 清单改，数字用打包实测值回填 |
| **G3** | 必须 | 启动器看门狗（task-1）尚未收口：审计时 `server/launcher/Launcher.cs` 是**未提交修改**（+287/−17），`dist\...\QingYaoTP AILauncher.exe` 仍是 v1.11.0 构建（2026-11-22 22:43），端到端验证/全量回归未在本审计范围内完成 | task-1 完成编译 + e2e + 回归，再打包 |
| **G4** | 决策 | 视觉增强包 zip **不含** LICENSE / NOTICE / THIRD_PARTY_NOTICES.md，而该文件自己写明「重新分发视觉增强包时请保留本文件」（THIRD_PARTY_NOTICES.md:4、25–26） | 要么重打时把三文件放进增强包并改自检，要么在 Release 说明里明确「许可文本见主包，重新分发需一并保留」 |
| **G5** | 建议 | CI 加固：① 许可证步骤依赖 `shell: pwsh` 的 UTF-8 默认值（本机 PS 5.1/zh-CN 实测会失败，见 §三）；② CI 不校验 build-portable 两处清单是否还含许可文件（未来被删会静默漏包）；③ CI 不校验 TUI 兜底/probe 夹具版本号 | 可选：加 `-Encoding UTF8` / 在 CI 里 grep 两处清单 / 扩版本检查 |

> 说明：本审计**未运行** CI，也**未打包**，所以 v1.11.1 的新 zip 字节数、条目数、SHA256 一律留空待实测（§四、§七 都标注了回填位置）。本机未安装 PowerShell 7（只有 Windows PowerShell 5.1.26100.9818），故 CI 中 `shell: pwsh` 步骤只能做 PS 5.1 语法解析与 PS 5.1 语义等价验证，见 §三。

---

## 一、许可证随包链路（逐条证据）

### 1.1 `server/build-portable.ps1`：两处清单都含三个许可文件 ✅

- `$need` 依赖检查清单：`server/build-portable.ps1:84–124`；三个许可文件在 **:90–92**：
  - `:90` `(Join-Path $Repo 'LICENSE'),`
  - `:91` `(Join-Path $Repo 'NOTICE'),`
  - `:92` `(Join-Path $Repo 'THIRD_PARTY_NOTICES.md'),`
- 实际复制清单：**:194–197**（`:193` 是 README，`:195–197` 依次 LICENSE / NOTICE / THIRD_PARTY_NOTICES.md）。
- 顺序安全性：`$need` 检查（:84–124）发生在清空旧产物（:135–159）**之前** → 许可文件万一缺失会先 `Die`，不会先把 dist 删了。
- 旁证：脚本头注释只写了「app\ 服务端、界面、KaTeX、node-llama-cpp」（:10），未提许可文件；不影响功能，属可读性小瑕疵。

### 1.2 `server/make-zip.ps1`：会把 `app\` 整棵带进 zip ✅（但不自检许可文件）⚠️

- 暂存方式：`server/make-zip.ps1:42` 用 `robocopy $dist $stage /E … /XD <dist\data> <dist\logs> <dist\app\llama>` → **dist\app\ 下除 app\llama 外全部**（含 LICENSE/NOTICE/THIRD_PARTY_NOTICES.md、README.md、app.mjs、node_modules…）都会进 stage，随后 :84–93 逐文件写入 zip。
- 排除项只有 `data\`、`logs\`、`app\llama\`（:42），另删 app 根级 `.pid/.log/.tmp`（:51）——**不会**排除 .md / 无扩展名文件。
- 结论：**只要 build-portable 把三文件拷进 `dist\app\`，make-zip 就不会漏**。
- ⚠️ 缺口：make-zip 的自检只有两条——不得有 `app/llama/` 条目（:101–109）、不得有 `data/cloud-review*`（:103–113）；**没有**「zip 里必须有 app/LICENSE、app/NOTICE、app/THIRD_PARTY_NOTICES.md」断言 → 若未来 build-portable 清单被误删，zip 会静默漏许可。建议在 §七 步骤 8 手工核一次（也可选加 CI/脚本断言，属 G5）。
- 已发布 v1.11.0 zip 实测（本轮只读打开）：`dist\QingYaoTP-AILauncher-v1.11.0.zip` = **127,961,662 B / 3,948 条目 / SHA256 18B83B29…ECCA7932**，其中 `*\/app/(LICENSE|NOTICE|THIRD_PARTY_NOTICES.md)` 匹配 **0 条** → 与交接文档「已发布 zip 不含许可文件」一致。

### 1.3 `server/make-vision-pack.ps1`：当前不带许可文件 ⚠️（G4，需决策）

- 打包内容：暂存只建 `<stage>/llama/`（:76–77），`Copy-Item Src\* llamaDst -Recurse`（:83），再加 `vision-pack.json`（:93–104）；**没有任何 LICENSE/NOTICE/THIRD 的拷贝**。
- 自检口径固定为「文件条目 = files.Count + 1（vision-pack.json）」：:138–149（`$expectFiles = $files.Count + 1`，:145）；若加 3 个许可文件必须同步改这里，否则打包自检会红。
- 现行增强包：`dist\QingYaoTP-AILauncher-v1.6.0-vision-pack.zip` = 38,408,198 B / 56 条目 / SHA256 `D7924534B30143F3791D26C143B95656306AE1FFA08D52557EE25D56699A11D3`（交接文档:111 记录；本轮未重开该 zip 验证内容，只沿用记录）。
- 许可文本是否「已声明覆盖」：`THIRD_PARTY_NOTICES.md:11` 列了 llama.cpp（MIT，b12144，视觉增强包内二进制），:25–26 明说「视觉增强包（app/llama）内含 llama.cpp … 重新分发增强包时请保留本文件」。**文本覆盖了，但文件没随增强包发出**——只下载增强包 zip 的人拿不到该文件。
- 安装器兼容性：`server/vision-pack.mjs:12` 明确「只接受 `<前缀>llama/**` 与 `<前缀>vision-pack.json`，其余条目忽略并计数」，:155–160 对其它条目 `skipped += 1` 后跳过 → 把三文件放增强包**包根**不会影响安装；只要同步改 make-vision-pack 自检期望即可。
- 决策建议（二选一）：
  - A. 重打增强包（推荐）：根目录放 `LICENSE / NOTICE / THIRD_PARTY_NOTICES.md`，自检期望改成 `files.Count + 1 + 3`；顺带包名会从 1.6.0 变成 1.11.1（版本取自 app.mjs，:35–39），README.md:71/191、交接文档:111、RELEASE 里的 1.6.0 文件名说明要同步。
  - B. 不重打：Release 说明明确「增强包内的 llama.cpp 许可文本见主包 app\THIRD_PARTY_NOTICES.md；重新分发增强包请一并保留」，并在 README 视觉小节加一句。

### 1.4 随包 App README 与使用说明

- `build-portable.ps1:193` 把仓库根 `README.md` 复制成 `app\README.md`（首启弹窗/关于读它）；v1.11.1 打包后会自动变成含许可小节的版本（当前 dist 里仍是 v1.11.0 版，见 §五）。
- `build-portable.ps1:340–432` 的 `使用说明.txt` 模板「一、目录结构」（:351–362）没提三份许可文件；可选在 v1.11.1 补一行（非必须）。

### 1.5 小结

| 链路 | 结论 | 证据 |
|---|---|---|
| build-portable `$need` | ✅ 含三文件 | build-portable.ps1:90–92 |
| build-portable Copy-Item | ✅ 含三文件（→ app\） | build-portable.ps1:195–197 |
| make-zip 是否随 app\ 带入 | ✅ 会（robocopy 全量 + 仅排除 data/logs/app\llama） | make-zip.ps1:42 |
| make-zip 是否断言许可存在 | ❌ 无断言（建议手工核 / G5） | make-zip.ps1:101–113 |
| 视觉增强包许可 | ⚠️ 不带（THIRD_PARTY_NOTICES 文本覆盖但未随发） | make-vision-pack.ps1:76–104、145；THIRD_PARTY_NOTICES.md:4、25–26 |

---

## 二、版本号对齐与 v1.11.1 必改清单（G1）

### 2.1 现状（全部 = 1.11.0）

| # | 文件 | 行 | 当前内容 | v1.11.1 改成 | 备注 |
|---|---|---|---|---|---|
| 1 | `server/app.mjs` | **47** | `const APP_VERSION = "1.11.0";` | `1.11.1` | 唯一主版本常量（probe-version 断言「只在一处定义」）；/api/version、关于、导出页等 10 处都从它派生（:205/455/749/814/856/1039/4809/9064/9367/10388），**不用逐处改** |
| 2 | `server/package.json` | **3** | `"version": "1.11.0",` | `1.11.1` | 与 app.mjs 对账（probe-version:47）；license 字段在 :11 |
| 3 | `server/localai.mjs` | **19** | `const VERSION = "1.11.0";` | `1.11.1` | CLI `--version` |
| 4 | `server/localai-tui.mjs` | **1570** | `val("--main-ver", "1.11.0")` | `1.11.1` | **只是快照兜底**；TUI 自己的 `VER` 在 :21 是 `2.0.0`，**不要动**（两条版本线解耦） |
| 5 | `server/probe-tui-tools.mjs` | **164** | `["--snapshot", …, "--main-ver", "1.11.0"]` | `1.11.1` | 测试夹具 |
| 6 | 同上 | **170** | `snapOut.includes("主程序 v1.11.0")` | `主程序 v1.11.1` | 断言字符串 |
| 7 | 同上 | **177** | `["--snapshot", …, "--main-ver", "1.11.0"]` | `1.11.1` | 测试夹具 |

> 共 **5 个文件 7 处**。TUI 自身的 `const VER = "2.0.0";`（localai-tui.mjs:21）与主版本无关，保持 2.0.0（v1.11.0 口径也是 2.0.0，别混）。

### 2.2 CI 的版本一致性检查读哪些文件（ci.yml:32–41）

- 只读 **3 个文件**：`server/app.mjs`（:35）、`server/package.json`（:36）、`server/localai.mjs`（:37）；不一致就 `throw`（:39–41）。
- **不检查** `localai-tui.mjs` 的 `--main-ver` 兜底，也**不检查** `probe-tui-tools.mjs` 的夹具/断言 → 第 4–7 处漏改不会被 CI 拦下；后果是发布包冒烟里 `probe-tui-tools` 52 条会红（快照头部「主程序 v1.11.0」对不上）。建议 v1.11.1 收口时用 §七 的 grep 自查（可选加 CI，G5）。
- 打包脚本无需改版本：`make-zip.ps1:23–25` 与 `make-vision-pack.ps1:35–39` 都从 `app.mjs` 解析 `APP_VERSION`；根目录名、zip 名、增强包名都跟着走。
- `probe-version.mjs` 只对账 app.mjs / package.json / /api/version（:46–51），不读 README/TUI。

### 2.3 其它可能被误当「版本号」的地方（确认不用改）

- `server/app.html`、`server/debug.html`：无硬编码主版本（本轮 `git grep "1\.11\.0"` 覆盖 *.html 无命中）。
- `server/launcher/Launcher.cs`（看门狗改动中）：无主版本字符串。
- 历史证据目录（`server/docs/feature-*`、`server/docs/packaging-*`）里的 1.11.0 是历史记录，**不改**。

---

## 三、CI 许可证检查（`.github/workflows/ci.yml:43–53`）

### 3.1 正确性 ✅

步骤名「许可证文件（LICENSE / NOTICE / THIRD_PARTY_NOTICES + package.json license）」（:43），`shell: pwsh`（:44），脚本（:45–53）实际检查：

1. 三个文件存在（:46–48）；
2. `server/package.json` 的 `license` 字段必须 `Apache-2.0`（:49–50）；
3. `LICENSE` 文本含 `Apache License`（:51–52，LICENSE:2 即 "Apache License"）。

本轮在仓库根用同一段脚本做只读验证（见 §3.4 编码说明）：三个文件都在、package.json `license=Apache-2.0`、LICENSE 含 `Apache License` → 逻辑正确。git 已跟踪三文件（`git ls-files` → LICENSE / NOTICE / THIRD_PARTY_NOTICES.md）。

可加强但非阻断：未校验 NOTICE 的版权/AI 声明内容、未校验 THIRD_PARTY_NOTICES 内容、未校验 build-portable 两处清单（见 G5）。

### 3.2 ASCII-only 约束 ✅

- 该步骤脚本提取后**无非 ASCII 字符**（逐行扫描 >127 → 0 行）。
- 同一文件里的 `shell: powershell` 步骤（「PowerShell 5.1 syntax check (build scripts)」:57–75）脚本也**纯 ASCII**（0 行非 ASCII）。
- ci.yml 文件本身 4,380 B、UTF-8 无 BOM（YAML 不需要 BOM），其中 16 行含中文——都只出现在步骤名/注释（`pwsh` 步骤不受 PS 5.1 ANSI 解码影响）；文件 :55–56 已有注释提醒「`shell: powershell` 步骤里绝不能出现中文」。

### 3.3 PS 5.1 语法 ✅（实测解析，不运行 CI）

- 本机只有 Windows PowerShell **5.1.26100.9818**（无 pwsh 7）。用 `[System.Management.Automation.Language.Parser]::ParseFile()` 对两段脚本的原文（按 CI 的 UTF-8 无 BOM 写入临时文件）解析：
  - 许可证步骤 → `PARSE_OK`（0 error）
  - PS 5.1 syntax check 步骤 → `PARSE_OK`（0 error）
- 复跑 CI 等价逻辑（`Get-ChildItem server -Filter *.ps1 -File` + `server/docs/run-full.ps1`）→ `OK build-portable.ps1 / make-icon.ps1 / make-vision-pack.ps1 / make-zip.ps1 / run-full.ps1；TOTAL=5 BAD=0` → 该 CI 步骤在 PS 5.1 上会过。
- 相关 .ps1 的 BOM 现状（PS 5.1 按 ANSI 解析中文的要求）：build-portable.ps1 BOM=**有**（27,853 B）、make-zip.ps1 BOM 有（6,858 B）、make-vision-pack.ps1 BOM 有（7,739 B）、run-full.ps1 BOM 有（14,023 B）；make-icon.ps1 也在 CI 解析清单内（同批 OK）。

### 3.4 一个真实的编码脆弱点 ⚠️（G5，低风险）

- 步骤用 `Get-Content server/package.json -Raw | ConvertFrom-Json`（:49）。`server/package.json:5` 的描述含中文（UTF-8）。在**本机默认 shell = PS 5.1 + 中文 GB2312 代码页**下实跑该脚本：`Get-Content` 按 ANSI 解码 UTF-8，中文行尾的引号被吃掉 → `ConvertFrom-Json` 报「传入的对象无效…(171)」→ 步骤退出码 1。加 `-Encoding UTF8` 后通过（`license=Apache-2.0 version=1.11.0`）。
- 为什么 CI 仍会过：该步骤明确 `shell: pwsh`，GitHub `windows-latest` 的 PowerShell 7 对 `Get-Content` 默认 UTF-8（本机没有 pwsh 7，无法本地实跑验证；按 PS7 默认行为应通过）。
- 建议（可选）：给两处 `Get-Content` 都加 `-Encoding UTF8`（或改用 `node -e` 解析），消除「shell/代码页变了就红」的隐性依赖。版本一致性步骤同样建议显式编码；本轮用 PS 5.1 实跑该步骤逻辑（app.mjs=1.11.0 package.json=1.11.0 localai.mjs=1.11.0）→ 通过。

---

## 四、v1.11.1 需要更新的文档 / 数字清单（G2）

> 原则：**历史记录不改**（RELEASE-v1.11.0.md、日志第八十一~八十三节、packaging-2026-11-22-v111 等证据目录保留原样）；只改「当前状态 / 当前版本 / 当前交付包」类文字。
> 数字口径：v1.11.1 zip 的字节数 / 条目数 / SHA256 / 解压文件数 **必须打包后实测回填**；预估变化只有「+3 个文件」是确定的（见下）。

**打包后预期变化（仅估算，实测为准）**：相对 v1.11.0（`127,961,662 B / 3,948 条目 / 解压 258.8 MB / 3,448 文件`）→ 条目 **预期 3,951**（+3 许可条目）、解压文件 **预期 3,451**（+3 许可文件）、解压体积 **+15,864 B**（11,369 + 797 + 3,698 明文，对 258.8 MB 的显示精度基本无影响）；zip 压缩后字节与 SHA256 **不可预估、必须实测**（禁止沿用 `18B83B29…7932`）。

### 4.1 `README.md`（客户端版）

| 行 | 现内容 | v1.11.1 动作 |
|---|---|---|
| 5 | 当前版本 **v1.11.0** | → **v1.11.1** |
| 70 | 主包 `QingYaoTP-AILauncher-v1.11.0.zip`（约 122 MB） | → v1.11.1 文件名 |
| 71 | 增强包文件名 1.6.0「版本不同步是正常的」 | 若重打增强包 → v1.11.1 并改说明；不重打保留 |
| 188 | 当前版本 v1.11.0（2026-11-22；…本版要点） | → v1.11.1（2026-11-24；**许可文件随包** + 启动器看门狗） |
| 189 | 交付主包 122.0 MB / 3,948 条目 | → 实测（预期约 122.0 MB / 3,951 条目） |
| 190 | 解压约 258.8 MB / 3,448 文件 | → 实测（预期 258.8 MB / 3,451 文件） |
| **195** | **「90 个探针、69 组全量用例、1,468 条断言」** | ⚠️ **现有事实错误**（v1.11.0 已到 91 / 70 / 1524）→ 必须改 **91 / 70 / 1524** |
| **197** | 「2026-11-22 体验优化（**未发版**）」 | ⚠️ 已随 v1.11.0 发布；删除或改成历史说明 |
| 222–229 | 十五、许可证（Apache-2.0）小节 / License badge | 已就位，**不用改**（除署名变更） |

### 4.2 `README-技术版.md`

| 行 | 现内容 | v1.11.1 动作 |
|---|---|---|
| 27 | 能力表 **v1.11.0 体验与稳定性** 行 | 新增一行 **v1.11.1：Apache-2.0 许可随包 + Launcher /health 看门狗（Vulkan 原生层卡死自愈）** |
| 122–131 | 「### v1.11.0：体验与稳定性」小节（保留为历史） | 在 122 前新增「### v1.11.1：许可证随包 + 启动器看门狗（2026-11-24）」小节 |
| 130 | 探针：新增 probe-review-watchdog 56 条；全量 70/1524 | 数字**不变**（除非打包前新增探针） |
| 233 | 91 个探针 / 70 条 / 1524 断言 | 不变 |
| **239** | **「发行包（v1.11.0 起）会随 app\ 目录带上 LICENSE…」** | ⚠️ **事实错误**：**已发布的 v1.11.0 zip 并不含**许可文件（§1.2 实测 0 条）→ 改成「**v1.11.1 起**」 |
| 246 | 发版流程：正文用 `.github/RELEASE-v1.11.0.md`、附件 `dist\*.zip`（tag 例 v1.11.0） | → `RELEASE-v1.11.1.md` / v1.11.1 |

### 4.3 `.github/RELEASE-v1.11.1.md`（**新建**；README-技术版:246 会指向它）

- 模板照 `.github/RELEASE-v1.11.0.md`（80 行）结构：下载表（字节 / 条目 / 解压文件数 / SHA256 全部实测）→ 本版重点 → 探针与验证 → 升级方式 → 已知限制 → 出品。
- 必写内容：① 许可文件随包（LICENSE / NOTICE / THIRD_PARTY_NOTICES.md 在 `app\`）；② 启动器 /health 看门狗（Vulkan 原生层卡死自愈；env 覆盖 `LOCALAI_WATCHDOG=0` 等）；③ 探针口径 **91 / 70 / 1524**（若看门狗新增探针则回填）；④ 已知限制更新：原文「进程需要重启启动器」（RELEASE-v1.11.0.md:49）在 v1.11.1 应改为「看门狗约 90s 无 /health 自动重启 node；真机验证记录见证据目录」；⑤ 升级方式沿用 3 步（停止 → 解压覆盖 → 保留 workspace/data/models）。
- `.github/RELEASE-v1.11.0.md` 保留为历史，**不改**。

### 4.4 `交接文档.md`（当前状态段 94–131 等）

| 行 | 现内容 | v1.11.1 动作 |
|---|---|---|
| 8 | 最后更新 2026-11-22（v1.11.0…） | 增补 2026-11-24 v1.11.1（许可随包 + 看门狗） |
| 72 | 当前交付包 `v1.11.0.zip`（122.0MB / 3,948 条目 / 127,961,662B / SHA 18B83B29…） | → v1.11.1 实测值 |
| 89 | 探针 91 个 / 70 条 / 1524 | 不变（除非新增） |
| 94 | 标题「当前状态（2026-11-22：v1.11.0 体验与稳定性）」 | → v1.11.1 |
| 97 | 版本 **v1.11.0**（四处对齐…TUI VER 2.0.0） | → **v1.11.1**；TUI VER 仍 2.0.0 |
| 102 | 交付物**当前行** v1.11.0.zip（127,961,662B / 3,948 / SHA） | → v1.11.1 实测；TUI 2.0.0 不变 |
| 111 | 增强包 v1.6.0（38,408,198B / 56 条目 / SHA D792…） | 若重打 → v1.11.1 新值；不重打保留并注明仍沿用 1.6.0 |
| 114 | 仓库根许可文件「v1.11.0 zip 不含，下次打包随包」 | → 「**v1.11.1 起随包**」 |
| **118** | **发布包 258.8MB/3448…「app\README.md = 客户端版（15,360B）」「APP_VERSION=1.10.0、VER=1.2.0」** | ⚠️ **现有事实错误**：v1.11.0 的 app README = **15,730 B**（= tag v1.11.0 版）、APP_VERSION **1.11.0**、TUI VER **2.0.0**（15,360B / 1.10.0 / 1.2.0 是 v1.10.0 的残留）→ 现在就改；v1.11.1 重打后按实测更新 |
| 122 | 8099 = 发布包实例 v1.11.0 | → v1.11.1（重启后） |
| 130 | 验证行（v1.11.0 打包交付/Release） | 追加 v1.11.1 验证行（构建自检 / zip / 发布包冒烟 / 看门狗 e2e） |

### 4.5 `新会话启动词.md`

| 行 | 现内容 | v1.11.1 动作 |
|---|---|---|
| 6 | 顶部「2026-11-23 深夜（许可证落地（未发版）…）」 | 在其后/前加 2026-11-24「v1.11.1 已打包发布：许可文件随包 + 启动器看门狗」 |
| 8 | v1.11.0 已发布条目 | 保留为历史 |
| 28 | 标题「现状快照（2026-11-16 v1.8.0 打包后）」 | 可选改日期/版本 |
| 31 | 版本 v1.11.0 + 主包 127,961,662B / 3,948 条目 / SHA | → v1.11.1 + 实测数字 |
| 40 | 「76 提交」 | 可选：实测（当前 `git rev-list --count HEAD` = 87） |
| 41 | README/Release 段 v1.11.0 数字与链接 | → v1.11.1 |
| 46–48 | 探针 91 / 70 / 1524（不变）；验证行 v1.11.0 | 验证行加 v1.11.1；数字不变 |
| 127 | 「**v1.11.0 之后未发版变更**：Apache-2.0 许可证已落地…下次打包起随包」 | → 改为「已随 v1.11.1 发布」 |
| 319–323 | 粘贴开局块（v1.9.2 旧文案、line 321 Release 列表、line 323 硬约束 70/1524） | 更新到 v1.11.1（Release 列表加 v1.11.1；硬约束数字不变） |

### 4.6 交接/技术文档与探针账本

| 文件 | 位置 | 动作 |
|---|---|---|
| `server/docs/handover-2026-11-23.md` | 7（版本/Release 链接）、9（8099 实例）、10（「新增（未发版）」）、17（「已发布 v1.11.0 zip 不含许可文件」）、41（探针 56 / 70 / 1524） | 建议**不改历史文件**，新建 `handover-2026-11-24.md`（短版）记录 v1.11.1；若改则按右列更新 |
| `server/docs/交接词-2026-11-23.md` | 1（当前版本 v1.11.0 / 未发版许可）、12–18（8099 / Release 主包数字 / Git 提交 / 探针 91-70-1524 / 视觉冒烟 / 许可状态）、22（下一步打 v1.11.1） | 新建 2026-11-24 交接词或更新；22 的「下一步」完成后改「已完成」 |
| `technique/07-坑与约定.md` | 237「已发布的 v1.11.0 zip 不含许可文件，下次打包起随包」 | 发布后改「v1.11.1 起随包」 |
| `technique/06-探针与验证.md` | 3（91 个探针 / 70 条 / 1524 断言） | 数字不变（除非新增探针） |
| `server/docs/run-full.ps1` | 探针注册表（含 :122 probe-review-watchdog），无版本号 | 不变 |
| `DeveloperRealtimeLog.md` | 第八十一~八十三节 | **只追加** v1.11.1 一节，不改旧节 |

### 4.7 发布后回填 / 校验（防文档数字漂移）

打包后必须在**同一份实测数据**上回填：build-portable 输出的「合计 MB / N 个文件」、zip 的「N 条目 / 字节 / SHA256」、包内 app 三许可文件字节、`app/README.md` 是否 = 仓库根 README（v1.11.1 版）。可用以下只读 grep 自查（历史引用会命中，属正常；重点看「当前」行）：

```powershell
Select-String -Path README.md,README-技术版.md,交接文档.md,新会话启动词.md,.github/RELEASE-v1.11.1.md -Pattern '127,961,662|3,948|18B83B29|v1\.11\.0'
```

---

## 五、Git 状态 / dist 同步 / 已发布资产（逐条证据）

### 5.1 Git

- 审计开始时 `git status --short` 为空；审计过程中出现 **`M server/launcher/Launcher.cs`**（task-1 看门狗进行中：`git diff --stat` = **1 file changed, 287 insertions(+), 17 deletions(-)**）。除此之外无修改、无未跟踪文件（`git status --short` 仅此一行）。→ 打包前必须等 task-1 收口（G3）。
- `git log --oneline -3`：`e3aef0b docs: 新增交接词 2026-11-23…` / `07ae08e docs(license): Apache-2.0…` / `ea0b1ba chore: 移除误提交的 %SystemDrive% 缓存目录…`。
- tag：`git rev-parse v1.11.0^{commit}` → **e5a1b52**（tag 对象 eddc7d8）；v1.11.0..HEAD 共 5 个 docs/chore 提交（无代码改动）。
- 工作区源码 = v1.11.0 tag：用 `git hash-object` 对比 server/app.mjs / app.html / localai.mjs / localai-tui.mjs，四者 blob 与 `v1.11.0:` 完全一致（看门狗只改 C#，不碰这四文件）。

### 5.2 dist\QingYaoTP AILauncher\app 三许可文件（存在，且与仓库根同哈希）

| 文件 | 字节 | SHA256（dist = 仓库根） |
|---|---|---|
| LICENSE | **11,369** | `1504AA0AFD6CCD9FADE50DEA8E9C28A5ABEF3F192AEF73E22D97DA7B1F25A2F4` |
| NOTICE | **797** | `8980D669D8E127DA05445D878EEA3AC57E88FD08A13646BA1F21905E3E863C57` |
| THIRD_PARTY_NOTICES.md | **3,698** | `01E77E34C9C9EE1DC9DA76B570217DC5BCD4D8C2E94BF68FEBB5982FBF5C5A2F` |

→ 第八十三节「本机 dist\app 已手工补三个文件」属实（dist 是 v1.11.0 构建 + 手工补丁，不影响已发布 zip）。

### 5.3 源码 ↔ dist 关键文件 SHA256

| 文件 | 源码 | dist\app | 一致？ |
|---|---|---|---|
| app.mjs | `7760AB9F12943CC7CE55921CE19E3553821C85B866B84815AECD0CDB65A6E253`（471,750B） | 同左 | ✅ |
| app.html | `069A3F83DD83CB9F1EDFBBCB0A26EF87C74D482ED81E8E88FE296DDB4AB4AE84`（549,939B） | 同左 | ✅ |
| localai.mjs | `01540964A7F282A9…` | 同左 | ✅ |
| localai-tui.mjs | `6BBD045B8309439F…`（TUI VER 2.0.0） | 同左 | ✅ |
| package.json | `1D4854C845C63325953AFA85EC83CD1E4D68E1EB9D8860C830E05BBF082550B2`（含 license 字段） | `3B8EB24895F0648220695C4FF4D152F491CB4677C911E1A29CC2B3A8B6E1065F`（**无 license 字段**） | ⚠️ 预期内不一致（dist 是许可改动前构建） |
| README.md | `725672DD19C52117854DDA03FF1BD058E1E29CDC5C4D69817D4890ACBDABABD8`（16,850B，含许可小节） | `96821004F041CA4974B658529714BAB20766C01D9A950217080FC50E2097C644`（15,730B = v1.11.0 tag 版） | ⚠️ 预期内不一致（同上） |

结论：**app.mjs / app.html 源码↔dist 一致**；package.json 与 README 的差异是「dist 构建早于 2026-11-23 许可改动」，v1.11.1 重跑 build-portable 会刷新（build-portable.ps1:170、:193），**不需要手工同步**。

### 5.4 对照 DeveloperRealtimeLog 第八十一节的旧哈希（18FE4517… / 9806CC7C…）

- 第八十一节 :3815 记录：app.html `18FE45179BBCDE98…`、app.mjs `9806CC7CBA23A6F8…`。
- 当前：app.html `069A3F83…`、app.mjs `7760AB9F…` —— **不同，但不是失同步**。第八十一节哈希是「P0 修复后、v1.11.0 最终提交 e5a1b52 之前」的中间快照；e5a1b52 又改了 app.html/app.mjs（panel-v2 状态行修复等 r2 收尾），当前工作区 = tag v1.11.0 = dist（§5.1/§5.3 已用 git hash-object 验证）。
- 看门狗改动**不影响** app.mjs/app.html（git status 只有 Launcher.cs）。

### 5.5 已发布 v1.11.0 资产（只读实测）

- `dist\QingYaoTP-AILauncher-v1.11.0.zip`：**127,961,662 B / 3,948 条目 / SHA256 18B83B2920DF2617CC6D72EE39F900095648D33568C14C10F42BEF63ECCA7932**。
- 该 zip 内 `app/(LICENSE|NOTICE|THIRD_PARTY_NOTICES.md)` 条目数 = **0** → 已发布资产**确实不含许可文件**（与交接文档:17、第八十三节:3906 一致）。
- `dist\QingYaoTP AILauncher\QingYaoTP AILauncher.exe`：57,856 B，mtime **2026-11-22 22:43:21** = v1.11.0 构建；看门狗编译后需同步（task-1 scope，本轮未动）。

---

## 六、额外检查：仓库清洁度 / 残留 / 密钥

| 检查 | 结果 | 证据 |
|---|---|---|
| 打包残留（仓库根） | ✅ 无 zip/7z/tar；根目录只有 md、ini、LICENSE/NOTICE/THIRD、*.gguf（模型，被 .gitignore:4 挡） | `Get-ChildItem -File`（扩展名筛 zip）为空 |
| dist 里的历史 zip | ✅ 20 个（v1.1.0…v1.11.0 + vision-pack）= **历史交付物，不算残留** | `dist\*.zip` |
| 是否有未跟踪且未被 ignore 的残留 | ✅ 无（git status 干净，除 Launcher.cs 修改） | `git status --short` |
| 临时目录 | ✅ 已忽略：tmp-cm / tmp-kx / tmp-ml → `.gitignore:48` `tmp-*/`；.downloads → :6；dsh-cost-meter → :45；dist → :9；workspace → :19；logs → :42；data → :71；node_modules → :12 | `git check-ignore -v` |
| .gitignore 挡 `%SystemDrive%/` | ✅ `.gitignore:77` 最后一行 `%SystemDrive%/`（2026-11-22 误提交已由 ea0b1ba 清理） | .gitignore:77 |
| 误跟踪的运行数据/发布包/模型 | ✅ `git ls-files` 中无 `data/ logs/ dist/ tools/ node_modules/ mmproj/` 前缀、无 .gguf/.part | CI 仓库卫生步骤同款检查 |
| 密钥/令牌 | ✅ 无真实密钥。`git grep -I` 只命中 2 处**明显占位假 Key**：`server/docs/feature-code-review-verify-2026-11-15/backend-smoke.mjs:136`（`sk-BACKENDSMOKE1234567890abcd`）、`server/probe-cloud-upstream-stream.mjs:25`（`sk-PROBESTREAM0123456789abcdef`）；`data/cloud-review.json` 被 .gitignore:71 挡住 | `git grep -n -I -E "sk-…"` |
| `asr/tokens.txt`（名字像密钥） | ✅ 不是密钥：**167,930 B**，首行 `<unk> 0 / <s> 1`，是 ASR 的 BPE 词表（tracked，baseline b6a9175） | 文件首行 |
| `tmp-config-orig.ini`（跟踪的历史备份） | ✅ 840 B，modelDir 空、无密钥；历史配置备份（a3f71ef 提交），可留可清 | 文件内容 |
| .env / *.pem / *.pfx 被跟踪 | ✅ 无 | `git ls-files` 扫描 |

---

## 七、用户批准后才执行的命令清单（**本轮严禁执行**；仅列清单，未运行）

> ⚠️ 以下全部是 v1.11.1 的**候选执行步骤**，本轮（2026-11-24 审计）**一条都没跑**。执行前需用户明确批准「打包 + 推送 + 发布」。

### 步骤 0：前置（G3）

1. 完成 task-1：Launcher.cs 看门狗编译 + 端到端验证（假 app.mjs 挂起 → 自动重启）+ 与 Exited 重启互斥 / 退出码 0 不拉起 / 30 分钟 5 次上限；同步 `dist\...\QingYaoTP AILauncher.exe`。
2. 确认 `git status --short` 只剩预期的看门狗/版本/文档改动。

### 步骤 1：停掉 8099 实例（否则 dist 文件被锁，打包会失败）

```powershell
& 'D:\LocalModels\dist\QingYaoTP AILauncher\QingYaoTP AILauncher.exe' --stop
Get-Process 'QingYaoTP AILauncher' -ErrorAction SilentlyContinue | Stop-Process -Force
# 再确认没有 dist 下的 node 子进程占着 app\ 与 logs\
Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*\dist\*' } | Stop-Process -Force
```

### 步骤 2：升版本（G1，5 文件 7 处；**不要动** localai-tui.mjs:21 的 `VER = "2.0.0"`）

```text
server/app.mjs:47               const APP_VERSION = "1.11.0";     -> "1.11.1"
server/package.json:3           "version": "1.11.0",               -> "1.11.1"
server/localai.mjs:19           const VERSION = "1.11.0";          -> "1.11.1"
server/localai-tui.mjs:1570     val("--main-ver", "1.11.0")        -> "1.11.1"
server/probe-tui-tools.mjs:164  "--main-ver", "1.11.0"             -> "1.11.1"
server/probe-tui-tools.mjs:170  "主程序 v1.11.0"                   -> "主程序 v1.11.1"
server/probe-tui-tools.mjs:177  "--main-ver", "1.11.0"             -> "1.11.1"
```

### 步骤 3：更新文档 + 新建 Release 说明（G2，按 §四 清单）

- 新建 `.github/RELEASE-v1.11.1.md`；更新 README / README-技术版 / 交接文档 / 新会话启动词 / 交接词（或新建 2026-11-24 版）/ technique:237 / handover（或新建）；数字先留空位，步骤 7 实测后回填。

### 步骤 4：本地静态检查（不打包）

```powershell
# 4.1 所有 .mjs 语法
$files = Get-ChildItem -Path server -Recurse -File | Where-Object { $_.Extension -in '.mjs','.cjs' -and $_.FullName -notlike '*\node_modules\*' }
foreach ($f in $files) { node --check $f.FullName; if ($LASTEXITCODE -ne 0) { throw "JS 语法错误: $($f.FullName)" } }
# 4.2 版本一致性（CI 同款 + 手工补 TUI/probe 两处）
Select-String -Path server/app.mjs -Pattern 'const APP_VERSION = "([^"]+)"'
Select-String -Path server/package.json -Pattern '"version":'
Select-String -Path server/localai.mjs -Pattern 'const VERSION = "([^"]+)"'
Select-String -Path server/localai-tui.mjs -Pattern '--main-ver'
Select-String -Path server/probe-tui-tools.mjs -Pattern 'main-ver|主程序 v'
# 4.3 PS 5.1 语法（CI 同款）
powershell -NoProfile -Command "$files=@(Get-ChildItem server -Filter *.ps1 -File); $files += Get-Item server/docs/run-full.ps1; $bad=0; foreach($f in $files){$e=$null;$t=$null;[void][System.Management.Automation.Language.Parser]::ParseFile($f.FullName,[ref]$t,[ref]$e); if($e.Count){$bad++; $e|%{Write-Output ($f.Name+': '+$_.Message)}}}; if($bad){throw 'PS 语法错误'} else {Write-Output ('PS 5.1 OK: '+$files.Count+' 个文件')}"
```

### 步骤 5：构建 dist（**打包**，需批准）

```powershell
Set-Location 'D:\LocalModels\server'
powershell -NoProfile -ExecutionPolicy Bypass -File .\build-portable.ps1 -ModelDir 'D:\LocalModels' -AutoLoad 'qwen3-5-4B-Q4_K_M.gguf'
```

### 步骤 6：构建自检（必须全过）

```powershell
$app = 'D:\LocalModels\dist\QingYaoTP AILauncher\app'
foreach ($f in @('LICENSE','NOTICE','THIRD_PARTY_NOTICES.md')) {
  if (-not (Test-Path (Join-Path $app $f))) { throw "随包缺 $f" }
  Write-Output ("$f " + (Get-Item (Join-Path $app $f)).Length + "B")
}
(Get-FileHash "$app\app.mjs" -Algorithm SHA256).Hash      # 应 = server\app.mjs
(Get-FileHash "$app\README.md" -Algorithm SHA256).Hash    # 应 = 仓库根 README.md
Select-String -Path "$app\package.json" -Pattern '"version"|"license"'   # 1.11.1 / Apache-2.0
Select-String -Path "$app\app.mjs" -Pattern 'const APP_VERSION'          # 1.11.1
# 记录 build-portable 输出的「合计 MB / N 个文件」（v1.11.0 为 258.8MB / 3448；预期 +3 = 3451）
```

### 步骤 7：打交付 zip（**打包**，需批准）

```powershell
Set-Location 'D:\LocalModels\server'
powershell -NoProfile -ExecutionPolicy Bypass -File .\make-zip.ps1
```

### 步骤 8：zip 自检 + 记录实测数字（回填 §四）

```powershell
$z = 'D:\LocalModels\dist\QingYaoTP-AILauncher-v1.11.1.zip'
$zi = Get-Item $z
Write-Output ("bytes=" + $zi.Length + " sha=" + (Get-FileHash $z -Algorithm SHA256).Hash)
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($z)
Write-Output ("entries=" + $zip.Entries.Count)   # v1.11.0=3948；预期 3951
$lic = @($zip.Entries | Where-Object { $_.FullName -match '/app/(LICENSE|NOTICE|THIRD_PARTY_NOTICES\.md)$' })
Write-Output ("license entries=" + $lic.Count)   # 必须 = 3
$bad = @($zip.Entries | Where-Object { $_.FullName -match '(^|/)app/llama/|(^|/)data/cloud-review' })
Write-Output ("forbidden entries=" + $bad.Count) # 必须 = 0
$zip.Dispose()
```

### 步骤 9（可选，G4）：视觉增强包

```powershell
Set-Location 'D:\LocalModels\server'
powershell -NoProfile -ExecutionPolicy Bypass -File .\make-vision-pack.ps1
# 若采纳「带许可」：先改 make-vision-pack.ps1 暂存三文件并把自检期望改为 files.Count+1+3，再记录新字节/条目/SHA
```

### 步骤 10：探针回归（**需批准后跑；本轮未跑**）

```powershell
# 10.1 全量必须跑源码实例（node server\app.mjs；不要跑 dist 实例，cloud 路径不一致）
powershell -NoProfile -ExecutionPolicy Bypass -File 'D:\LocalModels\server\docs\run-full.ps1'
# 期望：91 个探针 / 70 条 / 1524 断言（若新增探针则回填）
# 10.2 发布包冒烟（dist 实例；按惯例跳过 Phi 切换，防 Vulkan 原生层卡死）
$env:PROBE_SKIP_SWITCH = '1'
node server\probe-version.mjs http://127.0.0.1:8099
node server\probe-readme.mjs http://127.0.0.1:8099
node server\probe-debug.mjs http://127.0.0.1:8099
node server\probe-tui-tools.mjs
node server\probe-review-watchdog.mjs http://127.0.0.1:8099
# 10.3 看门狗专项 e2e（task-1 证据；/health 挂起 → 自动重启 → 日志/托盘提示）
```

### 步骤 11：切回 8099 发布包实例 + 视觉包（打包会重置 dist\config.ini 并删 app\llama）

```powershell
Start-Process 'D:\LocalModels\dist\QingYaoTP AILauncher\QingYaoTP AILauncher.exe'
# 如本机要跑模型：把 dist\config.ini 的 modelDir 填回 D:\LocalModels；视觉：设置 → 视觉 → 安装视觉增强包
```

### 步骤 12：Git（**push 需批准**；SSH over 443）

```bash
git add -A
git commit -m "release: v1.11.1（Apache-2.0 许可文件随包 + 启动器 /health 看门狗；zip SHA256 见 Release）"
git tag -a v1.11.1 -m "v1.11.1"
git push origin main
git push origin v1.11.1
```

### 步骤 13：GitHub Release（**发布需批准**）

```bash
gh release create v1.11.1 --title "v1.11.1" --notes-file .github/RELEASE-v1.11.1.md \
  "dist/QingYaoTP-AILauncher-v1.11.1.zip"
# 如重打视觉增强包，再附加 "dist/QingYaoTP-AILauncher-v1.11.1-vision-pack.zip"
```

### 步骤 14：回填与复核

- 用步骤 6/8/9 的实测数字回填 README:189/190、README-技术版、交接文档:72/102/118、新会话启动词:31/41、RELEASE-v1.11.1 下载表；再跑 §4.7 的 grep 自查（重点确认没有把 v1.11.0 的 127,961,662 / 3,948 / 18B83B29… 写进「当前」行）。
- About topics 仍需网页手动补（细粒度 PAT 缺 Administration 权限）——非必须。

---

## 八、风险（按严重度）

| # | 风险 | 级别 | 说明 / 缓解 |
|---|---|---|---|
| R1 | **看门狗未收口就打包** | **高** | 审计时 Launcher.cs 未提交（+287/−17）、dist exe 仍是 v1.11.0 构建；若跳过 task-1 的 e2e 与全量回归直接打包，会把未验证的自动重启逻辑发给用户。缓解：G3 作为打包门禁；e2e 必须覆盖「挂起→重启」「用户主动停服务退出码 0 不被拉起」「30 分钟 5 次上限」 |
| R2 | **probe-tui-tools 版本夹具漏改** | 中 | 7 处版本里 3 处在该文件；CI 只查 3 个文件 → 漏改时 CI 绿但发布包冒烟 probe-tui-tools 52 条会红。缓解：§二 清单 + §七 步骤 4.2 grep；可选扩 CI（G5） |
| R3 | **视觉增强包缺许可文本** | 中（合规） | THIRD_PARTY_NOTICES.md:4/25–26 明说重新分发增强包要保留该文件，但增强包 zip 不含 → 单独分发不满足 MIT/Apache 的随附义务。缓解：G4 方案 A（推荐）或 Release 说明兜底 |
| R4 | **CI 许可步骤编码脆弱** | 低 | 依赖 `shell: pwsh` 的 UTF-8 默认；本机 PS 5.1/zh-CN 实测失败（§3.4）。缓解：`-Encoding UTF8`；不阻断 GitHub CI |
| R5 | **已发布 v1.11.0 资产无许可** | 低 | v1.11.0 Release 的 zip 0 条许可（§5.5）；v1.11.1 自然解决。若坚持旧资产合规：重打并替换 v1.11.0 附件（SHA 变、需改 Release 正文，不推荐） |
| R6 | **文档现有事实错误** | 低 | README:195（90/69/1468）、交接文档:118（15,360B/1.10.0/1.2.0）、README-技术版:239（「v1.11.0 起随包」）——v1.11.1 一次改掉（G2） |
| R7 | **打包副作用** | 低 | build-portable 会清空/重建 `dist\QingYaoTP AILauncher`、重置 `config.ini`（modelDir 空）、删除 `app\llama`（视觉包需重装）→ §七 步骤 11 已含恢复动作；打包前必须先停服务（步骤 1） |
| R8 | **数字多处人工同步易漏** | 低 | 发布后用 §4.7 grep + 只读核对新 zip/SHA；避免把旧 SHA 复制进新文档 |
| R9 | **增强包重打不可复现** | 低 | vision-pack.json 带 createdAt（交接文档:111 已注明），每次 SHA 都变；文档里写「见发布页」或每次实测，别当固定值 |
| R10 | **原生层卡死风险仍在** | 中（产品） | 看门狗是缓解不是根治；Release 已知限制需如实写；长代码审查仍建议 4B/分段 |

---

## 附录 A：本审计实际执行的只读证据命令（全部非破坏性）

- `git status --short` / `git log --oneline -3` / `git rev-parse v1.11.0^{commit}` / `git hash-object` / `git cat-file -s`
- `git grep -n "1\.11\.0"` / `git ls-files` / `git check-ignore -v` / `git grep -I -E "sk-…"`
- `Get-FileHash … -Algorithm SHA256`（server、dist、zip）；`[System.IO.Compression.ZipFile]::OpenRead` 只读打开 v1.11.0 zip
- Windows PowerShell 5.1 `Parser::ParseFile`（CI 两段脚本 + 全部 .ps1）、PS 5.1 实跑版本/许可检查逻辑
- 未运行：build-portable / make-zip / make-vision-pack / run-full / 任何探针 / 任何 CI / 8099 操作 / git 写操作

## 附录 B：v1.11.0 与 v1.11.1 关键文件对照

| 项目 | v1.11.0（已发布） | v1.11.1（待发） |
|---|---|---|
| 主版本 | 1.11.0（5 文件 7 处） | 1.11.1（同 7 处） |
| TUI VER | 2.0.0（解耦，不变） | 2.0.0（不变） |
| 许可随包 | ❌ zip 0 条许可（实测） | ✅ app\ 带 LICENSE / NOTICE / THIRD_PARTY_NOTICES.md（build-portable 两处清单已就位） |
| 启动器看门狗 | ❌（只有 Exited 自动重启） | ✅ Launcher.cs +287/−17 看门狗（task-1，待验证） |
| zip | 127,961,662 B / 3,948 条目 / 18B83B29…7932 | **待实测**（条目预期 3,951） |
| 探针口径 | 91 / 70 / 1524 | 91 / 70 / 1524（除非新增探针） |

---

（本文件由 release-auditor 于 2026-11-23/24 生成；UTF-8 无 BOM；未改任何源码与版本号。）


---

## 2026-11-24 00:04 状态更新（Lead 回填；以上内容为 00:00 前的审计快照，保留不改）

> 来源：Lead 消息 + 本轮只读复核。以下不覆盖上文结论；上文 G1–G5 编号继续沿用。

### G3 更新：看门狗已由 Lead 完成（距打包还剩 3 项）

- 实现：`server/launcher/Launcher.cs` 看门狗已落地，`git diff --stat` 本轮实测 **+287 / −17（净 +270 行；Lead 口径「约 220 行」为估算）**，仍未提交（`git status --short` = `M server/launcher/Launcher.cs`）。
- 编译：Lead 用与 `build-portable.ps1:284–291` 相同的 csc 命令编译（`/target:winexe`、WebView2 引用、`app.manifest`、图标参数一致）。
- 端到端：**24/24 PASS**（Lead 报告）：挂起 node → 约 **6s** 判定 → 强杀并重新拉起；用户主动 `--stop`（退出码 0）不被看门狗拉起；非 0 退出码走单次重启；20s 假重启检查。
- dist 已换新（本轮只读复核）：`dist\QingYaoTP AILauncher\QingYaoTP AILauncher.exe` = **64,000 B**，mtime **2026-11-23 23:55**，SHA256 **8940A4BE33DB05822F423363E783ECBF9B5E2140BC9568C8F6940C1B56AA4319**（与 Lead 给的一致）；旧 v1.11.0 exe（57,856 B）备份在 `server/docs/feature-launcher-watchdog-2026-11-24/launcher-v1.11.0-backup.exe`（实测存在；SHA256 `FD45E174475149B6051F751AB6749BCCB56437F57FC6842243F968EE7F1806D1`）。
- 8099：已用新 exe 重启（本轮 GET `/api/version` 复核：version=1.11.0、dir=`D:\LocalModels\dist\QingYaoTP AILauncher\app`、node v24.19.0）；Lead 报告已加载 4B ctx=16384、视觉包 source=pack / 53 文件；冒烟 `probe-version` **14/14**、`probe-debug` **54/54**。
- 独立验证进行中：**task-3（watchdog-verifier）**。
- **打包前 G3 剩余项（3 项）**：① **全量 70 条回归（源码实例**，不是 dist）；② 独立验证报告（task-3 完成并归档证据目录）；③ **提交**（Launcher.cs + 证据 + 版本/文档收口一起 commit）。
- 补充状态：`server/docs/feature-launcher-watchdog-2026-11-24/` 现为未跟踪目录（task-1/3 证据），提交前确认内容齐全；Launcher.cs 未提交意味着打包前必须 commit（build-portable 直接编译源码，不读 dist 的旧 exe），否则「验证过的版本」与「打包出的版本」无法对账。

### G2 三处事实错误：**应立即修（不依赖打包）**

> 性质：纯文档错误，与 zip 打包/版本号无关；可在获得用户同意后立即改并随下次提交落地（本文件本轮不执行，写入范围仅本目录）。

1. **`README.md:195`**（质量说明段）  
   - 现：`90 个探针、69 组全量用例、1,468 条断言`  
   - 改成：`91 个探针、70 组全量用例、1,524 条断言`  
   - 依据：v1.11.0 交付口径为 **91 探针 / 70 条 / 1524 断言**（`technique/06-探针与验证.md:3`、交接文档:89、日志第八十二节）；若 v1.11.1 新增探针，再按实测回填。
2. **`README-技术版.md:239`**（许可小节）  
   - 现：`发行包（v1.11.0 起）会随 app\ 目录带上 LICENSE / NOTICE / THIRD_PARTY_NOTICES.md；…`  
   - 改成：`发行包（**下次打包起，即 v1.11.1 起**）会随 app\ 目录带上 LICENSE / NOTICE / THIRD_PARTY_NOTICES.md；视觉增强包内含 llama.cpp 二进制，重新分发时请保留本文件。`  
   - 依据：已发布的 v1.11.0 zip 实测 **0 条**许可条目（本文件 §5.5），「v1.11.0 起」不成立；改成「下次打包起」在发布前后都成立。
3. **`交接文档.md:118`**（发布包行）  
   - 现：`…app\README.md = 客户端版（15,360B，与仓库根 README.md 同哈希）。…包内 app\app.mjs 的 APP_VERSION=1.10.0、app\localai-tui.mjs 的 VER=1.2.0；新增 app\code-review-multi.mjs；…`  
   - 改法（二选一）：
     - A（标注历史）：行首加 `（v1.10.0 口径；v1.11.0/v1.11.1 见下行）`，数字保留不动；或
     - B（按当前值更新）：`app\README.md = 客户端版（**15,730 B**，= tag v1.11.0 版；v1.11.1 重打后按实测）`、`APP_VERSION=1.11.0`、`VER=2.0.0`；`含 app\code-review-multi.mjs（v1.10.0 新增，v1.11.0 起沿用）`。  
   - 依据：`git cat-file -s v1.11.0:README.md` = **15,730** = 当前 `dist\...\app\README.md`；v1.11.0 包内 APP_VERSION=1.11.0、TUI VER=2.0.0（本文件 §5.3/§5.5）。15,360 B / 1.10.0 / 1.2.0 是 v1.10.0 的残留。  
   - 可选顺带：`README.md:197`「2026-11-22 体验优化（未发版）」已随 v1.11.0 发布，建议同时删除或改成历史说明。

### G4 / G5 状态

- **G4**（视觉增强包许可）未变，仍需决策；若 v1.11.1 重打增强包，按 §1.3 方案 A（带三文件 + 自检 `files.Count+1+3`）。
- **G5**（CI 编码加固 / build-portable 清单断言 / TUI+probe 版本检查）未变，属建议，不阻断。

### 本轮复核方式（只读）

- `Get-Item` / `Get-FileHash` 核对新 exe 与备份；`git status --short` / `git diff --stat`；`Invoke-RestMethod http://127.0.0.1:8099/api/version`。
- 未改上文任何内容（原文是当时快照）；未改源码/版本号；未运行打包、探针、git 写操作。

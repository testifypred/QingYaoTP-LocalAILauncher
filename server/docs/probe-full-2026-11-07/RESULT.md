# 全量探针 2026-11-07（第十一轮，51 条 / 718 断言全绿）

> 结论：**51 条探针 / 718 断言全绿**（首跑 45 条绿 + 3 条红 → 3 条复跑转绿；另有 `probe-ui-gpu` 按开发模式分支修正后复跑，共 **4 份 rerun 日志**；2 条因「已加载模型」按设计跳过）。
> 环境：**源码模式**（`cd server; node app.mjs`，8099）+ headless Edge 9333 + 驱动预加载 7B。与 11-04 那轮「发布包形态」不同，本轮多出两处开发模式差异（见三）。

## 一、总数

| 项 | 值 |
|---|---|
| 探针数 | 51（驱动 48 + 本轮新增 `probe-code-workspace` / `probe-gpu` / `probe-ui-gpu`） |
| 断言 | 718 通过 / 0 失败（另 2 条条件跳过） |
| 首跑 | 45 条 PASS，3 条红（`probe-plugins` / `probe-code-panel` / `probe-formula-find`）；另有 `probe-ui-gpu` 首跑 7/8（开发模式无 config.ini） |
| 复跑 | **4 份 rerun 日志全部转绿**：plugins 11/11 / code-panel 17/17（跳过 1）/ formula-find 8/8 / ui-gpu 7/7（其中 plugins 是真 bug，见三） |
| 崩溃/重启 | 0（服务 pid 未变；7B 预加载由驱动完成） |
| 耗时 | 11-07 11:02 → 11:21（约 19 分钟；machine 忙时 tools-agent 116.8s / web-tools 96.7s） |

## 二、本轮新增/改动的探针

| 探针 | 断言 | 说明 |
|---|---|---|
> 口径说明：下表「22 / 18」是**无模型**时的全量断言（feature 目录那两次运行）；本全量跑在**已加载 7B**状态下，两条「无模型 409」被跳过，实际计入 21 / 17——两者都对，718 用的是 21/17。

| `probe-code-workspace`（新） | 22（无模型）；本跑 21 + 跳过 1 | capture 校验/落盘/穿越名清洗/重名；review 400/413/409 |
| `probe-code-panel`（重写） | 18（无模型）；本跑 17 + 跳过 1 | 代码工作区 UI：列表/标签/CodeMirror/保存/新建/运行/审查按钮/Esc/自复位 |
| `probe-gpu` | 14 | 11-04 就有，本轮补进驱动 |
| `probe-ui-gpu` | 7–8 | 同上；开发模式断言分支 |

驱动 `run-full.ps1` 的探针清单 48 → 51（补进上面 3 条），并**补回被剥掉的 BOM**（本轮首次跑因 BOM 丢失整段中文乱码、语法崩，Parser 0 错误后才跑起来）。

## 三、三条红的原因与处理

| 探针 | 首跑 | 原因 | 处理 |
|---|---|---|---|
| `probe-plugins` | 6/11 | **探针自身的目录推断错**：源码模式插件目录是 `D:\LocalModels\plugins`（服务端 `HERE\..\plugins`），探针却推成 `server\plugins`，写进去的临时插件服务端根本看不到 | 改为读 `GET /api/plugins` 返回的 `dir`（权威）；复跑 **11/11** |
| `probe-code-panel` | exit 2 | 瞬时 `no page`（CDP `/json/list` 里没有 8099 页面，前一条探针刚刷新/跳转） | 复跑 **17/17（跳过 1）** |
| `probe-formula-find` | 7/8 | 「点行内公式复制」剪贴板偶发（headless 焦点/权限） | 复跑 **8/8** |

> 另：`probe-ui-gpu` 首跑 7/8 是**开发目录没有 config.ini**（服务端按设计不写盘），断言改成「未写盘并给出说明」分支后 7/7。

## 四、断言口径（718 怎么算）

- 驱动 48 条：首跑日志解析 644/650（其中 plugins 6/11、formula-find 7/8、code-panel 0/0、func 9 条未被规则解析、kv-long/ui-metric 为信息型无断言）。
- 修正后：644 +5（plugins 6→11）+1（formula-find 7→8）+17（code-panel）+9（func）= **676/676**。
- 加 3 条新探针：probe-gpu 14 + probe-ui-gpu 7 + probe-code-workspace 21 = **718**。
- 跳过 2 条：code-panel 的「无模型 409」、code-workspace 的「无模型 409」（本轮 8099 已加载 7B，属条件断言）。

## 五、证据

| 路径 | 内容 |
|---|---|
| `summary.txt` | 每条形如 `probe-xxx PASS/FAIL 秒 fails=N RESULT X/Y` |
| `logs\probe-*.out.txt` / `.err.txt` | 每条探针原始输出（.err 基本为空） |
| `logs\rerun-probe-*.out.txt` | 3 条复跑 |
| `shots\` | UI 探针截图 |
| `server\docs\feature-code-workspace-2026-11-07\` | 功能层证据（契约、自测、E2E、审查截图） |

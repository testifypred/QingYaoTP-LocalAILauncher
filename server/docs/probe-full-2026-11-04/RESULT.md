# 显卡（Vulkan 设备）选择入口 + 50 条全量回归（2026-11-04）

> 结论：**功能做完并验证通过；全量 50 条 / 690 断言全绿**（一次整跑 48 条通过 + 2 条复跑转绿），0 崩溃 / 0 重启。

## 一、这一轮做了什么

| 层 | 内容 |
|---|---|
| 接口 | `GET /api/gpus`（设备清单 index/name/vramGB + current/config/needRestart/backend/pref）、`POST /api/gpus`（写 config.ini 的 `vkDevices`，非法/越界 400） |
| 启动链路 | `Launcher.cs` 读 `vkDevices` → 设 `GGML_VK_VISIBLE_DEVICES`；开发模式由 `app.mjs` 启动段读 config 顶上 |
| 界面 | 设置 → **显卡**：后端/偏好、设备列表（名称+显存）、自动/设备 N 单选、保存、重启提示；CPU 后端时不可选 |
| 可观测 | `app.log`：`Vulkan 设备：0=Intel(R) Arc(TM) Graphics（只可见 0）`；`/api/diag` 新增「显卡选择」检查项 |
| 打包 | `build-portable.ps1` 的 config 模板加 `vkDevices=`；启动器重编译（57,856B） |

## 二、功能验证（本机）

| 项 | 结果 |
|---|---|
| `probe-gpu`（接口，新） | **14/14**：形状、设备项、非法/越界 400、保存写盘、读回自洽、恢复空、diag 有项 |
| `probe-ui-gpu`（界面，新） | **8/8**：页签、后端信息、选项数 = 设备数+自动、保存后 config=0、提示、恢复、无 JS 异常 |
| 端到端（启动器传环境变量） | 写 `vkDevices=0` → 重启启动器 → `current=0` / `needRestart=false` / 日志「只可见 0」✅ |
| 本机设备 | 只有 1 块：`0 = Intel(R) Arc(TM) Graphics`（显存 2GB 共享）。**没有独显可选**，功能为老笔记本（UHD 620 + RX640）准备 |

## 三、全量回归（50 条 / 690 断言）

| 项 | 值 |
|---|---|
| 环境 | 发布包 v1.1.0（含本轮改动），全新工作区 + 驱动预置环境，5 个模型硬链接，vulkan，headless Edge 9336?（9333） |
| 一次整跑 | **48/50**，0 崩溃 / 0 重启，约 19 分钟（机器忙：tools-agent 239s、web-tools 101s） |
| 红项 1 | `probe-start-flow`：**8 条断言全过**，收尾 fetch 撞 `ECONNRESET` 退出码 1 → 复跑 **8/8** |
| 红项 2 | `probe-small-features`：靠「环境里正好有会话」→ `.copyBtn` 为 0 后抛异常 → 已改成**自己造一个带回答的会话 + 等渲染** → 复跑 **6/6** |
| 合计 | **50 条 / 690 断言全绿**（48 条整跑 + 2 条复跑） |

## 四、证据

- `summary.txt` + `logs\probe-*.out.txt`；两条复跑：`logs\rerun-probe-start-flow.out.txt`、`logs\rerun-probe-small-features.out.txt`
- 功能：`logs\probe-gpu.out.txt`、`logs\probe-ui-gpu.out.txt`
- 发布包 `logs\app.log`（无 crash/重启；启动行含设备列表）

## 五、留给下一轮

- **老笔记本真机验证**：设置 → 显卡 看有没有 RX640；有就选它重启；没有就升 AMD 22.6.1（30.0.15021.11005）。
- 交付 **zip 仍未重打**（现在包含 P4 + 显卡选择都只在 dist 运行目录/源码里）；下次交付先重打 zip，并确认包里 exe 是新的 57,856B。
- `probe-start-flow` 的 ECONNRESET 是偶发（keep-alive 连接被服务端关掉），没有当场复现；如果再撞，考虑在探针的 fetch 上加 `Connection: close`。

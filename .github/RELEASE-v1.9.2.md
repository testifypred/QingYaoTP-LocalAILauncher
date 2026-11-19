# v1.9.2 — 老账清算

**发布日期**：2026-11-19 · **类型**：体验修补（代码工作区 + 设置同步）

> 由 **卿峣Testifypred** 出品 · Powered By DeepSeek Harness

## 下载

| 文件 | 大小 | SHA256 |
|---|---|---|
| `QingYaoTP-AILauncher-v1.9.2.zip`（主包，必装） | 127,913,497 B（约 122 MB） | `217ABDC81A5A1996C9DE7023CD2E3E6100D5BE97637E86A84778276CEAC5BA16` |
| `QingYaoTP-AILauncher-v1.6.0-vision-pack.zip`（视觉增强包，选装） | 38,408,198 B（约 37 MB） | 见该文件发布页 |

主包解压后约 **258.7 MB / 3,447 个文件**；**不含**看图 sidecar（拆成可选增强包，不看图可忽略）。

## 本版修的四笔老账

1. **一键纠正的改动自动写回文件**：以前纠正完只改编辑器、要再点「保存」；现在纠正成功直接写回当前文件，状态行显示「已写回文件」，不会出现「以为改了其实没保存」。
2. **新增「保存并运行」按钮**：代码面板顶栏一键「保存 → 运行」，省掉两次点击。
3. **「调用工具」开关同步**：以前勾/取消「调用工具」只改页面状态、toolEnabled 还是加载时的旧值 → 「勾上工具 → 点新对话」会被复位；现在开关改变立即同步。
4. **单条「一键更改」补真模型验证**：scope=single 以前只有 stub 覆盖，本版探针在真模型上补跑并通过。

顺手确认：使用说明.txt 里已没有写死本机路径（modelDir 留空 = 安装目录的 models 子目录）。

## 探针

- probe-code-panel-v2 40 → **44 条**：新增「纠正自动写回文件」「保存并运行按钮」「toolEnabled 同步」「scope=single 真模型」四条。
- 全量驱动仍 **65 条**，断言口径 1,314 → **1,318**。
- 发布包冒烟：probe-version 14/14、probe-debug 54/54、probe-readme 21/21、probe-code-review-export 66/66、probe-code-panel-v2 44/44。

## 升级方式

1. 托盘右键 →「停止服务并退出」；
2. 把新 zip 解压覆盖到原安装目录；
3. 保留 workspace / data / models 三个目录即可无损。

> 目前**没有自动更新**，请以本页版本号为准。

## 已知限制

- 仅 Windows 10/11 x64；Mac / Linux 暂不支持；
- Phi-4-mini 不能用作审查模型（Vulkan 上偶发原生层卡死），界面上已隐藏；
- 云端复审只接受 https（本机回环可用 http），每次调用都要确认目标域名；
- 看图固定走 CPU 编码，因此 1440×900 截图约 40–60 秒。

## 出品

- **出品**：**卿峣Testifypred**（QingYaoTP = QingYaoTestifypred）
- **开发工具链**：**Powered By DeepSeek Harness**

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)

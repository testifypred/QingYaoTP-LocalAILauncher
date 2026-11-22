# v1.11.0 发布包冒烟（dist 实例，2026-11-22 22:45–22:56）

- 实例：`dist\QingYaoTP AILauncher`（v1.11.0，dir=dist\app；4B ctx=16384；视觉增强包已装 source=pack / 53 文件）
- 页面：headless Edge 9333（about:blank + CDP PUT /json/new）

| 探针 | 结果 |
|---|---|
| probe-version | **14/14** |
| probe-debug | **54/54** |
| probe-readme | **21/21** |
| probe-code-window-ui | **10/10** |
| probe-code-panel-v2 | **44/44** |
| probe-code-review-stream | **45/45（跳过 3 项：Phi 切换）** |
| probe-review-watchdog | **56/56** |
| 合计 | **failed=0** |

> 第一次冒烟没设 `PROBE_SKIP_SWITCH` 时，probe-code-review-stream 的 D 段切到 **Phi-4-mini** 后原生层卡死（`/api/state` 超时、CPU 持续涨）——这是已记录的产品风险（Vulkan 上 Phi-4-mini 偶发卡死，界面已隐藏它）。
> 重启发布包实例后按历史惯例设 `PROBE_SKIP_SWITCH=1` 重跑，45/45（跳 3）。发布包冒烟不覆盖 Phi 切换。
> 日志：`smoke-*.log`（`smoke-r2.log` 为最终全绿那一轮）。

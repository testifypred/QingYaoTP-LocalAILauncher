# 证据：v1.9.1 云端复审上游真流式

- 契约：[CONTRACT.md](CONTRACT.md)
- 探针：server/probe-cloud-upstream-stream.mjs（**24 条**，本地 SSE stub，不出网，不需要模型）
- 全量驱动：64 → **65 条**，断言口径 1290 → **1314**

## 结果

| 项 | 结果 |
|---|---|
| dev 8101（v1.9.1 代码）probe-cloud-upstream-stream | **24/24** |
| dev 8099 probe-version | **14/14** |
| dev 8099 probe-code-review-export | **51/51**（API 段；带 CDP 时 66/66） |
| 发布包 v1.9.1 probe-version / probe-debug / probe-readme / probe-code-review-export | **14/14** / **54/54** / **21/21** / **66/66** |
| probe-code-review-verify（A–F 段，分段运行） | 通过（一次 B 段因模型切换挂起 4.5h，判为本机环境问题，非改动） |

## 全量 65 条：本轮未跑成（如实记录）

第一次整跑（probe-full-2026-11-19-v191-r1，已删除不提交）被机器长时间睡眠 + 模型切换卡死污染：
probe-code-review-stream 4040s（正常 45s）、probe-code-panel-v2 exit 13（21325s），后续不可信 → 中止。
System 事件日志有睡眠/恢复记录；判定为环境问题，**下轮找机器清醒时段补跑 65 条**。

## 文件

- dev-8101-stream.txt：dev 8101 上 24/24 的原始输出
- probe-stream.txt / probe-version.txt / probe-verify.txt：dev 8099 目标探针原始输出
- ../packaging-2026-11-19-v191/：打包日志 + 发布包冒烟输出

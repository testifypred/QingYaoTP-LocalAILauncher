# v1.8.0 前端：质询 / 他人复审 / 云端复审（server/app.html）自测说明

- 时间：2026-11-15 23:10–23:30（Asia/Shanghai）
- 改动文件：`server/app.html`（唯一改动；未动 app.mjs / 8099 进程 / dist）
- 联调环境：8099（dev v1.8.0、qwen3-5-4B、context 16384、activeChats=0）+ headless Edge 157（`--headless=new --no-sandbox`，CDP 9334，窗口 1440x900，实测 innerWidth=1408）

## 1) 主联调轮（真模型 + 本地云端 stub）：70/71

证据：`ui-v180-selfcheck.txt`（逐条 ok/FAIL + 明细）

- 单锁五项互斥：质询进行中 #cwReview/#cwFixAll/#cwCross/#cwCloud/#cwChallenge 全 disabled，进行中项变「停止」→ ok
- 质询真跑 1 轮：15.1s；`.cwChalCard/.cwChalQ/.cwChalA` 先建卡再流式填（回答 204 字），history 记 1 轮 → ok
- 质询中断：Network `net::ERR_ABORTED`、状态「已停止（质询已中断）」、按钮恢复 → ok
- 他人复审（自动换模型 → DeepSeek-R1-8B）：258.2s；verdict「互相矛盾」`.err` + stats 计数；两栏 4/0；差异清单 4 条 `.onlyP`；点条目跳行 want=2 got=2 → ok
- 窄窗：Emulation 1000px 下 `.cwCrossCol` flex-basis=100%（换行）、无横向溢出 → ok
- 审查中断：#cwReview 进行中可点、`ERR_ABORTED`、状态「已停止（审查已中断）」、5 个按钮文案/可点全部复原 → ok
- 云端 ready=false：toast「云端复审还没配置好：去 设置 → 代码 …」，不弹窗、stub 0 命中 → ok
- 云端 ready：确认窗 `#cloudConfirmHost` 含 host；取消 0 发送；确认后 stub 1 次；上游请求体已脱敏（无原 sk-/邮箱/IP，含 `<API_KEY>`/`<EMAIL>`）；meta「云端 · 127.0.0.1:12189 · stub-model · 0.1s」；findings 写回 `#cwIssues` 且 `#cwFixAll` 可用 → ok
- 设置→代码：GET 回填（enabled/base/model 正确；`#cloudKey` value 为空、masked 占位 `sk-***0001`、type=password）；保存失败写「保存失败（INSECURE_URL）：…」；清除 Key 后 hasKey=false/ready=false 且占位回默认 → ok
- **唯一 FAIL 是测试脚本自身正则写错**（要求 class 里带字面量点，实际类名是 `cwVerdict err` 形式），产品 class 正确；由下面合成校验补证。

## 2) 合成 compare 校验（不跑模型，确定性验 3 种判定 + 4 类差异）：6/6

证据：`ui-v180-synthetic-compare.txt`、`ui-v180-cross-verdicts.png`

- consistent → 徽标 `.ok`，差异 `.agree`
- differs → 徽标 `.warn`，差异 `.agree/.onlyP/.onlyS`
- contradicts → 徽标 `.err`，差异 `.conflict`

## 3) 第三方探针（probe-verify）E 段 UI：12/12 通过

证据：`probe-verify-ui-confirm.png`、`probe-verify-ui-cloud.png`

## 截图清单

- `ui-v180-challenge.png`：质询卡片（问/答）+ 问题卡片
- `ui-v180-cross.png`（1440x900）：verdict 徽标「互相矛盾 · 原审查 4 · 他人 0 …」+ 并列两栏
- `ui-v180-cross-verdicts.png`：合成 compare 的 `.err` 徽标 + 差异清单
- `ui-v180-cloud-confirm.png`：确认弹窗（host + 已脱敏说明）
- `ui-v180-cloud-result.png`：meta「云端 · host · stub-model · 0.1s」+ findings 写回卡片
- `ui-v180-settings-cloud.png`：设置→代码 云端复审卡片（masked key 占位）

## 环境复原（已确认）

- 8099：模型切回 qwen3-5-4B-Q4_K_M.gguf / context 16384；云端配置复位为默认（enabled=false、baseURL=""、hasKey=false；`data\cloud-review.json` 已删除 → GET 全默认）；样例 `code/probe-v180.js` 已删；**未重启 8099**。
- 9334 Edge 已关闭；9333/8099 未被其它操作占用。

## 遗留 / 注意

1. 他人复审自动换模型耗时不可控：这次切 DeepSeek-R1-8B 用了 258.2s（换模型 + 两阶段），期间单锁占满、`/api/load` 会 409。属预期，UI 只靠「已用 Xs」提示。
2. 第二审查员 0 问题而原审查 4 条 → 按契约 §1.2 判「互相矛盾」（一方 0、一方 ≥1），UI 如实显示；符合契约，未改。
3. 云端 ready=false 只 toast 指路、不自动打开设置（契约「不弹窗」），用户需手动进 设置 → 代码。
4. 复核脚本两处 bug（收尾 token 作用域、徽标正则）已修但未整轮重跑（避免再切一次模型）；产品结论由 主轮 + 合成校验 + 探针 E 段 三方交叉验证。
5. 旧探针回归由 Lead 的全量 r2 覆盖，本次未跑。

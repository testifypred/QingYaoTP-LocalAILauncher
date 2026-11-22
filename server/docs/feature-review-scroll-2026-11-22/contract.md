# 代码审查面板滚动修复（2026-11-22）

> 用户反馈：代码工作区「模型审查」进行中会输出审查思路和意见，但这期间审查栏**不能上下滚动**。

## 根因

`server\app.html` 的 `cwThinkAppend()` 每收到一个 SSE delta 就执行：

```js
cwThinkTextEl.textContent += String(text);
if (cwThinkEl.open) cwReviewBodyEl.scrollTop = cwReviewBodyEl.scrollHeight;
```

审查思路是逐 token 流式的，等于**每个 token 都把 #cwReviewBody 强行滚到底**；用户用滚轮往上翻，下一个 delta 立刻拽回去，所以「不能上下滚动」。
另外 `textContent +=` 会重建文本节点，思路框（#cwThinkText）内部滚动位置也会被重置。

## 修法

`cwThinkAppend()` 改为「**只在本来就在底部附近时才跟随**」：

- 外层面板 `#cwReviewBody`：距底 < 80px 才跟随；
- 思路框内部 `#cwThinkText`：距底 < 40px 才跟随；
- 文本用 `Text.appendData()` 追加（不重建节点，不重置滚动位置）；
- 用户手动上滚后不再打断；滚回底部后自动恢复跟随。

## 验收（新探针 `probe-review-scroll`，10/10）

| # | 断言 | 结果 |
|---|---|---|
| 1 | 有 `#cwReviewPanel` | ok |
| 2 | 有 `#cwReviewBody` 与 `cwThinkAppend` | ok |
| 3 | 能打开面板并强制布局 | ok |
| 4 | 追加内容后外层面板跟随到底部 | ok |
| 5 | **用户上滚后，追加不再把面板拽回底部**（核心回归） | ok：bodyTop 保持 0 |
| 6 | 用户滚回底部后，恢复自动跟随 | ok：gap=0 |
| 7 | 思路框内部滚到中间后，追加不重置位置 | ok：preTop 30 → 30 |
| 8 | 思路框内部在底部时，追加会跟随 | ok：preGap=0 |
| 9 | 全程无 JS 异常 | ok |
| 10 | 收尾复位（面板/思路/样式） | ok |

## 文件

- `server\app.html`：`cwThinkAppend()` 重写；
- `server\probe-review-scroll.mjs`（新，10 条）；
- `server\docs\run-full.ps1`：注册探针（67 → 68 条）；
- `dist\QingYaoTP AILauncher\app\app.html` 已同步，8099 已重启（4B 已加载）；
- 全量口径：探针 88 → 89、全量 67 → 68、断言 1448 → 1458。

## 证据

- `probe-review-scroll.log`（10/10，本目录）

# 思考等级标签按界面分化，摘要压缩不再输出结果文案

- **Date:** 2026-08-19
- **Type:** fix
- **Scope:** `web`
- **PR:** [#340](https://github.com/Prism-Shadow/penguin-harness/pull/340)

[English](2026-08-19-thinking-label-and-compaction-notice.md)

对话界面的两处显示修正。中文的思考等级标签不再处处带上线路值，只在挑选档位的地方带；`summarize` 压缩完成后，也不再复述该行自己展开就能看到的内容。

## 思考等级标签

- `S.chat.thinkingLevelNames` 改为纯粹的档位名：中文读作 低 / 中 / 高 / 极高 / 最高，历史遗留的 `none` 另有 无；英文仍是它一贯的名字，即线路值本身。凡是展示「已选定档位」的界面都读它——草稿态与活动会话两个输入框选择器的按钮与悬浮提示、对话中途的切换确认框及其 toast，以及 Project 对话缺省值的控件与其只读视图。
- `S.chat.thinkingLevelMenuName` 负责组合下拉行的变体，在名字后附上这次挑选将要发送的线路值（`极高 (xhigh)`）。只有输入框自己的下拉菜单调用它：Project 对话缺省值用的是原生 `<select>`，它会把选中项自身的文字画到收起后的控件上，给行加注解等于把线路值又送回了按钮。
- 英文没有分化。它的档位名本就是线路值，所以 `thinkingLevelMenuName` 只接名字并原样返回，不去复制一份表。
- 新增一道防漂移测试，用 core 的 `DEFAULT_CHAT_THINKING_LEVELS` 去核对两份真实词典——此前 Web 的测试只跑一个手写替身：每个档位在两种语言下都有名字，中文名一律不含拉丁字母与圆括号，而带注解的变体必须含有线路值。

## 压缩行

- `summarize` 压缩完成后不再渲染任何结果文案：`compactionDone` 对该模式返回 undefined，`StepBanner` 随之整个略去 detail 槽位，只留状态图标、标题、耗时，以及那个点开就是摘要本身的折叠箭头。
- `discard` 压缩保留了它的文案——已丢弃旧上下文 / "old context discarded"——这是该行没有别的办法呈现的结果，因为这一模式压根不写摘要正文供展开。

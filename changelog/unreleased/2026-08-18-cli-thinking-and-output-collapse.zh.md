# CLI：运行期调整思考等级与折叠工具输出

- **Date:** 2026-08-18
- **Type:** feature
- **Scope:** `cli`, `docs`
- **PR:** [#322](https://github.com/Prism-Shadow/penguin-harness/pull/322)
- **Issue:** [#305](https://github.com/Prism-Shadow/penguin-harness/issues/305)

[English](2026-08-18-cli-thinking-and-output-collapse.md)

CLI 模式新增两项运行期控制，此前它们要么得去改 Agent 配置、要么根本没有：思考等级可在每次调用时指定，也可在对话中途改动；chat REPL 对过长的工具输出做首尾折叠，并留下 `/verbose` 这个出口。CLI 参考文档同步收录了两者。

## 思考等级

- `penguin run --thinking <low|medium|high|xhigh>` 与 `penguin chat --thinking <level>` 在 Session 创建时钉定其思考等级，派生的子会话随之继承。省略时沿用原有的配置链：Agent 的 `model.thinking_level`，其次 Project 的 `default_chat.thinking_level`，最后 `medium`。
- 在 chat REPL 中，`/thinking` 报出下一轮将使用的等级——并指明它是本 Session 的缺省值还是生效中的逐轮覆盖值，后者同时给出被覆盖的那个缺省值——`/thinking <level>` 则覆盖后续轮次。该覆盖是逐轮的 `RunOptions.thinkingLevel`，与 Web 端活动会话选择器保持一致，永不写回 Agent 配置；只有 Session 自身的等级才会传到派生的子会话。`--resume` 之下这个 flag 转而作为初始覆盖值生效，因为已恢复 Session 的构造参数是固定的。
- 可选等级复用 core 的 `DEFAULT_CHAT_THINKING_LEVELS`（不含 `none`，与 Web 选择器一致）；历史遗留的 `none` 仍按原样显示。

## 工具输出折叠

- chat REPL 缺省折叠过长的工具输出：前 4 行照常流式打印，流结束时打印省略标记（`……（另有 N 行，/verbose 显示完整输出）`）与最后 4 行。不超过 9 行的输出完整呈现，标记也绝不会为了藏起不足 2 行而出现。`--resume` 恢复的历史按同一规则折叠，同一份输出报出的隐藏行数与实时流完全相同。
- 折叠只作用于显示层：无论折不折叠，模型、Trace 与 Web App 拿到的都是完整文本。
- `/verbose` 可在对话中途切换到完整输出，`penguin chat --verbose` 则在启动时就把折叠关掉。`penguin run` 从不折叠——它的输出要供管道和嵌套 CLI 消费。
- 被中断切断的工具输出流，仍会在任务结束时把扣住的尾部补齐落屏，不会有内容悄无声息地从屏幕上消失。

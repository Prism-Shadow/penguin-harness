# 公司模式的频道消息更短

- **Date:** 2026-11-03
- **Type:** fix
- **Scope:** `plugins`, `server`
- **PR:** [#1434](https://github.com/Prism-Shadow/penguin-harness/pull/1434)
- **Issue:** [#1394](https://github.com/Prism-Shadow/penguin-harness/issues/1394)

[English](2026-11-03-company-channel-messages.md)

为公司模式的员工规定了频道消息的写法：第一行是要点或问题，其后最多五行短句，更长的内容写进文档，消息里给出它的路径。`company-employee` 与 `company-ceo` 两个 Skill 升到 `2026.11.03.1`，已有的组织在下一次调和时就会换上。

## 细节

- `company-employee` 新增「Writing a channel message」一节：消息不复述组织页面上已有的内容，不重申规则，不加免责套话，也不是本轮的最终答复；多行消息用带引号的 heredoc 传入。
- 开始做、正在做、做完分内工作以及回执都不再发到频道；只有需要别人据此行动时才发消息，并 @ 那个人。交接只写一行并带上工单；员工不再 @ 自己，因为这样的提及永远送不到。
- CEO 给董事会的提案与汇报把要拍板的事放在最前，理由、成本和备选方案各占一行短句。初始化提案仍是唯一可以写长的消息：编号的问题放在开头，方案分成几小节、用要点写；初始化完成后的汇报只写与提案不同的地方和下一个需要拍板的决定。
- 新建组织时生成的手册在中英两版里写入同样的频道礼仪；已有组织的手册保持不变。

# 「复制 Session ID」，位置移到归档之后

- **Date:** 2026-09-02
- **Type:** fix
- **Scope:** `web`, `docs`

[English](2026-09-02-copy-session-id-label.md)

会话行的复制 id 操作在所有出现之处——右键菜单与详情卡的复制按钮——都改为**复制 Session ID**（英文 Copy Session ID），并在右键菜单里移到归档与删除之间。菜单顺序现为置顶、重命名、远程控制、归档、复制 Session ID、删除：先是改变会话的操作，然后是这一项什么都不改的，紧挨着结束它的那一项。

## 细节

- 两套词典的 `chat.copySessionId` 换用新文案；`contextMenuActions` 对可置顶行与折叠夹内的行都采用新顺序，单元测试与 e2e 断言随之更新。
- Web App 文档按新顺序列出该菜单。

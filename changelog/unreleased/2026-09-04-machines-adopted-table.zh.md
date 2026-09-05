# 早于迁移的 machines 表补齐列，失败的任务总是给出下一步

- **Date:** 2026-09-04
- **Type:** fix
- **Scope:** `server`

[English](2026-09-04-machines-adopted-table.md)

从一个数据根目录在 machines 线发布之前就跑过它的安装上连接一台机器，发现了两件事。连接在「Opening the connection…」处失败，报 `table machines has no column named session_pid`：迁移 4 用 `IF NOT EXISTS` 创建 machines 各表，已经存在的表就按它原有的列被接管——记的是转发而不是会话——而连接写入的那一行点名了一个它没有的列。随后没有任何东西给出下一步：「照样安装」按钮只在点了名的那些失败里出现，而这次失败没有。

## 细节

- 迁移 5 `machines-columns` 为缺少 `session_pid` 和 `platform` 的 machines 表补上这两列，已有的表原样保留。纯增量且可在热推送时应用；它的回退什么也不做，因为迁移 4 声明的正是同样的列。
- 每一次失败的安装或连接现在都会提供「照样安装程序」。两种情况不提供：这次运行本身就是那次安装；以及安装也无法弥补的那一种失败——本服务端自己没有可发送的构建——结果里现在明确写 `canReplaceProgram: false`。页面仍然绝不自作主张地执行它：它会重启一台别人可能正在用的服务器。

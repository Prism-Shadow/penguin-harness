# Claude Code 表面会在安装器放它的地方找到 `claude`

- **Date:** 2026-09-07
- **Type:** fix
- **Scope:** `plugins`

[English](2026-09-07-claude-code-finds-its-program.md)

在机器上打开 Claude Code 会话时报 `execvp(3) failed.: No such file or directory`——而那个程序明明装着，也在操作者自己的 PATH 上。

原因在于机器上的服务端是怎么启动的，与这个工具无关：它由**非交互式 ssh** 拉起，PATH 只有 `/usr/local/bin:/usr/bin:/bin`。不会读取任何 profile，于是 Claude Code 安装器放它的 `~/.local/bin` 不在其中，而 pty 继承的正是这个 PATH。

现在表面会在 spawn 之前解析程序：先看 `PENGUIN_CLAUDE_BIN`，再查 PATH，最后查安装器会用的几个位置（`~/.local/bin`、`~/.claude/local`，以及两种包管理器的目录）。PATH 优先于这些兜底位置——那是操作者自己的 shell 会执行的那一个。

如果确实无处可寻，就在 spawn 之前拒绝打开，并在消息里列出**查过的每一个位置**以及可以覆盖它的环境变量——而不是把 C 库对一个它从未被告知含义的名字的回答丢给读者。

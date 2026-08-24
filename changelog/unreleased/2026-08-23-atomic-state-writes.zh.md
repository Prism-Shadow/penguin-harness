# Harness 的状态文件一律原子替换

- **Date:** 2026-08-23
- **Type:** fix
- **Scope:** `core`, `server`, `cli`, `desktop`

[English](2026-08-23-atomic-state-writes.md)

Harness 落在磁盘上的那些文件——`system_config.yaml`、`.project_config.toml`、`.vault.toml`、
`AGENTS.md`、`MEMORY.md`、定时任务文件、`GOAL.yaml`——此前都是就地覆盖写，写到一半遇上崩溃或磁盘写满，
留下的就是一个被截断的文件。而被截断的 `system_config.yaml` 未必会响亮地失败：截断点落在
`system_prompt` 块标量内部时，文件仍是合法 YAML，Agent 照常启动，但它后面的工具列表、MCP 服务器、
vault 与 skills 设置已经悄悄消失，用户下一次在 Web 上改配置，又把这份残缺文档当成新的事实持久化下去。
`atomicWriteFile` 原本只是 `write_file` / `edit_file` 两个工具的私有 helper，现在移到 core 的公开出口，
成为这些文件唯一的写入口：内容先写进同目录下的临时文件，flush 之后再 rename 覆盖目标，读者看到的要么是
旧字节，要么是新字节。

## 细节

- 存有密钥的文件（`.project_config.toml`、`.vault.toml`）的 `0600` 权限位改由临时文件上的显式 `chmod` 施加，不受 umask 影响，因此无论新建还是替换，权限都准确落到 0600。
- 被软链接进 dotfiles 仓库的配置文件仍然会被写穿，`penguin lang` 改写的 shell 启动文件同样如此。Memory 目录是例外，维持原样：那里模型可写，落在主题文件名上的软链接会被替换，而不是被跟随出这个 scope。
- Memory 索引裁剪（从 `MEMORY.md` 中删掉某个主题的行）不再就地覆盖索引，而是走与其他 Memory 写入相同的写入口。
- 桌面端的 `~/.local/bin/penguin` wrapper 改为 rename 就位，写失败时留在 PATH 上的是原来那个命令，而不是一个被截断的脚本。

## Skills

安装 Skill——无论来自内置库还是导入的 zip——都先写进一个点号开头的暂存目录，最后一步整体换入。此前是先删掉旧目录、
再逐个写入新文件，而判定"已安装"的唯一标准就是 `<name>/SKILL.md` 存在，于是在错误的时刻中断，会留下一个
看起来装好了的残缺 Skill。两处 Skill 列举都会跳过点号开头的目录——Skill 名字不可能是这种形式。

## 热更新

推送的字节与磁盘上已有文件完全一致时不再重写，其余情况一律 rename 就位。重复推送同一版本、或回滚到之前装过的
版本时，写的正是当前 manifest 已经指向的那个内容寻址文件；这次重写中途崩溃，留下的就是一个指向被截断 bundle 的
完好 manifest，而运行时正要用它启动。

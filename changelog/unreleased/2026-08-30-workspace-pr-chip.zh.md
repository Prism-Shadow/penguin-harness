# 对话头部标出它的 Workspace 正在进行的 Pull Request

- **Date:** 2026-08-30
- **Type:** feature
- **Scope:** `server`, `web`

[English](2026-08-30-workspace-pr-chip.md)

Workspace 上有开放 Pull Request 的对话,现在会在头部统计行的末尾标出来:显示编号,悬停显示标题,点击在新标签页打开该 Pull Request。

## 显示什么

以 Workspace 当前分支为 head 的开放 Pull Request,仅此一种。已合并或已关闭的不是这个 Workspace 正在做的事;而 head 是别的分支的,是 `gh` 通过跟踪分支解析过去的结果——否则一个跟踪 `main` 的分支会显示出 `main` 的 PR。

## 数据从哪来

由持有该 Workspace 的 server 在其目录中运行 `gh`。不存储也不配置任何凭据:`gh` 本就持有用户的认证,也本就知道 remote。答案按 Workspace 与分支缓存 30 秒,因此打开对话不会每次都启动进程;对话切换时与窗口重新获得焦点时会重新询问——这使得在终端里切换分支后,该标记会跟着变。

所有可能出错的情况表现一致:什么也不显示。分支没有 PR、没装 `gh`、未登录、不是仓库、HEAD 处于游离状态、没有网络——标记就是不出现。头部标记用来报告工作,不用来报告故障。

# 对话头部标出它的 Workspace 正在进行的 Pull Request

- **Date:** 2026-08-30
- **Type:** feature
- **Scope:** `server`, `web`
- **PR:** [#555](https://github.com/Prism-Shadow/penguin-harness/pull/555)

[English](2026-08-30-workspace-pr-chip.md)

Workspace 上有开放 Pull Request 的对话,现在会在头部统计行的末尾标出来:显示编号,悬停显示标题,点击在新标签页打开该 Pull Request。

## 显示什么

以 Workspace 当前分支为 head 的开放 Pull Request,仅此一种。已合并或已关闭的不是这个 Workspace 正在做的事;而 head 是别的分支的,是 `gh` 通过跟踪分支解析过去的结果——否则一个跟踪 `main` 的分支会显示出 `main` 的 PR。

## 数据从哪来

两个来源,按顺序,都由持有该 Workspace 的 server 询问。

先是在该目录中运行 `gh`:它本就持有用户的认证、本就知道 remote,也能访问私有仓库,因此无需存储或配置任何东西。没有 `gh` 时——只用来跑 agent 的机器通常都没有——改由 GitHub 的 REST API 回答:匿名请求可覆盖公开仓库,环境里有 `GH_TOKEN` / `GITHUB_TOKEN` 时则带上。`gh` 自己的凭据存储被刻意不去读取,那属于另一个程序。

`gh` 若回答"该分支没有 PR",以它为准,不再发起请求。

答案按 Workspace 与分支缓存 30 秒,因此打开对话既不会每次启动进程也不会每次发请求;对话切换时与窗口重新获得焦点时会重新询问——这使得在终端里切换分支后,该标记会跟着变。

所有可能出错的情况表现一致:什么也不显示。分支没有 PR、既没有 `gh` 也够不到 API、哪里都没登录、私有仓库又没有 token、不是仓库、HEAD 游离、remote 不是 GitHub、没有网络——标记就是不出现。头部标记用来报告工作,不用来报告故障。

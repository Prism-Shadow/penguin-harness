# Workspace 文件的地址跟随 Session 去它所在的机器

- **Date:** 2026-08-30
- **Type:** fix
- **Scope:** `web`
- **PR:** [#554](https://github.com/Prism-Shadow/penguin-harness/pull/554)

[English](2026-08-30-workspace-file-urls-follow-machine.md)

预览运行在机器上的 Session 里的文件,无论什么类型都回答"该类型不支持预览,请下载";图片、PDF 和下载同样失败,消息里附带的图片也是。文件一直都在,只是应用问错了 server。

## 细节

- 关于某个 Session 的调用,会按请求路径上的规则被路由到该 Session 所在的机器,这条规则由 fetch 封装应用。有三个地址从不经过它,因为它们是 URL 而不是调用:Workspace 文件内容 URL(直接用于 `fetch`、`<img>`、`<iframe>` 和下载链接),以及消息附件的 scratchpad URL。现在它们自己应用同一条规则。
- Workspace 浏览器把"读不到的文件"报告为"渲染不了的类型",所以这个失败才表现为"不支持预览"而不是一个错误。

## 已知缺口

对隔离 HTML 预览的"在新标签页打开",在机器上的 Session 仍然不可用:它是一次指向预览源的重定向,而承载机器调用的代理会刻意丢弃 `Location` 头。应用内的渲染预览不受影响。

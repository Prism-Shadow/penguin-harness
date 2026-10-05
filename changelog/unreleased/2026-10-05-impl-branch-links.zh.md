# 提案的 impl branch 可以在 GitHub 上打开

- **Date:** 2026-10-05
- **Type:** feature
- **Scope:** `company-proposals`, `server`, `web`

[English](2026-10-05-impl-branch-links.md)

登记的 impl branch 的 head 与 base 在提案页上只是文字，审阅的人要自己去仓库里找分支。

## 改动

- 提案视图的 `impl.head` 与 `impl.base` 各自带上 `url`——该分支在 GitHub 上的页面（`https://github.com/<owner>/<repo>/tree/<branch>`），或者 `unresolved`——解析不出的原因。写成 `owner/repo` 的一侧直接使用；写成 remote 名的，先查插件的 `origins` 设置，再查共享工作区的 GitHub remote（登记时读到的）。只认 GitHub 的地址，https 与 ssh 两种形式均可。登记的数据不变：链接在每次读取时算出，不运行 git。
- 提案页的「实现」一节里，有页面的一侧渲染成在新标签页打开的链接，没有的保持文字，悬停提示说明原因。PR 链接照旧。

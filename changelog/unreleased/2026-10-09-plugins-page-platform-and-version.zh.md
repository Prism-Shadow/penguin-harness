# 插件页按本机读：已装插件显示盘上的版本，其他平台的沙盒后端标出且不可安装

- **Date:** 2026-10-09
- **Type:** feature
- **Scope:** `server`, `web`, `plugins`

[English](2026-10-09-plugins-page-platform-and-version.md)

插件页给已装插件显示的是 registry 条目里的版本——盘上装成 0.2.2 的副本会读成索引里列的 0.2.3——而另一个平台的沙盒后端（Linux 上的 macOS 那个或 Windows 那个）被当成普通可装项：按钮可用，只有一个关键词提示不匹配。

## 改动

- `GET /api/projects/:projectId/plugins/installed` 为每个已装插件报出本机盘上解析到的 `version`——读它自己的 `package.json`，那是磁盘上的真实版本，可能落后于 registry 的条目——并且响应带上本机的 `platform`（`process.platform`）。
- registry 条目可以写 `os`——插件运行的平台（`process.platform` 的词；不写表示所有平台）。内置索引从包自己的 `penguinOs` 字段读它——npm 自己的 `os` 字段会让 npm 在其他平台直接拒装，而内置前缀要在它构建的每个平台装上所有后端——沙盒后端各自声明自己的平台：bubblewrap 是 Linux、Seatbelt 是 macOS、WSL 是 Windows；DSH 哪里都能跑、不声明。
- 插件页的已装行显示在看的机器自己的回答里的版本——看哪台机器，就说的是哪台的副本——其他平台的可装条目保留但标出「仅适用于 macOS」／「仅适用于 Windows」，安装按钮禁用、悬停说明原因，并排到最后。
- 已装行的描述对 registry 的回答诚实：回答没到之前那一行留空，不声称「没有条目」；请求失败时说来源不可用。

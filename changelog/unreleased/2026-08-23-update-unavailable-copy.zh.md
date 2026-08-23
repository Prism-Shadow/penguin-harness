# 不支持更新时的文案改为说明 AppImage 规则，不再假定用户装的是 dpkg 包

- **Date:** 2026-08-23
- **Type:** fix
- **Scope:** `desktop`, `web`

[English](2026-08-23-update-unavailable-copy.md)

在 Linux 上外壳只能替换 AppImage，因此其余所有形态——`.deb` 安装，以及解压出来的目录树——都
落进同一个「不支持」状态。此前上报这个状态的两处都说这份拷贝来自系统包管理器、请到那里更新，
对任何不是用 `.deb` 安装的人来说都是错的指引。现在桌面对话框和账户菜单里的那一行都会说明规则
并给出两条路径：包安装走包管理器，其余手动下载。

## 细节

- Web 侧的字符串在两份词典里都从 `clientUnsupportedPackage` 更名为
  `clientUnsupportedNonAppImage`，让键名指向它实际渲染的条件。
- `electron-builder.yml` 中 `extraMetadata` 的注释不再声称 `name` 决定应用数据目录；外壳自己的
  `app.setName()` 在任何东西读取 `userData` 之前就已执行。

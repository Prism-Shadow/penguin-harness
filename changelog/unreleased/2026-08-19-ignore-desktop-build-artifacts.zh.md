# 桌面端打包产物在所有分支上都被忽略

- **Date:** 2026-08-19
- **Type:** process
- **Scope:** `desktop`
- **PR:** [#331](https://github.com/Prism-Shadow/penguin-harness/pull/331)

[English](2026-08-19-ignore-desktop-build-artifacts.md)

`packages/desktop/.gitignore` 在原有的 `stage/` 之外增加了 `bin/`、`out/` 与 `skills/`，桌面端打包运行后不再留下未被跟踪的文件。

## 细节

- `bin/` 存放生成的 `penguin` / `penguin.cmd` 启动器，`out/` 是 electron-builder 的输出，`skills/` 则是 `packages/skills/skills` 的一份副本——其源头本身已被跟踪。
- 写入这些路径的脚本只存在于引入它们的那些分支上，而每个分支都在自己的 `.gitignore` 里带了同样这三条规则。产物却会在切换分支后留存下来，于是任何其他分支上的工作区都持有着这些既未跟踪、也未被忽略的文件——340 MB 的解包应用，距离一次 `git add -A` 只有一步之遥。

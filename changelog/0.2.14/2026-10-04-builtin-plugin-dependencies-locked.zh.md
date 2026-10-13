# 随包插件的依赖按锁定版本安装

- **Date:** 2026-10-04
- **Type:** feature
- **Scope:** `build`, `plugins`
- **PR:** [#979](https://github.com/Prism-Shadow/penguin-harness/pull/979)

[English](2026-10-04-builtin-plugin-dependencies-locked.md)

`scripts/build-plugins.mjs` 装进随包插件 prefix 的第三方包现在就是 `pnpm-lock.yaml` 解析出的版本，并且它们的许可证随包一起发布。

- 构建从 `pnpm-lock.yaml` 读出各插件原生依赖的闭包（包括每个目标平台的分平台包），写进 prefix 清单的 npm `overrides`，使 npm 连传递依赖也安装完全相同的版本（DSH 依赖链与 koffi 共 23 个包，例如 `@deepseek-ai/cordis` 为 4.0.1，而 npm 原先解析到 4.0.4）。第二次安装补装的分平台包也取自同一个闭包。
- 安装完成后，若 npm 的依赖树里出现锁文件没有列出的包或版本、缺少锁文件列出的包，或某个 tarball 的 integrity 与锁文件的 `resolution.integrity` 不同，构建即失败。这些锁文件条目计入构建的缓存键。
- 构建在 prefix 根目录写出 `THIRD-PARTY-NOTICES.md`，prefix 发布到哪里它就跟到哪里：每个第三方包一节，列出许可证标识、仓库、主页与完整许可证文本。koffi 的分平台包自身不带许可证文件，因此它们的小节使用 koffi 的许可证文本并注明来源；其他包若缺少许可证文本，构建直接失败。

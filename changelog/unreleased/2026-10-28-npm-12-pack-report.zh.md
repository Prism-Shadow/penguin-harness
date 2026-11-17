# npm 12 下的插件导入

- **Date:** 2026-10-28
- **Type:** fix
- **Scope:** `server`
- **PR:** [#1381](https://github.com/Prism-Shadow/penguin-harness/pull/1381)
- **Issue:** [#1366](https://github.com/Prism-Shadow/penguin-harness/issues/1366)

[English](2026-10-28-npm-12-pack-report.md)

装有 npm 12 的机器上，从 zip 导入插件会失败，提示 "npm pack did not report the tarball it wrote"。npm 12 把 `npm pack --json` 的报告输出为以包名为键的对象，npm 11 输出的是数组；安装器原先从输出里的第一个 `[` 开始读取报告，而在 npm 12 的报告里，这个 `[` 是包的 `files` 列表的开头。安装器改为从两种格式中读取压缩包文件名，并且仍然拒绝没有给出压缩包名、或名字带目录部分的报告。

# 沙盒后端发布到 npm

- **Date:** 2026-09-29
- **Type:** process
- **Scope:** `plugins`, `release`, `ci`, `tooling`
- **PR:** [#910](https://github.com/Prism-Shadow/penguin-harness/pull/910)

[English](2026-09-29-publish-sandbox-plugins.md)

- 四个沙盒后端 `@penguinharness/sandbox-{bwrap,seatbelt,wsl,dsh}` 不再是 private。与其他已发布的插件一样，由发布流程按 tag 版本发到 npm。包清单补齐了发布所需的字段：公开访问、带目录的 `repository`、`engines.node >=24`，并把 `LICENSE` 列入随包文件。
- 自带的 bwrap 从 npm 安装后可以运行：
  - 包清单把两个架构的二进制都标为可执行（`publishConfig.executableFiles`）；
  - 它们加载的 libcap 以带版本号的文件名、按普通文件随包发出，因为包的 tarball 不带符号链接。

  改动之前，从包安装的副本里，bwrap 没有可执行位，也缺少它链接的 `libcap.so.2`。
- 发布预检（`scripts/check-publishable.mjs`）现在还会检查已发布的包是否依赖 private 插件，发现即失败，不再只查 private 包。
- 发布参考文档补上了新包名首发的流程。下一个 tag 之前，由维护者手工首发四个后端，再为每个包配置 Trusted Publisher。

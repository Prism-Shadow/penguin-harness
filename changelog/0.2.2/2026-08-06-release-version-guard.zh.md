# 发布工具链：仓库版本不再能落后于已发布的版本

- **Date:** 2026-08-06
- **Type:** process
- **Scope:** `ci`, `tooling`
- **PR:** [#219](https://github.com/Prism-Shadow/penguin-harness/pull/219)

[English](2026-08-06-release-version-guard.md)

v0.2.1 是从一个版本号仍为 0.2.0 的仓库上打的 tag——它的发布准备 PR 移动了 changelog 并写了 RELEASE.md，却漏掉了 0.2.0 发布准备时执行过的版本号提升——于是每一个 dev/源码构建都拿自己去和已发布的 v0.2.1 比较，从而无休止地提示更新，而发布产物（在构建时由 tag 打戳）看起来一切正常。

- 根级与每个 `packages/*/package.json` 的版本号，连同 core 的 `VERSION` 常量，一并提升到 0.2.1，与已发布的版本对齐。
- `release.yml` 的两处打戳步骤（release 任务与并行的 npm 发布任务）现在会拒绝版本号与仓库 `package.json` 不匹配的 tag 推送，并在错误信息中写明修法。手动的 `workflow_dispatch` 只给出警告，因此一个 Release 丢失了的旧 tag 仍能从它自己的源码重建；安装脚本测试的固定数据会自行跳过该检查（回放目录中没有 `package.json`），使这段打戳代码块仍可被 `scripts/test-installer.sh` 回放。
- `CONTRIBUTING.md` 把版本号提升记录为一项显式的发布准备步骤，与 changelog 改名和 RELEASE.md 并列。

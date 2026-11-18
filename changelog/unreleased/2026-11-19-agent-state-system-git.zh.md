# 工作台版本沿用你的 Git 身份

- **日期：** 2026-11-19
- **类型：** refactor
- **范围：** `server`
- **PR:** [#1608](https://github.com/Prism-Shadow/penguin-harness/pull/1608)

[English](2026-11-19-agent-state-system-git.md)

macOS、Windows 和使用 glibc 的 Linux 版 PenguinHarness 随附 Agent State 所需的 Git，首次启动就可以离线保存和恢复工作台版本。在原有的裸仓库中，你仍然可以查看和恢复旧版本，版本号保持一致。新提交会读取 Git 配置和环境变量中的作者及提交者身份。姓名缺失时使用 `PenguinHarness`，邮箱缺失时使用 `penguin@localhost`，仅对这一次提交生效。

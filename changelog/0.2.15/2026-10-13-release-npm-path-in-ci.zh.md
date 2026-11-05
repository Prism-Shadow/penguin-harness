# 发布：npm 任务的盖版本号与测试也在 CI 里跑

- **Date:** 2026-10-13
- **Type:** process
- **Scope:** `ci`, `tooling`
- **PR:** [#1085](https://github.com/Prism-Shadow/penguin-harness/pull/1085)

[English](2026-10-13-release-npm-path-in-ci.md)

v0.2.14 的发布流程在 npm 任务里失败，当时还什么都没有发布：这个任务会把 tag 的版本号盖到要发布的每个包上，沙箱后端也在其中，却没有同步服务端内嵌的沙箱后端索引，而一个服务端测试正好比对两者。CI 从不盖版本号，所以一直是绿的。这次改为以 0.2.15 发布。

## 细节

- npm 任务的盖版本号与测试套件移到 `scripts/release-npm.sh`（`stamp <tag>`、`test`）。`release.yml` 调用它，CI 的 `npm packaging` 任务也在每个 PR 上调用：用仓库自己的版本号盖章、构建整个工作区，再跑同样的测试套件。只在盖过版本号的代码上才会失败的测试，在打 tag 之前就会暴露。
- 盖版本号时也会写入 `packages/server/src/plugin/builtin-index.json`，发布出去的服务端列出的沙箱后端版本就是实际发布的版本。
- release 任务自己的盖版本号步骤不变，`scripts/test-installer.sh` 会原样回放它。

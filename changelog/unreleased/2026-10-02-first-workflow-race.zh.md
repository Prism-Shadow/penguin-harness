# Watcher 启动期间写入的 Workflow 也会被加载

- **Date:** 2026-10-02
- **Type:** fix
- **Scope:** `server`
- **PR:** [#947](https://github.com/Prism-Shadow/penguin-harness/pull/947)

[English](2026-10-02-first-workflow-race.md)

Workflow 服务在创建一个 watcher 之后，等过一个 settle 窗口再把它所监视的内容重读一遍：等待首个 Workflow 的 watcher 重查 Agent 目录（`workflows/` 出现了吗），`workflows/` 上的 watcher 则重读其下每个目录（内容与已加载或加载中的不一致时才加载）。在 macOS 上，watcher 刚创建的最初几毫秒是盲区——每加入一个 watcher，libuv 都会在另一个线程上重建整个进程共用的那一条 FSEvents 流——Agent 一次性写完首个 Workflow 时恰好落在这个窗口里：目录出现了，却没有任何事件报告它，直到有人再次列出 Workflow 之前它都不会被加载。

## 细节

- 目录监视成为一项运行时能力（`FileWatch`，默认即 `fs.watch`），测试可以替换它；server 测试套件以事件不会送达任何人的真实 watcher 代入，证明两处重读都能加载 Workflow。
- 首个 Workflow 的测试用例每次尝试都创建 id 各异的 Agent，因此 CI 在 macOS 上给予的重试不再因第一次尝试已创建的 Agent 而失败。

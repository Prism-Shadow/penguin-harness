# macOS 的 CI job 重新能构建 server

- **Date:** 2026-09-29
- **Type:** fix
- **Scope:** `ci`

[English](2026-09-29-ci-macos-build-heap.md)

各 CI job 共用的构建步骤现在以 4 GB 堆运行 Node。`macos-latest` 上默认堆上限是 2240 MB，而 server
的类型声明构建需要的比这更多，于是 `test-macos (server)`、`test-macos (rest)` 与
`runtime (macos-latest, --mac)` 都在任何测试开跑之前以 `ERR_WORKER_OUT_OF_MEMORY` 失败。ubuntu 与 windows
runner 的默认上限本就是 4288 MB，也就是现在每个 runner 得到的上限，它们的构建没有变化。

## 细节

- 构建步骤在构建前打印 runner 的内存，以及默认与实际生效的两个堆上限。
- 只有构建步骤带这一设置；测试步骤仍用 runner 的默认值。
- 桌面安装包工作流不经共享步骤、自行构建整个 workspace，它的构建步骤也带同样的 4 GB 堆；否则其 macOS
  job 会撞上同一个上限。

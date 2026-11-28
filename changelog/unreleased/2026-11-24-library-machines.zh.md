# machines 域并入 library 包

- **Date:** 2026-11-24
- **Type:** refactor
- **Scope:** `server`, `library/machine`, `library/http`, `packages/cli`

[English](2026-11-24-library-machines.md)

machines 域搬到它之前的词汇包旁边。`@prismshadow/penguin-library-machine` 收下 ssh 机群的 transport、安装与连接作业、machines 服务、machines 路由、Machines 页的线格式词汇、machine-status 读取器、存储 ssh 口令的助手与 carried-store 落盘。`@prismshadow/penguin-library-http` 收下共享的心跳间隔与 API socket 的 per-message-deflate 设置。

服务端 import 这些包；library 里没有任何代码反向 import 服务端。machines 服务保留其服务端装配：Provider Module 留在原地，服务类搬走。API 的导出面通过 re-export 保持完整——服务端的 `machines/…` import 路径、`@prismshadow/penguin-server/machine-status` 与 `@prismshadow/penguin-server/secret-file` 依旧可用——CLI 与其余一律直接 import library 包。

## Details

- `library/machine` 增：machines 服务、其 effects、各路由工厂（machines 路由、machines server-proxy 路由、session forward、machines 侧的 history 读取）、聚合事件流、socket 拨号器、ssh transport（其独立的 `transport/` 模块）、安装／升级／checkout 镜像／发行镜像机制、models/plugins/settings 同步作业、诊断与探活助手、machine-status 读取器，以及本域的线格式词汇（`contract`、`ports`）。
- `library/http` 增：`heartbeat`（所有流共用的唯一间隔）与 `socket-compression`（API socket 的 deflate 设置），各自从原所在的 server 模块 re-export。
- machines 服务的 pushed-build effects 在服务端装配处绑定——服务端自己的 push seam 在那里；面向机器的 adoption 与 leave-out 头字面量在本域 contract 里命名。
- 涉及的每个接口类都以 `@Interface` 装饰器声明成员。

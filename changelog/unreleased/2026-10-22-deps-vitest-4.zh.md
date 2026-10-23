# 测试运行器：vitest 4（vitest、@vitest/mocker 与 tinypool 安全公告）

- **Date:** 2026-10-22
- **Type:** fix
- **Scope:** `tooling`
- **PR:** [#1294](https://github.com/Prism-Shadow/penguin-harness/pull/1294)

[English](2026-10-22-deps-vitest-4.md)

各包的测试从 vitest 3.2.7 升级到 4.1.12，关闭测试运行器上全部 22 条未处理的 Dependabot 告警：GHSA-82fw-gwwq-j7x9（经重定向的 mock 读取任意文件；工作区各清单上 18 条，`@vitest/mocker` 上 1 条）、GHSA-qxg6-89mg-rqv8（`@vitest/mocker` 的手动 mock 注册），以及 tinypool 的两条严重级公告 GHSA-5gmw-xhrv-c9v3 与 GHSA-85c8-ppgw-ccpr。3.x 没有任何版本包含这些修复。vitest 4 使用自己的 worker 池，tinypool 因此从 lockfile 中消失。改动全部属于开发工具，发布产物不受影响。

## 细节

- 根目录及使用 vitest 的十六个包与插件中，`vitest` 均为 `^4.1.12`；`core`、`server`、`web` 的 `@vitest/coverage-v8` 锁定为 `4.1.12`，即 vitest 要求的确切版本。
- vitest 4 移除了 `it(name, fn, options)` 写法。`packages/core/test/llm.e2e.test.ts` 中两条真实 LLM 测试改为把超时与重试选项作为第二个参数传入；旧写法会让整个 core 测试套件在收集阶段失败。
- 服务端的 vitest 配置删除了 `minWorkers`（vitest 4 已无此项），由 `maxWorkers` 单独决定池大小。该设置原在 [更快的 CI 测试任务](2026-10-15-ci-faster-pipeline.zh.md) 中加入，用来阻止 tinypool 终止空闲 worker。
- 在 vitest 4 下，pnpm 不再把 `@prismshadow/penguin-ui` 以软链接方式接入 `web`、`landing`、`docs`、`ui-gallery`，而是安装工作区的注入副本（硬链接于 `node_modules/.pnpm` 之下）。这四个包的 vitest 配置因此设置了 `esbuild: { jsx: "automatic" }`：Vite 不为 `node_modules` 下的文件读取 tsconfig，原先会以 classic 运行时编译该副本中的 `.tsx`。副本只在 `pnpm install` 时刷新：在 `packages/ui` 中新增的文件，或被整体替换而非原地修改的文件，要在一次安装之后才能到达这四个包。

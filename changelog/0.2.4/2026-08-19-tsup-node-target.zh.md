# 全仓库统一 Node 构建目标

- **Date:** 2026-08-19
- **Type:** process
- **Scope:** `tooling`, `core`, `cli`, `server`, `skills`, `desktop`

[English](2026-08-19-tsup-node-target.md)

现在每个包都按同一个 Node 版本编译——`node24`——而此前两个从未声明过自己需要哪个 Node 的已发布库，也把它写了出来。

tsup 配置里的 `target` 是 esbuild 向下降级到的语法级别。它此前漂移成了五个各自为政的答案：core、cli、skills 是 `node20`，server 与 desktop 是 `node22`，而声明了 `engines.node` 的那些包要求 `>= 24`，CI 跑的是 Node 24，发布物里随包分发的运行时也是 24。这并没有弄坏什么——把目标定低只意味着本可以原样保留的语法被多降级了一遍——但「我们到底为哪个 Node 构建」没有唯一答案，于是每新增一个包就是一次掷硬币。

## 细节

- `@prismshadow/penguin-core` 与 `@prismshadow/penguin-skills` 新增 `engines: { "node": ">=24" }`。它们是对外发布的包，现在会产出 Node 24 的语法，把这一点声明出来，Node 20 的用户才会在安装阶段就看到不兼容——npm 会报出 `EBADENGINE` 警告，开启 `engine-strict` 时更是直接拒绝安装——而不是在 import 时撞上 `SyntaxError`。这两个包本来也只在 24 上构建与测试，且都被要求 24 的包所依赖。
- `packages/cli/test/tsup-target.test.ts` 里的漂移守卫会断言所有 tsup 配置声明同一个 target，并且任何已发布的包都不会产出比它 `engines` 所承认的更新的语法。它放在 `packages/cli` 是因为仓库根目录本身不跑测试套件——沿用 `dev-script-entry.test.ts` 的做法。

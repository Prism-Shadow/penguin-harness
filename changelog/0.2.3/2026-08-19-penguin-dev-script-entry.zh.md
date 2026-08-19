# `pnpm penguin` 恢复可用

- **Date:** 2026-08-19
- **Type:** fix
- **Scope:** `tooling`, `cli`

[English](2026-08-19-penguin-dev-script-entry.md)

仓库根目录的 `pnpm penguin` 脚本改为运行 `packages/cli/src/penguin.ts`——也就是 `penguin` 可执行文件所构建自的那个源文件——不再运行 `packages/cli/src/index.ts`。

[#298](https://github.com/Prism-Shadow/penguin-harness/pull/298) 拆分 CLI 入口后，`index.ts` 只负责导出 `cli()`，真正的调用挪到了 `penguin.ts`。那次改动同步了 `packages/cli` 自己的 `penguin` 脚本和 bin，却漏掉了根目录这一份，于是自 2026-08-18 起，在仓库根目录执行的每一次 `pnpm penguin <args>` 都只是导入模块、什么也不执行、以 0 退出——没有输出，没有报错，`dotenv/config` 也从未加载。`pnpm penguin chat` 看上去就像一个拒绝启动的 CLI。

## 细节

- `packages/cli/test/dev-script-entry.test.ts` 中的漂移守卫会从 `bin.penguin` 推导出应有的源入口，并断言两个开发脚本都指向它，因此日后再改入口文件名，不会再有哪一个被悄悄落下。
- 已安装以及全局链接的 `penguin` 命令自始至终不受影响：它们运行的是 bin，而 bin 一直指向 `dist/penguin.js`。

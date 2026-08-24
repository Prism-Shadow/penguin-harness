# 推送的 platform bundle 只落在 store 里

- **Date:** 2026-08-23
- **Type:** fix
- **Scope:** `server`
- **PR:** [#422](https://github.com/Prism-Shadow/penguin-harness/pull/422)

[English](2026-08-23-hot-update-bundles-land-only-in-the-store.md)

每次推送都会把 platform bundle 写两遍磁盘：一遍写进 `<数据根>/hmr/uploads/`，好让启动有个文件可以
import；版本提交时再按内容寻址写进 store 一遍。之后只有 store 里那份还会被读到，被清理的也只有
store——`hmr/uploads/` 每推送一个不同的 bundle 就多出一个数 MB 的文件，伴随安装终身。开发时的
watch-and-push 循环填得最快，而没有任何东西会清空它。

现在 bundle 直接写到 store 里它自己的内容寻址路径，也从那里被 import，于是这些字节只存在一份，
原本就在给 store 定界的那次清理同时给它定了界。`hmr/uploads/` 会在下一次成功推送时被同一次清理
删掉。

## 细节

- 启动失败的推送会在 store 里留下一个无人引用的 bundle，而不是被提交；下一次成功推送的清理会收走
  它，且无论中间夹着多少次失败推送，已提交的版本都会被保留。
- 现在热交换与磁盘提交多共用一次写：`hmr/store/` 完全写不进去的数据根，会让推送直接失败，而不是
  先生效再报 `persisted: false`。两种情况下正在运行的版本都不受影响。

# 机器记录改存 web.db，并归属于 Project

- **Date:** 2026-09-01
- **Type:** refactor
- **Scope:** `server`, `web`, `docs`
- **PR:** [#565](https://github.com/Prism-Shadow/penguin-harness/pull/565)
- **Breaking:** yes — machines 路由移到 Project 之下，且 `machines-installs.json` 不再被读取

[English](2026-09-01-machines-store.md)

本服务端在哪台机器上装过什么，从 `<data root>/machines-installs.json` 移进 `web.db`，并且机器现在归属于某个 Project。安装过程本身没有变化——同样的 ssh、同样的任务、同样的进度输出。

## 细节

- **只有一处存储。** migration 4 建立 machines 相关的表，安装记录在那里读写。JSON 文件承载不了 schema 变更，而本服务端记住的其他东西也都不在数据库之外。该 migration 是 `swapSafe` 的：只新增表、不动既有表，因此平台回滚到没有 machines 的构建时，只是不再查询这些表而已。
- **机器归属于 Project**，因为一个 Project 的机器就是它的工作运行的地方。主机本身不按 Project 划分——一份程序、一条 ssh config 条目，被每个纳入它的 Project 共享；Project 拥有的是这层归属关系。安装就是一个 Project 取得机器的方式；`POST …/release` 把它交还，且不触碰安装本身。
- **别的 Project 装过的主机读作 `elsewhere`，而不是「未安装」。** 二者导向不同的操作：纳入只需写一行记录，重装则要为同一个结果再传 30 MB。一个看起来没人动过的条目，会让人去做后者。
- **路由从 `/api/machines` 移到 `/api/projects/:projectId/machines`。** 依然仅限管理员：Project 作用域决定回答哪些机器，不决定谁有权触达它们——无论如何，安装用的都是服务端账号的 ssh 密钥。

## 兼容性

`<data root>/machines-installs.json` **不会被读取**，也不会被迁移。在 0.2.9 下装过机器的服务端升上来后，**已安装机器**列表是空的；该文件原样留在磁盘上。重新安装即可恢复，代价很低：每一步都幂等，已经是该版本的机器只是一次 no-op，仅重写记录。

机器归属于安装它的那个 Project，没有任何继承——默认 Project 也不例外——所以请从应当拥有它的 Project 重新安装。Project 被删除时会带走自己的机器列表；机器上的安装本身保持不动。

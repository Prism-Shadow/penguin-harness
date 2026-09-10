# 记忆文件的顺序不再取决于服务端所在的 locale

- **Date:** 2026-09-04
- **Type:** fix
- **Scope:** `server`
- **PR:** [#608](https://github.com/Prism-Shadow/penguin-harness/pull/608)

[English](2026-09-04-memory-file-order-locale.md)

Memory 服务此前用不带 locale 参数的 `String.localeCompare` 排序一个作用域的主题文件，顺序因而随服务端进程的 locale 而变：同时存有 `testing-conventions.md` 与 `项目背景.md` 的作用域，在 `en_US.UTF-8` 主机上按此顺序列出，在 `zh_CN.UTF-8` 主机上则相反。这个顺序既是 Memory 文件列表所呈现的，也是导出文档 `files` 数组所携带的，同一个作用域在两台主机上导出会得到两份不同的文档。现在的比较器先折叠大小写、再以码元顺序断同，全序、在任何主机上一致，且复现了 `en_US.UTF-8` 原本的顺序，已有的导出不会重排。

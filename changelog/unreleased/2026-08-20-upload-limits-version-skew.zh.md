# 较新的 Web App 不再因旧服务端的 `/api/me` 而崩溃

- **Date:** 2026-08-20
- **Type:** fix
- **Scope:** `web`

[English](2026-08-20-upload-limits-version-skew.md)

在早于 [#350](https://github.com/Prism-Shadow/penguin-harness/pull/350) 的服务端上打开「上传限制」会让页面崩溃，报 `Cannot read properties of undefined (reading 'attachmentLimitMinMb')`。

Web App 与为它提供服务的运行时本来就经常是不同版本——热更新通道存在的意义正在于此，而桌面外壳也会附着到任何一个已在运行的服务端上。此前 `/api/me` 返回的上传限制被直接赋值进 state，于是一份来自「这些字段还不存在」的年代的载荷，会把内置默认值整个替换成 `undefined`，第一个读取限制的组件就把页面带崩了。

现在这份载荷是叠加在默认值之上的：服务端给出答案的字段以服务端为准，它没有携带的字段保留默认值。两种情况下这都只是显示层面的事——每一次上传，服务端仍然按它自己真实的限制重新校验。

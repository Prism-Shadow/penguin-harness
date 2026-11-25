# 服务端：浏览器导入不再阻塞并发请求

- **Date:** 2026-11-16
- **Type:** fix
- **Scope:** `server`
- **PR:** [#1565](https://github.com/Prism-Shadow/penguin-harness/pull/1565)
- **Issue:** [#1437](https://github.com/Prism-Shadow/penguin-harness/issues/1437)

[English](2026-11-16-browser-import-async.md)

浏览器导入的来源发现和 Chromium 密钥读取现在使用异步文件系统操作。缓慢或阻塞的浏览器配置目录不再会在准备导入时卡住请求处理，因此加载设置等无关 API 请求仍能正常响应。配置排序、显示名称、最新副本选择和导入错误行为均保持不变。

# runtime 的注释现在说的是 runtime 做的事

- **Date:** 2026-08-23
- **Type:** process
- **Scope:** `server`

[English](2026-08-23-hmr-comments-match-the-code.md)

热更新 runtime 里有四处文字描述的不是它周围的代码。没有会话记录的读者无从核实它们，其中两处还会
把读者引向错误的方向。

## 细节

- HTTP seam 的模块文档，以及跟着它的 `hmr/README.md`，都写着流式响应留在 runtime 一侧。platform
  自己的 SSE 端点一直都是走 seam 的——处理函数在流建立时就交回 `Response`，之后继续往里写。seam
  真正带不了的是活的 socket，因为没有 `Response` 可以为它返回，这也正是终端 WebSocket 握手要通过
  进程内成员去够到 App 的原因。现在两处文字说的都是这件事。
- `app.ts` 把热更新 API 的鉴权描述成「local-agent Bearer token 或管理员 cookie 会话」，并指向
  `hot/routes.ts`。那个 token 因为是磁盘上一份等同管理员权限的明文密钥而被移除，那个路径也不指向
  任何文件。
- 三处 JSDoc 记录的是它邻居下面的那个声明，而不是自己下面的：`UpgradeAllTarget` 的挂在
  `UpgradeAssets` 上、`persistVersion` 的挂在 `materializeAssets` 上、`isSafeRelPath` 的挂在
  `sameFileContent` 上——于是三个声明没有文档，另外三个各顶着两块。每一块都回到了它描述的声明上。
- store 的保留规则写的是「最多 `STORE_KEEP` 个版本」；被引用的版本是在最新的 `STORE_KEEP` 个之外
  额外保留的，所以只要已提交的版本不在最近写入的两个之内，store 里就有三份。

# 代码插件只经一个宿主面接触服务端，并可贡献 WebSocket 端点、自判来源的路由与自有偏好键

- **Date:** 2026-11-19
- **Type:** refactor
- **Scope:** `server`

[English](2026-11-19-plugin-server-seams.md)

服务端补齐了代码插件提供内置浏览器现有能力所需的通用接缝。浏览器代码仍留在 `packages/server/src/builtin-browser/`，此后只经这些接缝接触宿主。路由、状态码、WebSocket 关闭码与错误文案均不变。

## 细节

- **插件宿主面。** `@prismshadow/penguin-server/plugin` 在原有接口之外新增导出：
  - 插件模块 `@Use` 的能力接口（类型）：`Channels`、`Clock`、`Config`、`Db`、`Desktop`、`Log`、`Paths`、`Users`、`SessionDrivers`、`SessionIndex`、`Settings` 与 `UiPrefsStore`；
  - 类型 `AppEnv`、`ShellPort`、`WebSocketUpgrade` 与 `OwnedPref`；
  - 值 `HttpError`、`errorBody`、`badRequest`、`publicOriginOf`、`requireHuman`、`userChannelKey`、`ensureInstallId`、`shellPortOf` 与 `profileFromEnv`。

  `requireHuman` 与 `userChannelKey` 各自移入独立模块，原导入路径照旧再导出。
- **跨副本识别 HttpError。** `HttpError` 带全局品牌 `Symbol.for("penguin.http-error")`。App 的错误处理与异常落库认得任何带这个品牌的副本，例如插件打包的那一份。这样的错误按它自己的状态码、错误码、文案、details 与 `Retry-After` 应答，并记为 expected。不带品牌、只是自称 `HttpError` 的错误仍答 500 `internal`。
- **自判来源的路由组。** `HttpModule.routes` 的路由组可以声明 `origin: "own"`：该组自行判定调用方来源，它覆盖的路径因此不受写请求的同源检查。一条路径归覆盖它的最具体的路由组。这取代了扩展配对路由的硬编码豁免，该路由改为声明这个字段。运行时在接缝之前做的同一检查经 `Http.ownOrigin` 向当前一代询问。
- **WebSocket 端点。** 新槽 `HttpModule.upgrades` 接受 `{ prefix }` 与一个代码半，代码半接过原始的升级请求、自己完成握手。运行时在每个监听端口挂一个升级接缝（`hmr/upgrade-seam.ts`），经 `Http.upgrade` 把每个升级交给当前一代；运行时自己的终端流与 API socket 路径从不分发。浏览器的扩展 socket 改为这样的端点。`/api/builtin-browser/extension/ws` 之下的路径现在答 404，此前没有任何监听者应答。
- **自有偏好键。** 新数据槽 `MeRoutes.ownedPrefs` 接受 `{ key, message }`。`PUT /api/me/prefs` 带这个键即答 400 `bad_request` 与该文案，本次写入什么都不存。浏览器对 `browserBackend` 的拒绝改由这个槽声明。
- **较旧的平台。** 运行时可能恢复这些接缝之前推送的平台。对这样的平台，运行时仍按 `BuiltinBrowserModule` / `BrowserExtensionGate` 两个名字找到扩展的 gate，仍按路径豁免配对路由（`hmr/legacy-browser.ts`）。已装的运行时只会按名字查找，浏览器模块因此保留这两个名字。两处回退保留到 1.0。
- **测试。** 各桌面端测试共用的壳端口假件移到 `test/helpers/fake-shell-port.ts`。测试 App 经通用的 `nodes` 选项接受任意节点替身，浏览器的壳端口替身放在浏览器测试旁。

# 代码插件只经一个宿主面接触服务端，并可贡献 WebSocket 端点、自判来源的路由与自有偏好键

- **Date:** 2026-11-19
- **Type:** refactor
- **Scope:** `server`
- **PR:** [#1644](https://github.com/Prism-Shadow/penguin-harness/pull/1644)

[English](2026-11-19-plugin-server-seams.md)

服务端补齐了代码插件提供内置浏览器现有能力所需的通用接缝。浏览器代码仍留在 `packages/server/src/builtin-browser/`，此后只经这些接缝接触宿主。路由、状态码、WebSocket 关闭码与错误文案均不变。

## 细节

- **插件宿主面。** `@prismshadow/penguin-server/plugin` 在原有接口之外新增导出：
  - 插件模块 `@Use` 的能力接口（类型）：`Channels`、`Clock`、`Config`、`Db`、`Desktop`、`Log`、`Paths`、`Users`、`SessionDrivers`、`SessionIndex`、`Settings` 与 `UiPrefsStore`；
  - 类型 `AppEnv`、`ShellPort`、`WebSocketUpgrade`、`UpgradeCaller`、`MeRoutes`、`MeRoutesSlots` 与 `OwnedPref`；
  - 值 `HttpError`、`isHttpError`、`errorBody`、`badRequest`、`publicOriginOf`、`requireHuman`、`userChannelKey`、`ensureInstallId`、`shellPortOf` 与 `profileFromEnv`。

  `requireHuman`、`userChannelKey` 与 `profileFromEnv` 各自移入独立模块（`auth/require-human.ts`、`http/user-channel.ts`、`machines/profile.ts`），原导入路径照旧再导出。打包这一面的插件因此只带上这些小模块（约 5 KB），不带 core 的 SDK。
- **跨副本识别 HttpError。** `HttpError` 带全局品牌 `Symbol.for("penguin.http-error")`。App 的错误处理与异常落库认得任何带这个品牌的副本，例如插件打包的那一份。这样的错误按它自己的状态码、错误码、文案、details 与 `Retry-After` 应答，并记为 expected。不带品牌、只是自称 `HttpError` 的错误仍答 500 `internal`。
- **用另一份 Hono 构建的路由组。** 内置插件会打包自己的 Hono，它的缺省错误处理会在 App 的错误处理看到之前，把一切错误答成 `500 text/plain`。这样的路由组若没有设自己的错误处理，宿主现在为它设上一个原样转交错误的处理；组自己设了的，宿主不动。
- **自判来源的路由组。** `HttpModule.routes` 的路由组可以声明 `origin: "own"`，表示该组自行判定调用方来源。这些组挂在写请求同源检查之前，各自带一份 JSON-only 检查。它们应答的请求不经同源检查；其前缀下它们不应答的请求（别的方法、组不提供的路径）仍照常检查。这取代了扩展配对路由的硬编码豁免，该路由改为声明这个字段。因此，该前缀下配对路由不应答的跨源写请求（如 `DELETE`）答 403 `cross_origin_write`。运行时在接缝之前做的同一检查把这类写请求放给平台：它经 `Http.ownOrigin` 向当前一代询问，前缀逐段比对，含 `:param` 段。
- **WebSocket 端点。** 新槽 `HttpModule.upgrades` 接受 `{ prefix, auth }` 与一个代码半，代码半接过原始的升级请求、自己完成握手。
  - 前缀逐段比对，`:name` 段匹配任意一段。用了其他 Hono 模式的前缀不提供服务，并在日志中点名。
  - `auth: "user"` 时，宿主先像检查 API socket 那样检查握手的 Origin 与 `Sec-Fetch-Site`（403）和会话 Cookie（401），端点随后拿到该用户。`auth: "none"` 时，端点拿到原样的请求，自己检查 Origin 与自己的凭据。
  - 运行时在每个监听端口挂一个升级接缝（`hmr/upgrade-seam.ts`、`platformUpgradeDeps`），经 `Http.upgrade` 把每个升级交给当前一代；运行时自己的终端流与 API socket 路径从不分发。
  - 浏览器的扩展 socket 改为一个 `auth: "none"` 端点。`/api/builtin-browser/extension/ws` 之下的路径现在答 404，此前没有任何监听者应答。
- **自有偏好键。** 新数据槽 `MeRoutes.ownedPrefs` 接受 `{ key, message }`。`PUT /api/me/prefs` 带这个键即答 400 `bad_request` 与该文案，本次写入什么都不存。浏览器对 `browserBackend` 的拒绝改由这个槽声明。
- **较旧的平台与运行时。** 运行时与平台分属这次改动两侧时让扩展照常工作的回退，记录在[向后兼容](2026-11-19-backward-compatibility.zh.md)。
- **测试。** 各桌面端测试共用的壳端口假件移到 `test/helpers/fake-shell-port.ts`，第二份 Hono 的测试辅助在 `test/helpers/foreign-hono.ts`。测试 App 经通用的 `nodes` 选项接受任意节点替身，浏览器的壳端口替身放在浏览器测试旁。

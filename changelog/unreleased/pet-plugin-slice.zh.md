# pet 插件：停靠的 widget、`penguin pet` 命令、共享的插件状态

- **日期：** 2026-11-04
- **类型：** feat
- **范围：** `web`、`server`、`plugins`

[English](pet-plugin-slice.md)

插件在 web 应用上获得一个小的常驻伴随面、一个自己的 `penguin` 命令，以及它的每个面共享的一份 JSON 状态。

- 服务端的 `WebModule` 新增 `widgets` 槽：`{ key, title?, titleZh?, size?, renderer }`，与页面条目同形。`GET /api/contributions` 以 `widgets` 回答。widget 用 `iframe` 渲染插件自己的 `ui/` 文档，同源、随用户 cookie，因此它凭用户自己的 cookie 读写状态。
- web 应用把 widget 停靠在状态栏旁（app layout）：每个 widget 一枚收起的瓦片——没有图标时取标题首字——点开成它的框，带关闭钮。校验过的 widgets 走一个自己的小 store（一次 fetch、多方共享；插件装上或移除后 `refresh`），读法与文件渲染规则一致：条目要有 key 和 renderer，iframe 要有 `src`，`builtin` 名必须能被本构建的注册表解析，key 重复时先到先得。
- 服务端把插件状态存在共享 settings store 的 `plugin-state:<package>` 键下：`GET /api/plugins/<package>/state` 回答它，`PATCH` 把更新浅合并进去（`null` 删键）并回答合并后的文档。只有本进程已加载的插件有状态；其他合法包名一律 404。任何登录用户可读写——状态由插件是否安装把关，而非由内容把关。
- 服务端运行插件命令时，代码半在 message bundle 旁收到一个 state 通道：`state.read()` 与 `state.merge(update)`，同一份文档、同一条合并规则，进程内直达——一次运行没有自己的 HTTP client。
- `plugins/pet`：这条切片的第一个插件。它的 widget 画一只小生物，会发呆、散步、坐下、睡觉（纯 transform 步进），闲置的 tick 让它慢慢变饿，并用气泡说话；它的 `penguin pet` 命令（`feed`、`name`、`say`、`status`）经通道照看同一份状态。它的文档分面——持久的 pet（名字，饱食度钳在 0–100）挨着瞬时的 mood（doing、bubble）——形状由服务端 `pet-state.ts` 定义，作为这条切片的第一个使用者。

# pet 插件：伴随页面、`penguin pet` 命令，与它落在 server 上的状态

- **日期：** 2026-11-17
- **类型：** feature
- **范围：** `plugins`

[English](pet-plugin-slice.md)

`plugins/` 下新增三个插件——pet 本体与它的两个 figure driver——完全架在平台已有的扩展点上：插件页面槽、插件命令槽、插件自贡献的路由组。`plugins/` 之外只有插件构建的缓存哈希、landing 的插件登记面与锁文件随之变化。

- `plugins/pet` 经 `WebModule.pages` 贡献一个页面：`nav: "none"`，凭 URL（`/pet`）可达，以同源 iframe 渲染插件自己的 `ui/` 文件。页面就是宠物的舞台——figure driver 在上面画她，她走来走去、待在你放下她的地方、回应指针。她的气泡、习性与饥饿归页面管；右键她的对话框是共享 UI 包的作品，按需加载。
- 她的状态是 server 共享 settings store 里的一份 JSON 文档，键为 `plugin-state:@penguinharness/pet`。插件贡献自己的路由组——`GET /api/plugins/@penguinharness/pet/state` 回答它，`PATCH` 把更新浅合并进去（`null` 删键）并回答合并后的文档。文档分面：持久的 pet（名字、钳在 0–100 的饱食度、食物仓、币）挨着瞬时的 mood（她在做什么、她的气泡）。任何登录用户可读写——状态由插件是否安装把关，而非由内容把关。
- 同一份文档支撑 `penguin pet` 命令（`feed`、`name`、`say`、`status`），经 `PluginCliCommandsProvider.commands` 贡献、由 server 既有的命令运行器执行（沿其 admin only 门）。一次运行把解析好的语言交给命令；状态在进程内直达——经模块自己的 settings 通道，走与路由同一条合并规则，命令回执与页面永远一致。
- 宠物的样子由 driver 决定，背后只有一份契约（pet 包的 `ui/figure/contract.ts`）：状态的 `pet.figure.driver` 指向哪个插件，页面就从那个包动态 import 它的 `ui/figure.js`，该块其余部分原样交给 driver。随本切片交付两个 driver：`plugins/pet-live2d-cubism` 适配官方 Cubism Web SDK（由 SHA-256 pin 的脚本在使用方机器上下载，绝不入仓；模型包使用方自备，由 driver 自己的路由 serve），`plugins/pet-live2d-coopanion` 在运行时从配置指定的安装目录加载 Coopanion figure pack，本身不携带 Coopanion 的任何代码或资源。
- 浏览器侧源码全部是 TypeScript，由各包自己的构建编译（`ui/widget.ts` → `ui/dist/widget.js`，driver 的 `ui/figure.ts` → `ui/figure.js`）；`.js` 是构建产物，不是源码。

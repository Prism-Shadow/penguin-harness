# plugin 域并入 library 包

- **Date:** 2026-11-24
- **Type:** refactor
- **Scope:** `server`, `library/plugin`

[English](2026-11-24-library-plugin.md)

plugin 域搬进新的 `@prismshadow/penguin-library-plugin` 包：插件库及其安装、链接与卸载路径，market 与 registry 读取器，离线档案，插件宿主加载器，插件 DTO 契约，以及插件服务端模块的服务。服务端 import 这些；library 里没有任何代码反向 import 服务端。API 的导出面通过 re-export 保持完整——旧 import 路径继续可用，服务端包的导出子路径保持原拼写。

域要从服务端自有事实里读的东西，走端口、由服务端在自己的 import 路径上绑定：被推送 bundle 的资产解包到哪、平台自己的接口表、进程是否跑在开发检出上，以及 boot 时直改 Project 配置文件的那步所用的 own-table listing。插件服务端模块服务保留它的服务端装配：Provider 把服务的端口（config、热更新、重装配、数据库、channel、log、clock 能力，以及插件库、ledger、preinstall、project、member、user 节点）绑到服务端自己的机制上，用户 channel 的查找在服务端的 channel hub 之上组合。CLI 插件命令的 Provider 出于同样理由保留服务端文件——它的端口就是服务端自己的能力——而契约、slot 与路由住在 library 里。

## Details

- `library/plugin` 新建。它收下原 `plugin/` 目录（loader 与 host、插件库与其安装路径、market、registry 与 index 读取器、离线档案、配置存储与其页面词汇、tarball、npm 与 source 管线、接口检查器、unsatisfied-plugin 报告），旁边是从服务端 API 契约搬来的插件 DTO 类型、插件页面点名的 icon 应答、插件 mechanisms 契约，以及插件服务（archive、library、服务端模块、服务端卸载、tables、卸载、一次性 preinstall listing）。
- 域通过端口模块（`ports`）读服务端的平台事实：unpacked-assets 目录、平台的接口表、开发 profile 检查、workbench 卸载（带它自己的 not-found 区分）、own-table listing。
- 插件契约引用的少数 DTO（agent-create 与 task-create 的形状）随它一起搬走，因为还没有别的所有者；服务端 API 契约 re-export 全部搬走的名字，它自己的导出面不变。
- 涉及的每个接口类都在 `@Interface` 装饰器下声明成员。

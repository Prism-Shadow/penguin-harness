# Agent 浏览器改为预装插件 browser-automation

- **Date:** 2026-11-19
- **Type:** refactor
- **Scope:** `server`, `web`, `cli`, `core`, `plugins`, `docs`
- **PR:** [#1656](https://github.com/Prism-Shadow/penguin-harness/pull/1656)

[English](2026-11-19-browser-use-plugin.md)

Agent 浏览器从服务端、Web App 与 CLI 中移出，进入它自己的插件 `@penguinharness/browser-automation`，与它原本携带的 Skill 放在一起。它是第一个服务端模块被预装的内置插件：新建的 Project 都会列入它，本版本第一次启动时也会把它一次性列入每个已有 Project（见[向后兼容](2026-11-19-backward-compatibility.zh.md)）。模块运行时，路由、事件、停靠面板、设置页、CLI 输出与扩展的线路都与之前相同。

## 细节

- **一个包里的三个半。** `plugins/browser-automation` 带有服务端半（`.`：`BuiltinBrowserModule` 及其路由、驱动、页面脚本、导入、历史、扩展链路与配对）、Web 半（`./web`：图层、停靠面板、两个设置页、链接菜单行、文案、样式表与接口封装）和 CLI 半（`./cli`：`penguin browser`）。Web 半与 CLI 半是 TypeScript 源码，由 Web App 与 CLI 的构建编入；服务端半是一个打包好的文件，由插件 loader 从内置插件前缀导入。卡片写明 `preinstall: true`。
- **留在宿主的部分。** 桌面壳的 guest 与 CDP 机制、Chrome 扩展包、`library/machine` 中的线路词汇、`browser_extensions` 表、`@prismshadow/penguin-server/api` 中浏览器的数据形状（壳、扩展与画廊按它编译，插件只取类型）、运行时冻结的旧握手，以及管理员开关 `browserExtensionsEnabled`。旧名不变：`BuiltinBrowserModule`、`BrowserExtensionGate`、`/api/builtin-browser`、`builtin_browser_*`、停靠面板类型 `builtin-browser`、`<root>/builtin-browser/*.json` 与各分区名。
- **模块没有运行时。** 管理员可以在「设置 › 插件」中停用该模块，停用处处有效；也可以把它从某个 Project 的列表中移除：之后的启动不会把它加回，但在该 Project 的 Agent 上安装 browser-automation 会按 PRFC-0031 的内置规则重新列入。服务器上只要有一个 Project 列入它，模块就运行，界面在每个 Project 中都显示。没有任何 Project 列入时，浏览器的路由答 404，Web App 不画出它的任何界面，`penguin browser status` 以 `browser_unavailable` 退出（退出码 1），并说明该请用户做什么。安全模式不加载插件，同样没有浏览器。
- **没有包依赖环。** 服务端依赖该插件（它列出插件库），所以插件不依赖服务端包：它经 tsconfig `paths` 从源码取得服务端的插件面，并把插件面的值、Hono、ws 与用到的库值打包进来。服务端半不从 core 的根入口导入任何东西，打包结果因而很小（core 的 `./plugin` 子路径新增 `atomicWriteFile`，插件面的 `profileFromEnv` 移到单独的模块）。
- **接口表。** `penguin-gen-ifaces` 新增 `--sources <dir>`：按另一个包的源码编译的包只投影自己的文件。另一个包文件中的默认导出不再被当作本表的插件声明，因此 Web App 的表能容纳它编入的所有插件 Web 半。Web 表用应用自己的程序读取工作区插件的 Web 半。服务端与 CLI 自己的表只按各自的源码与 `library/` 生成，二者程序触及的内置插件源码（测试辅助文件、CLI 生成的模块清单）留在插件自己的表里。
- **检出目录里的服务端。** `scripts/stage-dev-plugins.mjs` 把预装插件暂存到 `packages/server/plugins/`，即从检出目录运行的服务端加载的内置插件前缀；`dev-prebuild.mjs` 与 Web e2e 脚本会调用它。桌面构建与发布照旧暂存各自的前缀。热推送携带的插件库用代码插件自己的构建生成其接口表，`dist/` 只随内置插件前缀发出。
- **测试。** 服务端半的单元测试随代码移入 `plugins/browser-automation/test/`；启动整个 App 的测试、CLI 与 Web App 的测试留在各自的包里，从源码加载插件。

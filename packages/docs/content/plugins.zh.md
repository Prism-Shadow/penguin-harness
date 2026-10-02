---
title: 插件模型
description: 插件如何声明、安装和配置——库插件与代码包的区别、生成的模块清单，以及四种沙箱后端。
---

harness 只有一套插件系统，其中装着两类 npm 包，都是仓库 `plugins/` 目录下的子目录。两者的区别在于携带什么、由谁声明：

- **库插件**携带内容——Agent 读取的 Skill 和运行的钩子包，由 `plugin.json` 清单声明；安装就是把这份内容复制到 Agent 的 `agent_state/` 下。
- **代码包**，也就是[技能与插件](/skills#服务端插件)里说的**服务端插件**，携带模块：一组带装饰器的类，由服务器作为自己模块树的子节点启动。它没有 `plugin.json`，一个包被列进某个 Project 的配置里，就成了这一类插件。

仓库里共有 23 个插件目录：14 个库插件和 9 个代码包——四个 `sandbox-*` 后端，外加 `claude-code`、`company-proposals`、`company-roadmaps`、`discord-bot` 和 `languages`。

- **要装东西？** 两条安装路径见[安装插件](#安装插件)，页面和步骤见[在 Agent 上安装插件](/skills#在-agent-上安装插件)。
- **要给插件加自己的选项？** 见[配置插件](#配置插件)。
- **要写代码包？** 见[代码包](#代码包)和[插件契约](/server-boot#插件契约)。
- **想知道命令到底被什么封禁？** 见[四种沙箱后端](#四种沙箱后端)。

## 两类插件

| | 库插件 | 代码包（服务端插件） |
| --- | --- | --- |
| 携带 | Skill 和/或钩子包——Agent 读取并运行的内容 | 带装饰器的模块——服务器启动的代码 |
| 清单 | `plugin.json`，旁边有 `icon.svg` | 无；`package.json` 旁生成的 `ifaces.json` 就是模块载荷 |
| npm 包 | `@penguinharness/<name>` | 任意包名，例如 `@prismshadow/penguin-plugin-sandbox-bwrap` |
| 由谁声明 | 宿主包的依赖列表——即内置插件库 | Project 的 `[plugins]` 表，位于 `.project_config.toml` |
| 装在哪里 | 某个 Agent 的 `agent_state/skills/` 和 `agent_state/hooks/` | 服务器进程，通过加载这个包 |
| 在哪里运行 | Agent 的 Session 中，作为指令和钩子脚本 | 服务器中，作为模块树的节点 |
| 例子 | `agent-company`、`goal`、`humanizer` | 四个 `sandbox-*` 后端、`discord-bot`、`languages` |

两类插件都以文件为准。插件库每次调用都重新读取、不做缓存，所以改过的 `plugin.json` 或 `SKILL.md` 立即生效；代码包每次加载时读取它生成的表。

## 库插件

库插件是一个目录，里面有清单、图标和它携带的内容：

```text
plugins/<plugin>/
├── plugin.json                # 清单——插件唯一的元数据存放处
├── icon.svg                   # 插件所携带一切的图标
├── skills/<name>/SKILL.md     # 零个或多个 Skill（参考文件放在旁边）
└── hooks/*.mjs                # 至多一个钩子包：纯 Node 脚本
```

`plugin.json` 存放插件的元数据——`version`、`category`、`preinstall` 以及各钩子点。库里的 `SKILL.md` 只带 `name` 和 `description`；加载器会把插件的版本和简短描述写入每个已安装副本，跟已安装钩子包的 `hooks.json` 由清单生成是同一个道理。逐个字段的说明见[插件文件格式](/skills#插件文件格式)。

命名和版本只有一套规则。插件名就是目录名，须匹配 `^[A-Za-z0-9_-]+$`，包名是 `@penguinharness/<name>`，位于 `plugins/<name>/`。清单里的 `version` 形如 `YYYY.MM.DD.N`——日期加当日序号，先比日期再比序号，所以 `2026.08.29.10` 排在 `2026.08.29.9` 之后——它与包自身的 npm 版本是两回事，后者跟着发行走。恰好五个插件带 `preinstall: false`，因此 `default_agent` 初始化时不会装上：`agent-company`、`agent-company-proposals`、`continual-learning`、`humanizer` 和 `use-claude-code`。

插件库的范围不是目录列表。`@prismshadow/penguin-core` 里的加载器读取宿主包自己依赖里的 `@penguinharness/*` 条目，再用 Node 逐个解析这些包：core 和桌面端声明了全部 14 个插件，CLI 声明了其中 13 个——只缺 `agent-company-proposals`——`packages/server` 一个都不声明，而是经 core 取得它们。在 workspace 检出里，加载器会把每个名字重定向到仓库自己的 `plugins/<name>/`——pnpm 把 `workspace:*` 包以注入快照的形式安装，会漏掉之后新增的文件，而插件没有构建脚本可以刷新这份快照——而 npm 安装和打包后的桌面端读取各自携带的副本。声明了却解析不到的包会带着路径直接抛错，而不是让插件库悄悄变小。

## 代码包

代码包是一组模块，与 harness 自身的构成单位相同、写法也相同：`@Component` / `@Module` 类，字段上是 `@Use`、`@Provide` 和 `@Bind`，分别表示 requires、provides 和 contribution。

它的默认导出就是插件本身：

```ts
@Component({ contributes: { "SandboxModule.providers": [{ id: "…", name: "…", dimensions: ["fs-write"] }] } })
export class MyBackend {
  @Bind("…") provider!: SandboxProviderSource;
  setup() { this.provider = createProvider(); }
}

export default { modules: [MyBackend], replaces: [] } satisfies Plugin;
```

- `modules`——在宿主根节点下新增的节点。
- `replaces`——按被顶替节点的名字顶替已有节点，可以是组件、模块，或带子节点的整个组。

契约（`Plugin`、五个内核装饰器，以及沙箱、语言与 surface 词汇表）位于 `@prismshadow/penguin-core/plugin` 子路径；插件模块可以 require 的接口位于 `@prismshadow/penguin-server/plugin`，只有类型，因此只对着沙箱词汇表写的后端只认 core。

清单是生成的，不是手写的。包的构建对自己的 tsconfig 运行 `scripts/gen-ifaces.mjs`，把生成的 `ifaces.json` 放在 `package.json` 旁一起发布。这张表里有每个带装饰器的类的 manifest，以及它们点到的每个接口的签名；它就是模块载荷，让宿主不必执行包就知道里面有什么。没有这张表的包不携带任何模块。

插件的模块被创建之前，先跑两项检查：

- 默认导出点名的每个类，都对照包里自己的表里的 manifest 核对，所以构建陈旧会在加载时就报出名字。
- 包编译所依据的宿主接口，由 TypeScript 编译器与平台当前的表比对。表中没有某个接口的副本时只记一条「未比对」日志，不算失败：被推送的新平台不该因为插件没做过的事，把插件从机器上撤走。

随后整棵树——宿主的节点和所有插件的节点一起——在任何节点运行之前作为数据校验：requires 按签名解析，contribution 按槽位校验；替身提供的少于消费者所需时按名字拒绝，App 因此不会启动。[Server 启动与子系统](/server-boot#插件契约)讲这棵树，[插件是什么](/server-boot#插件是什么)给出它周围的启动顺序。

## 声明插件

一个部署运行哪些代码包是配置，不是烧进平台的能力。每个 Project 在自己的配置里声明它需要的插件，服务器加载的是并集。

```toml
[plugins]
"@prismshadow/penguin-plugin-sandbox-bwrap" = "*"
"@scope/name" = "1.2.3"
```

每个键是一个包名，值是形如 Cargo `[dependencies]` 的要求；`"*"` 表示部署有什么就用什么，加载只认包名。共享表旁边还可以有 `[plugins.<machineId>]` 表，列出某台机器另外要跑的插件——因为机器是借给 Project 用的。格式与容错见[配置参考](/configuration#插件)。

加载是按进程进行的，由此有三点后果：

- **跑的是一整个闭包。** 模块树只有一棵，所以任一 Project 要求的插件都在树里，它提供的能力对所有 Project 可见；所有 Project 都只为其他机器列出的插件，在这里既不加载也不安装。
- **失败按条目隔离，不影响启动。** 解析不到或格式不对的条目会被记录并跳过——那份能力不可用——而不是让启动失败。`.project_config.toml` 读不了或解析不了的 Project 不贡献任何插件，其列表视图会报出这一故障。
- **改动通过重组生效。** 增删插件无需重启进程；所有 Project 中正在进行的 Agent 运行会被中止；让新树启动失败的改动会被撤销，列表因此回到改动之前的样子。

specifier 只在一处查找：`<数据根>/plugins/current` 指向的那一代。它是一个 npm prefix，`node_modules/<name>` 链接到插件仓（`<数据根>/plugin-store/`）的条目。每次 App 启动都先按各 Project 的表对照插件仓解析并激活这一代；热推送携带的插件、安装目录随包发布的插件、从插件页现取的包，都经插件仓到达这里。插件总是按包名指定，不能写路径：源码检出的开发构建把刚构建的插件放进它的随包插件目录（开发服务器是 `packages/server/plugins/`，构建出的 CLI 是 `packages/cli/plugins/`），与 CLI 安装包携带插件的方式相同。harness 随包发布的包标为**内置**；内置意味着安装它不需要下载，并不等于已经装上——它和其它插件一样，要等某个 Project 要求时才加载。

这两个目录都不会无限膨胀。每次激活让 `current` 换了一代之后，以及服务端启动时，都会清扫一次：除当前一代与上一代之外的代删掉，插件仓里不再被需要的条目也删掉。仓里的条目满足任一条就保留：被当前一代或上一代链接；被任何 Project 的表钉住；入仓不满一天。随构建发布的包被删掉后，下一次要它的激活会重新入仓。没写完的条目与暂存目录满一天删掉。清扫失败只记日志，从不让启动失败。

## 安装插件

**库插件装在 Agent 上。** 在**插件市场**页面的插件卡片上安装或卸载，或者在 Agent 设置页把插件库之外的 Skill、钩子包导进来。装的是整个插件：全部 Skill 落到 `agent_state/skills/<name>/`，钩子包落到 `agent_state/hooks/<plugin>/` 并附上由清单生成的 `hooks.json`；从插件库重新安装就是更新已装副本的方式。见[在 Agent 上安装插件](/skills#在-agent-上安装插件)。

**服务端插件装在 Project 里。** 在**插件市场**页面上，服务端插件的一行显示包名、描述、版本和状态；在**可安装**下点击**安装**，这个包就被加进 Project 的 `[plugins]` 表并立即应用。

只有管理员能看到**安装**和**移除**。随 PenguinHarness 发布的包直接加入，无需下载；其它包先从 npm registry 现取到本机的插件仓——用服务器 `PATH` 上的 npm。仅对这次 npm，运行服务器的 Node 运行时所在目录被追加到 `PATH` 末尾：CLI 安装包自带的运行时含 npm，没有 npm 的机器也能现取，你自己的 npm 仍然优先。npm 失败时，这一行显示 npm 的首条错误，列表保持原样。改动通过重组而非重启送达服务器；之后这一行的状态显示为**运行中**、无法免重启应用时的**待重启**，或带原因的**加载失败**。移除插件只是把它从 Project 的列表中去掉，磁盘上什么都不会删。

## 配置插件

需要设置的插件自己声明这些设置；harness 依据声明画出表单，并保存取值。

声明是对 `PluginConfigProvider.groups` 的一项 contribution，因而属于清单数据：它和其它 contribution 一样落在包生成的 `ifaces.json` 里，设置页因此不必运行这个包就能列出并校验它。一个分组就是一组带标题的字段——字符串、密文、布尔、数字、若干选项之一，或多行列表——可以带 `parent`，把该分组画在另一个分组的卡片里；状态会在运行期变化的分组（沙箱的各后端）改用代码 contribute。

声明是 schema，取值属于这个部署。取值存在 `server_settings` 里，每个分组一份 JSON 文档，键为 `plugin-config:<分组>`——与插件加载本身一样是**整台服务器共享**的，因为插件每进程只加载一次。密文和其它服务器设置一样明文存储，并在每个 API 表面被掩码；把掩码值原样发回会保留已存的取值。首次启动会把已存文档合并到声明的默认值上，因此读取方拿到的总是完整文档。

取值是拉取式获取，而且是实时的：声明该分组的模块自己去读，保存会触发它的 watcher，插件因此无需重启、也无需重组 App 就能应用一次修改。分组还可以提供 action——部署必须在机器上做的动作，例如安装 WSL、初始化 Windows 沙箱的发行版——由管理 API 执行并回报结果。[设置](/settings#插件)讲这个页面：仅管理员可见、作用于整台服务器，没有声明选项的插件不会有卡片。

## 四种沙箱后端

沙箱是插件系统最大的使用者，也是代码包最清楚的例子。`packages/server` 里的沙箱服务自己不持有任何后端，也不 import 任何后端：后端就是插件包，存在哪些后端由各 Project 的列表决定。每次 spawn 的策略会被路由到覆盖该策略所需维度的后端。

| 包 | 平台 | `fs-write` | `network` | `network-local` | `mask-paths` |
| --- | --- | --- | --- | --- | --- |
| `@prismshadow/penguin-plugin-sandbox-bwrap` | Linux | 有 | 有 | — | 有 |
| `@prismshadow/penguin-plugin-sandbox-seatbelt` | macOS | 有 | 有 | 有 | 有 |
| `@prismshadow/penguin-plugin-sandbox-wsl` | Windows | 有 | 有 | — | 有 |
| `@prismshadow/penguin-plugin-sandbox-dsh` | 三个平台 | 有 | — | — | — |

维度有 `fs-write`、`network`、`network-local` 和 `mask-paths`，后端声明自己实现其中的哪些；什么都不声明就等于只有 `fs-write`。路由按能力而非注册顺序：只要求文件效果层面的策略会交给第一个覆盖它的后端——DSH 适配器，它自己的链条按宿主分别选用 bubblewrap、Landlock、Seatbelt 或 Windows ACL 运行器——而还要求网络或屏蔽路径的策略会交给第一个实现这些维度的后端；注册顺序只在两个后端都能覆盖时用于打破平局。什么都覆盖不了的请求会**失败关闭**，并列出各后端分别覆盖什么，而不会让命令不受封禁地跑起来，也不会悄悄丢掉被要求的某个维度。

Windows 由专用 WSL2 发行版里的 bubblewrap 承担，因此那里的命令实际跑在 Linux 中，Windows 互操作已关闭。三个原生后端各自声明选项——bwrap 的程序路径与探测超时、Seatbelt 的程序路径、WSL 发行版的基础 Linux、软件包、镜像源与名称，以及 Windows 磁盘是否以只读方式可见——作为 `parent` 为 `sandbox` 的分组，因此画在沙箱卡片内；DSH 适配器不带选项。`sandbox` 分组本身设置模式、网络级别、屏蔽路径以及临时目录是否保持可写。[沙盒](/settings#沙盒)讲这张卡片会问什么、每个答案是什么意思。

## 代码位置

- `packages/core/src/plugin/` —— 契约：`Plugin`、各装饰器，以及沙箱、语言与 surface 词汇表。
- `packages/core/src/plugins/` —— 插件库加载器：哪些包是插件、它们的清单与版本，以及分类分组。
- `packages/server/src/plugin/` —— 宿主：一个进程加载哪些插件、生成表的读取，以及设置分组机制。
- `packages/server/src/sandbox/` —— 沙箱服务、维度辅助函数和 `sandbox` 设置分组。
- `plugins/README.md` —— 插件树自己的索引，含插件库的分类与开发命令。

`packages/` 下没有任何东西把插件当代码依赖。依赖方向是反的：库插件是 SDK 读取的内容，代码包则对着 SDK 的契约编译，并列在某个 Project 的配置里。

# 插件：一个目录、随每个构建发布的包，以及由 platform 应用的 Project 级清单

- **Date:** 2026-08-20
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `desktop`, `tooling`, `docs`
- **PR:** [#383](https://github.com/Prism-Shadow/penguin-harness/pull/383)
- **Breaking:** yes — 数据根的 `plugins.json` 不再被读取；各 Project 在插件页重新要求自己的插件

[English](2026-08-20-plugin-platform.md)

harness 从头到尾有了插件：服务端的注册表抽象与共享索引格式；本仓库构建出的插件成为每个部署自带的一部分；一个插件页，列出 Project 已有的和可以拥有的；一份属于 Project、不重启即生效的插件清单；以及在 Project 使用的机器上保持一致的同一份清单。插件由 platform 加载，因此这一切都能靠一次推送抵达运行中的部署。

## 注册表与索引格式

- **插件注册表（plugin registry）**是一个插件索引条目来源。本次实现两种——服务端包内嵌索引的**内置注册表（builtin registry）**，以及拉取 `index.json` URL 的 **HTTP 注册表**。两者共用同一个校验器，远端索引不会比内嵌索引获得更多信任。
- 所有注册表共享同一份**插件索引格式**，参考 typst/packages 的 `index.json` 模式：扁平数组，每个元素是插件的一个版本条目，含 `name`、`version`、`description`、`authors`、`license`，可选 `repository` / `homepage` / `keywords` / `categories` / `updatedAt`。条目的 `name` 就是 Project 插件清单里写的包名。
- `GET /api/plugins/registry`（任何已登录用户可访问）返回已配置注册表合并后的索引。内置注册表列出本构建自带的包：四个沙盒后端——bubblewrap（Linux）、Seatbelt（macOS）、MXC（Windows）与 DSH 适配器——以及语言楼层。
- 说明文档按条目单独通过 `GET /api/plugins/registry/readme?name=…` 获取，而不随索引下发：列表每次进入页面都要完整发送，而说明文档体积大，且只有被打开的那个条目才需要。该端点只对部署自己列出的条目作答，因此无法用来探测存在哪些插件；注册表没有某条目的说明文档时返回 null，而不是猜一个 URL。说明文档就是各包自己的 `README.md`，从本机的包里读取，因此目录里不存在第二份会与之漂移的副本；测试把每个条目的 name、version、description 与 license 钉在包自己声明的值上。

## 以 npm 包的本来面目发布

`scripts/build-plugins.mjs` 取 `plugins/*` 下每个带代码入口的包，先跑包自己的 `build`，再用 `pnpm pack` 打成 tarball——与 `npm publish` 送出的完全一样，`files` 照旧生效——然后用 `npm install` 把这些 tarball 装进一个按 npm 前缀布局的暂存目录：`plugins/package.json`（其 `dependencies` 记录发布了哪些包）加 `plugins/node_modules/<name>/…`，每个包的依赖像在任何地方一样由 npm 装在旁边。包的任何部分都不被改写：`package.json`、`exports`、`dist/`、生成的 `ifaces.json` 与 `README.md` 都以包自己的构建产出的样子到达目标。SDK 不在装入的依赖之列——插件只对 `@prismshadow/penguin-core` 的类型编译，运行时共用宿主那一份。暂存前缀按所有插件的源码、清单、README 与构建配置的哈希缓存在 `node_modules/.cache/penguin-plugins/` 下，没碰它们的推送不会再构建、打包或安装。

热推送把前缀放进资产（`plugins/…`）；桌面构建把它暂存到 `skills/` 旁边（`scripts/build-assets.mjs`、`electron-builder.yml`）。加载器按顺序解析：`<root>/plugins`（数据根自己的前缀）、已提交推送的 `plugins/`（从 `harness.json` 读取，无需宿主）、安装目录的 `plugins/`、安装入口——按 Node 的方式查找包，读 import 方会读到的入口（`exports` 的 import 条件或 `main`）。

**随构建发布不等于已安装。** `builtin` 只是「这个包从哪来」的标签，绝不是第二种安装方式：构建带来的插件在目录里标为*内置*——安装它不会经过网络——但它的安装、加载与移除与其他插件完全一样，由 Project 把它列进清单。只有随构建发布的插件可以被要求；构建没有带的名字会被拒绝而不是写入清单，因此 Project 永远不会指名一个不在机器上的包。

## 插件页

一个列表，一行一个插件，各种插件都用同一种卡片，上方是搜索框，旁边是筛选器。**已安装的插件 (N)** 在前，默认折叠：插件库里的 skill 与 hook 包（随构建自带，每个 Agent 都可以用），以及当前 Project 要求的模块插件，各自带着运行中的进程对它的判定——*已安装*、*运行中*或*重启后加载*。其后是**可安装**：Project 尚未要求的市场条目，以及市场里还没有条目的自带包。每一行有插件的名字、描述、版本与更新日期，以及它的标签：分类（Office Productivity、sandbox、languages……）、*内置*、关键词。筛选器是三组受控的维度，每个选项带计数——**分类**、**包含**（skills、hooks、modules）与**状态**（已安装、可安装、运行中、重启后加载）；同一维度内的选项取并集，维度之间取交集。每一行都带自己的控件，可以在读到它的地方直接要求，也在同一处移除。点开条目进入详情页，有元数据与渲染后的说明文档，因此选择一个沙盒后端不必再去读它的源码。

## 清单属于 Project，进程跑的是闭包

一个 Project 的插件写在它自己的配置里——`.project_config.toml` 的 `[plugins]` 表，包名 → 要求，形状同 Cargo 的 `[dependencies]`（`"@scope/name" = "*"` 表示部署自带的那个，或版本字符串，或 `{ version = "…" }`，后续字段就放在这里）——与它的模型并列——因为机器是按 Project 借出的，所以 Project 的清单才是「插件要抵达哪些机器」的依据（见 PRFC-0010）。但加载是按进程的：模块树只有一棵。所以部署跑的是**闭包**，即它各 Project 的并集，插件贡献的东西对所有 Project 可见。插件页上的一行因此是两个事实的合并：这个 Project 要了它，以及这个进程有它。

路由是 `/api/projects/:projectId/plugins/installed`：`GET`（该 Project 的成员即可）读取清单及进程对每一项的判定，`PUT { plugins }`（管理员）重写它，`POST { specifier }`（管理员）要求一个插件，`DELETE …?specifier=` 去掉它。进入清单的每个名字都过同一道闸，`PUT` 与 `POST` 一样：必须是包名——不是路径或子路径——且是随构建发布的包。要求是同意，不是下载；移除不改动磁盘上的任何东西，只有当没有任何 Project 还要它时，包才从磁盘上移除。已列出但进程加载不了的——specifier 无法解析、包缺少它的表、import 抛错、模块名已被另一个插件占用——会带着原因显示，而不是被算作「待重启」；插件页把这一行标为加载失败并给出原因。配置读不了的 Project 不向闭包贡献任何插件，它自己的列表视图会报告这个故障；其他 Project 的部署照常启动。

## 不重启即生效，由 platform 完成

写入之后会让 App 自行重组：platform 用 kernel 自带的 `upgrade` 把内层的树再启动一次——同一个 bundle、同一份寄存文档，热推送本来就在做的那次交换——所以 pty 与机器连接像跨越一次推送那样跨过去；推送会中止的，它同样中止：正在进行的 Agent 运行，所有 Project 的，因为树只有一棵。管理员应用改动之前，插件页会先说明这一点。不重启进程，HMR 层也一字未动：运行时自始至终握着同一个外层实例，因此在任何运行时上都生效，旧的也一样。改动随重组一起走：在重组的队列里写入，因此两个管理员对同一个文件的编辑不会交错；启动失败时先撤销改动再恢复上一棵树——报告「未生效」，清单保持原样。

读闭包并 import 是 platform 在自己的 boot 里做的事，而不是 runtime 在进程启动时做的。一个部署运行哪些插件、这份清单怎么读，是策略；否则程序比某条规则旧的机器永远学不会它——一台机器已经收到了 Project 的清单，却所有插件都不生效，因为它的程序仍在找旧的 `plugins.json`。现在凡是能接受推送的部署，就能接受插件变更。跨越一次 swap 留在注册表里的是已 import 的对象，由下一个 App claim 并按 specifier 复用，绝不重复 import；闭包不再提到的条目直接不在新的 host 里。注册表里的 host 只由成功的 boot 写入，于是不可能再出现「插件显示已启用、而运行中的树里根本没有它」。runtime 仍保留一份自己的加载作为垫片，供比这次改动更旧的 platform 回滚时使用。

## 一个 Project 的机器上保持同一份清单

Project 的清单会被交给它使用的机器，走的是它的模型凭据本来就在走的那趟，时机也一样：清单变动时，以及每次连接时。一致是**严格**的——以 Project 的清单为准，机器上多出来的被移除。

代价需要知道：分平台的沙盒后端不在另一平台的清单里，因此会被拿走。想保住就把它列进整支机队的清单；解析不到它的那台会显示一条惰性的错误行，而不是丢掉自己能用的那个。同步按机器汇报：加了什么、移除了什么、哪些它列了却解析不到（多半是那台需要先更新），以及它是否仍需重启。

## 兼容性

**数据根的 `plugins.json` 不再被读取，也不做任何迁移。** 原本装着插件的部署会以**没有任何插件**的状态启动：沙盒后端、语言、会话表面都不在树里，直到各 Project 在插件页重新要求。旧文件原样留在盘上，因此回滚到更早的平台时它还在。

这个键在发布前短暂有过的列表形式（`plugins = ["…"]`）同样不再读取：这样的 Project 视为不要求任何插件，直到在插件页重新写入它的表。

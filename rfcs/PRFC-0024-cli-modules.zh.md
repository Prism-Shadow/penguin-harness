# PRFC-0024 CLI Modules：命令是归属于拥有它的进程的贡献

[English](PRFC-0024-cli-modules.md)

- Feature Name: `cli-modules`
- Start Date: 2026-11-02
- PRFC PR: none yet (native to this repository)
- Implementation PR: —（设计随提案的实现分支 `feat/cli-command-contributions` 承载，RFC PR 开启前先落于此）

## Summary
[summary]: #summary

`penguin` 的命令行成为模块机制（[PRFC-0001](./PRFC-0001-module.zh.md#the-three-primitives)）之下的一组命令贡献。一条命令是一个 `@Component` 类的一份贡献：它的**静态半**写在 manifest 里——一个**命令 key**（这条命令答的 argv 路径）加每种语言一行 summary——它的**代码半**是类上的 `@Bind` 字段，与沙箱后端同一个类形状（[PRFC-0001](./PRFC-0001-module.zh.md#slots-and-contributions) 把槽写成 `Slot<Data, Code>`：清单里携带的 data 与绑定的实现 code，正是一份贡献的这两半）。收集这些贡献的宿主有两个，各在自己的进程里：CLI 自有的命令是 CLI 树上 `CliCommandsModule.commands` 槽的贡献，入口静态 boot、由构建固定；插件的命令是 server 树上 `PluginCliCommandsProvider.commands` 槽的贡献——知道它们、运行它们的都是 server，CLI 经两条路由取用，同 web 应用读自己的贡献一个读法。归属由进程决定——一条命令属于能运行它的那个进程，CLI 从不为分派而加载插件代码。

## Motivation
[motivation]: #motivation

### CLI 至今是一整块手写注册

CLI 的 program 由一个文件拼装：import 每条命令的 `register`，按序逐个调用。命令是宿主里的一次函数调用，不是树上的一个节点：帮助文本长在注册旁边，没有任何地方在自己代码运行之前声明它需要什么，加一条命令就要改宿主。server 的业务面早已告别这个形状、成为一棵模块树；CLI 是最后一块仍靠手拼装的表面。

### 插件的命令此前没有归属

插件提供给终端的命令，总要有人发现、有人执行，本设计的上一稿把两半都放进了 CLI：CLI 自己逐包读生成表、自己比配命令行、在自己的进程里执行插件的代码。这使 CLI 成了第二个插件宿主——它要懂插件解析、import 插件模块、为插件代码的行为负责——只为了命令能在没有 server 时运行。web 应用读自己的贡献是读数据，经 `GET /api/contributions`，浏览器里不执行它们；终端值得同一个答案。

定下这件事的事实是：推送携带的 CLI 就是启动 server 的那份代码。内建命令从两个进程的视角看完全一致，因为两个进程看到的是同一次构建。两进程之间不同的是动态状态——而插件的命令恰恰是动态状态：它们在 server 的模块树上，与 routes、技能、设置组并排。所以按归属切分：内建归 CLI 进程，插件命令归 server 进程，CLI 在这件事上是 server 的客户端。

## Guide-level explanation
[guide-level-explanation]: #guide-level-explanation

### 一条命令的两半

命令按其余一切贡献的方式贡献（[PRFC-0001](./PRFC-0001-module.zh.md#slots-and-contributions)）：**静态半**在 manifest 里，不执行任何代码即可读出；**代码半**绑在贡献类上。

- 静态半是一个**命令 key**——`a.b.c`，这条命令答的 argv 分段（`penguin a b c ARGS`）——加一个 **summary**，每种语言一行，help 打印的就是它。
- 代码半是一个 `register(node, ctx)` 函数：宿主已经按 key 定位了命令节点、把 summary 写成了节点描述；register 在其上补 options、参数与 action。register 从不自己搭路径。

```ts
@Component({
  contributes: {
    "CliCommandsModule.commands": [
      { id: "cli.auth", key: "auth", summary: { en: "Sign in…", zh: "登录…" } },
    ],
  },
})
export class AuthCommand {
  @Bind("cli.auth") command!: CliCommandCode;
  setup() {
    this.command = { register: (command, ctx) => registerAuthCommand(node(command), ctx.messages) };
  }
}
```

### CLI 自有命令：由构建固定的一张表

CLI 自有的二十条命令各是这样一个 `@Component` 类，贡献给 `CliCommandsModule.commands` 槽；CLI 入口每次调用静态 boot 这个模块一次。CLI bundle 就是启动 server 的代码，所以这张表在 CLI 进程与 server 进程里是同一张，serve 组——`server`、`web`、`server status`、`server stop`、`server reset-admin-password`——作为一组 CLI 命令留在 CLI 包。表面原封不动：`penguin --help` 打印的一如既往。

### 插件的命令：server 树上的贡献

插件用同一个类形状贡献命令，贡献给 server 的 `PluginCliCommandsProvider.commands` 槽。命令与插件其余部分一起长在 server 的模块树上，所以知道它们的是 server。两条路由服务这个槽：

- `GET /api/cli/commands` 列出每条命令连同所属包、key 与 summary——对任何已登录用户开放，同 web 读自己的槽一个读法。
- `POST /api/cli/commands/run` 在 server 上把一个 argv 对一个包的命令运行——仅管理员。回复带着这次运行在 stdout、stderr 上打印的内容与退出码。

无法运行的命令在 boot 时被剔除，各带一条警告：背后没有已加载插件包的模块、不是命令路径的 key、同一包贡献了两次的 key。半注册的东西永远不会出现在列表里。

### CLI 怎么分派

命令行首词是 CLI 自有命令时，照旧本地运行。否则：

- **恰有一个包答。** CLI 向一份已在跑的 server 查命令列表（不启动 server）。一条命令「答」一个命令行，指它的 key 与命令行的前导词逐段一致（判定见 Reference）；找到恰有一个包的命令答这些词，经 server 运行，把带回的输出当作自己的打印。
- **两个及以上包答。** 这就是歧义。CLI 逐包打印一行可直接复制的 `penguin exec <包>:<id>`，退出码 2，什么都不运行——由调用方指明它要的那一个。
- **无人答。** 命令行交回 CLI 自己的解析，照旧报未知命令。

`penguin exec <id> [args…]` 直接按点分 id 点名一条插件命令——`sandbox.wsl.restart`，至少两段——id 之后的所有选项（包括 `--help`）都归那条命令。两个插件贡献同一 id 时，用 npm 全名点名：`penguin exec <包>:<id>`，scope 不可省略。`penguin exec ls [包]` 列出各插件贡献的 id，旁边是各自的摘要。同其他需要 server 的命令一样，server 未运行时它会启动一个。

## Reference-level explanation
[reference-level-explanation]: #reference-level-explanation

### 收进 core 插件契约包的契约

命令契约住在 `@prismshadow/penguin-core/cli`——core SDK 里与插件契约并列的一个出口——贡献者因此不依赖任何 CLI 包：

- `CliCommandSummary`——`{ en, zh }`，每语言一行的 summary。
- `CliCommandData`——`{ key, summary }`，槽的数据类型。
- `CliCommandEntry`——静态半加 manifest 的 `id`，即被收集的贡献携带的形状。
- `CliCommandProgram`——宿主按 key 定位的命令节点，summary 已写成它的描述。它是 `Opaque<"Command">`：贡献者用它自己包所依赖的 commander 来标注类型，契约因此不钉 commander 的版本。
- `CliCommandMessages`——每个宿主的 bundle 都保证的东西：`language`，宿主为这次调用解析出的 locale。命令从不解析 locale；bundle 其余部分是宿主自己的词汇，CLI 的就是它完整的 `Messages`。
- `CliCommandContext<M>`——代码半可从宿主使用的东西：宿主的消息包，每次调用解析一次。输出不在契约里：命令直接写进程自己的 stdout 与 stderr、直接设 `process.exitCode`，而这些意味着什么由宿主决定——内建命令是 CLI 自己的这次调用，server 运行时是回复里的字符串。
- `CliCommandCode<M>`——`{ register(command, ctx) }`，代码半的形状；贡献者用它所贡献槽的宿主来标注 `M`。
- `cliCommandKeyFault(key)`——共享的 key 文法：小写 `[a-z][a-z0-9-]*` 分段以点连接，通过时返回 `null`。分派、归属与 key 到命令节点的翻译读的都是这一个判断。

### CLI 宿主

CLI 每次调用 boot `CliCommandsModule` 一次，从槽上读贡献，把每个 key 变成 program 上的命令节点、以 summary 作节点描述，再对那个节点调用绑定的 register。CLI 把本次调用的 locale 解析一次（`PENGUIN_LANG`，默认英文），把它的消息包经上下文交给每个 register——没有任何命令自己去解析 locale。help、version、`exec`、`update`、`auth`、`plugin` 与 serve 组归宿主所有，如同任何节点拥有自己的表面——给命令命名的另有其处是不允许的。

这张表与其他一切 manifest 一样是生成产物：`gen:ifaces` 把两个槽——CLI 包的 `CliCommandsModule.commands` 与 server 包的 `PluginCliCommandsProvider.commands`——投影进 `ifaces.json`，同几条再生路径（`typecheck`、build、test、`deploy.mjs`、`release-npm.sh`）让它与代码保持同步。

### Server 的槽与两条路由

`PluginCliCommandsProvider` 拥有槽，把路由以 `/api/cli/commands` 前缀贡献给 `HttpModule.routes`，boot 时从自己的槽上读贡献。三件事使一条贡献被剔除，各带一条指明模块与 id 的警告：贡献模块背后没有已加载的插件包；key 过不了 `cliCommandKeyFault`；同一包把同一个 key 贡献了两次——两条都剔除，这个包的命令因此保持无歧义。到包的归属按调用现取，插件表变更无需整树 re-boot 即可可见。

运行侧每次请求新建一个 commander program——被指名包的每条命令，各在其 key 定位的节点上、以 summary 作描述——然后仅对这个 program 解析 argv。每个 register 拿到宿主的消息包；server 还没有共享的命令词汇，它的 bundle 只携带调用方解析出的 locale。无参数时打印该包的帮助；commander 自己的帮助与用法错误按 commander 的退出码原样回复；命令自身的失败在受控调用链内被接住，写进回复的 stderr、退出码 1，从不越入 server。一次运行期间，server 把本进程的 stdout 与 stderr 重定向进回复的字符串——命令写进程；进程的流意味着什么由宿主决定——运行结束后恢复，且运行串行执行，两个并发的运行不会互相捕获对方的输出。运行返回的是字符串，不是一个活进程。这在请求边界内接住失败，不是进程隔离：插件与平台同进程运行，安装即信任其代码（[PRFC-0003](./PRFC-0003-plugin.zh.md#principles)）。这条边界保证的是普通失败——抛错、rejected promise、用法错误、帮助——以一个回复回来，而不是一个坏掉的请求。

鉴权分两层：路由带 `auth: "user"`，列表对任何已登录用户开放；run 处理器对管理员之外一概以 `403 admin_required` 拒绝，被拒的请求到不了任何命令的 register。未知包答 `404 unknown_package`；畸形请求体按请求校验自己的名字作答。

### 分派，逐例

CLI 的隐式分派是 argv 与列表的一个纯函数。**命令词**是 argv 到第一个选项为止的前导词。key **应答**一个 argv，当它的分段与命令词在双方都及得的范围内逐段一致：

- `tool sub` 应答 `tool sub x`，也应答 `tool` 与 `tool --help`——词先停下的情形。
- `tool sub` 不应答 `tool other`。
- 一个包有多条命令仍只算一个候选：匹配按包计、去重。
- `tool`（包 A）与 `tool sub`（包 B）都应答 `tool sub x`——两个包，即歧义。一词被一个包前缀、被另一个包延展，不构成打破平局的依据；打破平局靠具名，那就是 `penguin exec`。

歧义报告逐包打印一行——`penguin exec <包>:<id>`，id 取该包应答 argv 的命令中最长的 key——后接 argv 中 key 未命名的部分，每个词按 POSIX shell 能原样读回的方式加引号。粘贴这行，即以同样的参数（选项在内）运行那条插件命令，无需 `--`。报告写 stderr、退出码 2，什么都不运行。

`penguin exec` 按列表解析 id：id 是至少两段的点分 key，精确匹配——不做前缀或后缀匹配。裸 id 在恰有一个贡献包携带它时可用；撞名列出各包，未知 id 列出全部 id，两者退出码 1、什么都不运行。带前缀的形式 `<包>:<id>` 取 npm 全名——scope 不可省略——读作该包的这条 id。`penguin exec ls` 列出全部命令及其包与摘要；带包名则只列该包的命令。请求携带 `prog`——隐式分派是 `penguin`，显式形式是 `penguin exec <名>`——用法行按调用方的叫法打印；还携带 `language`，summary 与命令自己的文字按调用方语言返回。

一处降级明说：列表取不到时——server 未在跑，或查询失败——CLI 无法知道是否有插件本会答，于是退回自己的解析、报未知命令。隐式分派把「问不到」与「没有命中」同样对待；`penguin exec` 的存在，正是让需要这条命令的调用方不必依赖那个回退。

## Invariants
[invariants]: #invariants

### 路径由静态半决定

> 无论一条命令以何种方式抵达命令行——CLI 自己的表，或插件的经 server——[命令 key](./PRFC-0024-cli-modules.zh.md#guide-level-explanation) 都是定位其节点的唯一依据，[代码半](./PRFC-0001-module.zh.md#slots-and-contributions)收到的都是那个节点：register 从不自己搭路径。

manifest 里的 key 是命令路径的唯一来源；help 打印的 summary 与它同住在同一条目里。另一条路——register 自己调 `program.command("…")`——把路径放进两处，两处第一次被人各改一头就互相矛盾：help 说一套，分派答另一套。破坏它，静态半就不再是数据：不运行代码就无法列出、无法校验、无法投影。

### 插件的命令归属 server

> 无论 CLI 如何分派，插件的命令仍由 server 发现与运行，CLI 仍只经 [server 的命令 API](./PRFC-0024-cli-modules.zh.md#guide-level-explanation) 取用——从不为分派而加载插件代码。

这是本 RFC 之所以存在的归属决定。CLI 是客户端；发现与执行住在贡献所在的树所属的进程里，信任模型就是插件平台自己的那一个（[PRFC-0003](./PRFC-0003-plugin.zh.md#principles)）——一个进程、一次信任决定——而不是在 CLI 内部再长出一个更弱的。破坏它，此后每一个插件表面（技能、工具、hook）都得重新回答「哪个进程运行插件代码」，而 CLI 成为一个必须靠推送才正确的插件宿主。

### 隐式分派永不瞎猜

> 无论有多少个包答同样的词，[隐式分派](./PRFC-0024-cli-modules.zh.md#guide-level-explanation)在非恰有一个包答时仍然什么都不运行：其余情形是一份报告，全无命中时照旧交回 CLI 自己的解析。

便利形式绝不可悄悄消解歧义。跑第一个候选，是把用户的笔误变成插件的动作；报告后退出码 2 的形状保住命令行的可预测——同样的词要么做它们意指的那一件事，要么停在一行列出全部候选、可直接复制的提示上。破坏它，终端就成了 harness 里唯一一个靠运气消解重名的表面。

## Drawbacks
[drawbacks]: #drawbacks

二十个命令组件静态 boot，单文件拼装没有这个代价：实测 `penguin version` 慢了约 60 ms，这是入口 boot 的价钱。一条命令现在是一个类加一条 manifest 条目——对贡献者比一次函数调用更繁，换来的是一张能列出、能校验、能对外服务的表。隐式分派要有在跑的 server 才看得见插件命令；离线时 CLI 只认识自己。输出缓冲把一次运行的 stdout 与 stderr 整个握在内存里，无上限；而且一次运行在途时，server 自己的 stdout 与 stderr 也被重定向进那份回复，窗口内 server 打印的任何东西都会被一并捕获。回退把「问不到 server」与「没有插件命中」混为一谈——列表取不到时报的是未知命令，而点破降级会更诚实。退出码 2 成为 CLI 公开契约的一部分，脚本从此可见。

## Rationale and alternatives
[rationale-and-alternatives]: #rationale-and-alternatives

**本设计的上一稿**——CLI 逐包读生成表、在自己的进程里执行插件代码——被否，因为它使 CLI 成为第二个插件宿主：它要懂插件解析，还把信任决定劈成两个进程。按进程归属取代了它。

**server 连内建命令也一并收集**——一个宿主管全部——被否，因为内建命令表由构建固定，而启动 server 的构建就是 CLI 的；把内建收进 server 的树，`penguin --help` 就要依赖 server 可达，或把表发两份。

**维持手写注册**今天不花什么，日后每条命令都花：宿主继续长，help、分派与（将来的）补全各自手工重读注册，插件则被彻底挡在终端之外。

## Prior art
[prior-art]: #prior-art

**VS Code 的 contribution points** 是静态半的原型：命令在 manifest 里按数据声明——id 加每语言一个标题——扩展在代码里注册 handler；workbench 不执行扩展即可列出声明了什么。我们的槽取同一形状，key 扮演 id 的角色。

**Git、kubectl、cargo 与 gh** 都把子命令分派给具名的可执行文件：`git-remote-*` 在 `PATH` 上，`kubectl-*` 与 `cargo-*` 也在那里找，`gh` 按名运行扩展。具名形式无一例外是最可靠的形式，发现形式的严格程度则各有取舍——kubectl 对撞名给警告，cargo 拒绝歧义短名。`penguin exec <id>` 是具名形式；隐式分派是发现形式，按其中最严格的标准执行：有歧义就不运行，而不是挑一个。

## Unresolved questions
[unresolved-questions]: #unresolved-questions

- 列表取不到要不要具名？降级的隐式分派若会说「server 未能询问」，比一条未知命令错误更诚实，代价是 CLI 多一条错误路径。
- 运行回复的缓冲要不要上限？超限时一次运行答什么？
- 从静态半出 shell 补全：key 与 summary 本已机器可读；补全表面不在本 RFC 范围内。
- 授权要不要细化到 admin 之下——按命令、按包——等有真实消费方再说？

## Future possibilities
[future-possibilities]: #future-possibilities

补全与 help 可以只从静态半出，内建与插件一视同仁，包括 `penguin exec ls` 的列表——它已经是了。别名——第二个 key 答同一条目——能让一个包改名命令而不破脚本。桌面若有一天在同一张表上长出命令面板，它读两条路由与本地表即可，无需新机制。

---

## Changes

### v1.0.0

- Initial version

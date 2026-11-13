# PRFC-0002 HMR v1：层只有 `/api/hmr`，只依赖 http 与 log

[English](PRFC-0002-hmr.md)

> **来源**：设计仓 [penguin-harness-design](https://github.com/Prism-Shadow/penguin-harness-design) 的 `rfcs/PRFC-0002-hmr.md`——落地于默认分支 `main`（提交 [`ac673a24`](https://github.com/Prism-Shadow/penguin-harness-design/commit/ac673a245eec78d6afca35e260dce28b2a3ab3ac)）。
> **修订**：v1.0.0（迁入主仓）；本面的约定见 [README.zh.md](README.zh.md)，逐版本改动记在文末 `## Changes`。

- Feature Name: `hmr`
- Start Date: 2026-09-08
- PRFC PR: [Prism-Shadow/penguin-harness-design#128](https://github.com/Prism-Shadow/penguin-harness-design/pull/128)
- Implementation PR: [Prism-Shadow/penguin-harness#656](https://github.com/Prism-Shadow/penguin-harness/pull/656)（第一批）

## Summary
[summary]: #summary

HMR v1 把层与平台之间的关系收成三条：

1. **层的 HTTP 面只有 `/api/hmr`。** 其余每一条路由都是平台的，经接缝提供；层不为任何路由保留副本。
2. **层与平台之间的接触面是两个句柄**：要服务的 HTTP 面，以及一个写日志的出口。入口造出两个句柄的初值传给层；每启动一代平台，平台交出自己的 http 与 log，层把句柄换到新的一代

   ```ts
   function hmrMain(initHttp: Http, initLog: Log): Promise<number>
   ```

   层不靠 `@Use` 注入，也不按名字从被推送的树里取任何东西。
3. **registry 是平台的内存状态。** 每个条目的 id 是 `platform.<name>`；改动 id 或节点名是层与平台的**硬升级**，不设别名、不做兼容。

## Motivation
[motivation]: #motivation

`packages/hmr/README.md` 立了一条规则：**层承载机制，不承载策略**。层却一直在违反它，而且违反的方式是最难看见的一种——按字符串向平台要东西。

违例已经发生过一次。`/api/desktop` 挂在层里，hiyouga 改了它，但不知道这条规则，结果这次改动只能靠重装程序送达——用户没有得到热重载。层里按名字向平台取 `Log`、`Errors`、`Access`、`Settings` 来写请求日志、错误入库、归因、算 body 上限，是同一种违例：下一次改到它们的人同样会撞上。

`/api/auth` 本可以留在 HMR 层。但为了把 HMR 层收到最小，这些基础功能一并排除出层，放进平台：目标是**平台的每一个功能都能热重载**，层里只剩替换平台所必需的机制。

## Guide-level explanation
[guide-level explanation]: #guide-level-explanation

把层想成一个宿主：它负责启动、热替换、把端口打开、把请求交出去。它需要知道的只有两件事——**交给谁**，以及**往哪里写自己的日志**。两者都是句柄：入口给出初值（一个只会答「平台没起来」的 http、一个 console log），之后每一代平台启动成功时交出自己的 http 与 log，层把句柄换过去。

```ts
const code = await hmrMain(initHttp, initLog);
process.exit(code);
```

`http` 指向当前那一代平台装配出的 fetch 面。`log` 指向当前那一代的日志出口，平台缺席时退回初值。层不知道有 Project，不知道有设置，不知道错误怎么入库——这些都在 `http` 后面，由平台自己决定，随推送更新。

于是：

- **层在接缝之上只挂 `/api/hmr`**，接缝之下只有静态托管与 SPA 回退。`/api/auth`、`/api/desktop`（shutdown 与客户端更新中继）是平台的路由组；平台拒绝的路径就是 404，层不兜底。
- **请求日志**由平台的中间件写；层只在自己的生命周期上写行（启动、交换、退出）。
- **错误入库**由平台的 `onError` 做；层遇到进程级崩溃时只 `log`，因为那时可能根本没有可用的平台。
- **body 上限**由平台自己 gate——它本来就是平台的一个设置。
- 层的入口返回**进程退出码**，把「怎么收尾」也收进同一个函数里，而不是散在信号处理与 shutdown 路径上。

层按名字从树里取东西的地方降为**零**：平台在启动回调里把 http 与 log 交出来，层不进树。

## Reference-level explanation
[reference-level explanation]: #reference-level-explanation

### 层的 HTTP 面

`createApp(boot)` 挂载：网络守卫、平台接缝、静态托管。层在接缝之上不挂任何 API：`/api/hmr` 也是平台声明并贡献的路由组（自带 network gate，其后是平台的鉴权与 admin 检查），路由答什么（推送的 body、结果、探测）是机制的 `upgradeEndpoint`，经 `platform.hmrControl` 认领；不服务该通道的一代在提交前被拒绝（`admitsUpgradeRoute`），上一代继续，安装永远留有再推送的路。没有前缀清单，没有回退副本。平台侧 `HttpModule` 按贡献的 `routes`（`prefix` / `auth` / `order`）装配；cookie 门按组挂载——每个 `auth: "user"` 的组在自己的 `prefix` 上带门，同一请求只鉴权一次；`auth` 的含义因此与 `order` 无关：排在受保护组之后的 `auth: "none"` 组仍然公开，`/api` 之外的受保护组（机器代理 `/server/`）同样受保护。没有任何组服务的路径由平台拒绝，即 404，而不是落到门后变成 401；`/api/auth` 组自己以 404 收尾。

### 入口

```ts
// main：造两个句柄，给初值，交给层
const http = handle<Http>(initHttp); // 初值只答「平台没起来」
const log = handle<Log>(initLog);    // 初值写 console
process.exit(await hmrMain(http, log));

// 层
async function hmrMain(http: Handle<Http>, log: Handle<Log>): Promise<number> {
  const platformStart = resolveHarness();               // harness.json 指向的那一版，缺省是打包进程序的
  const replaceHmr = (nextHttp: Http, nextLog: Log) => {
    http.set(nextHttp);
    log.set(wrap(nextLog, log));                         // 新 log 包住旧句柄：平台没了就退回上一层
  };
  const next = (version: Version) =>
    platformStart(version, resources, (newHttp, newLog) => replaceHmr(newHttp, newLog));

  http.route("/api/hmr/upgrade", (req) => next(versionOf(req)));
  await next(current);
  return exitCode;
}
```

- **句柄**是层唯一持有的东西：监听器每个请求读一次 `http`，层自己写行时读一次 `log`。swap 只是换句柄指向，不重启、不重新解析。
- **平台交出值，而不是层去取**：`platformStart` 启动一代平台后，在回调里把该代装配出的 http 与 log 交给层。层从不 `tree.api(...)`。
- **失败即不换**：新一代启动失败，回调不会被调用，句柄仍指向上一代；host 恢复上一版后同样如此。第一代启动之前、以及所有代都死了之后，句柄是初值——http 答「平台没起来」，log 写 console。
- **`/api/hmr/upgrade` 挂在句柄上**：层在 `http` 上只挂这一条路由；其余请求全部落到句柄当前指向的平台。

### 迁移清单

- `createApp` 去掉 `errors` / `settings` / `access` / `authService` 四处解析；`onError` 只保留 `handleError`，记录交给平台。
- `index.ts` 的 `uncaughtException` / `unhandledRejection` 不再 `liveApi<Errors>`，改为经 `log` 句柄写行，进程退出语义不变。
- `applyPersistedProxy()` 移到平台启动路径：代理设置是平台的设置。
- `liveApi` 删除：句柄取代了它的「上一个 App 的值」回落语义。
- `Clock` / `Paths` 不是层的东西：从 `hmr/capabilities.ts` 与 `RuntimeModule` 搬回平台自己的模块，纯搬家。

### 节点名

层的常量与类型已统一到 HMR 词汇（`HmrCapabilities`、`claimHmrCapabilities`、`HMR_*_RESOURCE_ID`）。层不再按名字取节点之后，模块节点（`RuntimeModule`、`RuntimeDesktop`、`RuntimeAuthState` 等）改成说明它们是什么的名字——它们是平台里把层发布的对象包成节点的那一组；同样是硬升级，不需要固定名字的测试。

### registry 与 id

registry 里的是平台的状态，进程替它保管，只为 swap 不丢。每个条目的 id 是 `platform.<name>`——dot 分隔、camelCase，与 plugin id 同形：`platform.interfaces`、`platform.config`、`platform.db`、`platform.channels`、`platform.proxyControl`、`platform.host`、`platform.desktop`、`platform.lifecycle`、`platform.authState`、`platform.overrides`、`platform.plugins`，以及平台写给下一代的停放声明 `platform.resourceInterfaces`。动态条目 `terminal:<sessionId>` 保持冒号形式：那个冒号是 `disposeGroup` 按组清扫的键。

registry 是内存状态，**没有别名**：层只注册新 id，平台只认领新 id。带此改动的平台推到早于它的层上，握手读不到 `platform.interfaces` 即被拒绝，层恢复上一个版本；层需要重装。这是有意的——为内存状态维护跨代别名是长期成本，换不回任何持久数据。

## 落地状态
[status]: #status

**已落地（[penguin-harness#656](https://github.com/Prism-Shadow/penguin-harness/pull/656)）：**

- 层改名为 HMR 层；机制成为 `packages/hmr`（`HmrHost` 看不见平台：bundle 是构造参数，api 是类型参数）；一份 README 在 `packages/hmr/README.md`。
- 层的 HTTP 面只剩 `/api/hmr`：`AuthRoutes` / `DesktopRoutes` / `DesktopUpdateRoutes` 成为平台路由组，`HMR_LAYER_PREFIXES` 与拒绝中间件删除，层不留回退副本。
- registry id 全部为 `platform.<name>`，无别名；固定节点名的测试删除。
- `createHmrApp` 改名 `createApp`。
- `log` 句柄：平台在 api 上交出 `log`（iface 点名），层的请求日志行每行经 host 解析到当前平台，平台没有就写 console；`http` 句柄即接缝本身。层里其余按名字的解析未动。

- 入口与冻结的操作在 `packages/hmr/src/main.ts`：`hmrMain(host, replace, start)` 返回控制对象——`current()`（请求交给哪一代，先等完进行中的 swap，无一代可启动时抛出）、`upgrade(target)`（存 bundle、启动新一代、swap、提交，或把上一代重新启动），两者之后都调用产品的 `replace`（新的一代，或失败后重启的上一代）。server 的 `main()` 先绑端口（平台起来前答 503），再把 host、`replace`（刷新层解析节点用的树）与自己的启动交给 `hmrMain`；接缝与升级路由只驱动控制对象，不再直接驱动 host。
- `/api/hmr` 是平台贡献的路由组（`HmrRoutes`），鉴权是平台加的；控制对象多一个 `endpoint(request)`——推送协议本身在包里；`upgrade` 在提交前探测新一代是否服务 `/api/hmr/upgrade`，不服务则拒绝（kernel `upgrade` 的 `admit` 钩子），测试固定「一次坏推送不能把机器锁死」。
- 推送按 `git push` 的方式走：存储按内容寻址（`store/blobs/<sha256>`），`POST /api/hmr/assets/probe` 回答目标缺哪些 blob，`PUT /api/hmr/blobs/<sha256>` 原样收一个 blob（哈希对上名字才存），`POST /api/hmr/upgrade` 形状不变，其中每个内容值（`platform` / `cli` / `web.files` 与 `assets.files` 各项）可写成 `{ sha }`，升级在启动前从存储解析，指名了存储没有的 blob 即拒绝。三者都是机制的（`packages/hmr`），经控制对象到达；deploy.mjs 先探测、只上传缺失的 blob、再推送一个只有名字的 body。没有 probe 的老目标仍收到全部内联。

**待落地：**

- 层里其余按名字的解析（`Errors` / `Settings` / `Access` / `Auth`）与 `liveApi`——每一项单独过，不打包。
- `Clock` / `Paths` 搬回平台；模块节点改名。

## Drawbacks
[drawbacks]: #drawbacks

**每一步都是硬升级。** 程序早于本改动的安装无法接收本平台的热推送：握手在 registry id 处即被拒绝。这类安装必须更新程序，而不是推送。

**进程级崩溃不再入库。** `uncaughtException` 发生时平台可能正处于交换中途或根本没起来；层经 `log` 句柄写行，句柄指向谁就写到哪——平台在就是平台的日志，不在就是 console。代价是丢掉一部分崩溃记录，换来的是层不再持有一个「随时可能指向已销毁树」的引用。

**平台没起来时没有任何 HTTP 面**，包括登录。以前看起来像是有——`/api/auth` 由层服务——但那是假象：认证实现本来就在平台里。本 PRFC 把这件事摆到明处，而不是修好它；真正的「降级模式」是另一件事。

## Rationale and alternatives
[rationale and alternatives]: #rationale-and-alternatives

**为什么是传参而不是按名字取。** 按名字取把「模块叫什么」变成了层与平台的契约，代价是模块从此不能改名、服务不能搬家，而违反的后果是旧安装启动即死。传参把这份契约收敛到函数签名上——签名由两侧同一次构建产出的类型守着，改坏了是编译错误，不是线上事故。

**为什么不给 id 设别名。** 别名让一份内存状态背上永久的两套名字，还要在层与平台两侧各写一份读写逻辑（第一版实现里正是如此，被否决）。硬升级只多一次重装，而且握手会明确拒绝，不会带着错误的状态跑起来。

**替代方案：导出表。** 让平台发布一张稳定别名表（`"http" → HttpModule#http`），层只认表里的名字。这保住了「按名字」的灵活性，也解开了改名的锁。它比本方案改动小，但没有解决真正的问题——四对策略仍然在缝之下。可以作为后续，与本方案不冲突。

**替代方案：什么都不动，只是不改名。** 这正是此前的状态：一个描述错了的名字被永久保留，因为它是契约。成本是每一次重构都要绕开它，而绕不开的那次就是故障。

## Prior art
[prior art]: #prior-art

同一条缝上已经做过同向的移动：客户端更新中继、登录与桌面 shutdown 从层移到平台（#656）；host commands 与插件加载的移动在 #631 与 #383 上待合并。每一次的理由都一样——那是策略，策略靠推送更新。本 PRFC 是把这条线走完。

Rust 的 `fn main() -> ExitCode` 是同一个形状：入口拿到它需要的东西，返回退出码，不向宿主反向索取。

## Unresolved questions
[unresolved questions]: #unresolved-questions

- `wrap(nextLog, log)` 的形状：新一代的 log 包住旧句柄以便回退，但回退到几代之前——只到初值，还是逐代往回。
- `Handle` 是层自己的一个小类型，还是放进 `packages/hmr`。

## Future possibilities
[future possibilities]: #future-possibilities

- `ModuleTree` 增加按接口解析的能力，让模块名彻底退回实现细节。
- 层缺席平台时的降级模式：一个由层自己拥有的最小面，只够看到「平台没起来」以及怎么恢复。

## Changes

### v1.0.0

- 新增：迁入主仓；正文取设计仓的同一版本，与英文版逐节对应。

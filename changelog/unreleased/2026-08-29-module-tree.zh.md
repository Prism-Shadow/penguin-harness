# 服务端成为模块树，启动前按签名校验

- **Date:** 2026-08-29
- **Type:** refactor
- **Scope:** `core`, `server`, `web`, `tooling`
- **PR:** [#543](https://github.com/Prism-Shadow/penguin-harness/pull/543)
- **Breaking:** `@prismshadow/penguin-server` 不再导出 `AppDeps`、`buildAppDeps`、`createApp`；`activate(ctx)` 形态的插件契约被 `Plugin { modules }` 取代

[English](2026-08-29-module-tree.md)

服务端的业务面——每个服务、每个 repo、每组路由、session 运行时、终端管理器——现在是由这些 class 本身组成的一棵树（`packages/server/src/platform.ts`）——没有 `modules/` 目录，每个节点就声明在它所是的那个东西的文件里。大多数节点是**组件**：一个把自己导出的服务或 repo class。类上 `@Component()`——节点以它的 class 命名，`AuthService` 就是节点 `AuthService`，没有东西被命名两次——每个依赖一个 `@Use()` 字段，类型就是它需要的 class 或接口——`@Use() private readonly users!: UsersRepo`——在可选的 `setup()` 之前注入；class 的公开表面就是它的接口。**模块**是另一种节点：导出*别的东西*的 class，`@Module({ contributes?, context?, children? })`，在 `setup()` 里给 `@Provide() sessions!: Sessions` 字段赋值。两者都可以带 contribution 代码半身的 `@Bind("HostAssembly.routes") routes!: Hono` 字段和寄存状态的 `park()`。`AuthService` 与那个只为构造它而存在的模块现在是同一个 class；repo 与普通服务的 `modules/<name>/` 包装目录没有了，它们的 `Pick<Impl, …>` 接口类也没有了——消费者直接写组件 class，或者在消费处声明自己需要的窄接口（`abstract class ScheduleTaskRunner extends Interface<…>() {}`，声明在 scheduler 旁边）。`pnpm gen:ifaces` 静态读取装饰器与字段注解——从不执行文件——进与接口同一张表，组件的公开成员被投影为它的契约；启动器再把每个 class 与这张表核对（表里不认识的字段即为表过期错误），因此整棵树在任何 class 代码运行之前就被校验，之后按依赖顺序创建。树之外要用一个组件——脚本、测试——用 `wire(Cls, { …fields })` 构造。

## 签名级 interface

组件的接口就是它的 class 的投影；其余接口是 `extends Interface<…>()` 的抽象类，声明在哪里都可以。`pnpm gen:ifaces` 把每个这样的 interface 投影进 `packages/server/src/ifaces.json`——包含参数和返回类型，而不只是方法名；具名数据类型只输出一次、按引用使用，因此递归类型就是对自身的引用。这张表是生成物，不进版本库：`typecheck`、`build`、`test` 和部署脚本都会重新生成它。一个 requires 按 Go 的规则判定满足：消费者列出的每个方法都存在于提供者上且签名可赋值（参数逆变，返回协变）。模块可以在消费处声明自己需要的窄接口；scheduler 的 `ScheduleTaskRunner` 就是一例，由 session 运行时更宽的 `SessionManager` 满足。

宿主对象（`AbortSignal`、`Request`，以及本包里写成 `Opaque<"Name">` 的 class）只按名字比较，生成器会明说而不是猜。

## contribution 是 manifest 数据

一组路由就是 manifest 里的一行——`"HttpModule.routes": [{ "id": "agents.memory", "prefix": "/api/…", "auth": "user", "order": 190 }]`——模块按这个 id 绑定 handler。`http` 模块从这些行装配整个 HTTP 面；新增端点不再改任何集中的路由表。sandbox 后端和消息连接器走同一种槽位。

## 插件即模块

一个插件包就是一组模块：`package.json#penguin.modules` 承载 manifest，默认导出是 `{ modules: { <name>: { create } } }`，按名字配对，这些模块在每次 App 创建时作为 platform 树的子节点启动。`activate(ctx)` 契约——`initialize` / `create` 事件、`PenguinInterface`、`PenguinContext`——不再存在；它过去注册的东西（沙箱后端、workflow factory）现在是 contribution 或 provides，它过去触达的东西（`terminals`、`sandbox`）现在是按签名校验的 requires。四个沙箱后端已转换。

## 表就是一个页面

`pnpm ifaces:page` 把 `ifaces.json` 渲染成一个自包含的 HTML 页面（`dist-ifaces/index.html`）：模块树、每个节点的 requires / provides / contributes、每个接口的签名，标题里是表的 sha256，旁边就是那份 JSON。CI 为每个 commit 渲染一份，按 commit sha 发布到 `ifaces-pages` 分支，并从 job summary 与一条 PR 评论链接过去——页面的 `ifaces.json` 就是那个 commit 构建出的表，哈希一致。

## 兼容性

platform 节点的 parked 文档版本不变：模块树的文档是新增的 `modules` 字段，pty 句柄与沙箱设置仍写在最早的 platform 寄存它们的位置——所以被更新的 platform 寄存过的数据根，仍能启动之后推过来的任何更老的 platform，终端与沙箱配置都还在。

`@prismshadow/penguin-server` 不再有 `AppDeps`、`buildAppDeps`、`createApp`，也不再有 `activate(ctx)` 形态：按旧契约写的已安装插件会以 "not a plugin package" 加载失败，直到改写为模块。测试需要某个服务时，通过服务端测试 helper 的 `flattenForTests(boot)`，或 `boot.tree.api(module, alias)` 取得。——组件的别名是它的 class 名（`tree.api("AuthService", "AuthService")`）；槽位是 `<Class>.<slot>`（`HttpModule.routes`、`SandboxModule.providers`）。服务与 repo class 不再从构造函数接收依赖：`new UsersRepo(db)` 变成 `@prismshadow/penguin-core/kernel` 的 `wire(UsersRepo, { db })`。

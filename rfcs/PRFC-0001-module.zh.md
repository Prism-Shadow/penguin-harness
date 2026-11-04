# PRFC-0001 Module

[English](PRFC-0001-module.md)

> **来源**：设计仓 [penguin-harness-design](https://github.com/Prism-Shadow/penguin-harness-design) 的 `rfcs/PRFC-0001-module.md`——落地于默认分支 `main`（提交 [`ac673a24`](https://github.com/Prism-Shadow/penguin-harness-design/commit/ac673a245eec78d6afca35e260dce28b2a3ab3ac)）。
> **修订**：v1.0.0（迁入主仓）；本面的约定见 [README.zh.md](README.zh.md)，逐版本改动记在文末 `## Changes`。

- Feature Name: `module`
- Start Date: 2026-09-02
- PRFC PR: [Prism-Shadow/penguin-harness-design#117](https://github.com/Prism-Shadow/penguin-harness-design/pull/117)
- Implementation PR: [Prism-Shadow/penguin-harness#543](https://github.com/Prism-Shadow/penguin-harness/pull/543)（kernel 与生成器）、[Prism-Shadow/penguin-harness#599](https://github.com/Prism-Shadow/penguin-harness/pull/599)（服务端的转换）

## Summary
[summary]: #summary

Module 是这套 harness 组装代码的单位——一套机制，不是一条目录约定。它只有三个原语：**Interface** 说需要什么，**Component** 导出它自己，**Module** 导出别人。节点之间的接口以**签名级的数据**表达，整棵树在任何节点的代码运行之前被校验一遍。服务端的业务面是它的第一个应用，此前那只什么都装的 `AppDeps` 包裹随之取消。

## Motivation
[motivation]: #motivation

### 一套装配机制要满足三件事

任何一处要把一堆零件装到一起的地方，都得回答三个问题：一个零件**怎么说出它需要什么**；**怎么换掉其中一个**而不动其余；以及当装配的两半来自**两次独立的编译**时，怎么在装上之前判断它们拼不拼得起来。

第三条是这套 harness 特有的，也是最硬的一条。平台代码可以在线推送到一个正在跑的 runtime 上，两边各自编译；一个插件包是第三方编译的产物；将来一个 workflow 是 Agent 自己写下的代码。这些边界的共同点是：**跨过去之后唯一还能比较的东西是数据**。

### 服务端是这三个问题的第一个现场

这套机制之前，服务端的每个路由、每个服务都从一个叫 `AppDeps` 的对象里取自己要的东西——它最后长到四十来个成员，谁都能伸手。三件事因此都做不到。

一个节点**没有地方声明它需要什么**。`AuthService` 用到了 `AppDeps` 里的哪几样，只有读完它的实现才知道；反过来，某样东西还有没有人用，也只能靠全局搜索回答。

**换掉其中一样是不可能的**。测试要一个假的时钟，就得从 `AppDeps` 里塞；而一旦塞得进去，生产的依赖图里也就有了这条缝。

**热推送的两半没有办法核对**。当时 kernel 的接口比较只比方法名：名字对得上、签名对不上，照样装得进去，然后在第一次调用时炸开。

### 一个例子

沙盒后端要在热推送之后仍然能用。平台一侧要求后端有 `confine(argv, policy)`，后端一侧提供的是 `confine(argv, policy, extra)`——名字相同，签名不同。只比名字的检查会放行，直到某次真的 spawn 命令时才发现参数对不上，而那时命令已经在跑，不是没跑。跨这条边界要的是「装不进去就当场拒绝，并说出是哪个方法的哪个参数」。

## Guide-level explanation
[guide-level-explanation]: #guide-level-explanation

三个原语，一句话各自说清：**Interface** 是一组方法与字段的签名，写成抽象类只是为了当句柄——自己声明成员的用 `@Interface()`，本身就是某个已有类型的用 `extends Interface<T>()`；**Component** 是导出自己的节点，实例本身就是它的提供物；**Module** 是导出别人的节点，它有 children，并从 children 里转出一部分接口，子树其余的提供物对外私有。

一个节点用 `@Use()` 字段声明它要什么，用 `@Provide()` 字段声明它给出什么，用 `@Bind()` 交出某个贡献的代码半，用 `park()` 交出要留存的状态。依赖在可选的 `setup()` 之前注入完毕；生命周期钩子叫 `setup()` 而不是 `create()`，因为 repo 本身就有一个叫 `create` 的领域方法。

**节点由它的类命名**，所以不存在第二处起名的地方；也因此节点写在它本身所在的文件里，不另设 `modules/` 目录：`AuthService` 在 `auth/service.ts`，会话模块在 `runtime/session-manager.ts` 的末尾，一组路由的组件在那组路由文件的末尾。

构建时，`gen-ifaces` 静态读取这些装饰器与字段标注——从不执行被读的文件——把每个组件的公开面和每个接口类投影成签名数据，写进 `ifaces.json`。启动时，booter 拿这张表把整棵树核对一遍，然后才让第一个节点运行。表过时了，启动就以具名的错误停下。

树外面要用一个组件时（脚本、测试），`wire(Cls, { …字段 })` 手工装一个：原来的 `new UsersRepo(db)` 成了 `wire(UsersRepo, { db })`。

服务端的业务面按此组织：多数服务与全部 repo 是组件，运行时适配层、会话运行时、消息、沙盒、终端、机器、HTTP、Web 各是一个模块。同一套机制也是插件接入的方式（见下），以及前端那棵树将来的判定方式。

## Reference-level explanation
[reference-level-explanation]: #reference-level-explanation

### 三个原语

整套机制只有三样东西：**Interface** 说「需要什么」，**Component** 与 **Module** 是树上的两种节点。

#### Interface：一组方法签名，而签名是数据

接口写成一个抽象类。有两种拼法，分别对应两件不同的事。

**接口自己声明成员**——用 `@Interface()` 装饰器，成员就是这个类的成员，它们的文档注释也就写在它们自己头上：

```ts
@Interface()
export abstract class Db {
  /** Statements are host objects. */
  abstract prepare(sql: string): Opaque<"StatementSync", StatementSync>;
  abstract close(): void;
}
```

`prepare` 的返回值是一个**宿主对象**，所以写成 `Opaque<…>`：这不是可选的修饰，而是「这里不检查结构」的正式说法——生成器遇到它认不出的类类型会拒绝，写出 `Opaque` 才让它通过（见下「投影的边界」）。

被装饰的类**必须恰好是一份声明**：抽象类，不继承也不实现任何东西，每个成员都是抽象、公开、非静态的。一个可继承的基类或者一个带函数体的成员，等于把实现放进了契约，而当事人到底想要哪一个不是可以猜的——所以生成器拒绝，而不是替他决定。

**接口就是一个已有的类型**——这种情况装饰器表达不了，用基类那一拼：

```ts
export abstract class Config extends Interface<ServerConfig>() {}

export abstract class Sandbox extends Interface<
  Pick<SandboxService, "configure" | "currentSettings" | "backends" | "confiner">
>() {}
```

为什么非要两拼：TypeScript 没有办法把装饰器的类型参数带进实例类型，所以一个「本身就是 `ServerConfig`」或者「是 `SessionManager` 上几个方法的视图」的接口，写成装饰器之后成员对每个消费者都是不可见的。两种拼法因此正好分开了两件事——**自己声明成员的接口**，与**对一个已有类型的取景**。

`ServerConfig` 全是字段、一个方法都没有，这正是 `IfaceDecl` 需要 `fields` 的原因；映射类型按它展开后的形状投影，所以 `Pick<…>` 那一行不引入任何新东西，它只是把「我需要这四个方法」说出来。

两拼是同一个调用：`Interface()` 返回的句柄既能当基类，也能当类装饰器。它是一个普通函数而不是一个类，因为类不能不带 `new` 地被当作装饰器调用。

投影本身不因拼法而变——生成器读的是这个类的实例类型，而被装饰的类的实例类型恰好就是它那些抽象成员；变的只是识别方式，外加上面那道守卫。**两种拼法下类名都保留**，这一点要紧：类名是契约的一部分，而一份 parked 的模块文档正是按它作键。

接口在表里的键是 `<声明它的包>#<导出名>`。它是类只是为了当**句柄**——清单里可以按引用点名它，而不必写字符串。从它构造不出任何东西，也没有任何地方用 `instanceof` 检查它：判定是结构性的。

生成器把它投影成 `IfaceDecl`：一个 `name`（只用于消息与查找，身份是成员集合本身）、一张 `methods: Record<string, Sig>`，以及可选的 `fields`。有 `fields` 是因为 TS 的接口有非方法成员，而一个发布出来的配置对象往往除了字段什么都没有——Go 没有这一项；字段按**存在与类型**比较，从不比较值。

一个签名是 `Sig { params: TypeExpr[]; returns: TypeExpr }`：位置参数加返回类型。

`TypeExpr` 是这套设计的核心，它把「一个类型」压成一组可序列化的情形：

| 情形 | 是什么 |
| --- | --- |
| `{ data }` | 一个 arktype 定义——原始类型、字面量、联合、数组、元组、纯对象 |
| `{ iface }` | 一个满足另一个接口的**活对象**，值是接口表里的键 |
| `{ fn }` | 回调，内含一个 `Sig` |
| `{ promise }` | Promise 的解包类型 |
| `{ stream, returns? }` | `AsyncIterable<T>`；异步生成器的返回值放在 `returns` |
| `{ void: true }` | 无返回 |
| `{ array }` | 元素**不是数据**的数组（一串回调、一串句柄） |
| `{ map }` | `Map<K, V>`：活的键值集合，值是 `[K, V]` 两个 `TypeExpr`，按键与值的类型各自比较 |
| `{ set }` | `Set<T>`：活的集合，按元素类型比较 |
| `{ object, optional? }` | 至少有一个非数据成员的对象，逐成员比较 |
| `{ maybe }` | 非数据的 `T` 外面套 `null` / `undefined` |
| `{ oneOf }` | 含一个以上非数据成员的联合 |
| `{ opaque }` | 只按**名字**比较的宿主对象 |

分成「数据」与「非数据」两类是必须的：数据类型可以交给 arktype 表达并按赋值性比较，而一个回调、一个活着的句柄、一条流没有值层面的模式可言，只能各自成为一种情形，递归地比下去。

#### Component：导出自己的节点

```ts
@Component()
export class AuthService implements Auth {
  @Use() private readonly users!: Users;
  @Use() private readonly authSessions!: AuthSessions;
  @Use() private readonly state!: AuthState;
  // …
}
```

`implements Auth` 不只是给 TypeScript 看的：生成器读这个子句，把 `Auth` 记进这个节点的 `provides`，接线因此优先按**声明**、其次才按结构。

一个组件**由它的类命名**，实例本身就是它的提供物：消费者按它自己的类点名它（`@Use() auth!: AuthService`），它的接口就是生成器投影出的那个公开面。所以没有 `AuthModule` 去构造它，没有 `modules/auth/module.ts`，也没有一个 `Pick<AuthService, …>` 的接口类——**它就是那个节点**。名字是类的**声明名**，不是运行期的 `Function.name`：生成器从源码把它读进表，装饰器上下文把同一个词以字符串字面量交给内核，两处同源，产物压缩与否都改不了它。名字只承担身份——parked 文档以它为键，接线与槽以它寻址——满足性判定从不看它；改类名等于改身份，parked 文档要随之迁移。

四个标注各司其职：

- **`@Use(From?)`**——字段的类型是需要的接口，装饰器的参数是被接线来提供它的模块。**参数省略时**，由可见范围内结构上满足它的那个模块提供，且只有恰好一个满足时才成立。字段在 `setup()` 之前注入完毕。
- **`@Provide()`**——在 `setup()` 里赋值，之后被读取；没赋值就是启动错误，并点名是哪个字段。
- **`@Bind("<id>")`**——某条贡献的代码半，同样在 `setup()` 里赋值。
- **`park()`**——交出要留存的状态。

`setup(ctx, context)` 是唯一的生命周期钩子，而且是可选的。它不叫 `create`，因为 repo 本身就有一个叫 `create` 的领域方法。

判断一个东西该是组件还是模块，只有一条：**如果一个类的输入没有任何接口能提供**——一个算出来的闭包、一条拼出来的路径——那它就得由一个 Module 去建。这正是「导出别人」的含义。

树外面要用一个组件时，`wire(Cls, { …字段 })` 按 booter 注入的方式把字段装上；**什么都不检查，`setup()` 也不调用**。原来的 `new UsersRepo(db)` 就是 `wire(UsersRepo, { db })`。

#### Module：导出别人的节点

模块多两样东西：`children` 是它下面的节点类，`exports` 是它从子节点转出的接口——**子树里其余的提供物对外私有**。这就是「整组可替换」与「组内节点互不暴露」的实现方式。

一个纯粹用来分组的模块，类体是空的：

```ts
@Module({
  children: [UsersRepo, AuthSessionsRepo, ScryptHasher, AuthService, AdminService, AdminRoutes, MeRoutes],
  exports: [Users, AuthSessions, Auth, Admin, PasswordHasher],
})
export class IdentityModule {}
```

它自己什么都不做：七个子节点里，被 `exports` 点名的那五个接口对外可见，其余（那两组路由）留在组内。

而一个自己也要给出东西的模块，用 `@Provide` 加 `setup`：

```ts
@Module({ context: { version: 1, schema: { "settings?": { mode: "…" } } } })
export class SandboxModule {
  @Provide() sandbox!: Sandbox;
  setup({ contributions }: ClassCtx, context: Json) {
    // 用投到自己槽里的 providers 组装 SandboxService，赋给 this.sandbox
  }
}
```

`setup` 的两个参数就是它拿到的全部：`ClassCtx`（`contributions`、`resources`、`effect`，requires 已经作为字段注入好了）和它自己那份 parked 文档。

#### 清单：静态半是一份 JSON

上面那些标注，生成器**静态读取**（从不执行被读的文件）之后写成一份清单：

```jsonc
{
  "name": "agents",
  "requires": { "projects": { "iface": "ProjectsNeeded", "from": "projects" } },
  "provides": { "agents": "Agents" },
  "contributes": { "http.routes": [{ "id": "agents.routes", "prefix": "/api/…", "auth": "user" }] },
  "context":  { "version": 1, "schema": "{ collapsed?: string[] }" },
  "children": ["vault", { "keyed": "workbenches" }],
  "exports":  ["agents"],
  "kind": "module"
}
```

`requires` 的每一项有两半：`iface` 是**需要的形状**——可以是消费者自己就地声明的接口（Go 的习惯：接口属于消费者），也可以是 `<包>#<导出名>`；`from` 只说**由谁**来提供，判定本身仍是结构性的。`contributes` 的键是 `<模块>.<槽>`，每条带一个唯一的 `id`，纯数据。`children` 里的 `{ keyed: … }` 表示形状静态、基数动态的一组子节点。

### 槽与贡献

一个槽写作 `Slot<Data, Code>`，投影成 `SlotDecl { data, code? }`：`data` 是一条贡献在清单里携带的数据形状（`id` 不算，框架自己加），`code` 是需要绑定实现时那个实现的形状。

消费者按槽名收到 `Contributed { id, from, data, code? }`——`from` 是投稿模块的名字。路由是第一个槽，沙盒后端与消息连接器同形。

### 可见性是词法的

一个模块看得见**它的兄弟、它的祖先，以及祖先的兄弟**。祖先本身**不是**它的提供者——祖先的 exports 是朝外的。宿主发布的那些能力作为虚拟的根级兄弟，处处可见。

### 顺序不是树的形状

一个模块在两件事之后创建：它 `requires` 的一切，以及**每个向它带代码半的槽投稿的模块**——因为一条贡献的代码半是投稿者的 `bind[id]`，只有投稿者被创建之后才存在。只带数据的贡献是清单里的数据，任何节点创建之前就在，不决定顺序；所以一个模块可以向某个纯数据槽投稿，同时 `requires` 这个槽的所有者（插件声明自己的设置分组、再读回它的值，就是这样）。

兄弟之间按边允许的任意顺序创建。成环是启动错误，并点名环上的每个模块。

### 校验：整棵树，七种问题

`checkTree` 在**任何节点被创建之前**跑完，每个问题都带着它在树里的路径：

`unresolved`（某条 requires 在可见范围里找不到提供者）、`mismatch`（找到了但某个方法签名对不上，点名是哪个方法）、`unknown-iface`（引用了表里没有的接口）、`no-such-slot`（投给了不存在的槽）、`bad-contribution`（贡献的数据不合槽的形状）、`duplicate-id`（贡献 id 撞名）、`duplicate-module`（模块名撞名）。

### 判定规则

Go 的赋值规则，跨编译边界执行：消费者点名的每个方法都存在，且签名可赋值——参数逆变，返回协变。数据类型按 **TypeScript 的可赋值性**比较，而不是 arktype 那种交集恒等的 `extends`，后者会把 `{ a }` ⊆ `{ a, meta? }` 判为不成立。

### 投影的边界

宿主对象（`AbortSignal`、`Request`，以及任何声明在 `.d.ts` 里的东西）和本包自己那些写作 `Opaque<"Name">` 的类，只按名字比较，而且名字由生成器用**声明它的包**限定——所以两个包各自的 `Resources` 永不相等。生成器遇到它认不出的类类型就拒绝，而不是猜：写出 `Opaque<…>` 正是一份声明用来说「这里不检查结构」的方式。`Map` / `Set`（及其 `Readonly` 形式）不属此列：它们没有 arktype 形式，但元素类型是可比的，所以投影为 `{ map }` / `{ set }` 并按结构比较——一个节点持有的内存状态（PRFC-0015 的 `AgentState`）因此可以进接口表而不必写成 `Opaque`。`WeakMap` / `WeakSet` 仍然拒绝：键是对象身份，跨代无从比较。泛型方法擦除为 `unknown` 并给出警告。具名数据类型只发射一次，进 `types` 表，其余以 `$ref` 引用；递归类型就是指向自己的引用。

### park 与迁移

每个模块 `park()` 的结果按模块名存进一张表；下一次启动时 `bootModules` 把这张表拿回来，跑完该模块自己的 `migrations`（按起始版本链式，1→2→3）之后，把属于它的那份文档交还给它。这张表就是平台节点的 `modules` 字段。

### 那张表是生成物

`ifaces.json` 不入版本库：`typecheck`、服务端的 `build` 与 `test`、以及 `deploy.mjs` 各自重新生成。它是构建产物而不是源码，因为它必须与代码同步，而任何要求人去同步的东西迟早不同步。

### 扩展就是模块，不是第二套机制

一个扩展包提供一组 Module：`package.json#penguin.modules` 承载清单，默认导出是 `{ modules: { <名字>: { create } } }`，按名字配对，作为平台根的子节点启动。四个沙盒后端已经照此改写，原来的 `activate(ctx)` 契约取消。

### 与热更新的关系

引入这套机制本身不改运行时。树在既有的平台 kernel 节点内启动，park 时每个模块的文档写进新增的 `modules` 字段。parked 文档不重定版本——只加字段——因此一个被这一版平台 park 过的数据根，仍然接得住推回去的旧平台。运行时唯一被碰到的地方，是扩展加载器多读一个 `package.json#penguin`。

## Drawbacks
[drawbacks]: #drawbacks

**多了一个生成物**，以及四条各自负责重新生成它的路径。忘了生成，启动会具名报错而不是默默错下去，但那仍然是一次失败的启动。

**装饰器与静态读取**意味着这套元数据只对 TypeScript 成立，生成器要跟着 TS 的类型系统走，它认不出的构造只能拒绝。

## Rationale and alternatives
[rationale-and-alternatives]: #rationale-and-alternatives

**只比方法名**是从前的做法，也是最省的做法。它挡不住签名不匹配，而签名不匹配恰恰是热推送最容易产生的那类错误——两边各自演进，方法名往往是最后才改的东西。

**手写清单**（每个模块自己维护一份 JSON 描述）不需要生成器，但它要求人把清单和代码同步，而这类同步在第一次赶工时就会断。生成器从代码投影，两者不可能不一致。

**运行时反射**：启动时读实际对象，看方法在不在。它跨不了推送边界——推送方在自己的进程里没有对方的对象，而检查必须发生在装上之前。

**什么都不做**：`AppDeps` 继续膨胀，热推送继续在运行时炸，而不是在启动时被拒绝。

## Prior art
[prior-art]: #prior-art

**Go 的结构化接口**是判定规则的原型，本设计直接照搬：满足与否只看方法集合，没有名字、没有版本、没有归属关系。差别在于 Go 在同一次编译里判定，我们要跨两次独立编译，所以签名必须先变成可序列化的数据。

**VS Code 的 contribution points** 是贡献槽的原型：扩展在 manifest 里以数据声明自己贡献什么，宿主据此拼装，不执行扩展代码就知道它提供了什么。我们的路由槽、沙盒槽与消息槽是同一个形状。

**NestJS 与 Angular 的依赖注入**同样以类作为注入令牌、以装饰器声明依赖，形状很近。不同的是它们只在同一次编译内解析，没有跨边界的结构校验——那正是这里多出来的一层。

**OSGi 的服务注册表**做过跨边界的服务契约，但它以 Java 接口的类型标识为准，靠每个 bundle 一个 ClassLoader 支撑，代价见 PRFC-0005 的 Prior art。签名级的数据比较不需要那套隔离。

## Unresolved questions
[unresolved-questions]: #unresolved-questions

**发送侧的预检还没做。** 今天的校验发生在启动时与 CI 里；理想的位置是推送之前，拿目标 runtime 已发布的那张表核对一遍，装不上就根本不推。这要求 runtime 把 `describe(tree)` 发布出来。

## Future possibilities
[future-possibilities]: #future-possibilities

Agent Workbench（原 Workflow）以一份声明描述 backend 与 UI，沿用同一套模块机制；应用分发与宿主契约已落在 [PRFC-0020](PRFC-0020-agent-workbench.md)。

前端也有自己的一棵树：`web/src/module.json` 已经是 App 的清单，页面的路由、导航位置、是否管理员限定、渲染器名字都在里面，路由与侧栏由它导出；`GET /api/contributions` 把服务端投给前端槽的东西作为数据返回，前端只渲染自己认得的渲染器。两棵树用同一套判定的可能性留待另一篇。

## Changes

### v1.0.0

- 新增：迁入主仓；正文取设计仓的同一版本，与英文版逐节对应。

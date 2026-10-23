# PRFC-0014 Workflow：Agent 目录里的一棵模块树

[English](PRFC-0014-workflow.md)

> **来源**：设计仓 [penguin-harness-design](https://github.com/Prism-Shadow/penguin-harness-design) 的 `rfcs/PRFC-0014-workflow.md`——落地于默认分支 `main`（提交 [`ac673a24`](https://github.com/Prism-Shadow/penguin-harness-design/commit/ac673a245eec78d6afca35e260dce28b2a3ab3ac)）。
> **修订**：v1.0.0（迁入主仓）；本面的约定见 [README.zh.md](README.zh.md)，逐版本改动记在文末 `## Changes`。

- Feature Name: `workflow`
- Start Date: 2026-09-18
- PRFC PR: [Prism-Shadow/penguin-harness-design#194](https://github.com/Prism-Shadow/penguin-harness-design/pull/194)
- Implementation PR: [Prism-Shadow/penguin-harness#718](https://github.com/Prism-Shadow/penguin-harness/pull/718)

2026-10-14：本提案的 Workflow 已在实现 [#1133](https://github.com/Prism-Shadow/penguin-harness/pull/1133) 中更名为 Workbench，目录、接口与路由同步更名。下文保留最初决策的 Workflow 命名；现行名称以 specs 为准。

## Summary
[summary]: #summary

**Workflow** 是 Agent 保存在自己目录里的一段服务端代码，连同它向界面贡献的页面。`<agentDir>/workflows/<id>/` 是一个 plugin package：`package.json#penguin.modules` 里的清单、按名与清单配对的 `index.ts` 默认导出（Workflow 的代码是 TypeScript，不接受 JavaScript）、静态文件的根 `ui/`、由服务端保管的 `state.json`。服务端把它作为一棵**独立的模块树**启动，用的是 PRFC-0001 的同一套机制。

1. **越过边界的只有两个接口。** 宿主向每棵 Workflow 树发布 `WorkflowHost`（运行本 Agent、一份状态文档、一行日志）；Workflow 提供 `WorkflowMain`（一个 JSON 请求处理器）。
2. **先校验，后运行；类型来自运行它的 harness，判定交给 tsc。** 一台机器上可以有多个 harness——发行版、某个检出、别人推送的带着自己接口的平台——它们都不是 npm 上的某个版本，所以 Workflow 不安装任何东西：第一次加载时，平台把**它自己这一代**的接口表渲染成 `.d.ts` 写进 Workflow 目录（`.harness/`），此后不再动它。两道检查都在任何代码运行之前：其一，Workflow 的源码是 TypeScript，以 `strict` 对着这份 `.d.ts` 做类型检查——它**实现**的接口对不对、它调用的成员存不存在，在这里查出；其二，把 `.harness/` 里留下的那一份表与平台这一代的表各生成 `.d.ts`，在两个方向上判定可赋值性——它**依赖**的接口与接入的平台是否兼容。我们不自己写类型检查。不通过的 Workflow 带着具名的问题加载失败，**上一个实例继续服务**。
3. **按内容加载，按内容留版本。** 目录内容的哈希即修订（revision）：它进入 import URL，改过的代码一定被重新导入；每次成功加载记录为一个版本，任一版本可恢复，`state.json` 不随之回退。
4. **界面由贡献声明，不由目录约定。** Workflow 在清单的 `contributes` 里向宿主开放的槽投稿：今天开放的是 Chat 旁的标签页（`WebModule.sessionTabs`，一个 Workflow 可以投多张），写法与 plugin 向平台投稿完全相同。以后要让 Workflow 出现在别的位置，是宿主多开放一个槽，而不是再立一条目录约定。标签页可以占满整个应用，页面跟随应用的主题。

## Motivation
[motivation]: #motivation

Agent 与用户之间只有一种界面：对话。凡是有结构、会反复出现的工作——一张待办板、一条审阅队列、一块随任务推进而更新的面板——都只能一次次用文字重述，状态留在对话历史里，换一个 Session 就丢了。

另一端是 plugin：它能给平台加页面与服务端代码，但作用域是整个安装，由管理员安装，面向所有 Project 与所有 Agent。某个 Agent 为某一件事需要的一张页面，不该是一次平台级安装；而且这张页面最合适的作者就是 Agent 自己，它要能随手写、随手改。

让 Agent 写会被服务端执行的代码，有三个问题必须先有答案：

- **写错了怎么办。** Agent 的一次编辑可能语法不通、清单对不上、处理器形状不对。错误必须在运行之前被点名，而且不能让原来能用的页面跟着挂掉。
- **改坏了怎么回去。** Agent 会连续改自己的 Workflow；用户与 Agent 都需要一条退路，且退路不能带走已经积累的数据。
- **它能碰什么。** Workflow 不应拿到平台的组件；它能做的事要写成一份接口，由宿主决定给多少。

PRFC-0001 的 Future possibilities 已经指出「Workflow 作为 Agent 目录里的一个模块……是同一套机制的自然延伸」；05「服务端模块树」的分层表里也留着 workflow 这一行（Agent 自己的目录，按 Agent 安装 / 重载）。本提案把这一层落到实处。

场景：

- **Agent 给自己做一张待办页。** 用户说「给我一个能勾选的待办列表」；Agent 在 `workflows/todo/` 写下清单、处理器与页面，Chat 旁随即出现 *todo* 标签页，无需刷新。条目存进 `state.json`；页面上一个按钮经 `createSession` 与 `run` 把「处理下一项」交回给 Agent。
- **Agent 改坏了处理器。** 新的 `index.ts` 里 `handle` 的返回类型不对，或者调用了宿主没有的方法；类型检查在代码运行之前报出文件、行号与原因，标签页上显示这条加载错误，页面与处理器仍是上一个版本。Agent 看到错误后修复，或用户在 *历史* 里点 *恢复*。
- **一个 Workflow，两张标签页。** 待办 Workflow 后来多了一张「统计」页：Agent 在清单里再投一条 `sessionTabs`，指向 `ui/stats.html`，不需要第二个 Workflow，也不需要新的约定。
- **一张页面就是整个应用。** `penguin web --app default_project/default_agent/todo` 让浏览器直接打开到这张页面，没有侧栏与聊天。

## Guide-level explanation
[guide-level-explanation]: #guide-level-explanation

把 Workflow 想成一个**只属于这个 Agent 的 plugin**：同一种包形状、同一道校验，区别只在它住在哪里、由谁写、对谁可见。

```
<agentDir>/
  agent_state/                  Agent State（不含 Workflow）
  workflows/<id>/
    package.json                "type": "module" 与 penguin.modules：清单；没有要安装的依赖
    index.ts                    默认导出：{ modules: { <Name>: { create } } }，满足 WorkflowPackage
    ui/                         静态文件的根；放什么、有几张页面由清单决定
    state.json                  Workflow 自己的文档，由服务端读写
    .harness/                   平台写下的：plugin.d.ts（类型）、ifaces.json（渲染它所用的那部分表）、harness.json、README.md（约定简述）；只读不改
    .build/<revision>/          服务端转译的产物；不计入修订，不要手改
    .build/status.json          最近一次加载的结果，Agent 读它来得知修改是否生效
  workflows-history/<id>/
    <revision>/                 每次成功加载时的整份目录副本
    versions.json               版本列表，新的在前
```

最小的一个 Workflow：

```json
{
  "name": "todo",
  "version": "0.1.0",
  "type": "module",
  "penguin": {
    "modules": [
      {
        "name": "Workflow",
        "requires": { "host": { "iface": "@prismshadow/penguin-server#WorkflowHost", "from": "Host" } },
        "provides": { "main": "@prismshadow/penguin-server#WorkflowMain" },
        "contributes": {
          "WebModule.sessionTabs": [
            { "id": "todo.board", "key": "board", "title": "Todo", "titleZh": "待办", "renderer": { "iframe": { "src": "ui/index.html" } } }
          ]
        }
      }
    ]
  }
}
```

```ts
// index.ts
import type { WorkflowPackage } from "@prismshadow/penguin-server/plugin";

interface Doc { items: unknown[] }

export default {
  modules: {
    Workflow: {
      create({ use }) {
        return {
          api: {
            main: {
              async handle({ method, path, body }) {
                const doc = (use.host.getState() ?? { items: [] }) as Doc;
                if (method === "POST" && path === "/items") {
                  doc.items.push(body);
                  await use.host.setState(doc);
                }
                return { status: 200, body: doc };
              },
            },
          },
        };
      },
    },
  },
} satisfies WorkflowPackage;
```

```html
<!-- ui/index.html：页面在 ui/ 下提供，所以自己的处理器是 ../api/ -->
<button class="wf-primary" onclick="add()">Add</button>
<script>
  const add = () => fetch("../api/items", { method: "POST", body: JSON.stringify({ text: "…" }) });
</script>
```

应当这样理解它：

- **文件即安装。** 没有安装、启用这一步；目录存在且含 `package.json` 就是一个 Workflow，目录删掉它就没了。Agent 用的是它本来就有的文件工具。
- **代码是 TypeScript。** `satisfies WorkflowPackage` 让 `use.host` 与 `handle` 的参数、返回值都有类型；不写它，`strict` 下的隐式 `any` 本身就是错误，不会静默通过。服务端负责类型检查与转译，Agent 不需要运行任何构建步骤；产物由服务端写进目录里的 `.build/`。
- **类型来自运行它的 harness。** `@prismshadow/penguin-server/plugin` 在这里不是一个包：第一次加载时平台写下 `.harness/plugin.d.ts`，这条导入解析到的就是它。先写 `package.json` 与最小的 `index.ts`，让平台加载一次，再读 `.harness/plugin.d.ts`，就是这个 harness 确切提供的 `WorkflowHost`。平台换代之后这份记录不动，既有的 Workflow 对着新平台重新比较一遍，不兼容在加载时点名，而不是在第一次调用时；删掉 `.harness/`，Workflow 就改为依据现在运行它的 harness。
- **界面是声明出来的。** 有没有标签页、有几张、叫什么，都写在 `contributes` 里；`ui/` 只是这些页面的文件所在。没有投稿的 Workflow 是纯服务端的，只有处理器。
- **保存即重载。** 服务端监视 `workflows/`，文件变化后重新加载对应的 Workflow；打开着的标签页收到事件后更新，`ui/` 变了才重新加载页面。
- **坏的编辑不生效。** 当前文件加载失败时，`error` 写明原因，上一个实例继续答请求。列表里看到的 `revision` 是当前文件的，服务着的却可能是上一个——`error` 非空即是这种状态。
- **代码可回退，数据不回退。** 回滚恢复的是某个版本的代码文件；`state.json` 是 Workflow 的数据，不属于任何版本。
- **Agent 从 Skill 里知道这一切，而不是从系统提示词。** 目录布局、两个接口、主题变量与退路写在 `penguin-sdk` Skill 的 Workflows 一节，Agent 被要求做 Workflow 时才加载；不向任何 Agent 的系统提示词追加内容。

## Reference-level explanation
[reference-level-explanation]: #reference-level-explanation

### 目录与修订

- Workflow id 是目录自己的名字，须匹配 `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`；不含 `package.json` 的目录不是 Workflow。`package.json` 解析失败的目录**仍是** Workflow——错误由加载过程报出，而不是让它从列表里消失。
- `name` / `version` 取自 `package.json`，`name` 缺省为 id，`version` 可为 null。
- **revision** 是对目录内全部文件（相对路径与内容，按路径排序）取 SHA-256 的前 12 位十六进制；`state.json`、`node_modules/` 与以 `.` 开头的条目不计入。**uiRev** 是同一算法只算 `ui/` 之下的文件，没有 `ui/` 时为 null；它只是页面的缓存键，不决定标签页的有无。
- `workflows/` 与 `agent_state/` 平级：Workflow 不在 Agent State 的版本链里，它的版本由下文的历史自己承担。

### 加载

1. 读 `package.json`：须有 `"type": "module"`（Workflow 是 ES 模块；否则 NodeNext 会把入口当作 CommonJS 转译），`penguin.modules` 逐条 `parseManifest`，列表为空即错误。
2. 入口是 `index.ts`；只有 `index.js` / `index.mjs` 的目录加载失败，错误写明 Workflow 须以 TypeScript 编写。入口及其相对导入的 `.ts` 文件构成一个 tsc 程序：编译选项由宿主固定（`strict`、NodeNext，目录里的 `tsconfig.json` 不被采用——Workflow 不能替自己关掉严格模式）；编译之前，目录里没有 `.harness/` 的先由平台写入（见「接口检查」），`@prismshadow/penguin-server/plugin` 由编译器宿主直接解析到 `.harness/plugin.d.ts`，不经过任何包，其余导入按 Node 的规则解析。程序里另有一个虚拟的根文件，把默认导出赋给 `WorkflowPackage`：作者没写 `satisfies WorkflowPackage` 时形状照样被检查。类型检查有任何诊断即加载失败，诊断（文件、行、列、原因）即 `error`，至多报 12 条。
3. 检查通过后由同一个程序转译，产物写到 Workflow 目录**之内**的 `.build/<revision>/`，导入的是它——不同的 revision 是不同的 URL，改过的代码一定被重新导入。放在目录之内，是为了让产物按 Node 的规则解析到 Workflow 自己的 `node_modules`（它的运行时依赖）；用点目录，是因为修订哈希、版本副本与监视器都跳过点目录，产物因此不计入修订、不进版本历史、也不触发重载。它随目录的移除而删除，加载成功后只保留当前 revision 的那一份。
4. 默认导出须为 `{ modules: { <name>: { create } | create } }`（类型 `WorkflowPackage`），按名与清单配对；清单点名而导出里没有的模块、`children` 指向未声明的模块，均为错误。
5. 根模块必须名为 `Workflow`，且其 `provides` 中有一项是 `@prismshadow/penguin-server#WorkflowMain`。
6. `bootModules(root, { ifaces, resources, published })`：`ifaces` 是平台自己的接口表，`published` 把宿主对象作为模块 `Host` 发布进这棵树（PRFC-0001：宿主发布的能力是虚拟的根级兄弟，处处可见）。同一个 `published` 里还有宿主向 Workflow 开放的槽（见「贡献」）。整树校验先于任何 `create()`，投稿的槽名与数据形状也在其中；两个方向的接口比较见「接口检查」。
7. 成功：取根模块提供的 `WorkflowMain`，收集清单里的投稿，释放上一棵树，记录版本。失败：写一行日志，保留上一棵树与上一个处理器，`error` 为问题文本；从未成功过的 Workflow 没有处理器，其 `api/*` 答 503。

每个 `(project, agent, workflow)` 同时只有一个实例，且同一时刻只有一次加载在进行：一次加载要跑编译器，监视器与请求可能在它完成之前再次触发，后到的排在其后、加载届时磁盘上的内容，版本因此按序记录。服务组件 dispose 时关闭全部监视器并释放全部树。

### 两个接口

```ts
// 宿主发布，模块名 Host
abstract class WorkflowHost extends Interface<{
  listAgents(): { agentId: string }[];
  createSession(opts?: { agentId?: string }): Promise<{ sessionId: string }>;
  run(sessionId: string, input: { text: string }[]): Promise<{ sessionId: string; queued: boolean }>;
  sessionStatus(sessionId: string): string;
  getState(): unknown;
  setState(state: unknown): Promise<void>;
  log(message: string): void;
}>() {}

// Workflow 提供
abstract class WorkflowMain extends Interface<{
  handle(request: { method: string; path: string; query: Record<string, string>; body: unknown }):
    Promise<{ status?: number; body?: unknown }>;
}>() {}
```

- **与 SDK 同一套动词**，限定在 Workflow 所属的 Project 之内。`listAgents` 列出本 Project 的 Agent，即 `createSession` 的 `agentId` 可取的值（SDK 里没有对应的动词：SDK 的调用方自己持有 Agent）。`createSession` 即 SDK 的 `agent.createSession`：为本 Agent 开一个 Session，`agentId` 指定同一 Project 的另一个 Agent。`run` 即 SDK 的 `session.run`：`input` 同样是一个条目列表，今天每一项是 `{ text }`（SDK 用 `userText("…")` 构造它，而 Workflow 不安装任何包，运行时无处导入这个构造函数，所以把条目直接写出来），在一个新的或已有的 Session 里跑一轮，开始后即返回；Session 正忙时作为后续消息排队（`queued: true`）而不是被拒绝；不属于本 Project 的 Session 被拒绝；无论 Workflow 写了什么，Agent 听到的都是来自服务端的消息，不是来自人。`sessionStatus` 返回本 Project 某个 Session 的运行态。走的是定时任务所用的同一对 Session 创建器与 Task 运行器。
- **今天不做结构化，将来只加可选字段。** `opts`、`input` 的元素与返回值都是对象：要指定模型、Workspace，要带图片，要回传更多，都是加一个可选成员——按接口检查的规则，平台一侧加可选成员不影响既有的 Workflow。
- `getState` / `setState` 读写本 Workflow 的 `state.json`（整份文档，原子替换）；文档在首次使用时读入内存，`getState` 同步返回。
- 宿主对象按 `(project, agent, workflow)` 构造，Workflow 无从指定别的 Agent。
- **给 Workflow 增加能力的唯一途径是给 `WorkflowHost` 加成员**（接口先行）；Workflow 树不直接够到平台组件。

### 接口检查

判定一律交给 tsc，分两道。

**第一道：源码对着它写下时依据的那份类型。** 见「加载」第 2 步。Workflow 是 TypeScript，tsc 以 `strict` 检查它的源码，类型是平台写进 `.harness/plugin.d.ts` 的那一份。`handle` 的参数与返回值、对 `use.host` 的每一次调用，都在这里核对；这回答的是「Workflow 把接口**实现**对了没有」。以 Guide 一节的示例实测（tsc 5.9.3）：原样通过并转译，351 ms；把 `handle` 改成返回字符串、把 `setState` 拼成 `setStat`，报 `TS2322`（`Promise<string>` 不可赋值给 `Promise<WorkflowResponse>`）与 `TS2551 Property 'setStat' does not exist on type 'WorkflowHost'. Did you mean 'setState'?`，带文件与行列；去掉 `satisfies WorkflowPackage`，报 `TS7031 Binding element 'use' implicitly has an 'any' type`——没写类型的代码不会通过。

**第二道：那份类型与平台这一代是否兼容。** 第一道只说明 Workflow 与它写下时依据的类型自洽；平台可能已经换了一代，或者同一个目录正被另一个 harness 加载。这一道要有**两份**声明可比：

**载体仍是 `ifaces.json`。** 它是每个包自带的、自包含的接口表（引用从不离开这张表），因此检查时不需要任何模块解析；槽的贡献数据按值校验、`create()` 之后按名核对，也继续用它。两份各有出处：

- **消费者的一份是它自己带着的。** plugin 的 `ifaces.json` 在它构建时由 `gen-ifaces` 生成。Workflow 没有构建步骤，它的一份是 `.harness/ifaces.json`：

  **`.harness/` 由平台写入，只写一次。** 加载一个没有 `.harness/` 的目录时，平台从**自己这一代**的表渲染出 `plugin.d.ts`——`WorkflowHost`、`WorkflowMain` 及其可达的类型，按导出名命名（`WorkflowHost` 而不是表里的键），外加默认导出的形状 `WorkflowPackage`——并把渲染所用的那一部分表写为 `ifaces.json`，来源与时间写在 `harness.json`。目录先在旁边写好再改名就位，半截的目录不会被当成已安装。**此后平台不再动它**：它是「这个 Workflow 写下时依据什么」的记录，换代之后拿来比较的正是它；每次加载都刷新它，比较就又退回「自己比自己」。要让 Workflow 改依据当前的 harness，删掉 `.harness/` 即可，随后编译器会报出需要改的地方。它是点目录：不计入修订与版本历史，监视器不理会，`npm install` 也不会把它当作多余的包清掉。

  之所以不从 npm 取：一台机器上可以并存多个 harness，任何一个未发布的提交、任何一个带着自己接口的定制平台，都不对应 npm 上的某个版本；类型必须出自运行它的那个平台本身。平台的产物里本来就内联着它的接口表，渲染只要几毫秒，因此每个提交天然带着自己的 `.d.ts`，不需要额外的构建产物。
- **平台的一份是它自己这一代的表**，随平台产物携带；热推送来的一代带着它自己的那份。

**判定：生成 `.d.ts`，由 tsc 检查。** 加载时从两份表各生成一份自包含的 `.d.ts`，再生成一个检查文件，每一项比较是一条赋值语句；tsc 的诊断即问题文本。两个方向，都在任何 `create()` 运行之前：

| 方向 | 判定 |
| --- | --- |
| Workflow **依赖**的接口 | 平台这一代的 `WorkflowHost` 可赋值给消费者那一份 `WorkflowHost` |
| Workflow **实现**的接口 | 消费者那一份 `WorkflowMain` 可赋值给平台这一代的 `WorkflowMain`——此处平台是消费者 |

`create()` 之后另有一次对**值**的核对（声明的方法在返回的对象上确为函数）；它保留，但不替代上面两项。

约束有四条：

1. **所需一律从消费者那一份里解析，解析不到即失败。** `.harness/ifaces.json` 读不出来、其中没有清单点名的接口，是具名问题；绝不回落到平台的那一份——那样的回落正是「自己比自己」。plugin 适用同一比较，且与 Workflow 共用同一份实现（`plugin/typescript.ts`、`plugin/iface-check.ts`，在 plugin 加载处调用）：plugin 的一侧是它包内生成的 `ifaces.json`；它今天的实际效力见下文「plugin 一侧今天还比不出东西」。
2. **生成无损，否则拒绝。** 表里没有「可选参数」，只有容许 `undefined` 的类型；渲染时把末尾这样的参数写回可选，否则 `createSession()` 对着 `createSession(opts?)` 过不了类型检查。 生成器遇到它不能如实写成 TypeScript 的表达式，报具名的「不支持」并拒绝加载，绝不写成 `unknown` 或 `never` 放行。表这一侧同理：`gen-ifaces` 把泛型方法擦除为 `unknown` 是当初的遗漏，属缺陷，表要带上足以还原的信息。
3. **成员生成为函数类型的属性**（`line: (a0: string) => void`），而不是方法简写：`strictFunctionTypes` 下前者的参数是逆变的，正是 PRFC-0001 写下的规则（参数逆变、返回协变）；方法简写是双变的，会放过参数收窄。
4. **`typescript` 成为服务端的运行时依赖，并随推送与桌面构建一起交付。** 第一个 Workflow 需要时才加载；平台的单文件 bundle 不把它打进去，运行时依次在三处解析：平台模块旁、正在运行的程序旁、推送携带的资产里。后两处是实测补上的——一台装着打包桌面版的机器上，服务端是一个没有 `node_modules` 的单文件，且早于「编译器成为依赖」安装，推送之后每个 Workflow 都报「编译器不可用」。现在编译器像 node-pty 一样被携带：推送把它打成资产里的一个归档（入口与缺省库文件，101 个文件、约 12 MB，按内容寻址，只传一次），桌面构建把同一组文件放在服务端 bundle 旁边。找不到时不加载任何 Workflow 并说明原因——没有「跳过检查」这条路。内核里手写的可赋值判定（`satisfies` / `dataExtends`）在模块树的整树校验里仍在，随 PRFC-0001 的修订退役；Workflow 的两个方向已只由 tsc 判定。
5. **只生成用得到的部分。** `.d.ts` 只含被问到的接口及其可达的类型，因此「不支持即拒绝」只会因 Workflow 实际依赖的声明而触发。

以真实的平台表实测（158 个接口、468 个具名类型，tsc 5.9.3）：生成 `.d.ts` 9 ms（183 KiB，0 个不支持的表达式），整张表逐一自检加三项跨版本比较的整个 tsc 程序 418 ms。整体比较意味着平台删改已发布接口的任何成员都会拒绝依据旧版的 Workflow——那本来就是破坏性变更；纯新增不受影响。消费者那一份把 `Log.line` 的参数记为 `number`、`Memory` 多记一个平台已删的方法时，诊断为：

```
Type 'server#Log' is not assignable to type 'server#Log'.
  Types of property 'line' are incompatible.
    Type '(a0: string) => void' is not assignable to type '(a0: number) => void'.
      Type 'number' is not assignable to type 'string'.
Property 'removedSince' is missing in type 'server#Memory' but required in type 'server#Memory'.
```

未变的接口通过。检查器的这次更换属于 PRFC-0001 的范围，其修订另文给出；本文陈述的是 Workflow 对它的要求与依据。

#### plugin 一侧今天还比不出东西

比较已接在 plugin 的加载路径上，但对链顶的全部 plugin 表实测，结果是「无可比较」：`claude-code` 的 2 个问题里有 1 个、`discord-bot` 的 13 个问题里有 12 个，plugin 的表里**没有宿主接口的副本**。原因在生成器，有两处：

1. **`gen-ifaces` 只写包自己声明的接口。** 它跳过声明文件与 `node_modules`，所以 plugin 所依赖的宿主接口不会被投影进 plugin 的表——`PluginHost.ifaces()` 注释里「plugin 的表带着它编译时所见的宿主接口副本」描述的是意图，不是现状。
2. **`@Interface()` 写法的接口，隔着 `.d.ts` 认不出来。** 装饰器在声明文件里被擦除，`declare abstract class WorkflowHost { … }` 与任何抽象类无异；`extends Interface<…>()` 的写法生成器倒是认得（`X_base` 的形状）。对着已发布的类型写一个类形式的模块、`@Use() host!: WorkflowHost`，生成器报「must be a @Component class or an interface class」。

因此规则分两种：Workflow 的一侧是它所装版本的**整张表**，表里没有即该版本确实没有，算失败；plugin 的表今天不含副本，没有副本的接口记为「未比较」并写入日志，不使加载失败——否则一次推送会让每台机器上依赖宿主接口的 plugin 全部停掉。表里**有**副本而不再相容的，照常失败。程序早于「`typescript` 成为依赖」的安装上同理：plugin 照旧加载，日志写明未做比较。两处生成器问题补上之后，「未比较」应当收紧为失败。

#### 现状（缺陷）

以 #718 所用的内核（`checkTree` / `bootModules`）逐项实测：

| 情形 | 结果 |
| --- | --- |
| 清单点名了表里没有的接口、`from` 指向不存在的模块、投稿的槽不存在或数据不合槽形、id 或模块名撞名 | 报出，在任何代码运行之前 |
| 平台的 `WorkflowHost` 变了——删掉了 Workflow 正在调用的 `setState`，或改了 `log` 的参数类型 | **不报**：0 个问题，第一次调用时才失败 |
| Workflow 所供的 `WorkflowMain` 与平台要求的不一致 | **不比较** |
| `create()` 返回的 `main` 没有 `handle`，或 `handle` 不是函数 | 报出，但在 `create()` 之后，且只比方法名；形状不对（参数个数、同步返回、返回字符串）不报——#718 的入口是无类型的 `index.mjs` |
| 宿主发布的对象缺少它声明的方法 | 不报 |

原因只有一个：所需与所供都在**同一张表**（平台的 `ifaces.json`）里按键查出。`requires.host.iface` 写的是 `@prismshadow/penguin-server#WorkflowHost`，查出的「所需」与宿主发布的「所供」是同一条声明，`satisfies(decl, decl)` 恒真；`provides` 一侧同理，只确认键存在。Workflow 自己依据的那一份从未被读取。plugin 一侧是同一缺陷的另一个入口：`PluginHost.ifaces()` 合并两张表时「两边都有的键以宿主的为准」，plugin 带来的副本被丢弃。

### 贡献

Workflow 的界面是它清单里的 `contributes`，与 plugin 向平台投稿是同一种数据、同一道校验；区别只在**作用域**——Workflow 的投稿只对它所属的 Agent 生效。

- **宿主开放哪些槽，Workflow 才能投哪些槽。** 宿主把开放的槽以平台中同名模块的名义发布进 Workflow 树（与 `Host` 一样是虚拟的根级兄弟），槽的数据形状来自平台的接口表。向未开放的槽投稿是 `no-such-slot`，数据不合槽形是 `bad-contribution`，id 撞名是 `duplicate-id`——都是 PRFC-0001 已有的具名问题，在任何代码运行之前报出，上一个实例继续服务。内核不需要改动：对已发布模块的槽的校验本来就在整树校验之内。
- **今天开放的槽只有一个：`WebModule.sessionTabs`**——Chat 旁的标签页。

  ```ts
  { id: string; key: string; title: string; titleZh?: string;
    renderer: { iframe: { src: string } } | { builtin: string } }
  ```

  `key` 在该 Workflow 内唯一，是标签页的稳定标识（出现在 URL 里）；`title` / `titleZh` 是标签上的字。`iframe.src` 是相对 Workflow 目录的路径，必须落在 `ui/` 之下，否则加载失败并点名该条投稿。`builtin` 指 Web App 自带渲染器的名字；这一版应用不认得的渲染器，其标签页被跳过，规则与平台的 `pages` 槽一致。
- **投稿是纯数据，没有代码半。** 宿主发布的槽不带 `code`；页面要的行为都在 `WorkflowMain` 后面。
- **宿主自己收集。** 已发布的模块不在树里创建，拿不到 `contributions`；加载成功后由 Workflow 服务从各模块清单里读出这些（已校验的）条目，解析 `src`，放进列表项的 `tabs`。
- **开放一个新位置 = 宿主多发布一个槽**：先在平台侧有这个槽（plugin 已经能投），再决定它对 Workflow 开放、且按 Agent 限定作用域时是什么含义。Workflow 一侧不需要任何新约定。

### 重载

- 监视器按 `(project, agent)` 建立，在该 Agent 的 Workflow 列表第一次被读取时启动；`fs.watch(recursive)`，监视的是 `workflows/` 的**真实路径**（符号链接与 Windows 短文件名下，事件携带的路径与声明路径不一致会使进程中止）。
- **Agent 的第一个 `workflows/` 目录在出现时即被发现。** 该目录尚不存在时，平台改为监视 Agent 目录本身，等它出现后再转为正常监视并加载其中已有的内容；否则一个只靠文件工具写出来的首个 Workflow，要等到有人再次读取列表才会被加载。
- **每次加载的结果写成文件。** 无论成败，平台都把结果写入 `<workflow>/.build/status.json`（`ok`、`revision`、`checkedAt`、`error`、`tabs`）。写 Workflow 的 Agent 手里只有文件、没有 HTTP API 的会话；没有这个文件，它要得知「刚才的修改加载了没有、编译器说了什么」就只能去找端口、设法鉴权、翻服务端产物——实测中一个 Agent 的大部分步骤正花在这里。它的工作循环于是只有三步：改文件、稍等、读 `status.json`；`.harness/plugin.d.ts` 则是它了解宿主接口的唯一来源。
- **加载成功但多半不是本意的情形，由平台说出来。** `status.json` 与接口返回的 Workflow 上都带 `hints`：每条指出一种这样的情形并给出对应的修改，它不是失败（失败是 `error`）。目前只有一条——`ui/` 下有页面而清单没有贡献任何标签页：加载是绿的，界面上却什么也没有，此时 `hints` 直接给出应写入的 `WebModule.sessionTabs` 条目。同理，平台在 `.harness/README.md` 里用自己的话简述这份约定（文件、清单、标签页、状态文件），内容与运行中的平台不一致时重写；它不属于「Workflow 据以编写的类型」那份记录。这样做的原因是 Agent 已安装的 Skill 只是副本，平台热推送不会刷新它，Agent 也可能根本没装该 Skill，而 Workflow 目录它总是有的。
- 事件按路径首段归到 Workflow id；`state.json` 的变化不触发重载。同一 Workflow 的一串写入在 300 ms 静默后合并为一次重载。
- 重载时目录已不存在：丢弃实例并通知，历史保留——历史只在显式移除时删除。
- 监视器之外还有一道按内容的比对：列表与 `api/*` 分发都先读目录的 revision，与已加载的不同就先加载。监视器建不起来的平台上，Workflow 仍然是对的，只是慢一步。

### 版本与回滚

- 每次**成功**加载把整份目录（不含 `state.json`）复制到 `workflows-history/<id>/<revision>/`，并记入 `versions.json`（`revision`、`savedAt`、`name`、`version`、`uiRev`、`files`）。最新一条已是该 revision 时不重复记录；见过的 revision 再次加载时移到最前而不是新增一条——一次回滚正是这样的一次加载。
- 每个 Workflow 保留 20 个版本，更旧的连同副本删除。
- 回滚把目录恢复为**恰好**该版本：版本里没有的代码文件删除，版本里的文件覆盖写回，`state.json` 不动；随后重新加载。
- 移除（`DELETE`）同时删除目录与 `workflows-history/<id>/`：没有入口的历史没有存在的理由。

### 路由

挂在 `/api/projects/:projectId/agents/:agentId/workflows`，作为平台贡献的路由组（`auth: "user"`），每条路由都要求调用者有该 Project 的访问权。

| 方法与路径 | 作用 |
| --- | --- |
| `GET /` | 该 Agent 的 Workflow 列表（顺带加载磁盘上变化了的） |
| `POST /:id/reload` | 立即重新加载 |
| `GET /:id/history` | 已记录的版本，新的在前 |
| `POST /:id/rollback` `{ revision }` | 恢复该版本的文件并重新加载 |
| `DELETE /:id` | 移除目录及其版本 |
| `GET /:id/ui/*` | `ui/` 下的静态文件；`cache-control: no-cache` |
| `* /:id/api/*` | 交给 `WorkflowMain.handle`；收发均以 JSON 为默认，其余内容类型见下 |

**处理器的请求与应答。** `handle` 收到 `{ method, path, query, headers, body, bytes? }`，应答 `{ status?, headers?, body?, bytes?, stream? }`：

- JSON 是两个方向的默认：JSON 请求体解析后放在 `body`（解析失败或无请求体为 `null`）；应答未写 `content-type` 时，`body` 按 JSON 发出。
- 其他内容类型的请求体（表单、上传、纯文本）以 `bytes`（`Uint8Array`）原样交给处理器，上限 50 MB；`headers` 是小写化的请求头，应用自己的凭据（`cookie`、`authorization`）不传入。
- 应答在 `headers` 里写明 `content-type` 即按原样发出：`body` 为字符串，`bytes` 为二进制（优先于 `body`）；`location` 加 3xx 状态即重定向。`set-cookie` 与传输层自行决定的头会被丢弃——Workflow 不写应用的 Cookie。同一来源本来就按原样提供 `ui/` 下的文件，处理器返回 HTML 并不比一个 HTML 文件更宽。
- `stream` 是字符串或字节的异步可迭代对象（`AsyncIterable<Uint8Array | string>`，类型表里即 `stream`），优先于 `bytes` 与 `body`：迭代器每产出一块，平台就向客户端写出一块，按客户端读取的速度拉取，不等到结束——server-sent events、被转发的流式应答靠它送达。客户端断开即结束迭代（调用 `return()`），生成器的 `finally` 是中止上游请求的地方。经机器转发时，代理本来就按流转发应答体。
- 由此，处理器可以接收上传、返回页面或下载，也可以转发它在本机上运行的程序：页面运行在用户的浏览器里，浏览器可能在另一台机器上，页面里的 `127.0.0.1` 指的不是 Workflow 所在的机器；需要展示本机程序时，由**处理器**去取 `http://127.0.0.1:<port>` 并把结果返回。平台因此不提供端口转发。
- **跨站写入的防线。** 全站的写请求只接受 HTML 表单伪造不了的内容类型（`application/json` 等），这条在处理器的挂载点上不再成立，取而代之的是浏览器自己对请求来源的陈述：`Sec-Fetch-Site` 须为 `same-origin`；浏览器不发该头时比较 `Origin` 与 `Host`；两者皆无的请求不是浏览器发出的，没有可被借用的 Cookie。不满足则 403 `cross_origin_write`。其余路由不变，表单类型仍一律 415。
- 类型表中 `Uint8Array` 记为 `lib#Uint8Array`；语言自带库的类型在每个程序里都是同一个类型，生成的 `.d.ts` 里按其本名写出，而不是不可构造的 `Opaque<…>`。

列表项（`WorkflowInfo`）为 `id`、`name`、`version`、`revision`、`uiRev`、`tabs`、`loadedAt`、`error`、`hints`；`tabs` 是**服务着的那个实例**的 `sessionTabs` 投稿（`id`、`key`、`title`、`titleZh`、`renderer`，其中 `iframe.src` 已解析为该 Workflow `ui/` 路由下的地址）——当前文件加载失败时，它仍是上一个实例的标签页。路径段经校验，`ui/` 之外的文件取不到。

### 事件

Project 的 owner 与成员在各自的用户事件流上收到：

- `workflow_updated { projectId, agentId, workflow }`——加载成功**或失败**之后（失败时 `workflow.error` 非空）。
- `workflow_removed { projectId, agentId, workflowId }`——经路由移除，或目录在磁盘上被删。

### 提示词：不加

Workflow 不向系统提示词添加任何内容。最初的实现经一个新槽 `HostAssembly.promptSections` 给每个 Agent 的每个 Session 追加一节 *Workflows*（约 3.5k 字符、870 个 token），无论这个 Agent 是否碰过 Workflow——这是让所有用户为一项多数时候用不到的能力持续付费；而改 Workflow 本来就不是高频操作。说明改由 `penguin-sdk` Skill 承载：系统提示词里只有 Skill 的名字与一句描述，正文按需加载。该槽、`Assembly` 机制及其在会话运行时里的接线随之删除——Workflow 曾是它唯一的投稿者。

### Web App

- 标签条按该 Agent 各 Workflow 的 `tabs` 逐条渲染，一条投稿一张标签页，标识为 `<workflowId>/<key>`，同一 Workflow 的标签页相邻、按清单顺序；没有投稿的 Workflow 不出现在标签条上。标签条在聊天工具栏之上，*聊天* 恒在且恒可达，标签页消失时回落到聊天。
- 页面以 iframe 展示，覆盖在聊天之上，聊天保持挂载；iframe 以 `uiRev` 为键，只改处理器不会重新加载页面。
- 框架栏属于 Workflow 而不是某一张标签页：同一 Workflow 的各张标签页看到的是同一条。它显示版本与修订、当前文件的加载错误，并提供 *重新加载*、*历史*（每个版本带 *恢复*）、需点击两次的 *移除*、*占满应用*。

### 占满应用

- 路由 `/app/:projectId/:agentId/:workflowId[/:tabKey]` 位于应用外壳之外：只有这一张页面，没有侧栏、聊天与标签条；省略 `tabKey` 时取该 Workflow 的第一条投稿。
- 三个入口：框架栏的 *占满应用*；页面自己 `parent.postMessage({ type: "penguin:fill-app" }, "*")`；`penguin web --app <project>/<agent>/<workflow>[/<tab>]`（不是三段或四段非空时，在启动任何东西之前报 `Invalid --app`）。页面经 `postMessage` 请求时，占满的就是发出请求的那张标签页。
- 该路由**刻意没有可点的出口**，出口是命令面板：面板同时响应 Ctrl+P 与 Ctrl+Shift+P（macOS 为 ⌘），页面拿走其中一个也困不住用户；在该路由上面板多出 *退出全页模式（回到聊天）*，记住 Project 与 Agent 后落到它们的聊天页。

### 主题

Workflow 页面是独立文档，应用的样式表与 `html.dark` 到不了它。框架在页面加载时、以及外观设置变化后：

1. 在页面根节点标上 `light` / `dark`；
2. 把应用**已解析**的令牌复制过去——灰阶、强调色对、字体栈、根字号；
3. 把 `/workflow-ui.css` 注入 `<head>` 最前，页面自己的规则因此优先。

`workflow-ui.css` 为纯 HTML（标题、列表、表单、表格、代码）定样，暴露 `--wf-bg`、`--wf-fg`、`--wf-muted`、`--wf-border`、`--wf-surface`、`--wf-accent`、`--wf-accent-fg` 与类 `wf-primary`、`wf-card`、`wf-rows`、`wf-row`、`wf-muted`。调色板只有一份定义：样式表引用复制过来的值，不重述灰阶。写死颜色或字体的页面保持原样，并与用户的主题冲突——提示词一节因此要求只用这些变量。

### 所属的层

`WorkflowsModule`（`WorkflowPrompt` + `WorkflowService` + `WorkflowRoutes`，导出 `Workflows`）是平台模块树的一个子模块，随推送更新；Workflow 自身是 05 分层表里独立的一层，生命周期跟着 Agent 的目录，不跟着平台的代。平台被替换时 Workflow 的实例随旧一代释放，由新一代按需重新加载；`state.json` 与历史都在磁盘上，不受影响。

## 落地状态
[status]: #status

本文所述内容均已在 [penguin-harness#718](https://github.com/Prism-Shadow/penguin-harness/pull/718)（已合并）实现：

- 服务端 `workflows/{store,service,routes}.ts` 与 `mechanisms/workflows.ts`；`workflows/compile.ts`（源码检查与转译）、`workflows/harness-types.ts`（把本平台的类型写进 `.harness/`）；与 plugin 共用的 `plugin/typescript.ts`（编译器的惰性加载）、`plugin/iface-check.ts`（表 → `.d.ts` 与两个方向的判定）。
- 不安装任何东西：`@prismshadow/penguin-server/plugin` 由编译器宿主解析到 `.harness/plugin.d.ts`；`WorkflowPackage` 的唯一定义就在这份渲染出的文件里；`typescript` 由 devDependency 改为 dependency。
- `WebModule.sessionTabs` 的槽形改为本文的形状（增加 `title` / `titleZh`，去掉无人使用的 `namespace`），由宿主发布进 Workflow 树；`WorkflowInfo.tabs`；`ui/*` 不再有缺省文档。
- Web 的标签条按 `tabs` 渲染（标题随语言）、全页路由与 CLI 的 `--app` 接受可选的标签页 key；主题与命令面板出口如前。
- 不加全局提示词：`HostAssembly.promptSections` 槽与 `Assembly` 机制已删除，说明在 `penguin-sdk` Skill 里（含 `workflows/` 与 `agent_state/` 平级这一处更正）。
- 宿主接口为 SDK 的动词 `createSession` / `run`，限定在本 Project 之内。
- 接口比较与编译器加载在 `plugin/` 下，plugin 加载时同样调用（今天对 plugin 多数只能得到「未比较」，见「接口检查」）。
- 测试：TypeScript 的检查与转译、拒绝 JavaScript、两个方向的接口比较（含「平台新增不受影响」「没有表即失败」）、多标签页与未开放的槽、目录的重载 / 版本 / 移除；Web 的标签模型与全页路由；`serve` 的 `--app`。以真实构建出的包（类型与随包的表）实测：源码检查加转译 399 ms，接口比较 249 ms。

**在真实安装上的验证：** 推送到一台打包桌面版（Windows）之后，用一个临时 Workflow 走完整条链路：`.harness/` 写入、`strict` 编译、两个方向的比较、`sessionTabs` 投稿、`listAgents()` 返回本 Project 的 Agent；把源码改坏后，错误带文件与行列，上一实例继续应答。这次验证查出并修掉了两处：编译器在该机器上解析不到（见「接口检查」约束 4），以及 `gen-ifaces` 把可选的 `unknown` 成员投影成 `{}`——`getNonNullableType(unknown)` 的结果——致使 `body: null` 被拒绝。

**尚未实现：** 模块树整树校验自身（平台与 plugin）仍用手写的判定、仍在同一张表里查两侧——那是 PRFC-0001 修订的范围。

## Drawbacks
[drawbacks]: #drawbacks

- **Workflow 的代码在服务端进程内运行，不受沙箱约束。** 接口校验约束的是宿主**交给**它什么，管不了它自己 `import` 什么：一个 Workflow 可以 `import "node:fs"`。Agent 的 shell 命令受 Session 的沙箱策略约束，它写下的 Workflow 却以服务端的权限执行。这是本设计最大的一处欠账，见 Unresolved questions。
- **`typescript` 进入运行时。** 约 9 MB 的依赖要随程序交付，平台的单文件 bundle 不宜把它打进去；每次 Workflow 加载要跑源码检查、转译与跨版本比较（整张平台表的比较约 0.4 s），平台每换一代对既有 Workflow 重做一遍。判定规则随所装的 tsc 版本而定。
- **页面与应用同源。** iframe 带着用户的 cookie，页面里的脚本能以该用户的身份调用任何 API，而不只是自己的 `../api/`。
- **类型安全不是健全性。** `as any` 与类型断言仍然能绕过检查；`strict` 保证的是没写类型的代码不会通过，不是写了断言的代码一定正确。
- **模块缓存只增不减。** 每个 revision 是一个新的 import URL，Node 不提供卸载；频繁编辑的 Workflow 会在进程生命周期内留下每一版的模块，直到下一次重启。
- **处理器只讲 JSON。** 没有流式应答，没有二进制上传。
- **历史是整份副本。** 每个版本复制整个目录，20 个封顶；带大资产的 `ui/` 会放大磁盘占用。
- **监视器是惰性的。** 在某个 Agent 的列表第一次被读取之前，该 Agent 的目录没有监视器；此前的编辑要等到下一次列表或请求才生效。

## Rationale and alternatives
[rationale-and-alternatives]: #rationale-and-alternatives

- **沿用模块机制，而不是另立一套脚本约定。** 「一个导出 `handle` 的脚本」更短，但「写错了怎么办」的答案得重新发明一遍。PRFC-0001 的整树校验已经能在运行之前点名七种问题，Agent 拿到的错误文本与平台开发者拿到的是同一种；Workflow 日后长出第二个模块、需要槽与贡献时，也不必换形状。
- **Workflow 而不是 plugin。** plugin 面向整个安装、由管理员决定；Workflow 面向一个 Agent、由 Agent 自己写。两者共用包形状，不共用作用域与授权。
- **清单写在 `package.json`。** 平台 plugin 的清单由装饰器生成；Workflow 的作者是没有构建步骤的 Agent，清单必须是能直接手写的数据。
- **Workflow 只接受 TypeScript。** 无类型的 JavaScript 里，「`handle` 的形状对不对」「调用的宿主方法存不存在」只有运行时才知道，加载前能做的只剩按方法名核对；对 JS 开 `checkJs` 靠的是推断与 JSDoc，漏网的 `any` 多，而且要求作者写注解却没有语法强制。TypeScript 加 `strict` 把这件事变成语言层面的要求。Agent 写 TypeScript 没有额外成本，服务端已经带着 tsc，检查与转译都由它完成，Workflow 目录里不出现构建步骤。转译用 tsc 而不依赖运行时的类型擦除：后者不做检查，且只认可擦除的语法。
- **用 tsc 判定，而不是自己写类型检查。** 自己的检查器要么只覆盖 TypeScript 的一个子集（现行实现即如此，且在子集之外静默放行），要么得长期追着 tsc 的可赋值规则跑；这份节省不值得。tsc 的规则是接口作者写代码时已经在用的那一套，诊断文本也是他们认得的。
- **载体留 `ifaces.json`，`.d.ts` 在检查时生成，而不是直接携带 `.d.ts`。** 表是自包含的数据：每个包带着它编译时所见的那一份，不依赖检查时的模块解析（`peerDependency`、依赖提升都影响不到它），槽数据的按值校验与 `create()` 之后的按名核对也要用它。`.d.ts` 只是把这份数据交给 tsc 的形式，毫秒级即可生成。
- **修订取内容哈希，而不是 mtime 或计数器。** 同一份内容无论怎么到达（编辑、`git checkout`、回滚）都是同一个 revision：回滚因此自然去重，import URL 因此恰好在内容变化时变化。
- **`state.json` 不计入修订，历史放在目录之外。** 数据变化不该触发重载、不该产生版本、不该被回滚带走；历史若放在目录里，会被自己的哈希与监视器看见。
- **窄接口而不是把平台组件交出去。** `WorkflowHost` 的每个成员都是一次明确的授权，且可被签名校验；直接暴露 `SessionManager` 一类的组件，等于把平台内部冻结成 Workflow 的公共 API。
- **界面由贡献声明，而不是「有 `ui/` 就有一张标签页」。** 目录约定只能表达「一个 Workflow、一张页面、一个位置」：第二张标签页要么拆成第二个 Workflow（状态与处理器随之分家），要么再立一条约定（`ui2/`？）；出现在别的位置更是每个位置一条新约定。贡献声明把这三件事变成同一件——往某个槽里多写一条数据——并且继承了槽已有的全部性质：形状经校验、错误具名、宿主逐个决定开放与否。代价是最小的 Workflow 多了几行清单。
- **沿用平台的槽名，而不是 Workflow 专属的 `Host.tabs`。** 同一件事（「Chat 旁加一张标签页」）在 plugin 与 Workflow 里应当是同一种写法；一个 Workflow 日后升格为 plugin，或者反过来，投稿不必改写。Workflow 特有的只是作用域，那是宿主的事，不是清单的事。
- **`ui/` 保留为静态文件的根。** `src` 本可指向目录里的任意文件，但那要求服务端对「哪些文件可以被浏览器取走」另有一份判断（`index.ts`、`state.json` 不该被取走）；一个固定的静态根让这份判断是一条路径前缀。它约束的是文件放在哪，不再约束界面有几张、在哪里。
- **iframe 而不是渲染进应用的 DOM。** 页面是 Agent 写的任意 HTML，独立文档隔开了它与应用的样式和脚本全局。代价是主题照不进去，于是有「复制已解析的令牌」这一步；复制而不是在样式表里重述调色板，是为了调色板只有一份定义。
- **全页路由不设出口按钮。** 任何固定的出口都要占用页面的像素，而页面是别人的。命令面板不占像素；两个快捷键同时有效，是因为页面可能拿走其中一个。
- **什么都不做**：Agent 的产出继续只存在于对话里；需要页面的场景只能做成 plugin，由管理员为所有人安装。

此前的 `feat/workflow-hmr` 分支被本设计取代，留下的只有「每个 Workflow 是 Chat 旁的一个标签页、聊天恒可达」这一点。

## Prior art
[prior-art]: #prior-art

- **PRFC-0001「Module」**：清单、接口表、宿主发布的能力、整树校验，全部照搬；本提案没有给内核加任何东西。
- **HMR（05「服务端模块树」）**：「新的一代启动失败，上一代继续服务」「每次成功的替换是一个可回到的版本」是同一种立场，Workflow 把它从平台搬到了单个 Agent 的目录上。
- **VS Code Webview**：扩展的页面同样是独立文档，编辑器把主题以 `--vscode-*` CSS 变量注入并在 body 上标注 `vscode-light` / `vscode-dark`，要求扩展只用这些变量着色。`--wf-*` 与根节点上的 `light` / `dark` 是同一做法。

## Unresolved questions
[unresolved-questions]: #unresolved-questions

- **Workflow 的执行边界。** 进程内、无沙箱是现状而不是结论。可选的方向：在独立进程里运行并受 Session 同一套沙箱后端约束；或者把「这个 Agent 可以拥有 Workflow」做成需要用户批准的授权。期望在本 PRFC 合并之前经讨论定下立场。
- **Workflow 直接用 plugin 的类形式，暂时做不到。** 目标是 Workflow 与 plugin 同一种写法（装饰器类加 `export default { modules: [Workflow] }`），清单由服务端在加载时替它生成，`WorkflowPackage`、手写清单的读取与配对随之删除，Workflow 的表也自然带上宿主接口的副本。挡在前面的正是上面两处生成器问题，外加生成器目前是仓库脚本（`scripts/gen-ifaces.mjs`），需要先成为服务端在运行时可调用的库。三件事都属于 PRFC-0001 的修订。
- **检查器的修订另文。** 由表生成 `.d.ts` 并交 tsc 判定、`satisfies` / `dataExtends` 退役、`gen-ifaces` 不再擦除泛型、所需一律从消费者一侧解析（含 plugin 的 `??=` 覆盖）——这些改的是 PRFC-0001 的内容，需要一篇对它的修订。
- **桌面安装包里的编译器尚未实测。** 热推送这条路径已在一台真实的桌面安装上端到端验证（编译、接口比较、标签页、处理器、坏编辑保留上一实例）；桌面构建把编译器放在 bundle 旁边这一步只改了构建脚本，要等下一次打包才能验证。
- **`.harness/` 不在修订与历史里，也未必随 Agent 包走。** 修订哈希与版本副本都跳过点目录；回滚恢复的是代码，`.harness/` 保持原样——通常正合适（它记录的本来就是更早的依据），但一个在新类型下改写过的 Workflow 回滚到旧代码后，依据的类型与代码不再同龄。是否把它纳入版本，留待实现时定。
- **页面的权限。** 同源 iframe 是否改为带 `sandbox` 属性、经框架转发请求，使页面只够得到自己的 `api/`。
- **既有的 Workflow 是 JavaScript、且没有投稿。** #718 尚未合并、未随任何版本发布，但开发实例上已有 Agent 写下的 Workflow：入口是 `index.mjs`，只有 `ui/` 而没有 `contributes`。按本文，前者不再加载（须改写为 `index.ts` 并安装依赖），后者不再有标签页，直到清单补上一条投稿。建议两处都不设回退（继续接受 `index.mjs` 等于保留一条不经类型检查的加载路径；「有 `ui/index.html` 而无投稿时视为一条缺省投稿」会让目录约定永久留存），由用户定。
- **`WorkflowHost` 的下一批成员。** 目前只能轮询 `sessionStatus`；订阅 Session 事件、读取 Session 的产出、读写 Workspace 文件都还没有。按「接口先行」逐个提案，不在本文范围内。
- **分类与用法文档。** `02-TAXONOMY.md` 尚无 Workflow 词条，`06-PROTOTYPE.md` / `07-USAGE.md` 尚未描述标签页与 `--app`；留给后续的 specs PR。

## Future possibilities
[future-possibilities]: #future-possibilities

- **随 Agent 分发。** Agent 包（[penguin-harness#719](https://github.com/Prism-Shadow/penguin-harness/pull/719)）已把 `workflows/` 与 `agent_state/` 一起打包，`state.json` 除外：代码随 Agent 走，数据留在原地。
- **开放更多的槽。** 机制已在「贡献」一节；候选的位置有平台已有的 `WebModule.pages`（按 Agent 限定的整页）与 `WebModule.agentTabs`（Agent 设置页的标签），以及尚不存在的命令面板条目、定时触发。每开放一个，要回答的只有「按 Agent 限定作用域时它是什么意思」。
- **发送侧预检。** 与 PRFC-0001 的同名问题一致：Agent 在写下文件之前，先拿宿主发布的接口表核对一遍。

## Changes

### v1.0.0

- 新增：迁入主仓；正文取设计仓的同一版本，与英文版逐节对应。

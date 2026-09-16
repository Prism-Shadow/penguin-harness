---
title: "PenguinHarness 0.2.13：新版评估中心、文件浏览器升级、托盘图标，以及 Agent 公司内测"
date: 2026-09-15
category: news
excerpt: 评估中心重做了一遍，Benchmark 从 Agent 的附属品变成与 Agent 平级的对象。文件浏览长出右键菜单并去掉了体积上限，桌面端关掉窗口后继续在托盘里干活，运行中的工具调用可以转入后台，三个会让任务中途终止的网关问题也一并修掉。最后是仍在内测的公司模式：缺省关闭，需管理员开启，一个 Project 可以变成一家公司，把里面的 Agent 组织起来——一位 CEO、一棵汇报树、一张日历、一块五列工单板和若干频道，每一样都是磁盘上的文件。
---

PenguinHarness 0.2.13 改的主要是工作台：评估中心按它服务的那条闭环重建，文件浏览变成真的能管理 Workspace 的面板，桌面端进了系统托盘，以及三个曾经让 Task 停在原地的网关问题。这一版还开了一项内测，需管理员开启——「Project 可以变成组织」：CEO 提议、人拍板，整家公司以文件的形式存在 Project 下。

## 评估中心围着闭环重建

Benchmark 从 `agents/<agent>/benchmarks/<id>/` 移到了 Project 自己的 `benchmarks/<id>/`：一个 Benchmark 可以评测多个 Agent，被测 Agent 记录在每条评测记录上。评测记录的标签是 `<agent_id> · <model_id> · <thinking_level>`，图表按标签画序列，只有可比的分数才落在同一条线上——同一个 Agent 在同一运行时上的历次版本，终于连成一条趋势线。打开一个 Benchmark 现在是**进入**它，地址是 `/benchmark/:benchmarkId`；表格中的一行点开评测详情对话框。两个详情对话框末尾都有**问 AI**：把屏幕上的事实——Benchmark id、序列标签、版本、供应商、模型、思考等级、逐题分数和每次 Run 的 Session id——交给一个预填好的对话。Benchmark 带上了 `status`，`benchmark-design` 校准期间的 `draft` 会被遮住，发布门槛固定为 0–100 分制下的 85 分。评测产生的 Session 归进独立的「评估任务」分组，不再涌入被测 Agent 的活跃列表。

![Benchmark 页面：按 Agent、模型与思考等级分序列的分数图，下面是评测表格](/blog-assets/penguinharness-0-2-13-benchmark-detail-zh.png)

## 文件浏览成了真正的文件管理器

面板改名为文件浏览，目录树的任意一行和预览区本身都有了右键菜单：复制路径、加入对话、上传、下载、重命名、移动、删除，右键、Shift+F10 和长按都能唤出。重命名和删除带着与编辑器保存相同的前置条件——对话框开着的时候 Agent 改写了文件，这一次操作会被拒绝。高亮移进了 Worker，体积上限也就此消失：TypeScript 每千字节约耗四毫秒，这正是源码视图卡在 64KB、编辑器卡在 32KB 的原因，现在两道上限都没有了。文本预览可读到 1MB，400KB 的文件整个过程稳在每秒 60 帧。搜索框改为在服务端搜索整个 Workspace，而不是过滤目录树恰好加载过的那些行；自动换行改为缺省开启。

![文件浏览面板，目录树上的一行打开着右键菜单](/blog-assets/penguinharness-0-2-13-files-panel-zh.png)

## 关掉窗口，桌面端继续运行

桌面应用在 Windows、macOS 和 Linux 的系统托盘里常驻一个图标，关闭主窗口缺省只是把它收进托盘，内嵌的服务端和后台任务照常运行。左键点击把窗口叫回来；右键提供打开、新建会话、模型、**关闭窗口后继续在托盘中运行**复选项和退出。设置 › 外观里的**托盘图标**开关可以关掉它，无需重启。文件浏览的预览头部还多了**在文件夹中显示**：只在桌面应用自己的窗口里绘制，并由服务端把关——用浏览器登录同一台服务端拿不到它，哪怕浏览器就跑在那台机器上。macOS 与 Windows 选中文件，Linux 打开所在目录。

## 把运行中的工具调用转入后台

`exec_command` 或 `run_subagent` 执行期间，它在对话里的那一行提供**转入后台执行**：调用带着 `process_id` 或 `subagent_id` 结束，什么都不会被杀掉，这一轮继续往下走，不必等命令跑完。转入后台的子智能体在启动它的那一轮结束之后仍然在跑、仍然在流式输出。这个操作在调用运行满十秒后才出现——几秒就返回的命令不会再闪一下又消失。

![运行中的 exec_command 行上出现的转入后台执行](/blog-assets/penguinharness-0-2-13-send-to-background-zh.png)

## 三个会让任务中途终止的网关问题

这三个问题都表现为供应商返回 4xx，被引擎判为致命错误，于是 Task 停在原地。AgentHub 0.4.12 把 `read_file` 读到的、或 MCP 工具返回的图片，从 `tool` 消息挪到该轮之后的 user 消息上——这是 Chat Completions 文档给出的唯一放置方式，此前按 schema 校验的网关会整条请求打回。0.4.14 解决两个 DeepSeek 上的失败：严格的 Responses 中继后面，第一次工具调用之后的那条请求报 `400 invalid_json`；以及长工具链中途报 `400 The reasoning_content in the thinking mode must be passed back to the API`。0.4.15 修的是一轮里并行调用两个工具、而网关先把所有调用打开再逐个关闭的情况——此前会在一条请求之后整轮丢失，报 `No function call found for function_call_output`。

## Shell 命令可以被约束

harness 有了自己的沙箱接口，标明三个维度——`fs-write`、`network`、`mask-paths`——具备 argv 改写、如实上报实际强制力，以及失败即关闭的路由：没有后端能覆盖的要求会中止 spawn，而不是让命令不受约束地跑起来。后端不属于 harness 本体，四个以插件包发布，由部署方自行安装并写进 `plugins.json`：`sandbox-dsh`（跨平台）、`-bwrap`（Linux）、`-seatbelt`（macOS）与 `-mxc`（Windows）。缺省部署一个都不写，也就什么都不约束。

## 模型库

- OpenRouter 分组全部 43 条预置改用 Responses API，此前只有十条 `openai/*` 是；协议由分组本身锁定，手工添加的 OpenRouter 模型也一并获得。
- **Atria-Dawn-Preview** 进入自定义分组：Anthropic Messages 协议，256K 上下文，仅文本。
- 免费的 **dots-3-note-preview** 进入 TokenDance 分组：512K 上下文，支持图片。
- 协议识别不再照字面读取填入的 URL：多一个 `/v1`、少一个 `/v1`、或者从供应商文档里整段复制来的 endpoint 路径，现在都能正确识别，模型页还会把修正后的 URL 写回输入框。

## 一个 Project 可以变成一家公司

公司模式是**内测功能，缺省关闭**，要管理员在「系统设置 › 服务器 › 启用公司模式」里打开，开关一拨即刻生效；模式切换处和总开关下方都标着内测版——它很新，你会撞上问题。一个组织以 CEO 为汇报树的根，每位员工有一条常驻的工位会话，另有日历、工单板、频道，以及每位员工的月度预算：用到 80% 告警，100% 暂停该员工的日历。这些全都是 `<project>/organizations/<org_id>/` 下的文件，SQLite 只存每轮从这些文件重建的缓存。新建一个组织只要一句话——使命——建成后只有 CEO，缺省预算每月 100 USD，按累计额比较，所以从第一分钟起就有一个数字封住整家公司。概览、组织图、日历、工单、财务、手册六个页面挂在 Project 切换器上方的「开发 | 公司」开关后面；命令行一侧，`penguin org` 覆盖了全部 API，每条命令都带 `--json`。

![公司模式的概览页：收件箱、今日日程与预算告警](/blog-assets/penguinharness-0-2-13-company-overview-zh.png)

## 看板、日历，以及谁来拍板

工单板分五列：提议、进行中、审核中、已完成、已拒绝。CEO 负责提议——它如何理解使命、第一批工单、招谁、给多少预算和什么模型、工作区怎么划分——由你拍板：招聘、预算，以及关闭 P0 或 P1 工单，都要等你在全员频道里确认。服务端调度器每 30 秒对每个组织对账一次，API 写入之后也立刻再对一次：把到点的日程投给工位、投递频道里的提及、重算预算；组织暂停期间到点的日程，恢复后不会补发。工单变更本身从不启动运行，它们排队等待，在该员工下一次日历扫描时落在 `## Since your last sweep` 之下。频道里只有 `@` 提及才会送达。工位会话与工单会话都是普通对话——同一套消息列表、工具卡片、审批与输入框——公司模式没有自己的聊天页。

![五列工单板：提议、进行中、审核中、已完成、已拒绝](/blog-assets/penguinharness-0-2-13-company-tickets-zh.png)

## 这一版还有

- 缺省系统提示词加了护栏：针对旧提示词容许的四种失败模式改了十四处。「无法解决」现在有了可观测的触发条件——换过三种修法之后同一个错误仍在——相互独立的工具调用一次发出，命令以非交互方式运行，一个库只有在清单里出现才算可用，新增的 `# Output` 一节则掐掉了开场废话、复述工具名和结尾总结。
- 同一个文件上的两处并发编辑不会再悄悄丢掉一处：`edit_file` 与 `write_file` 在整个读-改-写期间持有按文件的锁，以文件的真实路径为键，因此软链接与目标折叠到同一把锁上。
- 每个账号都有了个人资料：头像（128×128，重新编码，超过 128 KiB 拒绝）与 1–32 字符的昵称，取代侧栏、导航栏和管理员列表里的原始用户 id。
- 代理设置页可以测连通性，六个目标——OpenAI、Anthropic、Gemini、DeepSeek 和 GLM 的两个域名——由服务端发起，不带任何凭据，每个五秒，各行分别出结果。任何 HTTP 应答都算连通，401 和 403 也算：凭据被拒同样证明了域名解析、TCP 连接、TLS 握手和主机应答都成立。
- 长 Trace 终于能打开了。此前只取前 1000 条事件，导致靠后的轮次（包括压缩那一轮）消息列表是空的；现在会翻完整个文件并渐进渲染。
- 工具卡片可以用短名：`read_file` → 读取、`exec_command` → 执行命令、`run_subagent` → 子智能体，由外观里的开关控制，缺省开启，真实名字仍在悬停提示里。
- 压缩请求按 Session 锁定的思考等级发出，和其他请求一样。此前它取的是上下文的基础等级，在 DeepSeek 上会导致请求直接被拒。
- 侧栏文件夹每次展开十条对话，并提供「收起」折回去。
- 上下文面板的压缩刻刀在拖动时可读，模型有、但压缩不允许 Session 用掉的那段空间以斜纹标出，点击长条的一段或图例的一行会把高亮钉住。
- 任务完成通知这次是真的能用了。此前从来没有人调用过 `Notification.requestPermission()`，而 Electron 不问任何人就报告 `granted`，于是在 macOS 上，一个从未申请过授权的应用包，通知被直接丢弃。现在系统设置 › 通用里有一个开关，缺省关闭，拨动的那一刻才去申请；浏览器也第一次具备了资格。
- 用过或过期的一次性登录链接会落到 `/login` 并弹出对话框说明原因，而不是一页原始 JSON。
- 退出登录会先问一句，并说明后果：本次会话结束，运行中的对话在服务端继续。
- 行为准则升级到 Contributor Covenant 3.0，中英文同步。阶梯的每一级现在写明了期待的修复动作，而不只是后果；举报渠道不变。

## 升级须知

- **把 `extensions.json` 改名为 `plugins.json`，其中的 `"extensions"` 键改为 `"plugins"`。** 旧名不再被读取，也不迁移：按旧名配置插件的部署会照常运行，但一个插件都不加载，对应能力静悄悄地消失。
- **插件按新契约改写。** import 指向 `@prismshadow/penguin-core/plugin` 而非 `/extension`，`activate(ctx)` 换成 `Plugin { modules }`——按旧契约写的插件加载时报「the default export is not a Plugin」。`@prismshadow/penguin-server` 不再导出 `AppDeps`、`buildAppDeps` 和 `createApp`。改名不触及任何线上格式、数据库或磁盘文档。
- **到模型页点一次「同步预置」。** 已存的模型行保留写入时的协议、显示名和图片能力，因此 OpenRouter 转 Responses、`deepseek-v4-flash` 更正为仅文本，以及两条新预置，都只能通过同步到达既有 Project——代价是被你特意清空的显示名会被重新填上。
- **想用公司模式要自己打开**：系统设置 › 服务器 › 启用公司模式，缺省关闭，拨动即生效。
- **两处缺省值变了**：任务完成通知改为默认关闭，需要自己打开；文件编辑器的自动换行对从未动过 Wrap 开关的人默认开启。
- **旧位置 `agents/<agent>/benchmarks/` 下的 Benchmark 需要手工搬到 Project 的 `benchmarks/`。** 本版不读旧位置，也不迁移、不删除它们。
- **迁移 5、6、7、8**（个人资料页带来 5，公司模式带来 6、7、8）都是增量式的，打开时自动应用。

桌面端安装包在 [penguin.ooo/download](https://penguin.ooo/download)；CLI 与服务端的安装方式：

```sh
curl -fsSL https://penguin.ooo/install.sh | sh
penguin web
```

```powershell
irm https://penguin.ooo/install.ps1 | iex
penguin web
```

```sh
docker run -d --name penguin -p 127.0.0.1:7364:7364 -v penguin-data:/data hiyouga/penguinharness:latest
```

完整细节见 [`changelog/0.2.13/`](https://github.com/Prism-Shadow/penguin-harness/tree/main/changelog/0.2.13)。

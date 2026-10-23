# PRFC-0009 Sandbox：策略 fail closed，后端是插件

[English](PRFC-0009-sandbox.md)

> **来源**：设计仓 [penguin-harness-design](https://github.com/Prism-Shadow/penguin-harness-design) 的 `rfcs/PRFC-0009-sandbox.md`——落地于默认分支 `main`（提交 [`ac673a24`](https://github.com/Prism-Shadow/penguin-harness-design/commit/ac673a245eec78d6afca35e260dce28b2a3ab3ac)）。
> **修订**：v1.0.0（迁入主仓）；本面的约定见 [README.zh.md](README.zh.md)，逐版本改动记在文末 `## Changes`。

- Feature Name: `sandbox`
- Start Date: 2026-10-04
- PRFC PR: [Prism-Shadow/penguin-harness-design#263](https://github.com/Prism-Shadow/penguin-harness-design/pull/263)
- Implementation PR: [Prism-Shadow/penguin-harness#354](https://github.com/Prism-Shadow/penguin-harness/pull/354)（接口与后端插件）、[Prism-Shadow/penguin-harness#769](https://github.com/Prism-Shadow/penguin-harness/pull/769)（设置分组与每 Session 快照）、[Prism-Shadow/penguin-harness#893](https://github.com/Prism-Shadow/penguin-harness/pull/893)（四类执行者）、[Prism-Shadow/penguin-harness#972](https://github.com/Prism-Shadow/penguin-harness/pull/972)（Windows 会话 shell）、[Prism-Shadow/penguin-harness#975](https://github.com/Prism-Shadow/penguin-harness/pull/975)（开关与预设）、[Prism-Shadow/penguin-harness#978](https://github.com/Prism-Shadow/penguin-harness/pull/978)（Landlock 地板与按维度路由）

## Summary
[summary]: #summary

沙盒是 Session 级的运行约束。本 PRFC 依次给出：

1. **沙盒接口**：一份策略由文件模式、网络档位、屏蔽路径与临时目录四个维度组成；后端插件声明自己实现哪些维度，宿主把策略路由给能覆盖它的后端；没有后端能覆盖时拒绝执行（fail closed），从不降级为不封禁运行。
2. **默认预设**：预设是「文件 × 网络 × 审批方式」的命名组合；沙盒开关打开时，新 Session 从默认预设 Workspace Write 开始。并逐表列出每个预设在各后端下能读写哪些路径。
3. **默认后端的决策树**：每个平台推荐什么后端、实际由哪个后端服务、都不可用时怎样失败。
4. 这样设计的理由，以及局限。

## Motivation
[motivation]: #motivation

- **「装了沙盒却什么都没封」比「命令被拒」危险得多**：用户无从分辨命令是否被隔离，一次静默降级就让整个能力失去意义。
- **没有一种机制覆盖所有主机**：bubblewrap 在默认的 Ubuntu 24.04 上被 AppArmor 的 userns 限制拒绝；macOS 只有 Seatbelt；Windows 没有等价的原生机制。接口必须容纳能力不同的多个后端，并如实说出本机实施了什么。
- **日常只用几种组合**：此前 composer 的权限菜单是三节十个选项（[#975](https://github.com/Prism-Shadow/penguin-harness/pull/975)）。

## Guide-level explanation：沙盒接口是什么
[guide-level-explanation]: #guide-level-explanation

### 策略：四个维度

| 维度 | 取值 | 要求后端实现 |
| --- | --- | --- |
| 文件模式 | `read-only`（除临时目录外不可写）/ `workspace-write`（Workspace、Session scratchpad 与临时目录可写）/ `danger-full-access`（不封禁文件） | `fs-write`：每个后端都必须实现的地板 |
| 网络档位 | `open` / `local`（仅本机）/ `none` | `none` → `network`；`local` → `network-local` |
| 屏蔽路径 | 绝对路径列表（≤ 64 条），读取也被隐藏 | 非空 → `mask-paths` |
| 临时目录可写 | 缺省开；关闭后临时目录同样只读 | 封禁模式下关闭 → `closed-temp` |

策略只要求它实际用到的维度。文件模式为 `danger-full-access` 且不要求其他维度时，命令原样运行；完全访问但仍要断网或屏蔽路径的策略照样需要后端。`network-local` 自成一维，因为能断网的后端未必能在断网时保留宿主回环；`closed-temp` 自成一维，因为并非每个后端都能关闭临时目录。

### 谁设定策略

```text
服务端沙盒设置（管理员）：开关、默认预设、临时目录、屏蔽路径
        │  Session 创建时快照，此后与设置脱钩
        ▼
Session 策略：文件模式、网络档位、审批方式（子会话沿用根会话）
        │  经该 Session 的 PATCH 改变；非管理员只能收紧，不得宽于服务端起点（上限）
        ▼
每次 spawn：宿主把策略交给后端
```

设置的改动只影响之后创建的 Session。上限按文件模式（只读 < 仅工作区 < 完全访问）与网络档位（无网络 < 仅本机 < 开放）分别比较，composer 的置灰与服务端的拒绝共用同一个比较。

### 约束什么

命令、钩子脚本、`stdio` MCP Server 与文件工具经同一条缝、按同一份 Session 策略受约束；可写范围与未覆盖项见 05「沙盒」（design [#222](https://github.com/Prism-Shadow/penguin-harness-design/pull/222)）。Project 的命令策略是审批边界上的正则拦截，不是沙盒，二者互补（design [#50](https://github.com/Prism-Shadow/penguin-harness-design/pull/50)）。

### 后端契约

```ts
type SandboxDimension = "fs-write" | "network" | "network-local" | "mask-paths" | "closed-temp";

interface SandboxProvider {
  dimensions?: SandboxDimension[];             // 缺省 ["fs-write"]
  mechanism?: string;                          // 由什么实施，如 "bubblewrap"、"Landlock (partial)"
  limits?: { text: string; textZh: string }[]; // 本机留下的缺口
  confine(argv: string[], policy: SandboxPolicy): ConfinedArgv; // 无法实施即抛错
}

interface ConfinedArgv {
  argv: string[];                              // 改写后的 argv，不得原样返回
  enforcement?: "full" | "partial";            // 只报告，不请求
  denialSignatures?: string[];                 // 被拒效果在 stderr 上的方言
  runnerFailureRules?: RunnerFailureRule[];    // 运行器自身失败的证据，含 informationalLines
}
```

三条规则：

- **后端只改写 argv。** 宿主照常 spawn 改写后的 argv，进程在后端的封禁下运行；后端不解释命令。
- **能力自报。** 后端在加载时自检：不能在本机服务即加载失败，不是本机平台即谢绝，而不是挂载一个拒绝每条命令的后端。部分实施经 `mechanism` 与 `limits` 在加载时结构化地报告一次。
- **Fail closed。** 宿主在已挂载后端中选择实现了全部所需维度的那个；一个也没有时拒绝该次 spawn，错误写明所需维度、各已挂载后端覆盖什么，以及未启用的后端与原因。

## Reference-level explanation
[reference-level-explanation]: #reference-level-explanation

### 默认预设

沙盒卡片顶部是**开关**。关闭时新 Session 不封禁、只受审批方式约束，composer 的盾牌按钮只列审批方式；打开时新 Session 从**默认预设**的文件模式、网络与审批方式开始，再加上卡片 Advanced 折叠里的临时目录与屏蔽路径。全新安装时开关关闭。

出厂预设（网络均为开放）：

| 预设 | 文件 | 网络 | 审批方式 | 缺省在菜单 | 用途 |
| --- | --- | --- | --- | --- | --- |
| Full Access | 完全访问 | 开放 | 全部批准 | 是 | 信任并在旁照看的工作；三列锁定 |
| Always Ask | 完全访问 | 开放 | 每次询问 | 是 | 逐步审批 |
| **Workspace Write**（默认） | 仅工作区 | 开放 | 全部批准 | 是 | 日常编码 |
| Read Only | 只读 | 开放 | 全部批准 | 是 | 浏览代码、审阅、答疑 |
| Workspace Write with Ask | 仅工作区 | 开放 | 每次询问 | 否 | 谨慎的修改 |
| Denied All | 完全访问 | 开放 | 全部拒绝 | 否 | 不使用工具的纯对话 |

- **默认为 Workspace Write**：日常编码不被打断，写入又限制在 Workspace 内；网络开放使它只要求 `fs-write`，因而在任何有后端的主机上都可实施（包括只有 Landlock 地板的主机，见下节）。
- **预设只是名字加映射**：Session 只存自己的文件模式、网络与审批方式，菜单按第一个取值相同的行为它命名。改名、钉到菜单、调整顺序、换默认都不触碰已有 Session。
- **可扩展**：管理员可新增预设（新行缺省为仅工作区 / 开放 / 每次询问），只有新增的行可删除，内置行只能取消固定。
- **选择受上限与可实施性约束**：宽于上限的预设对非管理员置灰；本机后端实施不了的预设置灰并写明原因（例如只有 Landlock 时的「无网络」）。选一项即一次 `PATCH`，先校验全部字段再写入，被拒时 Session 保持原样。
- **无人值守的 Session**（组织 Session、定时任务、workflow 创建的 Session）以「全部批准」开始，不取默认预设的审批方式：没有人在场回答审批。

#### 各预设可访问的路径

示例：用户 `alice`，Workspace 是 `~/code/app`，Session `s1` 属于 Project `demo` 的 Agent `coder`；屏蔽路径一行假设管理员屏蔽了 `~/.ssh/`（出厂为空）。

| 列 | 预设 |
| --- | --- |
| Full | Full Access |
| Ask | Always Ask |
| WsWrite | Workspace Write（默认） |
| WsWriteA | Workspace Write with Ask |
| Read | Read Only |
| DeniedAll | Denied All |

| 格 | 含义 |
| --- | --- |
| rw | 可读写 |
| ro | 只读 |
| masked | 不可见（目录显示为空、文件读出为空） |
| denied | 命令不运行 |
| — | 该环境里没有这个路径 |

Full、Ask 不经后端，格里是宿主自身的权限。

##### Linux（bubblewrap）

| 路径 | Full | Ask | WsWrite | WsWriteA | Read | DeniedAll |
| --- | --- | --- | --- | --- | --- | --- |
| `/home/alice/code/app/`（Workspace） | rw | rw | rw | rw | ro | denied |
| `/home/alice/.penguin/data/demo/agents/coder/scratchpad/s1/`（scratchpad） | rw | rw | rw | rw | ro | denied |
| `/tmp/`（WsWrite、WsWriteA、Read 下每条命令私有、初始为空） | rw | rw | rw | rw | rw | denied |
| `/dev/null` | rw | rw | rw | rw | rw | denied |
| `/home/alice/.penguin/data/` | rw | rw | ro | ro | ro | denied |
| `/etc/`、`/usr/` | ro | ro | ro | ro | ro | denied |
| `/home/alice/.ssh/`（屏蔽） | rw | rw | masked | masked | masked | denied |

##### Linux，bubblewrap 不可用时（DSH · Landlock）

| 路径 | Full | Ask | WsWrite | WsWriteA | Read | DeniedAll |
| --- | --- | --- | --- | --- | --- | --- |
| `/home/alice/code/app/`（Workspace） | rw | rw | rw | rw | ro | denied |
| `/home/alice/.penguin/data/demo/agents/coder/scratchpad/s1/`（scratchpad） | rw | rw | ro | ro | ro | denied |
| `/tmp/`（与宿主共享） | rw | rw | rw | rw | ro | denied |
| `/dev/null` | rw | rw | rw | rw | rw | denied |
| `/home/alice/.penguin/data/` | rw | rw | ro | ro | ro | denied |
| `/etc/`、`/usr/` | ro | ro | ro | ro | ro | denied |
| `/home/alice/.ssh/`（屏蔽）：DSH 不支持屏蔽，带屏蔽路径的策略被拒 | rw | rw | denied | denied | denied | denied |

##### macOS（Seatbelt）

| 路径 | Full | Ask | WsWrite | WsWriteA | Read | DeniedAll |
| --- | --- | --- | --- | --- | --- | --- |
| `/Users/alice/code/app/`（Workspace） | rw | rw | rw | rw | ro | denied |
| `/Users/alice/.penguin/data/demo/agents/coder/scratchpad/s1/`（scratchpad） | rw | rw | rw | rw | ro | denied |
| `/private/tmp/`、`/private/var/folders/…/T/`（与宿主共享） | rw | rw | rw | rw | rw | denied |
| `/dev/null`、`/dev/stdout`、`/dev/stderr`、`/dev/dtracehelper` | rw | rw | rw | rw | rw | denied |
| `/Users/alice/.penguin/data/` | rw | rw | ro | ro | ro | denied |
| `/etc/`、`/usr/` | ro | ro | ro | ro | ro | denied |
| `/Users/alice/.ssh/`（屏蔽） | rw | rw | masked | masked | masked | denied |

##### Windows（WSL）

受限预设的命令在专用 Linux 发行版里运行，Windows 路径出现在 `/mnt/<盘符>/` 下；Full、Ask 直接在 Windows 上运行。

| 路径 | Full | Ask | WsWrite | WsWriteA | Read | DeniedAll |
| --- | --- | --- | --- | --- | --- | --- |
| `C:\Users\alice\code\app\`（Workspace；发行版内为 `/mnt/c/Users/alice/code/app/`） | rw | rw | rw | rw | ro | denied |
| `C:\Users\alice\.penguin\data\demo\agents\coder\scratchpad\s1\`（scratchpad；发行版内为 `/mnt/c/…`） | rw | rw | rw | rw | ro | denied |
| `C:\Users\alice\` 下的其余路径（打开「以只读方式显示 Windows 磁盘」后为 ro） | rw | rw | masked | masked | masked | denied |
| `C:\Windows\` | ro | ro | masked | masked | masked | denied |
| 发行版内的 `/tmp/`（每条命令私有） | — | — | rw | rw | rw | denied |
| 发行版内的 `/dev/null` | — | — | rw | rw | rw | denied |
| 发行版内的 `/etc/`、`/usr/` | — | — | ro | ro | ro | denied |

##### Windows，WSL 不可用时（DSH · Windows ACL，要求 PowerShell）

| 路径 | Full | Ask | WsWrite | WsWriteA | Read | DeniedAll |
| --- | --- | --- | --- | --- | --- | --- |
| `C:\Users\alice\code\app\`（Workspace） | rw | rw | rw | rw | ro | denied |
| `C:\Users\alice\.penguin\data\demo\agents\coder\scratchpad\s1\`（scratchpad） | rw | rw | ro | ro | ro | denied |
| `C:\Users\alice\AppData\Local\Temp\`（受限预设下只有其中每条命令一个、结束即删的随机子目录可写） | rw | rw | rw | rw | ro | denied |
| `NUL` | rw | rw | rw | rw | rw | denied |
| `C:\Users\alice\.penguin\data\` | rw | rw | ro | ro | ro | denied |
| `C:\Windows\` | ro | ro | ro | ro | ro | denied |
| `C:\Users\alice\.ssh\`（屏蔽）：DSH 不支持屏蔽，带屏蔽路径的策略被拒 | rw | rw | denied | denied | denied | denied |

补充：

- **关闭临时目录**时，bubblewrap、Seatbelt、WSL 下的临时目录从「读写」变为「只读」；DSH 不支持此项，这样的策略不会交给它，屏蔽路径同理。
- **「只读」只限制写。** `~/.ssh`、`~/.penguin/data` 都没有特殊处理，读取不受限；要隐藏只能列入屏蔽路径。
- Windows ACL 的约束是部分的：Everyone 可写的对象、硬链接与 FAT 卷上的文件仍可写。

### 默认后端的决策树

后端插件与各自实现的维度：

| 插件 | 平台 | `fs-write` | `network` | `network-local` | `mask-paths` | `closed-temp` |
| --- | --- | --- | --- | --- | --- | --- |
| `sandbox-bwrap`（bubblewrap） | Linux | ✓ | ✓ | | ✓ | ✓ |
| `sandbox-seatbelt`（Seatbelt） | macOS | ✓ | ✓ | ✓ | ✓ | ✓ |
| `sandbox-wsl`（专用 WSL2 发行版内的 bubblewrap） | Windows | ✓ | ✓ | | ✓ | ✓ |
| `sandbox-dsh`（DSH 的平台链） | Linux / macOS / Windows | ✓ | | | | |

**路由规则**：在实现了策略全部所需维度的已挂载后端中，实现维度最多的那个负责；注册顺序（Project 插件列表的先后）只用于打破平局。因此 bwrap 与 DSH 都挂载时每条策略都由 bwrap 负责，DSH 只在它是唯一剩下的后端时服务。

```text
Linux     卡片推荐：sandbox-bwrap + sandbox-dsh
├─ bubblewrap 自检通过 ──────────────────── bwrap 服务（4 维）
├─ bubblewrap 被拒（Ubuntu ≥ 23.10 的 AppArmor userns 限制、Debian 关闭 userns、Docker 容器内）
│  ├─ DSH 链探测到 Landlock 可用 ──────── DSH 经 Landlock 服务（仅 fs-write）；
│  │                                       卡片点名 bwrap 被拒的原因与回到 bwrap 的一次性 root 步骤
│  └─ 两者都不可用 ────────────────────── 无后端：封禁策略一律拒绝
└─ 「仅本机」网络：Linux 上没有后端实现 network-local，一律拒绝

macOS     卡片推荐：sandbox-seatbelt
├─ sandbox-seatbelt 挂载 ────────────────── Seatbelt 服务（5 维）
├─ 仅 sandbox-dsh ───────────────────────── DSH 经 Seatbelt 服务（仅 fs-write）
└─ 都没有 ────────────────────────────────── 拒绝

Windows   卡片推荐：sandbox-wsl
├─ sandbox-wsl 挂载（WSL2 与专用发行版就绪） ── WSL 服务（4 维）
├─ 仅 sandbox-dsh（ACL 受限令牌运行器）
│  ├─ 会话 shell 为 PowerShell ────────── DSH 服务（仅 fs-write，partial）
│  └─ 会话 shell 为 bash / sh（缺省） ─── DSH 加载失败，原因写明修法：
│                                          PENGUIN_SHELL=pwsh（或 powershell）后重启
└─ 都没有 ────────────────────────────────── 拒绝
```

开关打开而本机没有后端时，卡片提示安装该平台的推荐后端。卡片同时写明本机实施什么、由什么实施，例如「本机实施：文件写入，由 Landlock (dsh-local) 实施。本机不实施：网络隔离……」；折叠的「更多信息」列出在用后端的 `limits` 与每个未启用后端的原因。设置保存后，加载失败的后端重新加载一次，修好主机即可挂载，无需重启。

## Rationale and alternatives
[rationale-and-alternatives]: #rationale-and-alternatives

- **Fail closed，而不是缺后端时退回不封禁。** 后者让「看起来有沙盒」与「实际有沙盒」脱钩。拒绝是可见的，并且带着修法；不可实施的预设在卡片与 composer 上提前置灰，而不是在运行时放宽。
- **后端是插件。** 各平台机制差异大、演进节奏不同，平台本身不依赖任何一种；新的系统机制只需实现 `confine` 并如实声明维度，路由规则不变。
- **按能力路由，而不是按注册顺序。** 注册顺序来自 Project 的插件列表，与安全性无关；按顺序取第一个，DSH 可能抢走本该由 bwrap 服务的策略。按维度数取，能多做的那个总是负责。
- **DSH 是地板而不是默认。** DSH 的策略词汇只管文件写入，接不住网络与屏蔽路径；把它当默认会让这些维度在所有主机上消失。它的价值在于 bwrap 被拒时仍能封住文件写入，使出厂预设在默认 Ubuntu 上无需 root 即可实施。
- **跟随 DSH 的契约，而不是重写。** Landlock 启动器在旧 ABI 上每次运行都打印的报告行由 DSH 声明为 `informationalLines`，宿主只从 stderr 开头去掉这些行，DSH 不声明时不挂过滤；Windows 上裸名程序的查找归 DSH 的运行器。另写一套正则或 PATH 查找就是在两处维护同一个事实：曾有的手写 PATH 查找与 Windows / libuv 的语义不一致，而它要防的「Workspace 内同名 exe 遮蔽」运行在同一受限令牌下、不构成逃逸，已撤下。逐命令提示「部分实施」亦被否决：结论是主机级的，加载时报告一次即可。
- **保留 Windows 缺省 shell。** 把缺省 shell 改成 PowerShell 会改变每个 Windows 用户；只在封禁 Session 里换 shell 则让 shell 成为沙盒契约的一部分，而 shell 每进程解析一次并写进系统提示词。因此只在 DSH 加载时与每条命令前检查，并点名 `PENGUIN_SHELL`。
- **预设是名字加映射，而不是新的策略类型。** Session 的存储、实施路径与上限比较都不变，预设的任何编辑都不触碰已有 Session。

## Drawbacks：局限
[drawbacks]: #drawbacks

- **配置错了就什么都跑不了。** 没有后端、后端加载失败、或策略所需维度本机没有时，封禁模式下的每条命令都被拒。这是有意的代价。
- **Landlock 地板比 bwrap 窄。** 临时目录就是宿主共享的 `/tmp`，无法关闭或私有化；Landlock ABI 低于 5（Linux 6.10）时，Workspace 外设备文件上的 ioctl 不受限制，低于 ABI 3（Linux 6.2）时截断 Workspace 外的文件也不受限制。
- **DSH 不能断网、不能屏蔽路径、不能关闭临时目录。** 只有 DSH 服务时，「无网络」「仅本机」的预设置灰并在保存时拒绝，带屏蔽路径或关闭临时目录的封禁策略被拒；DSH 的策略只接受模式与 Workspace，因此每一级下 Session scratchpad 都不可写，Read Only 下临时目录也不可写。
- **「仅本机」网络只有 Seatbelt 实现**，Linux 与 Windows 上选它即被拒。
- **Windows ACL 一级恒为 partial**：受限令牌必须保留 Everyone 才能初始化进程，授予 Everyone 写权限的外部对象仍可写；NTFS 硬链接可让 Workspace 内外的路径指向同一文件。
- **Windows 上用 DSH 必须换成 PowerShell 会话 shell**，面向 POSIX shell 的 Skill 可能不能直接运行；设置后需重启。
- **回到 bwrap 的 AppArmor 步骤需要一次 root**：桌面 `.deb` 之外的安装方式与 Docker 容器都无法自带 profile。
- **报告行过滤只覆盖命令与钩子脚本**：`stdio` MCP Server 与文件工具仍会看到 Landlock 的 partial 报告行；命令自己的第一行 stderr 若与该行逐字相同，会被去掉。
- **宿主不区分被拒与运行器失败**：`denialSignatures` 与 `runnerFailureRules` 随每次改写返回，宿主只用其中的 `informationalLines` 过滤报告行。

## Prior art
[prior-art]: #prior-art

- **DSH（DeepSeek Harness 的沙盒）**：argv 改写、如实报告实施完整度、fail closed，以及 `denialSignatures` / `runnerFailureRules` 的形状都以它为蓝本。本项目的接口自有，因此能命名 DSH 词汇明确排除的维度（网络、屏蔽路径）；DSH 是接口后面的一个适配器。
- **bubblewrap、Landlock、Seatbelt（`sandbox-exec`）、WSL2**：各后端直接使用的系统机制。

## Unresolved questions
[unresolved-questions]: #unresolved-questions

- **会话 shell 成为设置（提议，未决定）**：`system_config` 增加会话 shell，优先级 `PENGUIN_SHELL` > 设置 > 自动探测；DSH 因 bash 不可用时卡片提供一键修复，重启后生效。每 Session 的 shell 暂被否决，理由见上。
- **Linux 推荐后端的口径**：只推荐 `sandbox-bwrap`，还是如本文推荐 `sandbox-bwrap` 与 `sandbox-dsh` 两个包。
- **Landlock 下的 `/tmp` 与 DSH 下的 scratchpad**：是否、以及如何给 DSH 下的命令私有临时目录与可写 scratchpad。

## Future possibilities
[future-possibilities]: #future-possibilities

- 提权（escalation）：以 `denialSignatures` 与 `runnerFailureRules` 区分「被沙盒拒绝」与「运行器失败」，在此之上决定被拒之后怎么办。
- 更多后端：维度与路由规则不变，新机制只需实现 `confine` 并如实声明维度，例如为 Linux 补上 `network-local`。

## Changes

### v1.0.0

- 新增：迁入主仓；正文取设计仓的同一版本，与英文版逐节对应。

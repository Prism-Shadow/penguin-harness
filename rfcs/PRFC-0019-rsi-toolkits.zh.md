# PRFC-0019 RSI 工具包

[English](PRFC-0019-rsi-toolkits.md)

> **来源**：设计仓 [penguin-harness-design](https://github.com/Prism-Shadow/penguin-harness-design) 的 `rfcs/PRFC-0019-rsi-toolkits.md`——落地于默认分支 `main`（提交 [`ac673a24`](https://github.com/Prism-Shadow/penguin-harness-design/commit/ac673a245eec78d6afca35e260dce28b2a3ab3ac)）。
> **修订**：v1.0.0（迁入主仓）；本面的约定见 [README.zh.md](README.zh.md)，逐版本改动记在文末 `## Changes`。

- Feature Name: `rsi_toolkits`
- Start Date: 2026-10-10
- PRFC PR: [Prism-Shadow/penguin-harness-design#293](https://github.com/Prism-Shadow/penguin-harness-design/pull/293)
- Implementation PR: [Prism-Shadow/penguin-harness#1030](https://github.com/Prism-Shadow/penguin-harness/pull/1030)（取代 [#985](https://github.com/Prism-Shadow/penguin-harness/pull/985)）
- 相关: 02「TAX-020」、04「MVP-005」、05「插件库」「Benchmark 评测与优化」

## Summary
[summary]: #summary

PenguinHarness 定位为 **Unified and Stable RSI Framework**（统一、稳定的 Agent 自进化框架）：全自动优化模型 × Agent Harness——模型固定，进化的是 Harness。每一种自进化算法以一个 **RSI 工具包**分发：插件库新增首位分类 `rsi`（Agent Self-Evolution / Agent 自进化），工具包名以 `-rsi-toolkit` 结尾；原 `agent-tuning` 一拆为三、所含 Skill 的名称不变：`default-rsi-toolkit`（Default RSI Toolkit）只含 `agent-optimization`，承载「试跑 → 反思 → 提升」的默认循环；出题与评测（`benchmark-design`、`agent-evaluation`）成为 AI 应用开发分类的 `agent-evaluation` 插件（Agent Evaluation），默认循环经由它测量；`agent-initialization` 归入 `agent-development`，后者另把 Workflow（现名 Agent Workbench，见 [PRFC-0020](PRFC-0020-agent-workbench.md)）的说明从 `penguin-sdk` 拆成新 Skill `penguin-plugin`；OPRO、APE、ACE、AWM 各成一个插件（`opro-rsi-toolkit` / `ape-rsi-toolkit` / `ace-rsi-toolkit` / `awm-rsi-toolkit`），各带一个与插件同名的 Skill，按原论文的流程运行。工具包之间不相互依赖：评测单元协议与 `scoreboard.yaml` 的格式是平台契约，每个算法工具包自带一份逐字相同的评测参考，由 core 测试钉住一致。Benchmark 的复现不属于任何插件或 Skill，统一放在 `Prism-Shadow/penguin-harness-benchmark`；导入其中的包是 `benchmark-design` 的一个分支。Web 草稿页——新对话的启动仪表盘——在品牌区右侧列三个总数，其中「自进化算法」一项从插件库的 `rsi` 分类派生算法数；评估中心「使用 → 优化」新增「方法」选择。

## Motivation
[motivation]: #motivation

产品定位改以递归自我进化为首、一句话生成应用为次：同一个模型，靠改进 Harness（Agent State 中的提示词、Skill、工具与钩子）持续变好。此前平台只有一种自进化算法——`benchmark-design`、`agent-evaluation`、`agent-optimization` 组成的默认循环（05「Benchmark 评测与优化」），它位于「AI 应用开发」分类下的 `agent-tuning` 插件中。文献里的算法远不止这一种，各有自己的实验协议：OPRO 由带分数的历史指令提出新指令，APE 从输入 / 输出示例归纳指令，ACE 把训练轨迹里的教训折进规则手册，AWM 从成功轨迹归纳工作流记忆。框架的职责是让每一种都**按原论文的方式**跑在同一套 Benchmark、记分与快照之上，结果才可比。

一种算法一个插件，有三条理由：

- **计数要真实。** 「已支持 N 种自进化算法」只能是派生值：数插件库 `rsi` 分类里的插件。写死的数字会随代码漂移。
- **安装与更新按算法进行。** 用户可以只装自己要用的算法，每个工具包的 Skill 各有自己的日期版本，改一种算法不会让其他算法显示为可更新。
- **默认循环保持精简。** 把所有算法做成同一个插件里的参考文件（[#985](https://github.com/Prism-Shadow/penguin-harness/pull/985) 的做法），默认循环的几个 Skill 都要按方法分支，正文与其中的参考索引随算法数一起膨胀。

工具包之间不能相互依赖：插件库没有依赖机制，安装以插件为单位，一个 Agent 可以装任意子集。一个要求 `agent-evaluation` 的算法工具包在没装 `agent-evaluation` 插件的 Agent 上直到运行时才失败，卸载该插件又会悄悄弄坏其他工具包。默认循环是唯一的例外：它本来就由出题、评测、优化三步组成，出题与评测是评估中心「评估」标签页与 Benchmark 导入也要用的通用能力，属于 AI 应用开发，于是 `default-rsi-toolkit` 只留优化这一步，经 `agent-evaluation` 插件测量。

Benchmark 的复现也不该进插件。一个复现的 Benchmark 是数据加一套特殊的运行方式（Docker 里的 Harbor 任务、每组题一个业务服务、各不相同的评分字段），写进 Skill 就把每个 Benchmark 的特例绑在了插件的发版节奏上，每多复现一个 Benchmark 都要改一次 Skill。既有做法已经给出了更好的落点：内置 Benchmark Sec A–E 把运行方式写在题干的「本题如何运行」与 benchmark 仓库的 README 里，`agent-evaluation` 只管产品侧。

具体场景：

- 用户一句话「复现 APE」，平台在 `ape-rsi-toolkit` 自带的演示任务上新建被测 Agent 与 Benchmark，跑完后评估中心给出优化前后的分数曲线（03「SCN-007」）。
- 已有 Benchmark 与基线的用户，在「使用 → 优化」里把方法从 Default 换成 OPRO，其余字段不变。
- 新用户打开草稿页，就看到这个版本支持哪些算法、复现了哪些 Benchmark，数字不会过时。

## Guide-level explanation
[guide-level-explanation]: #guide-level-explanation

**插件库。** 第一个分类是「Agent 自进化」，列出 `default-rsi-toolkit` 与各算法工具包，卡片短描述写明它是哪一个工具包（「默认 RSI 工具包：试跑、反思、提升。」「OPRO RSI 工具包：由分数优化指令。」）。它们缺省预装到 default_agent；其他 Agent 经插件库安装，或创建时选装（默认循环要连同测量它的 `agent-evaluation` 插件一起装）：

```bash
penguin agent create --agent-id writer --plugins default-rsi-toolkit,agent-evaluation,ape-rsi-toolkit
```

**一句话复现。** 每个算法工具包的快速开始是一句可直接运行的话。`ape-rsi-toolkit` 与 `opro-rsi-toolkit` 自带一个演示任务（Benchmark 与题目内容完整写在 `references/demo-task.md` 里，不在运行时生成），所以一句「在 ape-rsi-toolkit 自带的演示任务上复现 APE」就足以新建被测 Agent、新建一套已发布的 Benchmark、测基线、跑方法、报告前后分数。`ace-rsi-toolkit` 与 `awm-rsi-toolkit` 没有演示任务，先问用户要被测 Agent 与一个已发布的 Benchmark。

**评估中心。** 「使用 → 优化」的第一项是「方法」：插件库 `rsi` 分类里的工具包各一项，Default 居首，名称与说明取自插件清单——管理员在插件市场装上一个工具包，下次打开对话框它就在列表里。选 Default 时表单与提示词同前；选其他方法时「最多轮数」与「目标分数」隐藏——这些方法用论文自己的预算，缺省降为冒烟档——提示词改为交给该工具包的 Skill。执行优化的 Agent 没装那个 Skill 时，弹窗点名要安装的插件。每条完整评估照常以「`<agent_id>` · `<model_id>` · `<thinking_level>`」的标签记入 `scoreboard.yaml`，曲线与明细不区分方法。

**草稿页。** 新对话的启动仪表盘（06「对话页」），一屏放得下：品牌区两行（产品名与版本号、副标题「最全面的 Agent 自进化平台」），同一行最右端一块小的统计面板，只列三个总数——本 Project 的智能体数、自进化算法数（插件库 `rsi` 分类的工具包，取自 `GET /api/plugins`）、本 Project 的评估集数——点开对应页面，取不到时显示「—」，每次进入草稿页都重新读取，装上插件或导入 Benchmark 后回到草稿页数字即变；输入卡片之下为示例与快捷指令，每个条目以各自的图标领头。

**官网。** 首屏「统一、稳定的 Agent 自进化框架 / 全自动优化模型 × Agent Harness」，其下原有的四张数据卡片不变（1000+ 模型、跨平台部署、100% 开源、首个自进化 Harness，小字在上、大字在下），再下是三份带外链的清单——支持模型（供应商主页）、自进化算法（论文；Default 不带链接）、评估集（内置 Benchmark 只写类别，链到上游评测集；取自同一上游的几个合为一项，如 GDPevo 的训练与测试两半），算法与评估集的条目是纯文字链接、不加胶囊底，外链点击先经确认框再打开。两个示例并排：一句话生成会思考、可运行的 AI 应用；一句话启动 Agent 自进化（即 `ape-rsi-toolkit` 的演示任务）。

**复现一个新的 Benchmark。** 不写 Skill：在 `Prism-Shadow/penguin-harness-benchmark` 里加一个 Benchmark 包（`packages/<id>/`），特殊运行方式写进每题题干的「本题如何运行」与仓库 README，再把它导入 Project。导入经 `benchmark-design` 的导入流程进行（配对的 train / test 包一并导入，导入后核对，可选的冒烟探测先问）。

## Reference-level explanation
[reference-level-explanation]: #reference-level-explanation

### 分类与插件

core 的分类清单首位新增 `{ id: "rsi", title: "Agent Self-Evolution", titleZh: "Agent 自进化" }`。插件都在仓库根的 `plugins/<name>/`，npm 包名 `@penguinharness/<name>`，`category = "rsi"`，`preinstall` 取缺省值 true：

| 插件 | Skill | 自带参考 |
| --- | --- | --- |
| `default-rsi-toolkit` | `agent-optimization` | 原 `agent-tuning` 的同名 Skill，逐字不变 |
| `agent-evaluation`（AI 应用开发分类，非工具包） | `benchmark-design`、`agent-evaluation` | 原 `agent-tuning` 的 Skill 与参考文件（含 `reference/harbor.md`），除 `benchmark-design` 新增的导入分支外逐字不变 |
| `agent-development`（AI 应用开发分类，非工具包） | 新增 `agent-initialization`、`penguin-plugin` | `agent-initialization` 带 `reference/hooks.md`，「程序以哪种方式接入」与 Agent API 的负责人步骤改为指向 `penguin-sdk`；`penguin-plugin` 即原 `penguin-sdk` 的 Workflow 一节 |
| `opro-rsi-toolkit`、`ape-rsi-toolkit` | 与插件同名 | `references/initialization.md`、`references/evaluation.md`、`references/demo-task.md` |
| `ace-rsi-toolkit`、`awm-rsi-toolkit` | 与插件同名 | `references/initialization.md`、`references/evaluation.md` |

算法工具包的 Skill 不提及任何其他插件或 Skill，单独安装即可读通。正文依次为：方法出处（论文、作者与年份、官方仓库、核对过的源码提交）；「Before you start」（`test_agent_id`——已有 Agent，或用户要新建时写 `create: <id>`；`benchmark_id`，必须已发布，`opro-rsi-toolkit` / `ape-rsi-toolkit` 可改用演示任务；`runs`；方法参数的论文默认值与冒烟档）；路径与记录；初始化；测量；方法循环；冻结与报告。每次实验的记录写在本 Session 的 scratchpad 下 `<skill>/<experiment_id>/`（目录名即 Skill 名，如 `opro-rsi-toolkit`）：`experiment.yaml`（方法、论文与源码出处、参数、题目集合、Runtime、State 散列，以及 Awesome-RSI 的分类维度）、提议日志（每个提示词与原始回答）、每个候选的测量与失败。方法循环由 #985 的配方改写而来：保留元提示词结构、历史处理、去重与语法检查、平局与选择规则、预算算式，以及「不隐式启动论文的完整预算」；去掉伴生监管与对默认循环的一切引用。

### 学习槽

初始化只在被测 Agent 中建立该方法的学习槽：一个被测 Agent 自有的 Skill——`opro-instruction`、`ape-instruction`、`ace-playbook`（学习文件 `rules.yaml`）、`awm-workflows`（学习文件 `workflows.md`）——其固定的 `SKILL.md` 正文要求 Agent 完整读取学习文件并照做；再在被测 Agent 的 `AGENTS.md` 末尾追加一行固定指令，要求在开始实质性操作前先读它。方法循环只改学习文件。学习 Skill 的 frontmatter 带日期版本（与已装 Skill 同口径）；Agent State 的 `version` 每测量一个候选就递增一次，被拒或落选的版本号不再复用。每次改动被测 Agent 之前，先确认当前版本的快照 `snapshots/v<version>.tar.gz` 已存在（不含 `.vault.toml`，从不覆盖，打不出来就停）。结束时恢复胜出的快照，版本号保持它被测量时的值，其余快照与记录都保留。

### 评测契约

`references/evaluation.md` 在每个算法工具包里逐字相同。工具包的 Skill 是 controller：只接受已发布的 Benchmark；每次实验固定一次 Runtime——用户点名的模型对，否则取自身 Environment 的 Provider 与 Model ID，从不读被测 Agent 的文件、Project 默认值或服务端，缺一半即停；思考等级取被测 Agent 的 `model.thinking_level`。对 Case × runs 矩阵的每一格调用一次 `run_subagent`（省略 `agent_id`，worker 即本 Agent，因而读得到这份参考），委派提示词先指向这份参考的「The worker」一节，随后是与 `agent-evaluation` 相同的请求字段：

```text
protocol_version: 1
case_id: <case_id>
run: <1_based_run_index>
expected_version: <agent_state_version>
test_agent_id: <test_agent_id>
benchmark_id: <benchmark_id>
provider: <provider>
model_id: <model_id>
```

worker 只评一格，只回一份不带围栏的纯 YAML：`status: ok` 带身份字段、`score`（0–100）、`cost`（数值或 null）、`duration_ms` 与被测 `session_id`；`status: failed` 带 `failure_code`（`invalid_request` / `benchmark_invalid` / `version_changed` / `evaluation_failed`），不带分数与任何私有信息。被测 Agent 在独立的 Workspace 中经 `penguin run` 运行，只见题干；题干以「本题如何运行」一节指定经 Harbor 运行的题（如内置 Benchmark），worker 改为在固定提交的检出上照该节与仓库 README 跑一次 trial（检出带有 README 所述的安装包时一并传入），controller 在上限内后台派格（缺省 4 格，用户另给上限时从之，不超过 8），一格返回即补派下一格、不等整批，Docker 给不出网络的格子降低并发重跑一次、不计分。controller 先核对结果恰为一份纯 YAML（否则请同一个 worker 重发，不为格式重跑被测 Agent），再核对身份字段与固定的 Runtime 一致（否则矩阵无效、停止）；缺格的矩阵没有分数，从不对残缺矩阵求平均。每个完整矩阵向 `scoreboard.yaml` 追加一条 evaluation（05「Benchmark 评测与优化」的记分结构；评估级的 `score`、`cost`、`duration_ms` 取各题平均，与 `agent-evaluation` Skill 现行的口径相同），追加后重新解析核对；只记录仍留有快照的 State 的完整测量，方法内部的候选历史留在实验目录。controller 与 worker 都不读凭据与 `web.db`，也不拿磁盘上的 token 调服务端 API。

core 的插件测试对 `rsi` 分类中除 `default-rsi-toolkit` 以外的每个插件，读取其 Skill 下的 `references/evaluation.md`，断言各份非空且逐字相同。

### 自进化算法的来源

Web App 不写死工具包与 Benchmark 的清单。草稿页的「自进化算法」计数与「方法」下拉都读插件库（`GET /api/plugins`）的 `rsi` 分类，「评估集」计数读本 Project 的 Benchmark 列表；每次挂载（进入草稿页、打开「使用」对话框）都重新读取，读到之前先显示本页上一次读到的结果，读取失败时保留上一次的结果；从未读到时计数显示「—」、下拉置灰。官网的自进化算法与评估集两份清单取自落地页包里的常量，由测试钉到 `plugins/*/package.json` 中 `penguin.category` 为 `rsi` 的插件与 core 的内置 Benchmark 清单。

### 「方法」选择

「方法」下拉在打开「使用」对话框时由插件库的 `rsi` 分类生成，每个插件一项：名称取清单的 `title` / `title_zh`（缺省为包名），说明取 `short_description(_zh)`，缺省为 `description(_zh)`。内置的五个工具包都不写 `title`，下拉与插件市场一样显示包名。`default-rsi-toolkit` 按包名识别为默认循环：排在首位，表单与尾部同前，预选 `agent-optimization` 与 `agent-evaluation`。其余每个插件按原论文流程运行，所用 Skill 依次取与插件同名的 Skill、快速开始预选的第一个且插件自带的 Skill、插件唯一的 Skill；三者都定不下来的插件不进下拉。插件库还没读到、读取失败或分类为空时，下拉置灰并写明原因，表单按 Default 处理，「评估」tab 不受影响。选非 Default 方法时，固定尾部向该 Skill 交代 test_agent_id、benchmark_id 与 runs，要求按原论文流程运行、经其自带的评测参考测量、以同一标签记录每条完整评估，不提 `agent-evaluation`、`run_subagent` 或轮数上限；预选技能只有该 Skill。测试只验证这条映射规则（排序、Skill 的选取、按语言取名称与说明、读不到时的回落），并对仓库里实际随附的工具包跑一遍，保证每个都能映射成一项。

### Benchmark 复现

复现的 Benchmark 是 `Prism-Shadow/penguin-harness-benchmark` 中 `packages/<id>/` 下的 Benchmark 包，按 05「Benchmark 评测与优化」的包格式导入 Project；它的运行方式写在每题题干的「本题如何运行」与仓库 README 里，从不写进插件或 Skill。GDPevo 子集（每题一个 Harbor 任务、每组一个业务服务、按组归一的评分）在该仓库打包为训练、测试两个包，并作为内置 Benchmark **GDPevo Train / GDPevo Test** 随每个新 Project 写入：产品只带两个包的题干与评分细则（与仓库里同版本的包逐字节相同），任务目录、业务环境与一切大文件仍只在该仓库。

### 兼容性

已装的 Skill 副本按 Skill 名匹配，不记插件名：存量 Agent 照常工作，更新检查照常生效，原 `agent-tuning` 的四个 Skill 各自记在现在承载它的插件名下。按旧名安装（例如脚本里的 `--plugins agent-tuning`）返回 404 `unknown_plugin`；npm 上的 `@penguinharness/agent-tuning` 不再发布新版本。预装只在创建时发生，存量 Agent 不会自动得到新的工具包——「方法」选择的缺技能提示会点名要装的插件。记分结构不变，旧读者照常解析算法工具包写下的记录。

## Drawbacks
[drawbacks]: #drawbacks

- **评测参考的副本。** 每个算法工具包各有一份，改一处就要在同一次改动里改全部；测试只保证副本之间一致，不保证它们与 `agent-evaluation` 在语义上一致——同一个协议有了两种写法。
- **npm 包的首次发布。** 每个新插件都是一个新的 npm 包，要在发版之前手工完成首次发布与 trusted publisher 设置。
- **更名。** 脚本、文档与博客里的 `agent-tuning` 失效（博客作为历史保留原样）；旧 npm 包停在最后一个版本。
- **提示词开销。** 全部预装时，default_agent 的 Skill 索引每个工具包多一行。
- **默认循环依赖另一个插件。** `default-rsi-toolkit` 要靠 `agent-evaluation` 插件测量，而插件库没有依赖机制：只装前者的 Agent 直到优化时才发现缺评测。缓解：二者都预装，评估中心在评估者缺少 `agent-evaluation` Skill 时提示安装该插件。
- **清单取决于插件清单。** 名称取自插件清单，不写 `title` 的工具包（包括内置的五个）在下拉里显示包名；所用 Skill 定不下来的插件不进下拉，却仍计入草稿页的「自进化算法」数。

## Rationale and alternatives
[rationale-and-alternatives]: #rationale-and-alternatives

- **算法工具包依赖 `default-rsi-toolkit` 的 `agent-evaluation`。** 协议只有一份实现，没有副本。不选：插件库没有依赖机制，耦合只能落在安装顺序上，失败要到运行时才暴露。
- **所有算法做成一个插件里的参考文件（#985）。** 一个插件计不出「N 种算法」，算法不能单独安装与更新，默认循环的 Skill 要随每种算法增加分支，正文与参考索引无界增长。不选。
- **前端维护方法清单、由测试钉到 `plugins/`。** 本提案最初的做法：新增工具包要在前端加一行，管理员在服务器上安装的工具包永远进不了下拉，计数也只在刷新页面后才变。不选。
- **服务端的评测执行器。** 由平台服务执行每一格，契约成为代码，副本随之消失。代价是一个新的子系统，且执行逻辑离开了 Agent 可编辑的文件（PRN-001）。暂缓，见 Future possibilities。
- **命名。** 以 `-rsi-toolkit` 结尾的长名（`default-rsi-toolkit`、`opro-rsi-toolkit`）：名字自解释，算法工具包唯一的 Skill 与插件同名；一族在插件库里由 `rsi` 分类归在一起，不靠名字排序。短名 `rsi-*` 曾在本提案的早期版本使用，未发布。
- **什么都不做。** 默认循环仍是唯一的算法，「RSI 框架」的定位没有东西支撑，计数也无从谈起。

## Prior art
[prior-art]: #prior-art

- [#985](https://github.com/Prism-Shadow/penguin-harness/pull/985)（Junhao Hu）最先把 OPRO、APE、ACE、AWM 作为 `agent-tuning` 里的参考文件移植进来，核对了各方法的源码提交、给出了冒烟档与学习槽的布局；它另提出伴生监管（`agent-supervision`）与 Benchmark 复现（`benchmark-reproduction`，含 GDPevo 配方）。本提案沿用其方法配方与初始化布局并改写为自成一体的工具包，取代该 PR。未并入的有三项：伴生监管让每次委派的会话数翻倍、效果尚未验证（见 Unresolved questions）；Benchmark 复现的理由见 Motivation；它对默认循环几个 Skill 的改写也未采用——这些 Skill 已在主线上独立加固过。
- Awesome-RSI 的分类维度（artifact / source / feedback / updater / frequency / topology / selection / mode / scope）记入每次实验的 `experiment.yaml`，使不同算法的实验可以对照。
- 论文与官方实现：OPRO，Yang 等，2023，[Large Language Models as Optimizers](https://arxiv.org/abs/2309.03409)（[google-deepmind/opro](https://github.com/google-deepmind/opro)）；APE，Zhou 等，2022，[Large Language Models are Human-Level Prompt Engineers](https://arxiv.org/abs/2211.01910)（[keirp/automatic_prompt_engineer](https://github.com/keirp/automatic_prompt_engineer)）；ACE，Zhang 等，2025，[Agentic Context Engineering](https://arxiv.org/abs/2510.04618)（[ace-agent/ace](https://github.com/ace-agent/ace)）；AWM，Wang 等，2024，[Agent Workflow Memory](https://arxiv.org/abs/2409.07429)（[zorazrw/agent-workflow-memory](https://github.com/zorazrw/agent-workflow-memory)）。
- 内置 Benchmark Sec A–E 是「运行方式写在题干与仓库 README，不写进 Skill」的先例：`agent-evaluation` 的 `reference/harbor.md` 只规定产品侧。

## Unresolved questions
[unresolved-questions]: #unresolved-questions

- **更名的兼容策略。** 明确不兼容（changelog 标 Breaking，旧 npm 包 deprecate）、core 里留一张 `agent-tuning → default-rsi-toolkit` 别名表到 0.3，还是只改描述不改名。倾向前者。
- **预装范围。** 全部工具包预装，还是只预装 `default-rsi-toolkit`、其余手动安装。倾向全部预装，示例与快速开始开箱即跑。
- **评测契约的落点。** 自带副本，还是声明依赖 `default-rsi-toolkit` 的 `agent-evaluation`。倾向自带副本。
- **伴生监管。** 本轮不并入；若要，作为 `default-rsi-toolkit` 的可选 Skill，算法工具包不引用它。
- **#985 的设计文档。** 候选算法清单与文献综述是否署名并入实现仓库的 `packages/docs/decisions/`；FDE 场景文档的决定已被本提案取代，倾向不并入。
- **官网第二例的素材。** 先以评估中心截图占位，真实跑一次后换成分数曲线截图与视频并补上成本。
- **评测 Runtime。** Default 的优化沿用基线记录的 Runtime；算法工具包取优化会话自身的模型。两者不同时，同一被测 Agent 的曲线分成两个系列。是否让算法工具包也沿用基线记录？
- **评估级分数的口径。** 05 的记分结构写评估级为各题平均值之和、满分由评分细则约定；现行 Skill 与本提案的评测参考取各题平均、固定 0–100。需要定下以哪个为准并同步 05。

## Future possibilities
[future-possibilities]: #future-possibilities

- 从 #985 的候选清单里继续添加工具包：每种算法一个插件，装进插件库后「方法」下拉与计数自动跟上。
- 伴生监管作为 `default-rsi-toolkit` 的可选 Skill。
- evaluation 记录增加一个 `method` 字段（旧读者忽略），曲线与明细可以分辨同一系列里由不同方法产出的点。
- 服务端的评测执行器取代各工具包里的参考副本。

## Changes

### v1.0.0

- 新增：迁入主仓；正文取设计仓的同一版本，与英文版逐节对应。

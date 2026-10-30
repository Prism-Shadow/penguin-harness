# PRFC-0024 CLI 解析：每条通道按声明解析要运行的 CLI

[English](PRFC-0024-cli-resolution.md)

- Feature Name: `cli-resolution`
- Start Date: 2026-10-23
- PRFC PR: none yet (native to this repository)
- Implementation PR: —（由本 RFC 的实现分支承载，尚未开 PR）

## Summary
[summary]: #summary

本 RFC 把「这次运行哪个 CLI 入口」收成一个有名字的问题——**resolution**——由每个要跑 harness CLI 的消费方共享：server 启动、机器远端命令、推送闸门、用户可见的命令 shim。resolution 从安装的声明与 [harness meta](./PRFC-0023-harness-meta.zh.md#guide-level-explanation) 作答——即根里那份记录，推送写下的 `hmr/harness.json` 文件。每条 [distro channel](./PRFC-0021-distros.zh.md#guide-level-explanation) 的产品都带一个 **CLI loader**——加载记录所指那份 CLI 的入口，本身是安装的产物、在热推送后存活；桌面应用还没有——找不到可用 loader 时，resolution 给出具名故障。答案是带固定顺序的判定过程：记录与声明的每一种状态，各自得出一个入口或一个具名故障。

## Motivation
[motivation]: #motivation

### loader 的身份今天是一个文件名

CLI loader 的身份今天是一个文件名，靠约定在包、版本与机器之间流传。一份声明能指着它说「这就是 loader」的地方今天不存在；名字在五处被各自拼写——远端命令路径、启动检查、桌面启动器、推送闸门、包的 bin 映射。改名时这些地方以三种方式坏掉：一处响亮地坏，两处无声地坏，全部发生在运行期。这个名字被当作协议字段使用，却没人把它当协议管理。

### 两条通道上推送 CLI 抵达不了

桌面产品不带 loader；Docker 镜像的 `PATH` 入口是一枚无扩展名 symlink，使机制所依赖的可重启启动失效。两条通道上，CLI 的热推送被收进记录、却永不运行，而同一次推送的 platform 与 web 两半照常生效——产品只可半更新，这是最安静的坏法。

### 重构之前先立地基

pushed CLI 的重构就在眼前：改名、改入口形态、改 server 启动方式，每一件都要走过名字那些分散的拼写。resolution 变成一处声明的、共享的答案，重构才有地面可站；让它继续隐含，改名就会以三种停机之一收场。

## Guide-level explanation
[guide-level-explanation]: #guide-level-explanation

### 概念

- **产品自己的入口**——通道产品装下、一个人会敲的那个 CLI 入口；别的都不知道时运行它。
- **CLI loader**——加载记录所指那份 CLI 的入口；它本身是安装的产物，并在热推送后存活。
- **resolution**——那个共享的问题「这条命令运行哪个入口」；答案来自安装声明了什么、记录里有什么。
- **记录（the record）**——根里的 `<root>/hmr/harness.json`，由一次推送写下：它说这个根持有哪些 platform、CLI、web 文件，各在哪里。
- **存储（the store）**——根的 `hmr/` 目录，推送把那些文件写在这里。
- **文件（the bundle）**——一次推送写下的一个文件；推送来的 CLI 就是记录里 CLI 路径所指的那个文件。
- **旧名（the legacy name）**——`penguin-hmr.js`，早于声明的产品里 loader 的文件名。

### 每个消费方问的是同一个问题

决定再拉起哪个入口的 server 监督者、决定在对端调用什么的机器远端命令、决定拿哪个 loader 冒烟测候选的推送闸门、决定把什么放上用户 `PATH` 的命令 shim——四个消费方，一个问题。今天它们各自作答，各带一套拼写与回退习惯；本 RFC 给它们一个共享的答案。

### resolution 按固定顺序作答

resolution 从根里的记录与调用方产品的声明作答。没有记录的数据根，或记录里没有 CLI 一节的根，运行调用方自己的入口，理由 `own-entry`；读不出、用不了的记录是一个故障；带推送 CLI 的记录选出产品的 loader：声明指名了它时答 `declared-loader`，只有旧名存在时答 `legacy-loader`，两者都没有时答一个故障。调用方自己就是那个 loader 时，resolution 答它自己，并带上记录指名的文件。每个答案都带着自己的名字，每个消费方记下它据以行动的那个名字。

### 身份靠声明

loader 靠包清单里的一个字段亮明身份：`penguin.cliLoader`，值是相对该清单的 loader 路径。resolution 从这个字段发现 loader。一次保住字段的改名对 resolution 不可见；一次破坏字段的改名在发现点变成具名故障。

### 每条通道都带 loader

每条通道的产品都带一个可加载的 CLI loader，由发行面在构建期断言。这样一次产品重塑不会无声丢掉加载推送代码的那一半。断言查什么——入口与 loader 在每个产物中都在、都加载——是本 RFC 的主张；发行工作流怎样措辞它的失败，见 Unresolved。今天有一条通道还没带上它：桌面应用不带 loader，它的数据根一直答故障 `no-loader`，直到桌面产品带上一个。

### 故障要具名

找不到可用 loader 的 resolution 在失败点给出具名故障；故障名由 Reference-level 的相应一节定下。随后仍运行一个较次的入口——用产品自己的入口顶替推送的 CLI——那次回退是一次被记录、具名的决定。「起得来的 server 胜过起不来的」仍然可以作为一种选择存在，不再作为一次事故存在。这样，一次让推送路径无声消失的改名，就变成了安装时可见的报告。

### 跨版本的对端

远端命令靠问来解析对端的 loader：对端声明、调用方读取，过渡窗口内退回旧名。机器活得比安装它的东西久；窗口与探测的形状是下方候选，方向已定——远端命令不再依赖某一方的私有拼写。

## Reference-level explanation
[reference-level-explanation]: #reference-level-explanation

### 四个消费方，一个答案

1. **启动**——能再拉起的 server 向 resolution 要入口，每次拉起都重新问；一次新推送在下次重启时被捡起，无需重装。
2. **机器远端命令**——调用方解析对端声明，不拼硬路径；探测先行，结果在「声明的 loader、旧名、具名拒绝」之间裁决。
3. **推送闸门**——候选推送用接收方安装将来实际运行的那个 loader 做冒烟测试；测的 loader 与将来运行的那个是同一个，闸门才装对了门。
4. **命令 shim**——数据根放到用户 `PATH` 上的东西是 resolution 的答案，敲 `penguin` 的人与监督者拿到同一个入口。

### 答案在哪里

resolution 是命令 shim 模块里的一个函数，`packages/server/src/services/cli-shim.ts`——也就是早已决定用户 `PATH` 上那个 `penguin` 运行什么的那份模块——以 server 包的 `@prismshadow/penguin-server/cli-shim` 子路径发布，与 `./hmr/manifest`、`./version-report` 并排。它位于热更新层之外：那一层——`packages/hmr`、`packages/server/src/hmr/` 与 `packages/desktop/`——承载 store 与记录的机制，改动那里意味着重建并重装每一台安装；判定过程是部署方可能想改、却不必付这个代价的那部分。CLI 的 loader 引入同一个子路径，于是 loader 与 shim 据同一个答案行动，也没有任何一条通道的打包需要改。

记录只读一次，读它的是那一层的 reader `readHarnessMeta`（`@prismshadow/penguin-hmr/manifest`）：没有提交过版本的根答 `none`，有记录答 `meta` 连记录本身，读不出答 `broken` 并说明为什么。resolution 的 CLI 一半投影到这一个答案上——`meta` 的 `cli.bundle`，对 `<root>/hmr` 解析——版本报告与 `resolveCliBundlePath` 也走同一个 reader，记录的每一副面孔都不再二次读这份文件。有一条用例钉住这层投影，resolution 与 reader 因此不会无声地走岔。

### resolution 的输入与顺序

resolution 收调用方自己的入口与数据根。它从磁盘读两样东西：根里那份记录，以及调用方产品在入口之上最近一份包清单里携带的声明。它的答案是一个入口加一个理由，或一个故障加一个名字。

1. **自身，且有推送的 CLI。** 调用方自己的入口就是它产品的 loader 时，resolution 答它自己，理由取它名字应得的那一个：声明的 loader 答 `declared-loader`，旧名答 `legacy-loader`。答案带上推送的文件，所以 loader 不去加载自己。
2. **记录。** [PRFC-0023](./PRFC-0023-harness-meta.zh.md#reference-level-explanation) 的记录，走那一层唯一的 reader `readHarnessMeta`（见「答案在哪里」）；CLI 一半投影到它的答案上。
3. **声明的 loader。** 产品声明了 loader：目标存在时答这个 loader，理由 `declared-loader`；目标缺失或声明坏掉时答故障 `declared-loader-missing`。
4. **旧名的 loader。** 产品没有声明时，过渡窗口开着且旧名 loader 存在，答那个 loader，理由 `legacy-loader`；既无声明、也无旧名 loader 时，答故障 `no-loader`。
5. **没有推送的 CLI。** 记录里没有提交过的 CLI——没有记录、记录里没有 `cli` 一节、一节里没有可用的 bundle 路径、路径所指文件已不在 store 里——答调用方自己的入口，理由 `own-entry`。
6. **用不了的记录。** 读不出、解析不了、或 resolver 无从处置的记录——`cli` 一节没有可用的 bundle 路径、路径解析到 store 之外、路径所指文件已不在 store 里——答 `record-unreadable`，出了什么问题随 detail 带上。这些情形要的都是同一个补救，所以共用一个名字。

第一条命中的情形决定答案。第 3、4 条适用于带推送 CLI 的记录；第 5、6 条适用于不带的那一种。

### 各情形与答案

| 记录 | CLI 路径 | 声明 | 答案 |
| --- | --- | --- | --- |
| 记录 | 在，文件在 store 里 | 声明的 loader 存在 | 这个 loader——`declared-loader` |
| 记录 | 在，文件在 store 里 | 声明的 loader 缺失 | 故障 `declared-loader-missing` |
| 记录 | 在，文件在 store 里 | 无声明，旧名 loader 存在，窗口开着 | 旧名 loader——`legacy-loader` |
| 记录 | 在，文件在 store 里 | 无声明，无旧名 loader | 故障 `no-loader` |
| 记录 | 在，文件不在 store 里 | 任意 | 故障 `record-unreadable` |
| 记录 | 在，路径用不了 | 任意 | 故障 `record-unreadable` |
| 记录 | 没有 CLI 一节 | 任意 | 调用方自己的入口——`own-entry` |
| 没有记录 | — | 任意 | 调用方自己的入口——`own-entry` |
| 记录损坏 | — | 任意 | 故障 `record-unreadable` |
| 带推送的 CLI，且调用方自己就是它产品的 loader | — | — | 它自己——`declared-loader` 或 `legacy-loader` |

存在决定答案；加载成不成是另一份报告。磁盘上存在、加载不了 CLI 的 loader，第一件事就是报 `cli-unloadable`；会做探测的消费方——收下推送之前的推送闸门、发出产物之前的发行断言——在运行任何东西之前把探测失败变成同一个故障。在没有推送 CLI 的根上被调用的 loader，答那两条「没有推送的 CLI」情形的理由 `own-entry`，或它们的故障：它就是那里的入口。

消费方据答案行动。必须起 server 的监督者在答案是故障时运行产品自己的入口，并记下故障名。loader 在故障上什么都不运行，只把故障报出来；一个人或一条远端命令在没有推送 CLI 的根上调用它时，它报 `own-entry`。远端命令原样转达对端的故障。命令 shim 承载 resolution 的答案，人敲到的入口就是监督者会运行的那个入口。自己入口无法作为独立进程启动的消费方——`PATH` 上的无扩展名 symlink、经 TypeScript 运行器跑的源跑——在进程内运行 server，并记下 `entry-not-rerunnable` 这一情形。

### 声明的形状

产品在发货那个包的包清单里声明它的 loader：

```json
"penguin": { "cliLoader": "./dist/penguin-hmr.js" }
```

值是一条相对清单所在目录的路径，resolution 按那个目录解析它；爬出这个包的值不指向任何 loader。读者从手上的入口向上走，找到最近的那份包清单——它就是产品自己的清单——并把 bin symlink 或 `PATH` 链接先解析成它指向的文件。

这个字段给出三种答案，判定顺序对它们各有安排，所以三者分开：已声明、缺席（早于声明的产品）、损坏（字段指不出一份可用文件）。字段损坏时答 `declared-loader-missing`，旧名不再被读。

声明随产品走：npm 包发的是它自己的清单，发行 payload 的 `lib/` 是把同一个包部署出来、字段原样带着，Docker 镜像照抄那份 `lib/`，桌面应用在自己的 bundle 旁带上自己的清单，源码检出里清单就在树里。对端的声明是它程序目录里的同一份文件，调用方读它，不必拼一条路径。

### 各通道的答案

每条通道的产品都装一个入口，除桌面应用外每个产品都声明一个 loader，装配时写下根的第一份记录（[PRFC-0023](./PRFC-0023-harness-meta.zh.md#guide-level-explanation)）。表里逐通道读出 resolution 的答案：首启时与一次推送之后。

| 通道 | 产品自己的入口 | 声明的 loader | 首启 | 推送之后 |
| --- | --- | --- | --- | --- |
| npm 包 | 主 CLI bin | 与它并排的 loader bin | loader——`declared-loader` | loader——`declared-loader` |
| 发行 tarball（含 universal） | launcher 脚本 | 安装好的 CLI 对旁边的 loader | loader——`declared-loader` | loader——`declared-loader` |
| Docker 镜像 | 今天的无扩展名 symlink；下方改动后是可再运行的入口 | 镜像里的 loader | loader——`declared-loader`；symlink 入口在重塑之前答 `entry-not-rerunnable` | loader——`declared-loader` |
| 桌面应用 | 打包的 CLI，经外壳的 launch 入口启动 | 今天没有：产品不带 loader | 故障 `no-loader`——这条通道的缺口，仍然开着 | 故障 `no-loader`，直到产品带上 loader |
| 源码检出 | 构建出的 CLI；源跑没有可再运行的入口 | 构建出的 CLI 旁边的 loader | 构建跑：loader——`declared-loader`；源跑：`entry-not-rerunnable` | loader——`declared-loader`；dev 根的装配仍在下方开放 |
| machines 安装出的对端 | loader，它是对端唯一的 CLI 面 | 同一个 loader | loader——`declared-loader`；从未被推送、也未被本侧安装过的裸 release 答 `own-entry` | loader——`declared-loader` |

远端命令是唯一跨机器解析的消费方：它读对端的声明，调用声明的 loader；早于声明的对端按旧名作答。随后对端自己的 resolution 运行，所以记录读不出的对端报 `record-unreadable`，从未收到推送、也从未由另一台机器安装而来的对端报 `own-entry`。

### 过渡窗口

旧名是早于声明的产品里 loader 的文件名：`penguin-hmr.js`。resolution 先读声明、再读旧名，且只在没有声明的地方走到旧名。来自旧名的答案记为 `legacy-loader`，窗口在持续期间保持可见。

声明指名了缺失或用不了的 loader 时，只答它那一份故障，旧名不再被读。带坏声明的新产品就是一次损坏的安装，回退会把它掩盖住。

携带声明的发布线覆盖到部署关心的机器时，窗口关闭。此后产品去掉旧名那一支，没有声明的产品答 `no-loader`。窗口的长度、调用方对端所用探测的确切形状，仍在下方开放。

### 身份的载体

载体是包清单里的 `penguin.cliLoader` 字段。三条性质定下它。读一份清单不需要运行产品，人、远端调用方与发行断言都需要这一点。清单属于一个产品，所以每条通道声明自己产物里带的那一个 loader。每条通道的打包本来就会带上清单，声明因此不需要第二套投递机制。

另外两个候选各缺其中一条。导出的身份常量只有运行产品代码才读得到，而远端调用方与构建期断言做不到这件事。记录里的一条路径属于一个数据根、而非一个产品，而没有记录的根里仍然有 loader 要找。

### 构建期的通道断言（候选）

发行面按产物断言：入口存在，loader 在旁或在内，两者都加载。断言属于发行工作流，因为要抓的失败是跨包的：一个包重塑了入口，随行 loader 在另一个包里被重塑。桌面包的重塑产检会是第一个实例——它会让一次「清单没有声明 loader」或「声明的 loader 没有随包进去」的构建失败——而这项检查随 loader 一起来。

### 两条缺口通道

`PATH` 入口是无扩展名 symlink 的那条：入口换成可再运行的形态（真实文件或 launcher），resolution 在那里与别处一样工作；形态仍在下方开放。桌面应用这边，产品会把 loader 与它打包的 CLI 并排发货，并在自己的清单里声明它，桌面数据根于是与其余五条通道一样能运行推送的 CLI。这项改动不在本版里：桌面包属于热更新层，那一层的改动要重建并重装每一台安装，所以桌面数据根今天答 `no-loader`。

### 与 PRFC-0023 的分工

resolution 依赖常在：一个可以信任记录存在的 reader，才不需要在缺席处猜。这份 RFC 拥有那条缝：harness meta 陈述根持有什么，resolution 决定运行什么。

## Invariants
[invariants]: #invariants

### 声明认身份，名字留记录

> 无论产物在 [distro channel](./PRFC-0021-distros.zh.md#guide-level-explanation) 之间怎样命名或改名，[resolution](./PRFC-0024-cli-resolution.zh.md#guide-level-explanation) 仍然按产物携带的声明识别 [CLI loader](./PRFC-0024-cli-resolution.zh.md#guide-level-explanation)；文件名只在没有声明处作答，记为理由 `legacy-loader`。

这是整份 RFC 要固定的那条属性。一个靠约定跨包跨机器共享的名字，改名时以三种方式在运行期分别损坏；未来的重做若重新引入按文件名认人，三种坏法的形态就随它回来。旧名是名字还在作答的唯一一处，它只在产品什么都没声明时作答；答案有记录，窗口就能凭证据关闭，名字也不会与声明并排存在。

### 每条通道都带着 loader 发货

> 无论一条 [distro channel](./PRFC-0021-distros.zh.md#guide-level-explanation) 的产品怎样重塑，它仍然带着 [CLI loader](./PRFC-0024-cli-resolution.zh.md#guide-level-explanation)。

丢掉 loader 的通道会无声劈开自己的更新面：platform 与 web 的推送照落，CLI 的推送在记录里腐坏。invariant 是构建期断言所捍卫的东西本身；断言的措辞可以改，属性不能顺手退役。

### 故障要具名

> 无论 [resolution](./PRFC-0024-cli-resolution.zh.md#guide-level-explanation) 是否回退到较次的入口，那次回退仍然是一个具名、记录在案的决定。

回退本身没有问题，一个用自己入口起来的 server 确实强过一个起不来的。缺陷出在那次回退的选择上：它由无人做出、以沉默做出、在最坏的时刻做出。把故障具名，就把「重做时才被发现的损坏」变成「安装时就发现的损坏」。

## Drawbacks
[drawbacks]: #drawbacks

声明的身份是一层新的协议面，要设计、要定版本、要在一整个旧机器生态上信守。过渡窗口让两种拼写同时为真，必须有人记得某台对端答的是哪一个。探测给远端命令增加一次往返。构建期断言让发行更脆——这正是它的目的，代价也是真的：为一个缺失的 loader 红一次发行。

## Rationale and alternatives
[rationale-and-alternatives]: #rationale-and-alternatives

**维持文件名约定的代价**：这个名字早已是协议字段——跨包、跨版本、跨机器——盘点的发现是没人把它当协议管理；约定并不更便宜，账只是延后到运行期结算。

**构建期检查单独不够**：构建检查看见的是一个包的产物，要紧的坏法发生在调用方的拼写与对端的拼写之间。

**一个共享答案**：缺陷的根是每个消费方各自作答；共享答案把「谁弄坏了名字」从一道考古题变成一份声明的 diff。

**不做的代价**：pushed CLI 的重构在口口相传的名字上进行，三种坏法重演一次，这一次由用户发现。

## Prior art
[prior-art]: #prior-art

Node 的 `bin` 映射是声明的入口：包说它安装什么，调用方读映射。Java 的 jar manifest 声明 `Main-Class`，类改名是一道 manifest 编辑，调用方不受影响。Rust 的工具链与版本管理器经 shim 运行，在调用时解析声明的工具，因而扛得住版本替换。systemd 的服务从声明解析 `ExecStart`，二进制缺失是一次具名的启动失败。共同教训：活得过改名的入口都是被声明的。

## Unresolved questions
[unresolved-questions]: #unresolved-questions

几处细节仍然开着，每条都写着它为什么还不能在这里定下。

- 结果名的载体：一个值、一个退出码、一个带类型的错误，或它们的组合。消费方需要一个能记录、能比较的名字；三者中哪一个承载它取决于消费方，而今天 resolver 答一个值、loader 用退出码报告。
- 过渡窗口的长度：一次发行决定，因为只有当携带声明的发布线覆盖到部署关心的机器时，窗口才关闭。
- 对端探测的确切形状：它取决于旧对端能答什么，而清单里没有字段告诉调用方该怎么问。
- 构建期断言失败是硬性的发行失败还是窗口期内的一条警告：断言是新的，发行得先带它一段时间，才知道它有哪些误报。
- symlink 通道的 `PATH` 面变成什么。那个镜像暴露的仍是这条无扩展名链接，重塑它会改变人在那里到达 CLI 的方式。
- 桌面应用何时带上它的 loader。产品今天不带，数据根因此答 `no-loader`；这项改动属于热更新层。

## Future possibilities
[future-possibilities]: #future-possibilities

resolution 可以推广：一次推送的 web 资产与 platform 两半可以按通道断言，如同 loader 在这里被断言，把「半可更新的产品」这一形态彻底关死。对端能力协商——对端声明的不止 loader，还有版本与能力——从本 RFC 引入的探测自然生长。

---

## Changes

### v1.7.0

- 记录有了唯一的 reader，`readHarnessMeta`：那一层答 `none`、`meta`、`broken` 三种，记录的每一副面孔——版本报告、CLI 文件、resolution 的 CLI 一半——都投影到这一个答案上，不再二次读这份文件。resolution 自己那份读法去掉了。
- 故障名从六个收窄到四个：`cli-path-unusable` 与 `cli-file-missing` 并进 `record-unreadable`，出了什么问题随它的 detail 带上——reader 原来分开的那些状态，要的补救相同，都是从 Machines 页重装一次。
- 声明的读法从三种收窄到两种：声明了，或没有。读不出、解析不了的清单等于没有声明——说不出自己身份的产品就没有身份，它得到的答案与前声明时代的产品相同。

### v1.6.0

- 命令 shim 的公开名字改成各自装的东西的名字。CLI loader 的函数叫 `loadCli`，它自己的入口常量叫 `SELF_ENTRY`；resolution 里「调用方自己的入口」这个输入叫 `callerEntry`。shim 的决定叫 `ShimDecision`，装答案名字的字段叫 `answerName`，shim 结果里那句消息叫 `detail`。两个选项叫 `explicitEntry` 与 `runsFromSource`，检出根叫 `checkoutRoot`，launcher 写的数据库路径叫 `databasePath`。
- `CliLaunch` 与它的 `unavailable` 字段保留原名。runtime 把配置对象交给它启动的 platform，platform 可以比发布配置的 runtime 新，这些字段名因此跨版本读取；改名会让旧 runtime 发布的那句话丢失。
- 用例夹具 `PUSHED` 改名为 `RECORD_WITH_CLI`：它是一份带 CLI 一节的记录，不表示发生过推送。

### v1.5.0

- 把答案那一套名字改成「名字说的是它是什么」。三个理由名说的是哪个入口作答：`declared-loader`、`legacy-loader`、`own-entry`。两个「没有推送」的理由 `no-record` 与 `no-pushed-cli` 并成一个——它们答的是同一个入口，差异留在记录的五种状态里。六个故障名说的是哪一块坏了：`record-unreadable`、`cli-path-unusable`、`cli-file-missing`、`declared-loader-missing`、`no-loader`、`cli-unloadable`。
- 概念「安装入口」改名为「产品自己的入口」：源码检出发的是构建出的 CLI，machines 对端只发 loader，桌面发的是打包的 CLI，「installed」只覆盖一部分通道。
- 在首次出现处定义记录、存储、文件与旧名；情形名 `entry-not-respawnable` 改名为 `entry-not-rerunnable`。
- 回答「这台 server 提供哪个 CLI」的那个函数由 `resolveCliLaunch` 改名为 `offeredCli`，不再像是 `resolveCli`（resolution 本身）的变体。

### v1.4.0

- 身份载体改名 `penguin.cliLoader`：字段的名字说的是它做什么——加载 CLI 的那个入口。声明的形状、发现方式与它给出的故障都不变。

### v1.3.0

- resolution 住在命令 shim 模块 `packages/server/src/services/cli-shim.ts` 里，以 `@prismshadow/penguin-server/cli-shim` 发布：一个函数，与早已决定 `penguin` 运行什么的那份代码放在一起；v1.2.0 时为它单开过一份模块。
- 答案带上推送的文件，loader 因此只读一次记录，走的是 shim 用的同一个函数。记录的五种状态与声明的三种答案保留；第二份记录读法与那条投影辅助函数去掉。
- 判定顺序改写成各条：带推送的 CLI 时，调用方自己是 loader 就答它自己，否则答声明的 loader、旧名 loader 或一个故障；不带时，调用方自己的入口运行、理由 `own-entry`，或答记录的故障。

### v1.2.0

- 定下身份的载体：包清单里的 `penguin.cliLoader` 字段，理由与被否掉的两个候选写在「身份的载体」一节。
- 新增声明的参考形状：字段本身、按清单所在目录解析、从入口走到它所属包的清单，以及已声明、缺席、损坏三种答案。
- 新增记录的五种状态，即 resolver 读到的形态：没有记录、读不出、没有 CLI 一节、CLI 路径用不了、路径所指文件已不在。那一层的 reader 保持它那三种答案；resolver 自己读记录，并把答案投影到它那三种上。
- 把判定带进代码：一个 resolver 回答运行哪个入口；CLI loader 按名字报告它的答案，命令 shim 运行它。它位于热更新层之外，以 server 包的子路径发布（见「答案在哪里」）。机器远端命令与推送闸门仍各自作答。
- 机器页按名字读 loader 的失败——这一版引入的具名报告，以及更早发布线发的那两句句子——存储里没有 CLI 的机器因此拿到「在这页重装一次」那句，不论它是哪条发布线装上去的。
- 桌面通道仍然开着：它的产品不带 loader、也不声明 loader，桌面数据根因此答 `no-loader`。关掉它要改桌面包，而桌面包属于热更新层。

### v1.1.0

- 新增 resolution 的判定：四个输入、固定顺序的九步，以及逐情形的表——每种情形一个入口或一个具名故障。
- 新增逐通道的答案：六条通道的产品自己的入口、声明的 loader，以及首启与一次推送之后的答案。
- 新增过渡窗口的处理：旧名只在没有声明处作答，答案记为 `legacy-loader`；声明坏掉时只答它那一份故障。
- 退役 invariant「身份靠声明」，替换为「声明认身份，名字留记录」：原句说身份来自声明或记录，而窗口按旧名作答。

### v1.0.0

- 初始版本（草案，原生于此仓库）。

# PRFC-0024 CLI 解析：每条通道按声明解析要运行的 CLI

[English](PRFC-0024-cli-resolution.md)

- Feature Name: `cli-resolution`
- Start Date: 2026-10-23
- PRFC PR: none yet (native to this repository)
- Implementation PR: —（本 RFC 落地后由它自己的实现 PR 承载）

## Summary
[summary]: #summary

本 RFC 把「这次运行哪个 CLI 入口」收成一个有名字的问题——**resolution**——由每个要跑 harness CLI 的消费方共享：server 启动、机器远端命令、推送闸门、用户可见的命令 shim。resolution 从安装的声明与 [harness meta](./PRFC-0023-harness-meta.zh.md#guide-level-explanation) 作答。每条 [distro channel](./PRFC-0021-distros.zh.md#guide-level-explanation) 的产品都带一个 **pushed-CLI loader**；找不到可用 loader 时，resolution 给出具名故障。答案是带固定顺序的判定过程：记录与声明的每一种状态，各自得出一个入口或一个具名故障。

## Motivation
[motivation]: #motivation

### loader 的身份今天是一个文件名

pushed-CLI loader 的身份今天是一个文件名，靠约定在包、版本与机器之间流传。一份声明能指着它说「这就是 loader」的地方今天不存在；名字在五处被各自拼写——远端命令路径、启动检查、桌面启动器、推送闸门、包的 bin 映射。改名时这些地方以三种方式坏掉：一处响亮地坏，两处无声地坏，全部发生在运行期。这个名字被当作协议字段使用，却没人把它当协议管理。

### 两条通道上推送 CLI 抵达不了

桌面产品不带 loader；Docker 镜像的 `PATH` 入口是一枚无扩展名 symlink，使机制所依赖的可重启启动失效。两条通道上，CLI 的热推送被收进记录、却永不运行，而同一次推送的 platform 与 web 两半照常生效——产品只可半更新，这是最安静的坏法。

### 重构之前先立地基

pushed CLI 的重构就在眼前：改名、改入口形态、改 server 启动方式，每一件都要走过名字那些分散的拼写。resolution 变成一处声明的、共享的答案，重构才有地面可站；让它继续隐含，改名就会以三种停机之一收场。

## Guide-level explanation
[guide-level-explanation]: #guide-level-explanation

### 概念

- **安装入口**——通道产品装下的、一个人会敲的那个 CLI 入口；别的都不知道时运行它。
- **pushed-CLI loader**——加载数据根记录所指那份 CLI 的入口；它本身是安装的产物，并在热推送后存活。
- **resolution**——那个共享的问题「这条命令运行哪个入口」；答案来自安装声明了什么、记录里有什么。

### 每个消费方问的是同一个问题

决定再拉起哪个入口的 server 监督者、决定在对端调用什么的机器远端命令、决定拿哪个 loader 冒烟测候选的推送闸门、决定把什么放上用户 `PATH` 的命令 shim——四个消费方，一个问题。今天它们各自作答，各带一套拼写与回退习惯；本 RFC 给它们一个共享的答案。

### resolution 按固定顺序作答

resolution 先读记录，再读声明。没有记录的数据根运行安装入口，记录损坏是一个故障，带推送 CLI 的记录选出 loader。声明指名了 loader 时答 `pushed`，只有旧名存在时答 `legacy`；既无声明、也没有旧名 loader 的产品答一个故障。每个答案都带着自己的名字，每个消费方记下它据以行动的那个名字。

### 身份靠声明

loader 靠声明亮明身份：一个导出的身份常量、一处包声明，或记录里的一个指针；哪个载体胜出，见下方 Unresolved。resolution 从声明发现 loader。一次保住声明的改名对 resolution 不可见；一次破坏声明的改名在发现点变成具名故障。

### 每条通道都带 loader

每条通道的产品都带一个可加载的 pushed-CLI loader，由发行面在构建期断言。这样一次产品重塑不会无声丢掉加载推送代码的那一半。断言查什么——入口与 loader 在每个产物中都在、都加载——是本 RFC 的主张；发行工作流怎样措辞它的失败，见 Unresolved。

### 故障要具名

找不到可用 loader 的 resolution 在失败点给出具名故障；故障名由 Reference-level 的相应一节定下。随后仍运行一个较次的入口——用安装的 CLI 顶替推送的 CLI——那次回退是一次被记录、具名的决定。「起得来的 server 胜过起不来的」仍然可以作为一种选择存在，不再作为一次事故存在。这样，一次让推送路径无声消失的改名，就变成了安装时可见的报告。

### 跨版本的对端

远端命令靠问来解析对端的 loader：对端声明、调用方读取，过渡窗口内退回旧名。机器活得比安装它的东西久；窗口与探测的形状是下方候选，方向已定——远端命令不再依赖某一方的私有拼写。

## Reference-level explanation
[reference-level-explanation]: #reference-level-explanation

### 四个消费方，一个答案

1. **启动**——能再拉起的 server 向 resolution 要入口，每次拉起都重新问；一次新推送在下次重启时被捡起，无需重装。
2. **机器远端命令**——调用方解析对端声明，不拼硬路径；探测先行，结果在「声明的 loader、旧名、具名拒绝」之间裁决。
3. **推送闸门**——候选推送用接收方安装将来实际运行的那个 loader 做冒烟测试；测的 loader 与将来运行的那个是同一个，闸门才装对了门。
4. **命令 shim**——数据根放到用户 `PATH` 上的东西是 resolution 的答案，敲 `penguin` 的人与监督者拿到同一个入口。

### resolution 的输入与顺序

resolution 收四个输入：调用方自己的入口、数据根、根里那份记录，以及调用方产品携带的声明。它的答案是一个入口加一个理由，或一个故障加一个名字。

1. **自身。** 调用方自己的入口就是 loader 时，resolution 答它自己，理由取它名字应得的那一个：声明的 loader 答 `pushed`，旧名答 `legacy`。这条规则让 loader 不去加载自己。
2. **记录。** [PRFC-0023](./PRFC-0023-harness-meta.zh.md#reference-level-explanation) 的 meta reader 给出记录、没有记录或记录损坏。
3. **没有记录。** 没有记录的根里没有推送的 CLI，安装入口运行，理由 `no-record`。
4. **记录损坏。** 读不出或解析不了的记录答故障 `damaged-record`。
5. **CLI 指针。** 记录里根本没有 CLI 一节，根里就没有推送的 CLI，安装入口运行，理由 `no-pushed-cli`。
6. **指针不可用。** CLI 一节里没有指针、指针为空或形状不合法、或指针解析到 store 之外，答故障 `cli-pointer-unusable`。
7. **指针指向的文件不在。** store 里已经没有了该指针指向的文件，答故障 `cli-bundle-missing`。
8. **声明的 loader。** 产品声明了 loader：目标存在时答这个 loader，理由 `pushed`；目标缺失时答故障 `loader-missing`。
9. **旧名的 loader。** 产品没有声明时，过渡窗口开着且旧名 loader 存在，答那个 loader，理由 `legacy`；既无声明、也无旧名 loader 时，答故障 `loader-absent`。

第一条命中的步骤决定答案，后面的步骤不再读。

### 各情形与答案

| 记录 | CLI 指针 | 声明 | 答案 |
| --- | --- | --- | --- |
| 记录 | 在，文件在 store 里 | 声明的 loader 存在 | 这个 loader——`pushed` |
| 记录 | 在，文件在 store 里 | 声明的 loader 缺失 | 故障 `loader-missing` |
| 记录 | 在，文件在 store 里 | 无声明，旧名 loader 存在，窗口开着 | 旧名 loader——`legacy` |
| 记录 | 在，文件在 store 里 | 无声明，无旧名 loader | 故障 `loader-absent` |
| 记录 | 在，文件不在 store 里 | 任意 | 故障 `cli-bundle-missing` |
| 记录 | 在，指针不可用 | 任意 | 故障 `cli-pointer-unusable` |
| 记录 | 没有 CLI 一节 | 任意 | 安装入口——`no-pushed-cli` |
| 没有记录 | — | 任意 | 安装入口——`no-record` |
| 记录损坏 | — | 任意 | 故障 `damaged-record` |
| 调用方自己就是 loader | — | — | 它自己——`pushed` 或 `legacy` |

存在决定答案；加载成不成是另一份报告。磁盘上存在、加载不了 CLI 的 loader，第一件事就是报 `loader-unloadable`；会做探测的消费方——收下推送之前的推送闸门、发出产物之前的发行断言——在运行任何东西之前把探测失败变成同一个故障。

消费方据答案行动。必须起 server 的监督者在答案是故障时运行安装入口，并记下故障名。loader 在故障上什么都不运行，只把故障报出来；一个人或一条远端命令在没有记录的根上调用它时，它报 `no-record`。远端命令原样转达对端的故障。命令 shim 承载 resolution 的答案，人敲到的入口就是监督者会运行的那个入口。自己入口无法再拉起进程的消费方——`PATH` 上的无扩展名 symlink、经 TypeScript 运行器跑的源跑——在进程内运行 server，并记下 `entry-not-respawnable` 这一情形。

### 各通道的答案

每条通道的产品都装一个入口、声明一个 loader，装配时写下根的第一份记录（[PRFC-0023](./PRFC-0023-harness-meta.zh.md#guide-level-explanation)）。表里逐通道读出 resolution 的答案：首启时与一次推送之后。

| 通道 | 安装入口 | 声明的 loader | 首启 | 推送之后 |
| --- | --- | --- | --- | --- |
| npm 包 | 主 CLI bin | 与它并排的 loader bin | loader——`pushed` | loader——`pushed` |
| 发行 tarball（含 universal） | launcher 脚本 | 安装好的 CLI 对旁边的 loader | loader——`pushed` | loader——`pushed` |
| Docker 镜像 | 今天的无扩展名 symlink；下方改动后是可再运行的入口 | 镜像里的 loader | loader——`pushed`；symlink 入口在重塑之前答 `entry-not-respawnable` | loader——`pushed` |
| 桌面应用 | 打包的 CLI，经外壳的 launch 入口启动 | launch 入口旁边的打包 loader | loader——`pushed`；不带 loader 构建出的产品答 `loader-absent` | loader——`pushed` |
| 源码检出 | 构建出的 CLI；源跑没有可再运行的入口 | 构建出的 CLI 旁边的 loader | 构建跑：loader——`pushed`；源跑：`entry-not-respawnable` | loader——`pushed`；dev 根的装配仍在下方开放 |
| machines 安装出的对端 | loader，它是对端唯一的 CLI 面 | 同一个 loader | loader——`pushed`；从未被推送、也未被本侧安装过的裸 release 答 `no-record` | loader——`pushed` |

远端命令是唯一跨机器解析的消费方：它读对端的声明，调用声明的 loader；早于声明的对端按旧名作答。随后对端自己的 resolution 运行，所以记录损坏的对端报 `damaged-record`，从未收到推送、也从未由另一台机器安装而来的对端报 `no-record`。

### 过渡窗口

旧名是早于声明的产品里 loader 的文件名：`penguin-hmr.js`。resolution 先读声明、再读旧名，且只在没有声明的地方走到旧名。来自旧名的答案记为 `legacy`，窗口在持续期间保持可见。

声明指名了缺失或载不起的 loader 时，只答它那一份故障，旧名不再被读。带坏声明的新产品就是一次损坏的安装，回退会把它掩盖住。

携带声明的发布线覆盖到部署关心的机器时，窗口关闭。此后产品去掉旧名那一支，没有声明的产品答 `loader-absent`。窗口的长度、调用方对端所用探测的确切形状，仍在下方开放。

### 身份的载体（候选）

加载器模块的导出常量；包清单里的声明；harness meta 记录里的指针。三种载体在「过时的实现在哪里响亮失败」上不同。选择留给实现那一轮讨论，只固定一个要求：载体是一份声明，一个读者能查阅的东西。

### 构建期的通道断言（候选）

发行面按产物断言：入口存在，loader 在旁或在内，两者都加载。断言属于发行工作流，因为要抓的失败是跨包的：一个包重塑了入口，随行 loader 在另一个包里被重塑。

### 两条缺口通道

`PATH` 入口是无扩展名 symlink 的那条：入口换成可再运行的形态（真实文件或 launcher），resolution 在那里与别处一样工作。桌面通道：已有一条实现线示范了形态——外壳经一个先问记录、有推送 CLI 就运行它的 launch 入口启动——本 RFC 采纳这个方向，入口的确切形式留给实现。

### 与 PRFC-0023 的分工

resolution 依赖常在：一个可以信任记录存在的 reader，才不需要在缺席处猜。这份 RFC 拥有那条缝：harness meta 陈述根持有什么，resolution 决定运行什么。

## Invariants
[invariants]: #invariants

### 声明认身份，名字留记录

> 无论产物在 [distro channel](./PRFC-0021-distros.zh.md#guide-level-explanation) 之间怎样命名或改名，[resolution](./PRFC-0024-cli-resolution.zh.md#guide-level-explanation) 仍然按产物携带的声明识别 [pushed-CLI loader](./PRFC-0024-cli-resolution.zh.md#guide-level-explanation)；文件名只在没有声明处作答，并记为一次旧名回答。

这是整份 RFC 要固定的那条属性。一个靠约定跨包跨机器共享的名字，改名时以三种方式在运行期分别损坏；未来的重做若重新引入按文件名认人，三种坏法的形态就随它回来。旧名是名字还在作答的唯一一处，它只在产品什么都没声明时作答；答案有记录，窗口就能凭证据关闭，名字也不会与声明并排存在。

### 每条通道都带着 loader 发货

> 无论一条 [distro channel](./PRFC-0021-distros.zh.md#guide-level-explanation) 的产品怎样重塑，它仍然带着 [pushed-CLI loader](./PRFC-0024-cli-resolution.zh.md#guide-level-explanation)。

丢掉 loader 的通道会无声劈开自己的更新面：platform 与 web 的推送照落，CLI 的推送在记录里腐坏。invariant 是构建期断言所捍卫的东西本身；断言的措辞可以改，属性不能顺手退役。

### 故障要具名

> 无论 [resolution](./PRFC-0024-cli-resolution.zh.md#guide-level-explanation) 是否回退到较次的入口，那次回退仍然是一个具名、记录在案的决定。

回退本身没有问题，一个用安装 CLI 起来的 server 确实强过一个起不来的。缺陷出在那次回退的选择上：它由无人做出、以沉默做出、在最坏的时刻做出。把故障具名，就把「重做时才被发现的损坏」变成「安装时就发现的损坏」。

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

几处细节留待实现或后续修订。

- 身份载体：导出常量、包清单、记录指针，或它们的组合。
- 结果名的载体：一个值、一个退出码、一个带类型的错误，或它们的组合。
- 过渡窗口的长度与对端探测的确切形状。
- 构建期断言失败是硬性的发行失败，还是窗口期内的一条警告。
- 两条缺口通道的确切入口形态：桌面 launch 入口的摆位，symlink 通道的 `PATH` 面变成什么。

## Future possibilities
[future-possibilities]: #future-possibilities

resolution 可以推广：一次推送的 web 资产与 platform 两半可以按通道断言，如同 loader 在这里被断言，把「半可更新的产品」这一形态彻底关死。对端能力协商——对端声明的不止 loader，还有版本与能力——从本 RFC 引入的探测自然生长。

---

## Changes

### v1.1.0

- 新增 resolution 的判定：四个输入、固定顺序的九步，以及逐情形的表——每种情形一个入口或一个具名故障。
- 新增逐通道的答案：六条通道的安装入口、声明的 loader，以及首启与一次推送之后的答案。
- 新增过渡窗口的处理：旧名只在没有声明处作答，答案记为 `legacy`；声明坏掉时只答它那一份故障。
- 退役 invariant「身份靠声明」，替换为「声明认身份，名字留记录」：原句说身份来自声明或记录，而窗口按旧名作答。

### v1.0.0

- 初始版本（草案，原生于此仓库）。

# PRFC-0024 CLI 解析：每条通道按声明解析要运行的 CLI

[English](PRFC-0024-cli-resolution.md)

- Feature Name: `cli-resolution`
- Start Date: 2026-10-23
- PRFC PR: none yet (native to this repository)
- Implementation PR: —（本 RFC 落地后由它自己的实现 PR 承载）

## Summary
[summary]: #summary

本 RFC 把「这次运行哪个 CLI 入口」收成一个有名字的问题——**resolution**——由每个要跑 harness CLI 的消费方共享：server 启动、机器远端命令、推送闸门、用户可见的命令 shim。resolution 从安装的声明与 [harness meta](./PRFC-0023-harness-meta.zh.md#guide-level-explanation) 作答。每条 [distro channel](./PRFC-0021-distros.zh.md#guide-level-explanation) 的产品都带一个 **pushed-CLI loader**；找不到可用 loader 时，resolution 给出具名故障。

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

### 身份靠声明

loader 靠声明亮明身份：一个导出的身份常量、一处包声明，或记录里的一个指针；哪个载体胜出，见下方 Unresolved。resolution 从声明发现 loader。一次保住声明的改名对 resolution 不可见；一次破坏声明的改名在发现点变成具名故障。

### 每条通道都带 loader

每条通道的产品都带一个可加载的 pushed-CLI loader，由发行面在构建期断言。这样一次产品重塑不会无声丢掉加载推送代码的那一半。断言查什么——入口与 loader 在每个产物中都在、都加载——是本 RFC 的主张；发行工作流怎样措辞它的失败，见 Unresolved。

### 故障要具名

找不到可用 loader 的 resolution 在失败点给出具名故障。随后仍运行一个较次的入口——用安装的 CLI 顶替推送的 CLI——那次回退是一次被记录、具名的决定。「起得来的 server 胜过起不来的」仍然可以作为一种选择存在，不再作为一次事故存在。这样，一次让推送路径无声消失的改名，就变成了安装时可见的报告。

### 跨版本的对端

远端命令靠问来解析对端的 loader：对端声明、调用方读取，过渡窗口内退回旧名。机器活得比安装它的东西久；窗口与探测的形状是下方候选，方向已定——远端命令不再依赖某一方的私有拼写。

## Reference-level explanation
[reference-level-explanation]: #reference-level-explanation

### 四个消费方，一个答案

1. **启动**——能再拉起的 server 向 resolution 要入口，每次拉起都重新问；一次新推送在下次重启时被捡起，无需重装。
2. **机器远端命令**——调用方解析对端声明，不拼硬路径；探测先行，结果在「声明的 loader、旧名、具名拒绝」之间裁决。
3. **推送闸门**——候选推送用接收方安装将来实际运行的那个 loader 做冒烟测试；测的 loader 与将来运行的那个是同一个，闸门才装对了门。
4. **命令 shim**——数据根放到用户 `PATH` 上的东西是 resolution 的答案，敲 `penguin` 的人与监督者拿到同一个入口。

### 身份的载体（候选）

加载器模块的导出常量；包清单里的声明；harness meta 记录里的指针。三种载体在「过时的实现在哪里响亮失败」上不同。选择留给实现那一轮讨论，只固定一个要求：载体是一份声明，一个读者能查阅的东西。

### 过渡窗口（候选）

早于声明存在的机器按旧名作答；调用方先试声明的身份，窗口期内退回旧拼写；携带声明的发布线覆盖到部署关心的机器时，窗口关闭。长度与探测形状是实现问题，两步形状——新名优先、旧名仍认——记为候选。

### 构建期的通道断言（候选）

发行面按产物断言：入口存在，loader 在旁或在内，两者都加载。断言属于发行工作流，因为要抓的失败是跨包的：一个包重塑了入口，随行 loader 在另一个包里被重塑。

### 两条缺口通道

`PATH` 入口是无扩展名 symlink 的那条：入口换成可再运行的形态（真实文件或 launcher），resolution 在那里与别处一样工作。桌面通道：已有一条实现线示范了形态——外壳经一个先问记录、有推送 CLI 就运行它的 launch 入口启动——本 RFC 采纳这个方向，入口的确切形式留给实现。

### 与 PRFC-0023 的分工

resolution 依赖常在：一个可以信任记录存在的 reader，才不需要在缺席处猜。这份 RFC 拥有那条缝：harness meta 陈述根持有什么，resolution 决定运行什么。

## Invariants
[invariants]: #invariants

### 身份靠声明

> 无论产物在 [distro channel](./PRFC-0021-distros.zh.md#guide-level-explanation) 之间怎样命名或改名，[resolution](./PRFC-0024-cli-resolution.zh.md#guide-level-explanation) 仍然按声明或记录识别 [pushed-CLI loader](./PRFC-0024-cli-resolution.zh.md#guide-level-explanation)。

这是整份 RFC 要固定的那条属性。一个靠约定跨包跨机器共享的名字，改名时以三种方式在运行期分别损坏；未来的重做若重新引入按文件名认人，三种坏法的形态就随它回来。

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
- 过渡窗口的长度与对端探测的确切形状。
- 构建期断言失败是硬性的发行失败，还是窗口期内的一条警告。
- 两条缺口通道的确切入口形态：桌面 launch 入口的摆位，symlink 通道的 `PATH` 面变成什么。

## Future possibilities
[future-possibilities]: #future-possibilities

resolution 可以推广：一次推送的 web 资产与 platform 两半可以按通道断言，如同 loader 在这里被断言，把「半可更新的产品」这一形态彻底关死。对端能力协商——对端声明的不止 loader，还有版本与能力——从本 RFC 引入的探测自然生长。

---

## Changes

### v1.0.0

- 初始版本（草案，原生于此仓库）。

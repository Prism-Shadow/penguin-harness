# PRFC-0023 Harness Meta：每个数据根都带着自己那份 harness 记录

[English](PRFC-0023-harness-meta.md)

- Feature Name: `harness-meta`
- Start Date: 2026-10-23
- PRFC PR: none yet (native to this repository)
- Implementation PR: —（本 RFC 落地后由它自己的实现 PR 承载）

## Summary
[summary]: #summary

本 RFC 把 **harness meta** 立为每个数据根必备的一部分：根内的 `hmr/harness.json` 这个文件，记录这个根当前持有哪一份 harness——platform、CLI、web 与 assets。每条 [distro channel](./PRFC-0021-distros.zh.md#guide-level-explanation) 装配数据根时，把产品自带的 harness 镜像铺成根的初始记录，这次装配就是一次自推送。读取面只有一个肯定结果——记录的路径与内容——其余每种情况都以具名错误抛出，其中没有记录与记录损坏各是一个名字。

## Motivation
[motivation]: #motivation

### 装配数据根时没有谁写下这份记录

现状里，写 harness meta 的只有两个事件：收到一次热推送，或 machines 功能从对端安装时复制发送方的记录。其余通道的根起手就没有这个文件，代价立刻出现：昨天刚装好的机器上，推送 CLI 加载器答「没有推送过」；版本报告降级成更少的事实；一台既没被推送、也没从对端装过的机器，远端命令整体不可用。

### 原料早已随产品发行

发行 tarball 与桌面应用已经带着一份自己构建的完整 harness 镜像，格式与推送一致。产品把它铺在自己旁边，供机器安装使用，刻意不铺进数据根。所以「常在」缺的是「装配时把它写下来」这个决定，材料早已到了每台机器门口。

### 读取面保持一个成功与具名失败

HMR 层落地时定下一条判据：缺记录与坏记录是两件不同的事实，读取面各自按自己的名字作答。常在会重新定义「缺席」，所以本 RFC 先固定读取面：一个肯定结果，记录本身，以及其余每种情况的具名错误。随后装配从根存在的第一刻起写下记录。

## Guide-level explanation
[guide-level-explanation]: #guide-level-explanation

### 概念

- **Harness meta**——数据根里的那份记录，说明这个根当前持有哪一份 harness：文件 `hmr/harness.json`，内含指向 platform、CLI、web assets 的内容寻址指针，连同它们的 provenance。
- **Harness data root**——每台机器的数据根，存放 harness 的状态与 store；[distro channel](./PRFC-0021-distros.zh.md#guide-level-explanation) 装配的就是它。
- **读取面（the meta reader）**——harness meta 唯一的读取入口。它有一个肯定结果：记录本身——根下 `hmr/harness.json` 的路径，连同它承载的内容。其余每种情况都是一个具名错误，其中两类是调用方要分辨的：**没有记录**（这个根还没有记录：从未装配过 harness）、**记录损坏**（记录在，读不出或解析不了）。

### 装配即自推送

通道装配一个数据根时，把产品自带的 harness 镜像铺成该根的初始记录，provenance 记为「由这条通道安装」。在读取面上，它与推送来的记录相同：答出它找到的那份记录，机器的推送 CLI 面从第一刻起可用；第一次热推送照常替代它。

### 常在之后，「没有记录」说什么

「没有记录」的居所从新装机器收窄到从未装配过的根——一个被人把 harness 指过去的裸目录，或一次写不进去的装配。两类错误各留自己的名字。一个装配过、从未被推送的根，用 provenance 说「由通道 X 安装、从未被推送」，并且照常答出它的记录。

### 常在不管入口

记录只说这个根持有什么。它不说哪个程序来启动 harness——根里这份 harness 由服务它的那份安装启动，用的是那个安装自己程序目录里的程序。dev 根带着安装记录，照旧以 dev 的方式启动；桌面外壳照旧以自己的方式起 server。

## Reference-level explanation
[reference-level-explanation]: #reference-level-explanation

### 记录的位置

记录是一个文件：数据根内的 `hmr/harness.json`。数据根就是 `PENGUIN_HOME` 指的那个目录，未设时是 `~/.penguin/data`。记录指向的 blob 活在它旁边的 `hmr/store/` 下，记录内的每个指针都相对 `hmr/`。

这个相对路径在每条通道上都成立。通道之间不同的是「哪个目录算数据根」：tarball、npm 与源码三条通道用上面那个目录，Docker 镜像用它挂载的卷，桌面应用用它自己的 profile 目录，machines 对端用它被安装进去的根。数据根由通道选定，根内的布局由本 RFC 固定。

### 记录的最小形状

三类 payload 加 assets 的内容寻址指针；一个 provenance 字段，分辨 installed（并记由哪条通道安装）与 pushed；一个「已装配、从未推送」的标记，让收窄后的缺席仍可表达。字段的精确形状留给实现；本 RFC 固定读取面的契约：一个固定路径上的文件、一个肯定结果、provenance 可读。

### 一个肯定结果，两类具名失败

读取面交出记录，或者抛出。两类情况各带自己的名字：**没有记录**（这个根在该路径上没有东西），**记录损坏**（文件在，读不出或解析不了）。每个错误都点名它找过的文件。调用方按这两个名字分支；任何合并两者、或在缺席处猜的读取面，都在无声回退这个面已落库的判据。常在让「没有记录」这一类变少，同时让它留在原地：从未装配过的根仍然存在，它们与记录受损的根仍然可区分。

### 装配写初始记录

逐通道：tarball 的安装脚本与桌面的首启把产品已带的镜像铺下去；npm 包与 Docker 镜像在构建时得到一份自己构建的镜像，以同样方式铺下；machines 对端保持安装时复制发送方的记录。每份手工安装的 release 从此自带预装配。写不进记录的装配在那一刻抛出自己的具名故障。只读或不可写介质的处置留给实现。

### 一个 store，镜像只在途中（候选）

今天 release 镜像与 checkout 镜像作为平行 store 活在数据根自己的 store 旁边。装配写下初始记录之后，这些镜像成为一次性输入：通道镜像只在装配时被复制，数据根的 store 是唯一存活的 store。镜像同批退役还是稍后退役，本文档不裁定，记为候选。

### store 健康可观测（候选）

记录的文件可能就地损坏。读取面被问到时能点名损坏，但今天没有哪条通道主动去问，版本报告把「没有记录」与「记录损坏」并成一个耸肩。记录常在后，健康值得浮出：首启与版本面点名记录损坏，让降级可见。载体与阈值留白，方向记为候选。

### 本 RFC 之后各通道的侧面

每条通道的**数据根**侧面变成「装配时即带 meta」；machines 对端保持安装即复制，没有新增；自带镜像的两条通道从「只为机器安装携带」变成「也为自己携带」。

## Invariants
[invariants]: #invariants

### Meta 常在

> 无论一条 [distro channel](./PRFC-0021-distros.zh.md#guide-level-explanation) 怎样装配一台机器，它装配出的 [数据根](./PRFC-0023-harness-meta.zh.md#guide-level-explanation) 从存在的第一刻起就带着 [harness meta](./PRFC-0023-harness-meta.zh.md#guide-level-explanation)。

这是整份 RFC 要铺的那条底线，按「通道的属性」声明：无论一条通道对一台机器做了什么，它留下的机器，其根上写着「自己持有什么」。未来的通道若带着不写记录的产品发行，就破了本 RFC。

### 两件失败各有其名

> 无论 meta 从哪条路径出现——装配、推送还是恢复——[读取面](./PRFC-0023-harness-meta.zh.md#guide-level-explanation) 交出记录本身，每一类失败的读取带着自己的名字回来：没有记录与记录损坏各算一个。

这两个名字早于本 RFC，也要活得比它久。常在把「没有记录」收窄到从未被装配的根，把「记录损坏」留成装配或文件损坏可能造出的故障。合并两者的读取面，会对一个记录受损的调用方答「从来没推送过」——那句回答悄悄丢掉这个根仍然持有的一个版本。

### 记录描述，安装启动

> 记录只说一个根持有什么。它不说哪个程序来启动 harness，记录里也没有任何字段写这个。

一份写明启动程序的记录，会让每条通道的 launcher 沦为记录的仆人，让每个 dev 根被自己安装的镜像扣为人质——而且这个名字根本写不成对所有读者都对的一份：启动的程序活在每份安装自己的目录里，记录却可能被站在任何布局上的读取方读到。能旅行的是 harness 本身：内容寻址的 bundle，相对记录存放，由服务这个根的那份安装用它自己的程序加载。保住这条缝，本 RFC 才能铺自己的底线。

## Drawbacks
[drawbacks]: #drawbacks

常在要求在记录里放一个「已装配、从未推送」的标记，这是缺席曾经免费提供的语义。装配开始写盘，引入只读介质与权限这类失败面，必须处置。每个装配出的根存下一整套可能用不上的 harness 负载，在小机器上是实在的空间。dev 检出会多出一份记录，对一条刻意保持 dev 根干净的通道是行为变化。

## Rationale and alternatives
[rationale-and-alternatives]: #rationale-and-alternatives

**维持「坏了再修」的代价**：裸装后被 adopt 的机器今天远端命令全断，用户在没有修复可达之前就付了成本。

**常在优于缺席处探测**：在根无记录时去探测产品镜像的 reader 会把「没有记录」与「记录损坏」合并，正好犯下已落库判据禁止的混同。

**读取面只读一个文件**：它读根下的 `hmr/harness.json`，别处不读，所以记录只存在于镜像里的机器没有可据以行动的记录。

**不做的代价**：新装的机器，远端命令面没有记录可读——正是常在要关掉的那片静默。

## Prior art
[prior-art]: #prior-art

内容寻址 store（git 的对象库、Nix store）与其索引同生，「仓库里没有对象」与「对象文件损坏」是两句不同的话。包管理器从安装那一刻起就带着已安装状态库：dpkg 的库是安装创建的，安装之后一直在。浏览器与编辑器在首启时初始化一份完整 profile，把缺席当作一种诊断。共同形状是：机器持有什么的记录随着机器的装配诞生。

## Unresolved questions
[unresolved-questions]: #unresolved-questions

几处细节留待实现或后续修订。

- provenance 与「从未推送」标记的确切字段形状。
- 写不进的装配如何处置：具名故障加降级运行，还是硬拒绝。
- 两类具名错误的载体：错误类型、错误码，还是两者兼有。
- 镜像安装 image 随本 RFC 一起退役，还是后一步动作。
- store 健康可观测的载体与阈值。
- dev 检出按同一规则装配它的 dev 根，还是一条文档化的例外；它的记录存在，本 RFC 不裁定 dev 工具怎样呈现它。

## Future possibilities
[future-possibilities]: #future-possibilities

每个根都有记录之后，升级对账可以只走记录：plan-over 与 sameBuild 的比较只读一个文件、只处理一类例外。机器 adoption 变成即时的，手工安装的 release 可以被 adopt 并直接驱动。provenance 字段可以喂给一个可见面——「由通道 X 安装、在 T 时被推送」——在一切展示版本事实的地方。

---

## Changes

### v1.2.0

- 把 invariant「记录不决定入口」改写为「记录描述，安装启动」：记录只说一个根持有什么，不说哪个程序来启动 harness。原先的措辞把决定推迟给一份 resolution RFC（PRFC-0024，已撤——这个问题自己就答了：服务这个根的那份安装，启动它自己的程序）。

### v1.1.0

- 记录有了固定位置：数据根内的 `hmr/harness.json`，它的 blob 就在旁边的 `hmr/store/` 下。
- 读取面只有一个肯定结果——记录的路径与内容——其余情况以具名错误抛出，没有记录与记录损坏各是一个名字。据此退役 invariant「缺席仍是一个答案」，换成「两件失败各有其名」。
- distros 的引用改指它现在的编号 PRFC-0021。

### v1.0.0

- 初始版本（草案，原生于此仓库）。

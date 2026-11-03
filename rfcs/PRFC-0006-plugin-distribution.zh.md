# PRFC-0006 插件的分发与安装

[English](PRFC-0006-plugin-distribution.md)

> **来源**：设计仓 [penguin-harness-design](https://github.com/Prism-Shadow/penguin-harness-design) 的 `rfcs/PRFC-0006-plugin-distribution.md`——草案，见设计 PR [#244](https://github.com/Prism-Shadow/penguin-harness-design/pull/244)（draft）。
> **修订**：v1.0.0（迁入主仓，取草案当前版本）；本面的约定见 [README.zh.md](README.zh.md)，逐版本改动记在文末 `## Changes`。

- Feature Name: `plugin_distribution`
- Start Date: 2026-10-01
- PRFC PR: [Prism-Shadow/penguin-harness-design#244](https://github.com/Prism-Shadow/penguin-harness-design/pull/244)
- Implementation PR: [Myriad-Dreamin/penguin-harness#92](https://github.com/Myriad-Dreamin/penguin-harness/pull/92)（下载、加载、索引）、[Myriad-Dreamin/penguin-harness#98](https://github.com/Myriad-Dreamin/penguin-harness/pull/98)（渠道）

## Summary

[summary]: #summary

定下插件从**发布**到**在一台机器上被加载**的整条线：有哪几条分发渠道、每条带什么；一个插件怎样被装上、卸下、在机器上存放在哪里、怎样被找到；哪些步骤必须是原子的；以及整条线上被比较的那一个校验值。

- 只有一种插件：一个 npm 包，**贡献**东西——给 Agent 贡献 Skill 与钩子，给 harness 贡献 Module，一个插件可以两者都有。它在每台机器上以解压好的包留在它到达的 prefix 里：安装目录的、热推送资产的、或数据根的；加载时在运行中构建的 prefix 与数据根的 prefix 之间按插件表挑一份，不论它贡献什么。
- 能装什么，首先问**目录**（penguin-plugins 发布的索引）；联网不了时退到每条渠道都带的**构建索引**。安装物、热推送与源码检出同时**携带**插件包，npm 上的 CLI 包只带索引，启用时从 registry **下载**。
- 插件只经插件页的「安装」进入一台机器；插件表永远不指名一个不在机器上的包；下载与替换都是先解压、再改名放入、最后删旧，崩溃后不联网即可恢复。
- 发布一次版本是一组 npm 发布加一组目录条目：先预检全部、再按依赖顺序发布、可重跑续上，目录条目在 npm 发布全部成功之后才加。
- 校验值就是 npm 的 `dist.integrity`。

## Motivation

[motivation]: #motivation

起点是「Web UI 上装不上沙盒」。查下来是一串分发缺口，2026-10-01 之前的状态如下：

- **渠道带的东西不一样。** 贡献 Module 的插件只随桌面端与热推送到达；CLI 安装包、npm、Docker 都不带；四个沙盒后端是 private，npm 上不存在。
- **一台机器上有四个查找位置。** 数据根下 npm 装进去的目录、热推送资产里的插件目录、安装目录旁的插件目录、程序自身的依赖。同一个包落在哪一处、是哪一份内容，要逐处试过才知道；也没有任何地方删除旧内容。
- **目录不说真话。** 插件页在每条渠道上都列出全部后端，点安装才得到 `plugin_not_shipped` 或 npm 的 E404。
- **校验值三处三算。** 构建、服务端现取、索引仓库各用一套安装规则展开依赖再算 hash，带依赖的包（`sandbox-dsh`）在本地 registry 上实测 `plugin_integrity_mismatch`。
- **发布不是原子的。** 0.2.13 的发布循环按字母序逐个发包，到一个 npm 从未见过的名字才失败，前面的已经发出去了。
- **设计彼此矛盾。** [design#232](https://github.com/Prism-Shadow/penguin-harness-design/pull/232) 写「每种分发都带完整的随包插件目录、安装从不下载」，PRFC-0003 写「装进 `<root>/plugins/`」，roadmap #6 的提案 #11（组织提案账本）写「一个插件仓、三个来源、registry 现取」。

场景：

- 安装包用户在插件页启用 `sandbox-bwrap`：安装物带着它，启用不联网。
- npm 全局安装的用户启用同一个插件：CLI 包带的索引里有它，服务端从 registry 下载、核对、解压放入数据根，再装配。
- 一台机器被热推送：推送带来的插件与插件库替换旧的，下一次装配生效；新推送不再携带、仍有 Project 在用的插件，在旧资产被清理之前收留到数据根。
- 第三方作者把 `@acme/sandbox-firejail` 发到 npm 并在 penguin-plugins 提交条目；任何渠道的用户都能从目录装它。
- 一次发版在中途因网络失败：重跑同一个 tag，已经在 npm 上的跳过，从断点续上；目录条目还没有加。

## Guide-level explanation

[guide-level-explanation]: #guide-level-explanation

### 插件

一个插件就是一个 npm 包（`plugins/<dir>` 发布为 `@penguinharness/<dir>`），它**贡献**东西：

- 给 **Agent** 贡献 Skill 与钩子：用户把它装到某个 Agent 上，Agent 拿到一份副本；
- 给 **harness** 贡献 Module（沙盒后端、消息连接器、语言……）：Project 的 `[plugins]` 表点名它，进程在装配时加载。

一个插件可以两者都贡献。分发与安装只看包，不看它贡献什么：到达、校验、放入、加载都是同一条线。

**插件自己打包自己：它的 tarball 就是它的全部。** 插件要用的代码在构建时打进它自己的包里；宿主的 SDK（`@prismshadow/penguin-core`）由正在运行的程序提供。我们不安装插件声明的依赖：依赖碰巧被 npm 装到插件旁边时也许能用，但不承诺。

### 渠道

每一份构建都带一个**随包插件目录**：`build-plugins` 把这次构建要带的每个插件用 `pnpm pack` 打包一次，算出 integrity，再把这份 tarball 解压进一个 npm prefix，并写下构建索引。

```
plugins/
  index.json                         构建索引：每个插件的 name / version / integrity
  node_modules/<名>/{.integrity, package.json, …}
                                     解压好的插件包；.integrity 记着它那份 tarball 的 integrity
```

打出的 tarball 就是发布到 npm 的那一份；它只在构建与发版时存在，不随渠道下发。

| 渠道                                  | 随包插件目录                                                        | 带插件包           |
| ------------------------------------- | ------------------------------------------------------------------- | ------------------ |
| CLI 安装包（含 OSS 镜像、一行安装器） | `lib/plugins/`                                                      | 带                 |
| 桌面端                                | 应用目录的 `plugins/`                                               | 带                 |
| Docker 镜像                           | `/opt/penguin/lib/plugins/`                                         | 带                 |
| 热推送                                | 推送资产里的 `plugins/`，每个包一个 archive，到达后解压一次         | 带                 |
| 源码检出（开发）                      | `packages/cli/plugins/`、`packages/server/plugins/`，由开发构建写下 | 带（本地构建的包） |
| npm（`@prismshadow/penguin-cli`）     | 包内的 `plugins/`，只有 `index.json`                                | 不带               |
| Machines 远程安装                     | 跟随它选的那一路                                                    |                    |

服务端在程序入口的上一级找它；有热推送时用推送资产里的那一份。构建没带、Project 又要的插件，从 registry 下载到数据根的 `plugins/`。

### 一台机器上的样子

```
<安装目录>/plugins/                    随安装物到达，跟着安装物升级
<数据根>/hmr/store/assets/<sha>/.unpacked/plugins/
                                        随热推送到达，跟着热推送保留与清理
<数据根>/plugins/                       从 registry 下载的插件
  node_modules/<名>/{.integrity, package.json, …}
  .staging/                             下载、解压、替换的暂存
<Project>/.project_config.toml          [plugins]：这个 Project 要哪些插件
```

三处都是同一种 npm prefix，每个插件就是 `node_modules/<名>/` 下解压好的包。插件留在它到达的那一处，不复制（收留 H 除外）。加载时看两处：运行中构建的（有热推送时是推送资产的，否则是安装目录的）与数据根的。

### 安装、卸载、管理

- **安装**（插件页，管理员）：`POST /api/projects/:p/plugins/installed { specifier, machineId?, integrity? }`。本机要运行、本机又没有的包，先下载到数据根，**到位之后**才写插件表、再重新装配。下载不到时插件表与运行中的 App 都不变。
- **卸载**：`DELETE` 只改表；下一次装配不再加载它。
- **整表**：`PUT` 只收本机已有的纯包名，用于机队同步；安装只有 `POST` 一条路。
- **版本与钉住**：`pkg@1.2.3` 记为 Project 的要求；表里可写 `name = { version, integrity }` 钉住某个内容。
- **按机器**：只列给别的机器的插件，本机既不下载也不加载，由那台机器在表同步过去时自己 `POST`。

## Reference-level explanation

[reference-level-explanation]: #reference-level-explanation

### 术语

- **插件**：一个 npm 包。它的身份是名字、版本与 integrity 三样。
- **integrity**：一份插件包内容的指纹，用来回答「这是不是那个包」。定义见下一节。
- **索引**：一张「有哪些插件可以装」的表。每一**行**写一个插件的名字、版本、integrity，以及描述、许可、分类等说明性字段。
- **构建索引**：一次构建写下的索引，列出这次构建发布或携带的插件，放在随包插件目录里的 `index.json`。
- **目录**：仓库 penguin-plugins 每晚发布的索引，收录可以从 registry 安装的插件，包括第三方的。
- **registry**：npm 的包仓库（缺省为 registry.npmjs.org，遵从机器上的 npm 配置）。
- **prefix**：一个放插件的目录，形如 npm 的 prefix：`node_modules/<名>/` 下是解压好的包，包里的 `.integrity` 记着它来自哪一份 tarball。一台机器上有三个：安装目录的、当前热推送的、数据根的。
- **随包插件目录**：一份构建随身带的 prefix 加上构建索引（npm 上的 CLI 包只有索引）。见「渠道」。
- **携带**与**列出**：构建索引里的一行，它的包就在随包插件目录里，叫构建**携带**这个插件；只在索引里、目录里没有包，叫只**列出**。
- **下载**：从 registry 取回一个插件的 tarball，核对后解压进数据根的 prefix。
- **插件表**：Project 的 `.project_config.toml` 里的 `[plugins]` 表，写这个 Project 要哪些插件、要什么版本；可以带机器限定。
- **提交点**：一步操作里让外界看到变化的那次改名（rename）。

### Integrity

- 定义：npm 自己的 `dist.integrity`——上传到 registry 的那个 tarball 文件，对它的字节算 sha512，写成 `sha512-<base64>`。它覆盖的就是插件包；插件自己打包自己，所以这也就是插件的全部。任何人都能用 `npm view <名>@<版本> dist.integrity` 核对。
- **我们只在一个地方算它：发版时，对将要上传的那份 tarball。** 打包一次、算值、上传这份文件本身，不让发布命令重新打包——不同的打包工具选出的文件一样（都遵守 `files` 与 `.npmignore`），字节却不一样。每条渠道的构建与发版用同一种方式打包（包括放进仓库的 LICENSE），所以随包插件的 integrity 与 npm 上的一致。第三方插件一律用 registry 上的值，不重算。
- 怎样核对：下载来的 tarball 解压之前对它的字节算 sha512，与索引那一行比，不一样就拒绝（`plugin_integrity_mismatch`），机器上什么都不留。随包插件与程序是同一份构建，内容由安装物或热推送的内容寻址保证，不在运行时重算。
- 解压之后 tarball 就丢掉，所以 integrity 记在包目录里的 `.integrity`。钉住某个内容，比的就是它；没有 `.integrity` 的包（更早用 `npm install` 装进数据根的）照常能按版本加载，但不能满足钉住。

### 索引与目录

- 一个插件能不能装、装哪一份，看索引。没有 integrity 的行照列，但不能下载，并写明原因。
- 索引有三个来源，按先后合并：**目录**、**构建索引**、数据根里已下载的。同一份内容（同名、同版本、同 integrity）只列一条，说明性字段取先列出的那一份；同名同版本而内容不同的，各列一条；被撤下（yanked）的不列。目录取不到（离线、超时）时，列表只由后两者组成，并写明哪个来源读不到。
- 选哪一份内容：表里钉了 integrity 的只取那一份；否则取满足版本要求的最高版本，同一版本里构建携带的那一份优先，因为它不用联网。
- 插件页一个名字一行，显示此刻装上会取的那一份。
- npm 上的 CLI 包里的 `plugins/index.json`，是这次构建索引中会发布到 npm 的那些行（不含 private）。
- penguin-plugins 的条目在 `packages/[<@scope>/]<桶>/<名>/<版本>/<key>/`，含 `manifest.toml` 与 `package-lock.json`，`integrity` 就是 npm 的 `dist.integrity`；桶取名字的前四个字符分两级，插件多时一个目录也不会堆满包名。条目路径不许移动，已收录的内容只能撤下、不能原地改。

### 加载

- **挑**：把所有 Project 的插件表（以及只给本机的那部分）对每个名字的要求合在一起，在运行中构建的 prefix 与数据根的 prefix 里这个名字的包之间，按「索引与目录」里的选法挑一份。版本要求只认常见的几种写法（`*`、精确版本、`^`、`~`、比较符、用空格连接的「并且」）。挑不出来的插件带原因报出来，插件页照常显示。
- **什么时候**：每次装配插件之前——第一次启动、热推送、插件页改动之后——都走这同一步；它之前先做数据根的恢复（R）与收留（H）。
- **导入**：从挑中的包目录按它 `package.json` 的 `exports` 或 `main` 导入。插件说明文档（readme）也从包目录读。
- **插件依赖宿主的 SDK**：插件运行时要用到 `@prismshadow/penguin-core`，而插件包里不带它；这时从正在运行的程序里找。

### 算法与原子性

**在一台机器上：任何时候读到的，要么是完整的旧状态，要么是完整的新状态；删掉任何东西之前，机器上已经有另一份完整的本地副本，恢复不需要联网。** 做法是：先解压到 `.staging/`，再用同一文件系统里的改名把它放进 `node_modules/`，最后才删旧的。

不变量：

1. `node_modules/<名>/` 一经放入就不再改动，只会被整个换掉。
2. 插件表只写机器上已有的插件：先下载、放入，再写表。
3. 数据根的 prefix 只由服务端写；一个数据根只有一个服务端进程（`server.lock`），进程内的下载、放入、恢复与收留在同一个队列上依次进行。

**D. 下载**（给定索引那一行：名字、版本、integrity）

1. 在 `plugins/.staging/` 下建临时目录，用 `npm pack <名>@<版本>` 把 registry 上的 tarball 取到里面（npm 的 registry、代理、认证配置照常生效）。npm 用的是 `PATH` 上的那个，最后补上运行中 Node 所在的目录（Windows 上是 `npm.cmd`，经 cmd.exe 调用，参数逐个加引号，加不了引号的拒绝）。
2. 对 tarball 的字节算 sha512，与 integrity 比较；不同就拒绝（`plugin_integrity_mismatch`），删掉临时目录。
3. 解压到 `plugins/.staging/u-<随机>/package/`（去掉 tarball 顶层的那一级），写 `package/.integrity`。插件声明的依赖不安装。
4. 放入（P），然后删掉临时目录与 tarball。

**P. 放入**（给定 `.staging/u-…/package/` 与名字）

1. `node_modules/<名>` 不存在：把 `u-…/package` **改名**为它，结束。
2. 已存在：先把它改名为 `.staging/d-<随机>/package`，再把 `u-…/package` **改名**为 `node_modules/<名>`。
3. 删掉 `d-…` 与 `u-…`。

**R. 恢复**（每次装配之前，不联网）

1. `.staging/d-…/package` 还在：它的 `package.json` 写着名字；`node_modules/<名>` 不存在（P.2 的两次改名之间崩溃）就把它改名回去，否则删掉它。
2. 其余的 `.staging/` 内容（下载到一半、解压到一半、已放入后剩下的空目录）都删掉。

**H. 收留**（每次装配之前）：热推送只保留最近的几份资产，旧的那份会被删掉。插件表要的某个插件，若此刻只能在**不是当前**的那些资产目录里找到满足要求的包，就把它复制到 `plugins/.staging/u-<随机>/package/`，再按 P 放入数据根——之后旧资产目录被删，这个插件也不需要再下载。

**L. 加载**：按「加载」一节挑出每个名字的包目录，导入。

崩溃发生在各处会留下什么：

| 崩溃发生在                | 磁盘上留下                                     | 之后                       |
| ------------------------- | ---------------------------------------------- | -------------------------- |
| D.1–D.3、H 的复制         | `.staging/` 里的临时目录或 `u-…` 半成品        | R.2 删除；插件表还没写     |
| P.1 或 P.2 第二次改名之后 | 新包已在位，`.staging/` 有残留                 | R.2 删除                   |
| P.2 两次改名之间          | `node_modules/<名>` 缺失，旧包在 `d-…/package` | R.1 改名回去，旧包照常加载 |

**保证的边界**：防进程崩溃与被杀，不防断电——改名前不做 fsync。npm 自己也不防这一点。安装目录被安装物的升级整个换掉时，其中的插件随之换掉，这不在本机服务端的控制之内。

#### 例子：下载、替换、恢复与收留在磁盘上的样子

以下是在测试机上实际跑出来的记录（实现 `15975e793`（本例涉及的部分在 `c66bfee19` 未变）；运行它的一次性脚本附在实现 PR 的描述里）：先后下载 `@acme/sandbox-x` 的 1.1.0 与 1.2.0，模拟一次 P.2 中途的崩溃再恢复，最后演示收留。每个包由 `npm pack` 打出，integrity 是真实的 `dist.integrity`。

树的写法：只有一个子目录的各级写在同一行，一个目录里的文件写在花括号里（`sandbox-x/{.integrity, index.js, package.json}`）。

**下载 1.1.0：P.1 改名之前。** tarball 在 `f-…` 里已核对，包已在 `u-…/package/` 里解压完整，`.integrity` 也已写好；目标位置还没有这个包。

```
<数据根>/plugins/
  .staging/
    f-gxL685/acme-sandbox-x-1.1.0.tgz
    u-DeLldP/package/{.integrity, index.js, package.json}
  node_modules/@acme/
```

**下载 1.2.0：P.2 的第一次改名之前。** 新包已在 `u-…` 里完整；旧包还在原位，照常可加载。

```
<数据根>/plugins/
  .staging/
    d-hb5wlx/
    f-6lQf8t/acme-sandbox-x-1.2.0.tgz
    u-m2f1s9/package/{.integrity, index.js, package.json}
  node_modules/@acme/sandbox-x/{.integrity, index.js, package.json}
```

**P.2 的第二次改名之前。** 旧包已移到 `d-…/package/`，新包还在 `u-…` 里：这一刻 `node_modules/@acme/sandbox-x` 不存在，但两份完整的包都在磁盘上。

```
<数据根>/plugins/
  .staging/
    d-hb5wlx/package/{.integrity, index.js, package.json}
    f-6lQf8t/acme-sandbox-x-1.2.0.tgz
    u-m2f1s9/package/{.integrity, index.js, package.json}
  node_modules/@acme/
```

**下载完成之后。** 新包在位，`.staging/` 清空；旧包是在新包放入之后才删的。`.integrity` 是 `sha512-I9XMINsuCWQOUXWr+xHILZ0JzlfwxSAB36qRWV6GUjqnOvcsweJjsBl/oS/I/EotltuGkZb7P/o9kPx5Pw4TSw==`。

```
<数据根>/plugins/
  .staging/
  node_modules/@acme/sandbox-x/{.integrity, index.js, package.json}
```

**在 P.2 的两次改名之间崩溃，再执行 R。** 崩溃留下的：目标缺失，旧包在 `d-…/package/`。R.1 读出它的名字，把它改名回去，不联网。

```
<数据根>/plugins/
  .staging/d-crash/package/{.integrity, index.js, package.json}
  node_modules/@acme/
```

**H：两份推送被保留，当前的是 `c3d4`。** Project 要 `@acme/sandbox-y@^1`，当前推送与数据根都没有，只有旧推送 `a1b2` 里有。H 把它复制到 `u-…/package/`，再按 P 放入：

```
<数据根>/
  hmr/store/assets/
    a1b2/plugins/{index.json, node_modules/@acme/sandbox-y/{.integrity, index.js, package.json}}
    c3d4/plugins/{index.json, node_modules/@acme/sandbox-x/{.integrity, index.js, package.json}}
  plugins/
    .staging/
    node_modules/@acme/
      sandbox-x/{.integrity, index.js, package.json}
      sandbox-y/{.integrity, index.js, package.json}
```

之后 hmr 清理掉 `a1b2`，`@acme/sandbox-y` 也不需要再下载。

#### 发版

一次发布要么整个可用，要么能从中断的地方接着发。

- 发布之前先检查整张清单：每个要发的名字在 npm 上都已存在、发布的包不依赖不发布的包。任何一项不满足就整次停下，什么都不发。
- 按依赖顺序发布：插件 → core → server → cli。某个版本已经在 npm 上就跳过，所以重跑同一个版本号能接着发。
- npm 从未见过的新名字，由维护者手工首发一次并配好自动发布的授权，之后才进入自动发布。
- 构建索引里的 integrity 是对将要上传的那份 tarball 算的，上传的就是它本身；CLI 包里的索引在同一次发布里写下。
- npm 上全部发布成功之后，才在 penguin-plugins 为这次发布的插件加条目，所以目录不会指向一个 npm 上还没有的版本。

### 命名与发布

- `plugins/<dir>` 发布为 `@penguinharness/<dir>`，没有例外。
- 不发布的插件标 `"private": true`：它只随构建携带，不进 CLI 包的索引，也不进目录。
- 发布的包不得依赖不发布的包，由发布前的检查保证。

### 每条渠道的验收

一条渠道算「能起一个插件」，四步都要成立：**到得了**（携带，或一步从 registry 下载）、**加载得起**（加载成功、本平台的检查通过）、**看得见开得了**（插件页能启用、状态如实显示）、**真的有效**（以沙盒为例：一条越界命令被拒、一条许可命令放行）。每条渠道 × 每个平台各做一次全新安装走完四步，结果做成矩阵，每次发版复核。npm 这条渠道用本地 registry 走完整的「发布 → 安装 → 启用」，不必等真发布。

### 与既有设计的关系

- 取代 roadmap #6 提案 #11 中 integrity 的定义（对含依赖的 `package/` 自算 sha256）与下载时的 `--install-strategy=nested`；取代提案 #11 中的插件仓与按代切换的激活目录（`plugins/<gen>/` 加指针）：插件就在它到达的 prefix 里，不复制、不另设选择文件。见「算法与原子性」。
- 取代 [design#232](https://github.com/Prism-Shadow/penguin-harness-design/pull/232) / [#913](https://github.com/Prism-Shadow/penguin-harness/pull/913) 的「安装从不下载」。
- 沿用 PRFC-0003 的安装位置 `<root>/plugins/`，写入方式由 `npm install` 改为 D、P。
- 存量数据：数据根里更早用 `npm install` 装进去的包没有 `.integrity`，照常按版本加载，只是不能满足钉住；它们装进来的依赖留在原处，不再被维护。

## Drawbacks

[drawbacks]: #drawbacks

- 插件要自己打包自己。`sandbox-dsh` 今天声明了运行时依赖（其中 `koffi` 与 `@deepseek-ai/node-addon-landlock-run` 带原生件），要改成把它们打进自己的包里，否则解压出来加载不起。
- 一个 prefix 里一个名字只有一份：下载的插件升级后，旧版本不留作回滚；随包插件的回滚由热推送保留旧资产来管。
- 下载依赖网络与 `PATH` 上的 npm。
- 发布流程多一条约束：上传的必须是算过值的那份 tarball。

## Rationale and alternatives

[rationale-and-alternatives]: #rationale-and-alternatives

- **每种分发都携带全部插件、从不下载**（design#232）：npm 上的 CLI 包要带一整份随包插件目录，第三方插件仍然无路可走。
- **对「包加依赖」的目录树算 hash，三处统一安装规则**：能一致，但要为校验装下所有平台的原生件，且这个值没有外部工具能复核。
- **cli 以 `optionalDependencies` 带上后端、从程序依赖里找回它们**：等于恢复「程序自身的依赖」这第四个查找位置。
- **服务端自己发 HTTP 请求下载 tarball**：等于重写 npm 的 registry 访问，镜像、代理、认证都要重做；所以下载交给 `npm pack`，解压由服务端做。
- **用 npm 装出依赖**：依赖要跟着展开，三处安装规则又要对齐。
- **一个插件仓、外加一个选择文件**（本提案的前几版）：每个插件在仓里再存一份 tarball、解压一份加载，多出入仓、选择切换与回收三套机制；而随包插件本来就跟着安装物或热推送保存，下载的插件只需一处。
- **用 tgz 作为本地源头、解压目录可再生**：要多存一份 tarball；先解压再改名、最后删旧已能保证删除前有本地副本。

## Prior art

[prior-art]: #prior-art

- npm：`dist.integrity` 与 lock 的 `integrity`（SRI），由 `ssri` 生成与校验。
- crates.io index：每个版本记 `.crate` 的 sha256，依赖另行解析；桶的规则取自它。
- Nix / pnpm 的内容寻址存放。

## Unresolved questions

[unresolved-questions]: #unresolved-questions

- **给 Agent 的贡献今天走第二条路。** core 以 `dependencies` 点名一组插件包，它们随 core 的宿主包到达（热推送另带一份插件库，宿主包从两个固定起点确定），不经这三个 prefix。按「一种插件、一条线」，它们也应当从 prefix 里被找到；收拢的时机与 core 对这组包的依赖怎么处理，待定。
- 发版后加目录条目：开 PR 由人合并还是直接推送；`owners`；跨仓库写入的 secret。
- penguin-plugins 的工具（条目格式、检查、nightly 索引）还在 [penguin-plugins#1](https://github.com/Prism-Shadow/penguin-plugins/pull/1)–[#4](https://github.com/Prism-Shadow/penguin-plugins/pull/4) 里，`main` 只有 LICENSE。

## Future possibilities

[future-possibilities]: #future-possibilities

- npm provenance 作为目录收录的条件。
- 私有 scope 与镜像源照 npm 自己的配置（`.npmrc`）生效。

## Changes

### v1.0.0

- 新增：迁入主仓；正文取设计仓的同一版本，与英文版逐节对应。

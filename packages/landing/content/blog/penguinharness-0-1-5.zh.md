---
title: "PenguinHarness 0.1.5：离线安装、更丰富的输入与更稳的运行"
date: 2026-07-30
category: news
excerpt: 0.1.5 同时拓宽了 PenguinHarness 的两端：五个自包含离线安装包让它装进完全没有网络的机器；composer 可以附加任意类型的文件，图像也进入了中途引导与目标模式；几乎所有 LLM 故障都在运行内自动恢复而不再终止任务；内置技能学会了第二套视觉语言，并写清了 thinking 与图像这两类消息的用法。逐项说明如下。
---

PenguinHarness 0.1.5 发布了。这个版本把管道的两端同时拓宽：harness 能装在哪里——包括从不联网的机器；装好之后你能递给它什么。中间那段也更结实了：几乎所有 LLM 故障都在运行内自动恢复，请求中途按下 Stop 也不再可能让 Session 悬死。逐项来看：

## 完全离线也能安装

每个 GitHub Release 现在附带**五个自包含离线安装包**——Linux 与 macOS 各有 x64、arm64 两种架构，Windows 为 x64。包内自带程序压缩包、SHA256 校验文件与对应平台的安装器，完整流程就是：在任意有网机器下载、拷贝到目标机器、跑一条命令。

```bash
mkdir penguin-offline
tar -xzf penguin-linux-x64-offline.tar.gz -C penguin-offline
./penguin-offline/install.sh
```

Windows 上解压 `penguin-win32-x64-offline.zip` 后双击 `install.cmd` 即可——或在 PowerShell 里运行 `.\install.ps1`。离线安装无条件校验 SHA256（没有网络可以重新下载，损坏的包必须被拦下而不是被容忍）；POSIX 离线包把安装载荷显式传给安装器，而不是让脚本扫描所在目录；平台包内置目标清单，改过名的压缩包也能正常安装。

Windows 安装包还多了一块「地板」：内置 MinGit（位于 `git/`），即使机器上没装 Git for Windows，`exec_command` 也有真正的 bash 可用。装了 Git for Windows 时仍然优先用你自己的——它的 MSYS 用户层更完整；GPLv2 义务记录在新增的根目录 `THIRD-PARTY-NOTICES.md` 中。

围绕离线包，安装文档也整体重做：README 把每种方式——Linux、macOS、Windows、npm、离线安装包——都写成可整段复制的完整代码块；官网落地页的安装区改为按系统与方式切换展示，不再全部平铺。

## 附加任意文件，用图像引导

Web composer 现在可以附加**任意类型的文件**，不再局限于图像。附件写入 Session 暂存目录，以 `[attached file: <path>]` 行交给模型——非 ASCII 文件名原样保留——模型用常规文件工具读取，运行中途同样可以附加。

图像则进入了**所有**输入通道：中途引导可以携带图像（不带文字说明的图像本身就是一条完整的引导消息）；目标模式的 objective 以暂存目录路径的形式接受图像——每轮以文本重新注入，因此无论模型是否具备视觉能力都可用。

composer 的 `@` 提及升级为 `/agent` 命令，两个切换命令（`/agent`、`/model`）的选择都以纸片形式暂存在输入框旁——与草稿一同缓存，按下 Enter 发送时才生效，且仅作用于当前会话。

## 运行不再死于一次故障

区分暂时性与永久性 LLM 故障的分类器过去是一张允许名单：网关用自己的措辞描述一次暂时故障，任务就被判死。0.1.5 把它反了过来——**除凭证被拒外的所有故障都在运行内重试**，重试在两个前端都以倒计时可见，压缩请求在自己更短的预算内重试，恢复成功的故障也不再作为事故报给管理员。

两项配套：请求中途按 Stop，即使供应商的流在中止后既不产出也不报错，Session 也不再可能永远悬着；成本中心的错误表可以翻页回看全部历史，普通的非零退出（`grep` 没搜到）不再被记为错误，环境来源的条目标注为 `[env]`。

## 会设计、也会构建的技能库

内置技能库这个版本迈了两大步：

- **web-design** 在默认的 GitHub 风格简洁语言之外，新增第二套完整视觉语言——可选的「纸质编辑风」主题：暖纸色调、系统衬线大标题、等宽小标签；并立下「交付即成品」的约定：一句话请求就是完整规格，交付页面默认包含暗色模式、加载/空态/错误状态、完整键盘路径与零外部请求。聊天界面新增了可折叠思考块与 composer 图像附件的配方。
- **penguin-sdk** 写清了现代模型真正收发的消息类型：把 `partial_thinking` 流入独立的折叠通道，用 `imageUrlMessage` 构造图像输入（配置的 `vision` 标志经项目 `vision_model` 平滑降级），在 persona 里约定输出格式而不是在 UI 里搭 Markdown 渲染管线，并用 ingest 时生成的双语关键词映射弥合跨语言 BM25 检索。

在这之上，Web 应用的草稿页新增了端到端的 **Agent 调优示例**——通过相互隔离的 CLI 会话创建、评测并优化一个 Agent；示例提示词也变短了，因为过去要在提示词里写明的知识，现在由技能承载。

## 0.1.5 还有这些

- 默认系统提示词缩短约十分之一（1087 → 969 词），回复语言锁定用户语言，共享工具装入 Agent 级 `shared_env/` 目录。已有 Agent 保持自己的提示词不变。
- 导航条目名称统一；Workspace 与 Agents 面板共用宽度与开合状态；Project 显示名可编辑；草稿页示例改为定高折叠书架。
- 会话头部的耗时纸片在刷新后不再归零，并统计在途事件——锚定服务器时钟，直播与回放一致。
- 向 `penguin chat` 粘贴中文或 emoji 不再因 stdin 分块撕裂字符而出现乱码。
- 时长与字节的缩写会正确进位，不再出现 `1m60s` 或 `1024KB`。
- `PORT` / `HOST` 不再泄漏进 Agent 运行的命令；开发后端移至 7368 端口，与已安装的 `penguin web` 互不干扰。
- 文档补齐三处参考：`run_subagent` 的 `provider` 参数、网关凭证表、Project 模型条目的 `max_tokens`。

## 安装或升级

```bash
curl -fsSL https://penguin.ooo/install.sh | sh
penguin web
```

Windows（PowerShell）：

```powershell
irm https://penguin.ooo/install.ps1 | iex
penguin web
```

也可以在 Node >= 24 环境 `npm install -g @prismshadow/penguin-cli`——从这个版本起，还可以用 [Release 附件](https://github.com/Prism-Shadow/penguin-harness/releases)完全离线安装。每项改动的完整细节见 [changelog/0.1.5](https://github.com/Prism-Shadow/penguin-harness/tree/main/changelog/0.1.5)。

---
title: "PenguinHarness 0.1.5：离线安装、文件附件与能自动恢复的运行"
date: 2026-07-30
category: news
excerpt: 0.1.5 新增五个自包含的离线安装包；输入框可以附加任意文件，插话和目标也能带上图片；几乎所有 LLM 故障都会在运行内重试。web-design Skill 新增第二套视觉主题，penguin-sdk 补上了思考消息和图片消息的用法。
---

PenguinHarness 0.1.5 发布了。现在可以在完全没有网络的机器上安装，在 Web 输入框里附加任意类型的文件，还能随插话和目标一起发送图片。运行也更稳了：几乎所有 LLM 故障都能在运行内恢复，请求中途按下「停止」也不会再让会话卡住。

## 离线安装

0.1.5 的 GitHub Release 附带五个自包含的离线安装包：Linux 和 macOS 各有 x64 和 arm64 两种，Windows 为 x64。每个安装包里有程序压缩包、它的 SHA256 校验文件和对应平台的安装器。在任意一台能联网的机器上下载安装包，拷到目标机器，运行一条命令即可。

在 Linux 或 macOS 上，解压安装包并运行里面的安装器。以 Linux x64 安装包为例：

```bash
mkdir penguin-offline
tar -xzf penguin-linux-x64-offline.tar.gz -C penguin-offline
./penguin-offline/install.sh
```

在 Windows 上，解压 `penguin-win32-x64-offline.zip` 后双击 `install.cmd`，或者在 PowerShell 中运行 `.\install.ps1`。

离线安装一律校验 SHA256。离线环境没法重新下载，压缩包一旦损坏，就只能中止安装。改过名的压缩包仍然可以安装，因为每个安装包内部都记录了自己的目标平台。

Windows 安装包还在 `git/` 下内置了 MinGit，所以即使机器上没装 Git for Windows，`exec_command` 也有真正的 bash 可用。如果你装了 Git for Windows，仍然优先使用它，因为它的 MSYS 用户层更完整。MinGit 的 GPLv2 义务记录在仓库根目录新增的 `THIRD-PARTY-NOTICES.md` 中。

安装说明也随之重写。README 现在把每种安装方式都写成可以整段复制的完整代码块：Linux、macOS、Windows、npm 和离线安装包。官网落地页的安装区按操作系统和安装方式切换，不再一次列出全部内容。

## 附加任意文件，用图片插话

Web 输入框现在可以附加任意类型的文件，不再只限图片。附件写入会话的 scratchpad，以 `[attached file: <path>]` 行的形式交给模型，非 ASCII 文件名原样保留，模型用常规的文件工具就能读取。

现在所有输入都能带上图片。运行中途发送的插话可以携带图片，不带文字说明的图片本身就是一条完整的插话。文件则不随插话发出，会留到你的下一条普通消息里再发送。目标也可以通过 scratchpad 路径包含图片，这些路径每轮都会以文本形式重新注入，所以无论模型是否支持视觉都能用。

输入框的 `@` 提及改成了 `/agent` 命令。`/agent` 和 `/model` 这两个切换命令只在已有会话里可用，新对话的草稿里没有；它们会把你选中的项以标签形式放在文字上方。标签随草稿一起保存，按 Enter 发送时才生效：Agent 标签会新开一个与该 Agent 的对话来接手，模型标签则把当前对话分叉到选中的模型上继续。

## 运行出错也能自动恢复

过去，区分 LLM 暂时性故障和永久性故障的分类器依据的是一份已知错误清单，网关只要换个说法描述暂时性故障，这一轮就直接结束。0.1.5 把逻辑反了过来：除了凭证验证失败，所有故障都会在运行内重试。Web App 会以实时倒计时显示重试，CLI 则打印一行 `[retry]`。压缩请求在自己更短的预算内重试，恢复成功的故障也不再当成事故报告给管理员。

两个相关修复：

- 请求中途按下**停止**时，即使供应商的流在中止后既不返回数据也不报错，会话也不会再一直处于运行状态。
- **成本中心**的错误表可以往前翻页查看全部历史；普通的非零退出（例如 `grep` 没搜到结果）不再记为错误；来自环境的条目会标上 `[env]`。

## 会设计也会构建应用的 Skill

这个版本里，两个内置 Skill 都有了大幅改进。

### web-design

`web-design` 在默认的 GitHub 式简洁风格之外，新增了第二套完整的视觉语言：可选的 *paper editorial*（纸质编辑风）主题，采用暖纸色调、系统衬线体标题和等宽小标签。

它还遵循「交付即完整」的约定：一句话需求就是完整规格，交付的每个页面都会主动包含暗色模式、加载/空/错误状态、可用的键盘操作路径，而且不发出任何外部请求。对于聊天界面，它新增了可折叠推理块和输入框图片附件两种做法。

### penguin-sdk

`penguin-sdk` 现在写清了当前模型发出和接收的思考消息与图片消息，以及基于它们构建应用的做法：

- 把 `partial_thinking` 流式输出到独立的可折叠区域。
- 用 `imageUrlMessage` 构造图片输入。模型配置的 `vision` 标志关闭时，图片会以文件路径的形式传入，由内置图片工具通过 Project 的 `vision_model` 读取，应用照样能用。
- 在 persona 里固定输出格式，而不是附带一个 Markdown 渲染器。
- 用入库时生成的双语关键词映射，打通跨语言的 BM25 检索。

草稿页示例提示词过去要写明的知识，现在由这两个 Skill 承载，所以这些提示词都变短了。草稿页还新增了一个端到端的 Agent 调优示例，它基于 Agent 创建、Benchmark 设计、评估和优化这几个 Skill：通过相互隔离的 CLI 会话创建 Agent、用 Benchmark 评估，再做优化。

## 0.1.5 还有这些

- 默认系统提示词缩短了约十分之一（1087 → 969 词）。它要求模型用用户的语言回复，并把共享工具安装到每个 Agent 专属的 `shared_env/` 目录。已有 Agent 保留各自的提示词。
- 导航项的名称统一了，每一项在各处只用一个名字。Workspace 面板和智能体面板共用同一个宽度，开合规则也相同；Project 的显示名称可以编辑；草稿页的示例改成固定高度的文件夹式书架。
- 对话页头部的用时标签刷新后依然保留，并会计入尚未结束的事件。它以服务器时钟为准，所以实时视图和回放视图显示一致。
- 向 `penguin chat` 粘贴 CJK 文本或 emoji 时，分散在多个 stdin 块中的字符不再出现乱码。
- 时长和字节大小会正确进位，不再显示 `1m60s` 或 `1024KB`。
- `PORT` 和 `HOST` 不再泄漏到 Agent 执行的命令中；开发后端改用 7368 端口，与已安装的 `penguin web` 互不干扰。
- 文档里三处落后于代码的参考内容已经补齐：`run_subagent` 的 `provider` 参数、网关凭证表，以及 Project 模型条目的 `max_tokens`。

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

也可以在 Node >= 24 的环境下从 npm 安装：`npm install -g @prismshadow/penguin-cli`。从这个版本起，还可以用 [v0.1.5 Release](https://github.com/Prism-Shadow/penguin-harness/releases/tag/v0.1.5) 附带的安装包完全离线安装，步骤见上文「离线安装」一节。每项改动的详细说明见 [changelog/0.1.5](https://github.com/Prism-Shadow/penguin-harness/tree/main/changelog/0.1.5)。

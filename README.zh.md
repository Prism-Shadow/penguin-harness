<p align="center">
  <img src="packages/landing/public/penguin-logo.svg" alt="PenguinHarness 标志" width="88" />
</p>

<h1 align="center">PenguinHarness</h1>

<p align="center"><strong>统一、稳定的 Agent 自进化框架</strong><br />全自动优化：<strong>任意模型&nbsp;· 任意算法&nbsp;· 任意 Benchmark</strong></p>

<p align="center">
  <a href="https://penguin.ooo/download">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="assets/readme/download-zh-dark.svg" />
      <img src="assets/readme/download-zh-light.svg" alt="下载应用" height="44" />
    </picture>
  </a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@prismshadow/penguin-core"><img src="https://img.shields.io/npm/v/@prismshadow/penguin-core" alt="npm 版本" /></a>
  <a href="https://github.com/Prism-Shadow/penguin-harness/actions/workflows/ci.yml"><img src="https://github.com/Prism-Shadow/penguin-harness/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/Prism-Shadow/penguin-harness/actions/workflows/pages.yml"><img src="https://github.com/Prism-Shadow/penguin-harness/actions/workflows/pages.yml/badge.svg" alt="部署站点" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="协议：Apache-2.0" /></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A5%2024-brightgreen" alt="Node >= 24" />
</p>

<p align="center">
  <a href="https://penguin.ooo/"><img src="https://img.shields.io/badge/Website-penguin.ooo-1f6feb?logo=googlechrome&logoColor=white" alt="网站" /></a>
  <a href="https://penguin.ooo/docs/"><img src="https://img.shields.io/badge/Docs-penguin.ooo%2Fdocs-1f6feb?logo=readthedocs&logoColor=white" alt="文档" /></a>
  <a href="https://penguin.ooo/blog"><img src="https://img.shields.io/badge/Blog-penguin.ooo%2Fblog-1f6feb?logo=rss&logoColor=white" alt="博客" /></a>
</p>

<p align="center">
  <a href="https://discord.gg/eFHKqqcU3D"><img src="https://img.shields.io/badge/Discord-join%20chat-5865F2?logo=discord&logoColor=white" alt="Discord" /></a>
  <a href="https://x.com/code_hiyouga"><img src="https://img.shields.io/badge/X-code%5Fhiyouga-000000?logo=x&logoColor=white" alt="X（Twitter）" /></a>
  <a href="https://github.com/Prism-Shadow/penguin-harness-community/blob/main/wechat/group.jpg"><img src="https://img.shields.io/badge/WeChat-user%20group-07C160?logo=wechat&logoColor=white" alt="微信" /></a>
</p>

<p align="center">
  <a href="https://www.producthunt.com/products/penguinharness?embed=true&amp;utm_source=badge-featured&amp;utm_medium=badge&amp;utm_campaign=badge-penguinharness" target="_blank" rel="noopener noreferrer"><img alt="PenguinHarness - 让 Agent 自主构建更好的 Agent，只需 $0.02 | Product Hunt" width="250" height="54" src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1202577&amp;theme=light&amp;t=1784804711946" /></a>
</p>

<p align="center"><a href="README.md">English</a> | 简体中文</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/Prism-Shadow/penguin-harness-community/main/blog-assets/penguinharness-0-2-14-start-page-zh.png" alt="PenguinHarness 起始页：Agent、RSI 算法、Benchmark 与示例" width="900" />
</p>

## 为什么选择 PenguinHarness

PenguinHarness 是开源的 Agent 自进化（recursive self-improvement, RSI）框架。模型保持不变，进化的是 Harness：提示词、Skill、工具和钩子。它可以在你的电脑或服务器上运行，提供桌面端、Web App、CLI 和 SDK。

- **一个框架**，**集齐所有 RSI 算法**。 Default、OPRO、APE、ACE 和 AWM 都以插件形式提供，跑在同一套内置 Benchmark、记分板和快照上。
- **一句话生成一个 Agent 应用**。 描述你的需求，Agent 就会把应用、页面和运行说明都写好。
- **跑起来很便宜**。 工具集刻意保持精简，专为开源模型调优：在我们的数据分析测试集上，以 Claude Code 1/70 的成本取得最高准确率。

## 自进化

选一个算法，选一个 Benchmark，一个 Agent 就能一轮一轮地优化另一个 Agent。每个候选版本都是一个新版本，改动前先存快照；每个分数都会进入评估中心。

| 工具包 | 算法 |
| --- | --- |
| `default-rsi-toolkit` | 试跑、反思、提升：每轮一个假设、一处改动 |
| `opro-rsi-toolkit` | [OPRO](https://arxiv.org/abs/2309.03409)：从已评分指令的历史中生成新指令 |
| `ape-rsi-toolkit` | [APE](https://arxiv.org/abs/2211.01910)：从示例中归纳候选指令 |
| `ace-rsi-toolkit` | [ACE](https://arxiv.org/abs/2510.04618)：把 Trace 中的经验提炼成 playbook |
| `awm-rsi-toolkit` | [AWM](https://arxiv.org/abs/2409.07429)：从成功的运行中归纳出工作流 |

每个新建的 Project 都自带七个 Benchmark，以 Harbor 任务的形式跑在 Docker 里：PenguinHarness Benchmark Sec A 到 Sec E（来自 rag-bench-essential、DeepSWE、AutomationBench、Terminal-Bench-Science 和 Terminal-Bench），以及 GDPevo Train 和 Test。更多 Benchmark 见 [penguin-harness-benchmark](https://github.com/Prism-Shadow/penguin-harness-benchmark)。

<p align="center">
  <img src="https://raw.githubusercontent.com/Prism-Shadow/penguin-harness-community/main/blog-assets/penguinharness-0-2-14-benchmark-detail-zh.png" alt="一个 Benchmark 的分数图：三个 Agent 随版本一路攀升" width="820" />
</p>

**演示**：以决策智能体为例，经过评测、一次工作方法的改进和同模型复测，分数从 84 提升到 100，每次运行的成本都看得到。

https://github.com/user-attachments/assets/8ab00e36-9da6-4706-aede-5cf63c3080fc

## 一句话，一个应用

```text
新建一个法务智能体，负责审阅合同、协议等法律文件：找出风险条款、说明理由并给出修改建议。再在法务智能体上做一个 Agent Workbench 标签页，当作它的工作台：我上传文件后，由它在后台分析，完成后生成一份分析报告供我下载。页面上只要上传、文件列表（每个文件的处理状态）和报告下载，不显示任何对话过程；颜色一律取自主题变量，明暗两种主题下都要好看。
```

结果：一个法务审阅应用。上传合同后，可以查看每个文件的处理状态，并下载列出风险条款、理由和修改建议的审阅报告。5 次样件审阅的模型花费是 $0.0423。

https://github.com/user-attachments/assets/138744cd-9ab8-42f3-bf6d-b0a25f404132

## Agent 能做什么

<table>
  <tr>
    <td width="50%" valign="top">
      <b>浏览器自动化</b><br />
      Agent 通过 PenguinHarness Browser 扩展操作你自己的 Chrome，也可以用桌面端的内置浏览器。读页面用文本、操作用短脚本，每一步只花很少的 Token。<a href="https://penguin.ooo/blog/let-agents-use-the-browser">教程</a><br /><br />
      <img src="https://raw.githubusercontent.com/Prism-Shadow/penguin-harness-community/main/blog-assets/penguinharness-0-2-14-browser-zh.png" alt="Agent 在浏览器面板里阅读 PenguinHarness 博客" />
    </td>
    <td width="50%" valign="top">
      <b>工作台</b><br />
      每个 Agent 都能有自己的热定制工作台：开口要一个，Agent 就把页面和服务端代码一起写好，作为标签页显示在对话旁边。<a href="https://penguin.ooo/blog/build-agent-apps-with-workflows">教程</a><br /><br />
      <img src="https://raw.githubusercontent.com/Prism-Shadow/penguin-harness-community/main/blog-assets/penguinharness-0-2-14-workflow-zh.png" alt="法务 Agent 的合同工作台页面" />
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <b>远程机器</b><br />
      添加一台机器，服务器通过 ssh 连接它。那台机器上 Workspace 里的会话就在那台机器上运行，而且仍在同一个窗口里。<a href="https://penguin.ooo/blog/run-agents-on-remote-machines">教程</a><br /><br />
      <img src="https://raw.githubusercontent.com/Prism-Shadow/penguin-harness-community/main/blog-assets/penguinharness-0-2-14-machines-zh.png" alt="在 devbox 机器上运行的一个会话" />
    </td>
    <td width="50%" valign="top">
      <b>Agent API</b><br />
      通过统一 API 把任意 Agent 接入外部应用：经 HTTP 发送输入，再以 AMSP 事件流读回运行过程。<a href="https://penguin.ooo/blog/call-agents-with-the-agent-api">教程</a><br /><br />
      <img src="https://raw.githubusercontent.com/Prism-Shadow/penguin-harness-community/main/blog-assets/penguinharness-0-2-14-agent-api-zh.png" alt="运行一次后的「试一试」面板" />
    </td>
  </tr>
</table>

回复还可以自带 UI：选项、表单、步骤、Mermaid 图表和实时小组件（[A2UI](https://penguin.ooo/blog/penguinharness-0-2-15)）。

## 评测结果

每个 Harness 都在自己通常搭配的模型上，跑同一组任务：

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/readme/benchmark-dark.svg" />
    <img src="assets/readme/benchmark-light.svg" alt="Benchmark：PenguinHarness 在数据分析套件上领先，在编程上与 OpenAI Codex 打平，成本只有两家竞品的一小部分" width="920" />
  </picture>
</p>

## 内置插件库

Agent 还能编写并优化自己的 Skill（[文档](https://penguin.ooo/docs/skills)）。

| 分类 | 插件                                                                       |
| -------------------- | ----------------------------------------------------------------------------- |
| Agent 自进化 | `default-rsi-toolkit`, `opro-rsi-toolkit`, `ape-rsi-toolkit`, `ace-rsi-toolkit`, `awm-rsi-toolkit` |
| 办公效率 | `a2ui`, `data-analysis`, `use-firecrawl`, `browser-automation`, `use-bento-slides`, `humanizer`, `goal`, `continual-learning`, `agent-company`, `penguin-support` |
| 软件开发 | `software-development`, `use-claude-code` |
| AI 应用开发 | `agent-development`, `agent-evaluation`, `model-development`, `skill-porting` |

## 支持的模型

重点支持以下模型系列。各型号的具体版本和供应商见应用的**模型库**。

### 闭源模型

| 模型 | 服务商 |
| --- | --- |
| GPT 6.1 | OpenAI, OpenRouter |
| Claude 5.5 | Anthropic, OpenRouter, OpenCode Go |
| Gemini 4 | Google Gemini, OpenRouter, Penguin Go, OpenCode Go |
| Grok 4.7 | OpenRouter, OpenCode Go |
| Qwen3.8 Max | Qwen Token Plan, Qwen Pay-As-You-Go, OpenRouter, TokenDance, OpenCode Go |

### 开源模型

| 模型 | 服务商 |
| --- | --- |
| DeepSeek V4.1 | DeepSeek, OpenRouter, Fireworks AI, Atlas Cloud, TokenDance, Penguin Go, OpenCode Go, Qwen Token Plan, Qwen Pay-As-You-Go, ModelScope |
| Kimi K3 | Moonshot AI, OpenRouter, Fireworks AI, TokenDance, OpenCode Go, Qwen Pay-As-You-Go |
| GLM 5.3 | Z.AI, OpenRouter, TokenDance, OpenCode Go |
| Hunyuan 4 | OpenRouter, TokenDance, OpenCode Go |
| MiMo v2.6 | OpenRouter, TokenDance, OpenCode Go |

Claude 5.5 的 OpenCode Go 预设为 Haiku；Fable 5.1、Opus 5.5 和 Sonnet 5.5 可通过 Anthropic、OpenRouter 使用。Hunyuan 4 使用 `hy4-preview`。

此外支持自定义 OpenAI 协议端点，可接入 1000+ 个在线和本地模型。

## 安装

### 桌面端

从 [penguin.ooo/download](https://penguin.ooo/download) 下载安装包：macOS 11+（dmg）、Windows 10+（exe）或 Linux x64（AppImage、deb）。应用打开即已登录，无需终端。

### CLI 与服务器

| 平台 | 安装命令 |
| --- | --- |
| Linux / macOS | `curl -fsSL https://penguin.ooo/install.sh \| sh` |
| Windows（PowerShell） | `irm https://penguin.ooo/install.ps1 \| iex` |
| npm（Node >= 24） | `npm install -g @prismshadow/penguin-cli` |

然后运行 `penguin web`：它在 `http://127.0.0.1:7364` 上提供 Web App，在设置密码之前会打印首次登录链接；模型在**模型库**页面配置。桌面端和 CLI 共用 `~/.penguin/data`。

### Docker

```bash
docker run -d --name penguin -p 127.0.0.1:7364:7364 -v penguin-data:/data hiyouga/penguinharness:0.2.17
docker logs penguin       # 首次登录链接，在本机可原样打开
```

镜像在 7364 端口提供服务，数据存放在 `/data` 卷，适用于 `linux/amd64` 和 `linux/arm64`；`latest` 跟随 `main` 中影响镜像运行代码或构建输入的改动，每次发布也会打上对应版本号的标签。上面的示例只监听回环地址。如需面向网络的部署、Compose 和升级，参见 [Docker 快速上手](https://penguin.ooo/docs/quickstart-docker)。

<details>
<summary><b>离线安装（物理隔离的机器）</b></summary>

每个 <a href="https://github.com/Prism-Shadow/penguin-harness/releases">GitHub Release</a> 为每个目标平台恰好附带一个包：Linux 和 macOS 提供 x64 / arm64 版本，Windows 提供 x64 版本，另有一个不含运行时的通用包。在线安装和离线安装用的是同一个文件。每个包都封入程序本体、对应的 SHA256 校验值和所在平台的安装器。在联网机器上下载这一个文件，拷贝到目标机器，解压一次，运行自带的安装器即可，无需网络，也无需单独携带校验文件（封入的 SHA256 始终会被校验）。

**Linux**（**arm64 机器请使用 `penguin-linux-arm64.tar.gz`**）：

```bash
mkdir penguin-install
tar -xzf penguin-linux-x64.tar.gz -C penguin-install
./penguin-install/install.sh
```

**macOS**（**以 Apple silicon 为例**；**Intel 机器请使用 `penguin-darwin-x64.tar.gz`**）：

```bash
mkdir penguin-install
tar -xzf penguin-darwin-arm64.tar.gz -C penguin-install
./penguin-install/install.sh
```

**Windows**（**解压后双击 `install.cmd`**，**或在 PowerShell 中运行**）：

```powershell
Expand-Archive penguin-win32-x64.zip -DestinationPath penguin-install
cd penguin-install
.\install.cmd
```

</details>

### Chrome 扩展（可选）

[PenguinHarness Browser](https://chromewebstore.google.com/detail/penguinharness-browser/dodgfhpcbmkjfcbgnoidablfgjjhhmgp) 让 Agent 在你自己的 Chrome 里操控你交给它们的标签页。

## CLI 与 SDK

同一套引擎，支持脚本调用，专为 Agent 驱动而设计：

```bash
penguin config model add --provider deepseek --model-id deepseek-flash --api-key sk-... --set-default
penguin run -m "Create hello.txt containing Hello, Penguin"   # 单次任务
penguin chat       # 交互式 REPL（/compact、/clear、/exit、Ctrl-C 中断）
penguin server     # 无界面服务（与 Web 应用同一套 API）
```

```ts
import { createAgent, isCompleteModelMessage, userText } from "@prismshadow/penguin-core";

const agent = await createAgent({ agentId: "default_agent" });
const session = await agent.createSession({ workspaceDir: process.cwd() });

for await (const output of session.run([userText("Create hello.txt containing hi")], {
  approve: async () => "allow", // 按工具调用逐个审批
})) {
  if (isCompleteModelMessage(output) && output.payload.type === "text") {
    console.log(output.payload.text);
  }
}
```

## 路线图

- [x] Benchmark 套件公开发布
- [x] 桌面端
- [x] 支持 Windows
- [x] Agent 公司与模板
- [ ] 公司级自进化
- [ ] 集成 OpenShell（权限管控的 shell）
- 还有更多，敬请期待……

## 参与开发

```bash
pnpm install && pnpm build   # 先构建：core 的导出指向 dist/
pnpm dev                     # 服务端 + Web 一起启动（带前缀日志，依赖只构建一次）
```

用编码 Agent 开发本仓库：开发用的 Skill 在 `.agents/skills/` 下（`penguin-harness-dev`、`penguin-harness-frontend`、`penguin-harness-manual-test`、`penguin-harness-writing`）。Claude Code 通过 `.claude` → `.agents` 软链接直接加载，无需安装；换用其他 Agent 时，把 `.agents/skills/*` 链接或复制到它读取 Skill 的目录即可。

完整的 Workspace 开发指南见 [CONTRIBUTING.md](.github/CONTRIBUTING.md)：开发命令、质量门禁、仓库布局和 changelog 规则。

## 贡献者

感谢所有为 PenguinHarness 贡献过的伙伴。

<p align="center">
  <a href="https://github.com/Prism-Shadow/penguin-harness/graphs/contributors"><img src="https://contrib.rocks/image?repo=Prism-Shadow/penguin-harness" alt="PenguinHarness 贡献者" /></a>
</p>

## 引用

如果你的研究使用了 PenguinHarness，请引用：

```bibtex
@software{penguinharness2026,
  author  = {{PrismShadow Team}},
  title   = {PenguinHarness: Efficient Self-Improving Harness for Everyone},
  year    = {2026},
  url     = {https://github.com/Prism-Shadow/penguin-harness},
  license = {Apache-2.0}
}
```

## 致谢

本仓库得益于以下项目：

- [MinGit](https://github.com/git-for-windows/git)：Windows 上捆绑的 POSIX shell 和 Git
- [GenericAgent](https://github.com/lsdefine/genericagent)：内置浏览器自动化

各项目的许可证见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。

## 协议

[Apache-2.0](LICENSE) © 2026 Prism Shadow

## 维护团队

**组织**：PrismShadow AI、清和乐章

**维护成员**：

- Yaowei Zheng（LlamaFactory、PrismShadow）
- Yangxi Xiang
- Junhao Hu
- Leijun Zhou（PrismShadow）
- Zhihao Liu（PrismShadow）
- Xiang Qu（PrismShadow）
- Hengjin Dou（PrismShadow）
- Ning Wang（清和乐章）
- Ming Lu（清和乐章）

Built with ❤️

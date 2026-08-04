<p align="center">
  <img src="packages/landing/public/penguin-logo.svg" alt="PenguinHarness logo" width="88" />
</p>

<h1 align="center">PenguinHarness</h1>

<p align="center"><b>全自动 Agent 构建平台，运行在你的桌面 / 服务器上</b><br />一键创建自进化 Agent</p>

<p align="center">
  <a href="https://penguin.ooo/download/"><img src="https://img.shields.io/badge/%E2%AC%87%EF%B8%8F_%E7%82%B9%E5%87%BB%E4%B8%8B%E8%BD%BD-macOS_%C2%B7_Windows_%C2%B7_Linux-2ea44f?style=for-the-badge" alt="点击下载 — macOS · Windows · Linux" /></a>
</p>

<p align="center">
  <a href="https://www.producthunt.com/products/penguinharness?embed=true&amp;utm_source=badge-featured&amp;utm_medium=badge&amp;utm_campaign=badge-penguinharness" target="_blank" rel="noopener noreferrer"><img alt="PenguinHarness - Let Agents Autonomously Build Better Agents for $0.02 | Product Hunt" width="250" height="54" src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1202577&amp;theme=light&amp;t=1784804711946" /></a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@prismshadow/penguin-core"><img src="https://img.shields.io/npm/v/@prismshadow/penguin-core" alt="npm 版本" /></a>
  <a href="https://github.com/Prism-Shadow/penguin-harness/actions/workflows/ci.yml"><img src="https://github.com/Prism-Shadow/penguin-harness/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/Prism-Shadow/penguin-harness/actions/workflows/pages.yml"><img src="https://github.com/Prism-Shadow/penguin-harness/actions/workflows/pages.yml/badge.svg" alt="Deploy Site" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="License: Apache-2.0" /></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A5%2024-brightgreen" alt="Node >= 24" />
</p>

<p align="center">
  <a href="https://penguin.ooo/"><img src="https://img.shields.io/badge/%E5%AE%98%E7%BD%91-penguin.ooo-1f6feb?logo=googlechrome&logoColor=white" alt="官网" /></a>
  <a href="https://penguin.ooo/docs/"><img src="https://img.shields.io/badge/%E6%96%87%E6%A1%A3-penguin.ooo%2Fdocs-1f6feb?logo=readthedocs&logoColor=white" alt="文档" /></a>
  <a href="https://penguin.ooo/blog"><img src="https://img.shields.io/badge/%E5%8D%9A%E5%AE%A2-penguin.ooo%2Fblog-1f6feb?logo=rss&logoColor=white" alt="博客" /></a>
</p>

<p align="center">
  <a href="https://discord.gg/eFHKqqcU3D"><img src="https://img.shields.io/badge/Discord-%E5%8A%A0%E5%85%A5%E8%AE%A8%E8%AE%BA-5865F2?logo=discord&logoColor=white" alt="Discord" /></a>
  <a href="https://x.com/code_hiyouga"><img src="https://img.shields.io/badge/X-code%5Fhiyouga-000000?logo=x&logoColor=white" alt="X（Twitter）" /></a>
  <a href="https://github.com/Prism-Shadow/penguin-harness-community/blob/main/wechat/group.jpg"><img src="https://img.shields.io/badge/%E5%BE%AE%E4%BF%A1-%E4%BA%A4%E6%B5%81%E7%BE%A4-07C160?logo=wechat&logoColor=white" alt="微信群" /></a>
</p>

<p align="center"><a href="README.md">English</a> | 简体中文</p>

## 为什么选择 PenguinHarness

> 使用 LangChain，以 1 倍速度人工构建 Agent；<br />使用 PenguinHarness，以 100 倍速度用 Agent 构建 Agent。

三个递进的理由——从任务效果，到构建方式，再到进化能力。

### 1. 🏆 以几十分之一的成本，跑出优异的效果

刻意精简的工具集配合干净的底层接口：更少的工具调用、更少的 Token，对 DeepSeek 等开放模型深度适配。各自搭配常用模型、同一批任务，正面对比：

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/readme/benchmark-dark.svg" />
    <img src="assets/readme/benchmark-light.svg" alt="Benchmark：PenguinHarness 在数据分析题库准确率最高、编程题库与 OpenAI Codex 持平，成本仅为两者的零头" width="920" />
  </picture>
</p>

**数据分析准确率最高——成本只有 Claude Code 的 1/70。**

### 2. ⚡ 一句话，让 Agent 构建 Agent 应用

输入一句话，Agent 为你构建完整的 Agent 应用——脚手架、代码、运行说明，一步到位：

```text
收集 https://github.com/ericbuess/claude-code-docs 的文档，做一个化身 Claude Code 配置专家、回答带来源引用的 RAG 问答应用。
```

这是做出来的成品——一个文档专家：检索增强、引用可点击直达原文、内置示例问题：

https://github.com/user-attachments/assets/604eb626-0a5d-4a62-87e3-14ebade1cd5f

**而生成整个 RAG 应用，仅消耗了 0.2 元（$0.02）的 token——使用 DeepSeek V4 Pro 模型。**

### 3. 🧬 自进化，越用越强

借助 PenguinHarness 技能库，Agent 自己评估、自己优化：跑 Benchmark、找失分点、发布 N+1 版——每轮之前自动快照，每个请求都可在轨迹观测中回放。

https://github.com/user-attachments/assets/aec49ae9-b743-467b-b247-37bedfeaa36e

## 内置 Skill 库

开箱内置四组 Skill（[文档](https://penguin.ooo/docs/skills)），Agent 也能编写并优化自己的 Skill：

| 分组        | Skill                                                                          |
| ----------- | ------------------------------------------------------------------------------ |
| 办公效率    | `data-analysis`、`firecrawl`                                                   |
| 软件开发    | `web-design`、`software-engineering`                                           |
| AI 应用开发 | `penguin-sdk`、`penguin-cli`、`agenthub-models`、`vllm`、`ollama`、`llamafactory` |
| Agent 调优  | `agent-creation`、`benchmark-design`、`agent-evaluation`、`agent-optimization` |

## 支持的模型

| 模型             | 可用供应商                                                                       |
| ---------------- | -------------------------------------------------------------------------------- |
| DeepSeek V4      | DeepSeek, OpenRouter, Fireworks AI, SiliconFlow, Qwen Token Plan, Qwen Pay-As-You-Go |
| Kimi K3          | Moonshot AI, OpenRouter, Qwen Pay-As-You-Go                                      |
| GLM 5.2          | Z.AI, OpenRouter, Fireworks AI, SiliconFlow, Qwen Token Plan, Qwen Pay-As-You-Go |
| Hunyuan 3        | OpenRouter                                                                       |
| Qwen 3.8 Max     | Qwen Token Plan, Qwen Pay-As-You-Go, OpenRouter                                  |
| GPT 5.6          | OpenRouter                                                                       |
| Gemini 3.6 Flash | Google Gemini, OpenRouter                                                        |
| Claude 5         | Anthropic, OpenRouter                                                            |

上表每个系列只列最新一代，完整预置清单请在应用的**模型**页查看；只要是 OpenAI 协议的端点都可以接入：选择预置，或用自定义端点连接 1000+ 在线与本地模型。

## 系统需求

| 需求项   | 支持情况                                          |
| -------- | ------------------------------------------------- |
| 操作系统 | Linux、macOS、Windows 10+                         |
| 架构     | x64、arm64                                        |
| 运行时   | 一行安装器自带（经 npm 安装需 Node >= 24）        |
| 模型     | 至少一个模型的 API key                            |

## 安装

每种方式装出的都是同一个 `penguin` 命令：`penguin web` 启动完整 Web 体验（多会话对话、Agent / 技能 / 模型管理、用量统计、轨迹观测、评估中心；首次登录使用 `admin`，初始密码在服务端首次启动时打印，形如 `penguin-1234`，登录后请尽快修改密码），在应用内模型页配置模型后即可对话。在线安装器自带 Node 运行时，解压即用，升级与重装不触碰数据。

### 🐧 Linux（在线安装）

```bash
curl -fsSL https://penguin.ooo/install.sh | sh
penguin web        # 启动服务并打开 http://127.0.0.1:7364
```

### 🍎 macOS（在线安装）

```bash
curl -fsSL https://penguin.ooo/install.sh | sh
penguin web        # 启动服务并打开 http://127.0.0.1:7364
```

### 🪟 Windows（在线安装，PowerShell）

```powershell
irm https://penguin.ooo/install.ps1 | iex
penguin web        # 启动服务并打开 http://127.0.0.1:7364
```

### 📦 npm（任意平台，需 Node >= 24）

```bash
npm install -g @prismshadow/penguin-cli
penguin web        # 启动服务并打开 http://127.0.0.1:7364
```

### 🖥️ 桌面端应用

完整的 Web 体验打包为独立应用：内嵌服务端，打开即已登录——无需终端、无登录页、也不用抄初始密码——并与 CLI 安装共用同一个 `~/.penguin/data` 数据目录，两者可以混用（一个数据目录同一时刻只运行一个服务端；CLI 已启动实例时，应用会直接接入它）。macOS（dmg，Apple 芯片 / Intel）、Windows 与 Linux（AppImage / deb）的安装包可在[下载页](https://penguin.ooo/download)获取——国内自动走 OSS 镜像加速——也附于每个 [GitHub Release](https://github.com/Prism-Shadow/penguin-harness/releases)。当前构建暂未签名：macOS 首次启动请右键 →「打开」，Windows 在 SmartScreen 提示中选「仍要运行」。

<details>
<summary><b>📴 离线安装（无网环境）</b></summary>

每个 <a href="https://github.com/Prism-Shadow/penguin-harness/releases">GitHub Release</a> 每个目标只附带一个安装包——Linux 与 macOS 各有 x64 / arm64 两种架构，Windows 为 x64，另有不带运行时的 universal 包——同一个文件同时服务在线与离线安装。包内封入程序负载、其 SHA256 校验文件与对应平台的安装器：在有网机器下载这一个文件，拷贝到目标机器，解压一次并运行包内安装器即可——全程无需联网，也不必另外携带校验文件（包内封入的 SHA256 始终强制校验）。

**Linux（arm64 机器换用 `penguin-linux-arm64.tar.gz`）：**

```bash
mkdir penguin-install
tar -xzf penguin-linux-x64.tar.gz -C penguin-install
./penguin-install/install.sh
```

**macOS（Apple 芯片用 arm64 包，Intel 芯片换用 `penguin-darwin-x64.tar.gz`）：**

```bash
mkdir penguin-install
tar -xzf penguin-darwin-arm64.tar.gz -C penguin-install
./penguin-install/install.sh
```

**Windows（解压后双击 `install.cmd`，或在 PowerShell 中运行）：**

```powershell
Expand-Archive penguin-win32-x64.zip -DestinationPath penguin-install
cd penguin-install
.\install.cmd
```

</details>

### 🤖 CLI 与 SDK——面向 Agent

同一引擎、可脚本化——为被 Agent 驱动而生（以及让 Agent 构建 Agent）：

```bash
penguin config model add --provider deepseek --model-id deepseek-v4-flash --api-key sk-... --set-default
penguin run -m "Create hello.txt containing Hello, Penguin"   # 单次任务
penguin chat       # 交互式 REPL（/compact、/exit、Ctrl-C 中断）
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

- [ ] Benchmark 套件正式发布
- [x] 桌面端应用
- [x] Windows 系统支持
- [ ] Agent 公司与模板
- [ ] 公司级自进化能力
- [ ] 集成 OpenShell（带权限管控的 shell）
- 更多规划，敬请期待……

## 参与开发

```bash
pnpm install && pnpm build   # 先构建：core 的导出指向 dist/
pnpm dev                     # 服务端 + Web 一起启动（带前缀日志，依赖只构建一次）
```

完整工作区指南见 [CONTRIBUTING.md](CONTRIBUTING.md)：开发命令、质量门禁、仓库结构与 changelog 规则。

## 贡献者

感谢每一位为 PenguinHarness 作出贡献的开发者！

<p align="center">
  <a href="https://github.com/Prism-Shadow/penguin-harness/graphs/contributors"><img src="https://contrib.rocks/image?repo=Prism-Shadow/penguin-harness" alt="PenguinHarness 贡献者" /></a>
</p>

## 引用

如果 PenguinHarness 对你的研究有帮助，请引用：

```bibtex
@software{penguinharness2026,
  author  = {{PrismShadow Team}},
  title   = {PenguinHarness: Efficient Self-Improving Harness for Everyone},
  year    = {2026},
  url     = {https://github.com/Prism-Shadow/penguin-harness},
  license = {Apache-2.0}
}
```

## 协议

[Apache-2.0](LICENSE) © 2026 Prism Shadow

由 [LlamaFactory](https://github.com/hiyouga/LlamaFactory) 作者 [Yaowei Zheng](https://github.com/hiyouga)、[PrismShadow AI Team](https://github.com/Prism-Shadow) 与 [Fable 5](https://www.anthropic.com/news/claude-fable-5-mythos-5) 共同用 ❤️ 构建。

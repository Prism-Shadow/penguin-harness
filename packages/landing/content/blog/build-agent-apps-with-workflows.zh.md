---
title: "给每个 Agent 一个热定制工作台"
date: 2026-10-13
category: practice
excerpt: "在 PenguinHarness 里，每个 Agent 都能有自己的工作台：一个自定义页面，背后是服务端代码，一句话就能搭出来，Agent 每次修改都会热更新。本教程给法务 Agent 搭一个合同工作台，开口修改它，再恢复到之前的版本。"
---

工作台是属于单个 Agent 的自定义 AI 应用：一个显示在对话旁边的页面，背后是服务端代码，以 workflow（工作流）的形式保存在 Agent 自己的文件夹里。Agent 按你的要求把它搭出来，之后也照样开口修改。每次修改都会先做类型检查，再热更新到已打开的标签页；加载成功过的每个版本都会保留，任何修改都能撤销。

工作台属于 Agent 自己，所以每个 Agent 的工作台都可以不一样：法务 Agent 是合同工作台，数据 Agent 是仪表盘，客服 Agent 是工单队列。[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 也允许插件给它的 Web UI 添加面板，但那是开发者为整个应用编写的客户端插件。在 PenguinHarness 里，工作台由 Agent 自己写，应用的其他部分都不受影响。

本教程从起始页上的法务 Agent 示例开始：一条消息就能创建一个法务 Agent，并给它一个工作台，用来上传合同、下载审查报告。然后你开口让它修改工作台，再恢复到修改前的版本。

## 准备工作

- PenguinHarness 0.2.14，桌面端或 Web App 都可以。
- 在**模型库**页面配置好一个模型。
- 作为起点的 Agent 要有 `agent-initialization`、`penguin-plugin` 和 `web-design` 三个 Skill。新建 Project 的默认 Agent 三个都有。

## 第 1 步：从示例开始

1. 选择**新建对话**。
2. 在**示例与快捷指令**下，打开**一句话生成 AI 应用**，选择**一句话构建法务智能体应用**。
3. 提示词已填入消息框，上方选中了那三个 Skill。点发送之前什么都不会发出去，想要别的页面可以先改提示词。

![法务 Agent 示例填好的消息框，已选中 agent-initialization、penguin-plugin 和 web-design](/blog-assets/workflow-example-zh.png)

## 第 2 步：让 Agent 构建

1. 发送这条消息。
2. Agent 创建法务 Agent，在 `AGENTS.md` 里写下它的角色，再把工作流写进新 Agent 的文件夹：`package.json`、`index.ts` 和 `ui/index.html`。
3. 最后它会读取 `.build/status.json`，服务端用这个文件报告工作流是否加载成功。新 Agent 的对话页面打开过一次之后，服务端才会开始监视它的工作流，所以文件还没出现时，先做第 3 步，再让 Agent 检查一次。

![构建对话：Agent 创建 legal_agent，写入 AGENTS.md 和三个工作流文件，然后读取加载状态](/blog-assets/workflow-build-zh.png)

## 第 3 步：打开 Agent 的页面

1. 选择**新建对话**，在消息框下方的 Agent 菜单里选中新创建的法务 Agent。
2. 对话上方出现一条标签栏：一个是**聊天**，另一个是工作流的标签页。选择工作流的标签页。

页面上方的栏里显示工作流的名称、版本和 revision，以及**占满应用**、**重新加载**、**历史**和**移除**。页面的所有颜色都取自应用传入的主题变量，因此会跟随浅色和深色模式。

![法务 Agent 的合同工作台标签页：上传区和文件列表，每个文件显示状态和报告下载](/blog-assets/workflow-page-zh.png)

## 第 4 步：开口就能改

1. 选择**聊天**，说出你要的修改。本教程的要求是：“在工作台上，把每份合同的整体风险显示在状态旁边，并把风险最高的合同排在最前面。”
2. Agent 修改 `ui/` 下的文件，然后再次读取 `.build/status.json`，确认修改已加载。

![Agent 读取 ui/index.html，修改两次，然后检查重新加载的结果](/blog-assets/workflow-edit-zh.png)

3. 切到工作流的标签页，新版本已经在显示了：只要工作流的页面有变化，开着的标签页就会自己刷新。

![修改后的工作台，多了一列「风险」，风险最高的合同排在最前](/blog-assets/workflow-page-after-zh.png)

## 第 5 步：恢复到之前的版本

1. 选择**历史**。每个加载成功的版本都列出了 revision、时间和文件数；正在使用的那个标着**当前**。
2. 在某个更早的版本上选择**恢复**并确认。它的文件会替换当前文件，工作流随之重新加载。`state.json` 里的工作流数据保持原样。

![页面上方展开的「历史」：当前版本和它的上一个版本，带恢复按钮](/blog-assets/workflow-history-zh.png)

也可以直接让 Agent 撤销上一次修改。`penguin-plugin` Skill 会让 Agent 从 `workflows-history/` 把记录下来的版本复制回来。

## 第 6 步：让页面占满整个应用

1. 选择**占满应用**。页面单独打开，没有侧边栏、对话区，也没有标签栏。
2. 要退出，打开命令面板（默认快捷键：macOS 上是 ⌥⌘P，其他平台是 Ctrl+Alt+P），然后选择**退出全页模式（回到聊天）**。

`penguin web --app <project>/<agent>/<workflow>` 会启动服务端，并直接在浏览器里打开那个页面。

![工作台占满整个应用](/blog-assets/workflow-fill-app-zh.png)

## 文件都放在哪里

工作流的一切都是文件，放在它所属 Agent 的文件夹里，位于数据根目录下（默认是 `~/.penguin/data`）：

```
<project>/agents/<agent>/
  workflows/<id>/
    package.json   清单，包括它添加的标签页
    index.ts       服务端代码：一个用 TypeScript 写的请求处理函数
    ui/            页面
    state.json     工作流自己的数据，重新加载和恢复版本时都会保留
    .harness/      由服务端写入：工作流所依据的类型定义
    .build/        由服务端写入：编译产物和 status.json
  workflows-history/<id>/<revision>/   每个已记录版本的文件副本
```

## 限制

- 服务端代码必须是 `index.ts` 里的 TypeScript。服务端按自己的 `strict` 设置做类型检查，忽略 `tsconfig.json`；如果文件夹里放的是 `index.js` 或 `index.mjs`，服务端会拒绝。
- 加载失败的修改不会上线，上一个版本继续运行。标签页会显示**加载失败**和原因（类型错误会给出文件、行号和错误信息），`.build/status.json` 里也写着同样的原因，供 Agent 读取。
- 每个工作流最多保留 20 个版本，而且只记录加载成功的版本。
- `state.json` 没有历史。恢复版本不会改动它，覆盖掉的数据没有任何办法找回。**移除**会删除工作流和所有已记录的版本。
- 只有打开过某个 Agent 的对话页面，服务端才会开始监视这个 Agent 的工作流。如果 Agent 写出了第一个工作流，`.build/status.json` 却迟迟不出现，把这个 Agent 的对话页面打开一次就好。

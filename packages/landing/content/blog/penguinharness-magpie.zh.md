---
title: "PenguinHarness 正式支持 Magpie：任意模型一键接入"
date: "2026-11-02"
category: "news"
excerpt: "下面跟着截图走完三步，就能把已有模型带进 PenguinHarness。"
---

常用 PenguinHarness 的小伙伴们，是不是也有过这样的想法：

在其他工具或订阅来源里明明还有受支持的模型额度，或者已经配好了可用的 API Key，能不能直接拿过来在 PenguinHarness 里用？

现在，PenguinHarness 正式支持接入 Magpie，帮你解决了这个麻烦。

![Magpie 官网关于统一管理多来源模型并接入各类 Agent 的介绍截图](/blog-assets/magpie-integration-overview-zh.png)

Magpie 是一款主打“每个 Agent 的模型，一处搞定”的模型网关工具，它能把受支持的已登录订阅来源、各家 API Key 和本地模型统一汇总起来，提供给电脑上受支持的 Agent 使用。

接入后，你不仅能在 PenguinHarness 里直接选用这些已配置可用的模型来源，也不用再重新填写一遍 API Key 和接口地址。只要在 Magpie 里打开接入开关，你配置的模型就会同步进 PenguinHarness 供选择调用。

![PenguinHarness 通过 Magpie 连接订阅账号来源（ZCode、WorkBuddy）、API 模型平台（DeepSeek、SiliconFlow）与本地模型（Ollama、LM Studio）的关系图](/blog-assets/magpie-integration-sources-zh.svg)

下面跟着截图走完三步，就能把已有模型带进 PenguinHarness。

## 第一步：在 Magpie 准备好模型来源

首先确认电脑上已安装并运行 [PenguinHarness](https://github.com/Prism-Shadow/penguin-harness) 与 [Magpie](https://usemagpie.ai/)。

打开 Magpie，进入左侧的 **供应商** 页面，确保里面至少有一个已配置可用的模型来源——无论是添加平台 API Key、连接受支持的订阅来源，还是接入本机运行的模型都可以。如果平时已经配好，直接进入下一步。

![Magpie 的供应商页面，展示已配置的模型来源列表](/blog-assets/magpie-integration-providers-zh.jpg)

## 第二步：打开 PenguinHarness 接入开关

切到 Magpie 左侧的 **Agent** 页面，在列表中找到 **PenguinHarness**。如果刚装好还没看到，可以点一下页面右上角的刷新图标。

![Magpie 的 Agent 页面，在已检测到的 Agent 列表中突出显示 PenguinHarness 卡片](/blog-assets/magpie-integration-agent-card-zh.png)

打开 PenguinHarness 行右侧的开关。当状态显示为 **已接入**，模型接入配置就已经同步完成了。

![Magpie 的 Agent 页面中 PenguinHarness 开关已开启并显示已接入状态](/blog-assets/magpie-integration-connected-zh.jpg)

现在，我们回到 PenguinHarness，就能在 **模型库** 里看到 magpie 的模型分组了：

![PenguinHarness 模型库页面中展示已同步的 magpie 模型分组](/blog-assets/magpie-integration-model-library-zh.png)

## 第三步：选择 magpie 模型并发起对话

在 PenguinHarness 中点击左侧栏的 **新建对话**，点开模型选择器，就能在 magpie 分组下看到同步过来的模型。这里我们以选择 GPT-6.1-Sol 为例：

![在 PenguinHarness 新建对话的模型选择器中选用 magpie 分组下的 GPT-6.1-Sol](/blog-assets/magpie-integration-model-picker-zh.png)

选好模型后直接发送一条消息，比如让它计算 17 × 23，收到正常回复即代表调用成功：

![PenguinHarness 使用 GPT-6.1-Sol 模型回复 17 × 23 = 391 的对话界面](/blog-assets/magpie-integration-conversation-zh.png)

如果想进一步确认请求走向，可以切回 Magpie 的 **用量** 页面查看刚才那条请求记录，确认请求来自 PenguinHarness 且已成功完成即可。

![Magpie 用量页面记录来自 PenguinHarness 的 gpt-6.1-sol 请求成功完成](/blog-assets/magpie-integration-usage-zh.png)

Magpie 下载链接：[https://usemagpie.ai/zh/](https://usemagpie.ai/zh/)

---
title: 携手 AMD 开发者计划：免费领取 $50 Fireworks 额度，PenguinHarness 直接可用
date: 2026-07-20
category: news
excerpt: 我们与 AMD AI Developer Program 合作，为大家提供免费的 Fireworks 兑换码。本文介绍如何在 AMD 国际站或中国站申请 $50 Credits，再在 PenguinHarness 里三步用起来。
---

> 本文基于 PenguinHarness 0.1.0 撰写，之后的版本在部分细节上可能有所不同。

我们与 **AMD AI Developer Program**（AMD 开发者计划）合作，为大家带来免费的 Fireworks 兑换码。加入计划并通过审核，就能拿到一个兑换码，可兑换 **$50 Fireworks AI Credits**。PenguinHarness 内置 Fireworks AI 网关分组，OpenAI 协议、base URL 和五个模型都已预置，额度到手就能用。

这个计划有国际站和中国站两个站点。两边的前两步不同，从填写申请表开始，步骤完全相同。

> 页面内容、Credits 金额与有效期可能调整，请以申请页面和审批邮件为准。

## 第一步：注册或登录

- **国际站**：打开 <https://developer.amd.com/ai-developer-program/>，在 **Join the AMD AI Developer Program** 区域点击 **Create Account**，填写个人信息。已有 AMD ADP 账号的，点击 **Log In**，按页面提示登录。
- **中国站**：打开 <https://developer.amd.com.cn/login?source=2a6CMBw3K>，点击**注册账号**，填写个人信息，创建 ADP 账号。已有账号的，点击**登录**，按页面提示登录。

<img width="327" height="690" alt="image 2" src="https://github.com/user-attachments/assets/e904e4aa-28e4-424e-98e1-373275000623" />

## 第二步：进入申请页

登录后：

- **国际站**：
  1. 点击顶部导航栏中的 **Member Perks**。
  2. 找到 **Cloud Credit Options**。
  3. 点击页面底部的 **Request Cloud Credits**。
- **中国站**：从首页的**新闻/公告**进入活动，或者在**活动中心**打开相关活动页，然后点击**去申请**。

<img width="1533" height="904" alt="image" src="https://github.com/user-attachments/assets/650ad0a8-6f27-4fea-b157-381d24fb3d15" />

## 第三步：填写申请表

按表单要求填写个人信息：

- 在 **Product Needed** 处选择 **Fireworks AI**。
- 在 **Profile** 处至少填写一个公开资料，用于账号验证。LinkedIn、GitHub、作品集、公司或学校主页、微信、企业微信等都可以。审核人员会查看这些资料，评估你的申请资格。

填好其他带 `*` 的必填项，核对邮箱、身份、产品选项和公开资料链接，确认无误后提交。

## 第四步：等待审核

AMD 会验证你的账号和申请资料，通常需要 2–3 个工作日。实际时间会受申请量、资料完整度和节假日影响。

## 第五步：接收兑换码

审核通过后，AMD 会向申请邮箱发送邮件，邮件里有一个唯一的兑换码（Coupon Code），可兑换 $50 Fireworks AI Credits。请妥善保存，不要公开、转发，也不要提交到代码仓库。

## 第六步：兑换 Credits 并创建 API key

1. 打开 <https://fireworks.ai/> 并登录。
2. 点击 **Redeem Promo**，输入邮件里的兑换码，兑换 $50 Credits。
3. 点击 **Create API Key**，生成 Fireworks API key。

<img width="1462" height="733" alt="image 1" src="https://github.com/user-attachments/assets/179c8f11-18f2-4e80-b0b0-4d48fd81db80" />

## 在 PenguinHarness 中用起来

拿到 API key 后，三步接入：

1. 安装 PenguinHarness 并启动 Web App：

   ```bash
   curl -fsSL https://penguin.ooo/install.sh | sh
   penguin web        # 打开 http://127.0.0.1:7364（首次登录：admin / penguin-2026，登录页上也有提示）
   ```

2. 打开**模型仓库**页面，找到 **Fireworks AI** 分组，点击**统一配置 API key**，粘贴刚创建的 API key。分组预置了五个模型：GLM 5.2、Kimi K2.7 Code、DeepSeek V4 Pro、MiniMax M3 和 DeepSeek V4 Flash，base URL 与价格都已填好，任选一个设为默认即可。想先比较各模型的实测 TTFT 与 TPS，可以点击分组上的**测速**。
3. 回到**对话**页面，把第一个任务交给 Agent，例如「分析 data.csv，输出各季度销售额汇总」。

## 参考链接

- [AMD AI Developer Program](https://developer.amd.com/ai-developer-program/)
- [AMD AI Developer Program 中国站](https://developer.amd.com.cn/login?source=2a6CMBw3K)
- [AMD 官方 Cloud Credits 申请视频教程](https://www.youtube.com/watch?v=masSW53JkTY)
- 国际站的申请步骤与截图整理自 WhatGhost 的申请指南（[中文](https://github.com/WhatGhost/whatghost_Notebooks/blob/main/other/AMD_AI_Developer_Program_Credits_%E7%94%B3%E8%AF%B7%E6%8C%87%E5%8D%97.md) / [English](https://github.com/WhatGhost/whatghost_Notebooks/blob/main/other/AMD_AI_Developer_Program_Credits_Application_Guide_EN.md)），中国站的申请步骤与截图整理自 [AMD AI Developer Program 官方申请指南](https://acn658bi9o7j.feishu.cn/docx/T8VIdjkZXoqyDwxwNjacbcsYngd)。感谢各位原作者。
- [PenguinHarness 模型配置文档](https://penguin.ooo/docs/models)

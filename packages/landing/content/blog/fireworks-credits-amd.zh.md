---
title: 携手 AMD 开发者计划：免费领取 $50 Fireworks 额度，直连 PenguinHarness
date: 2026-07-20
category: news
excerpt: 我们很高兴与 AMD AI Developer Program 合作，为大家带来 Fireworks 的免费兑换码——按本文申请 $50 Credits，再在 PenguinHarness 里三步用起来。
---

我们很高兴与 **AMD AI Developer Program**（AMD 开发者计划）合作，为大家带来 Fireworks 的免费兑换码：加入计划并通过审核，即可获得可兑换 **$50 Fireworks AI Credits** 的 Coupon Code。PenguinHarness 内置 Fireworks AI 网关分组——OpenAI 协议、预置 base URL 与五个模型，额度到手即刻可用。

> 页面内容、Credits 金额与有效期可能调整，请以申请时的页面及审批邮件为准。

## 第一步：加入 AMD AI Developer Program

访问官方入口：<https://developer.amd.com/ai-developer-program/>，在 **Join the AMD AI Developer Program** 区域：

- 没有 AMD ADP 账户：点击 **Create Account**，填写个人信息创建账户；
- 已有账户：点击 **Log In**，按页面提示登录。

![AMD AI Developer Program 加入页面](https://github.com/user-attachments/assets/47a3055b-9a95-40a1-80c6-e3bac7a9ac49)

## 第二步：在 Member Perks 申请 Cloud Credits

注册并登录后：

1. 点击顶部导航栏中的 **Member Perks**；
2. 找到 **Cloud Credit Options**；
3. 点击底部的 **Request Cloud Credits**。

![Member Perks 中的 Cloud Credit Options](https://github.com/user-attachments/assets/773f8cf1-d72f-4aa3-83b8-f31fc7c9ed9e)

## 第三步：填写申请表

进入申请表后填写个人信息：

- **Product Needed** 处选择 **Fireworks AI**；
- **Profile** 处提供至少一个公开资料用于账户验证：LinkedIn、GitHub、Portfolio、公司 / 学校主页、WeChat、WeCom 等均可。

![申请表：Product Needed 选择 Fireworks AI](https://github.com/user-attachments/assets/12a49136-0956-4f29-9d47-f0e473615075)

填完页面中其他带 `*` 的必填项，检查邮箱、身份、产品选项与公开资料链接无误后提交。

## 第四步：等待审核

AMD 会验证账户与申请资料，通常需要 **2–3 个工作日**；实际时间可能因申请量、资料完整度或节假日而变化。

## 第五步：收到兑换码并兑换

审核通过后，AMD 会向申请邮箱发送包含唯一 **Coupon Code** 的邮件，可兑换 **$50 Fireworks AI Credits**。请妥善保存，不要公开、转发或提交到代码仓库。

![审批邮件中的 Coupon Code](https://github.com/user-attachments/assets/c53129c7-2c87-4510-a4e3-31f52598dc24)

兑换与创建 API key：

1. 打开 <https://fireworks.ai/> 并登录；
2. 点击 **Redeem Promo**，输入邮件中的 Coupon Code，兑换 $50 Credits；
3. 点击 **Create API Key**，生成 Fireworks API key。

![在 Fireworks 控制台兑换并创建 API key](https://github.com/user-attachments/assets/051a1e69-db7f-4867-b899-89981df15142)

## 在 PenguinHarness 中用起来

拿到 API key 后，三步接入：

**1. 安装并启动**

```bash
curl -fsSL https://penguin.ooo/install.sh | sh
penguin web        # 打开 http://127.0.0.1:7364（首次登录：admin / admin123）
```

**2. 配置 Fireworks 模型**

进入「模型仓库」页，找到 **Fireworks AI** 分组，点击「统一配置 key」粘贴刚创建的 API key。分组预置了五个模型——GLM 5.2、Kimi K2.7 Code、DeepSeek V4 Pro、MiniMax M3、DeepSeek V4 Flash——base URL 与价格已填好，任选一个设为默认即可；也可以点组头的「测速」，实测各模型的 TTFT 与 TPS 再决定。

**3. 开始使用**

回到对话页，把第一个任务交给 Agent——例如「分析 data.csv，输出各季度销售额汇总」。

## 参考链接

- [AMD AI Developer Program](https://developer.amd.com/ai-developer-program/)
- [AMD 官方 Cloud Credits 申请视频演示](https://www.youtube.com/watch?v=masSW53JkTY)
- 申请步骤与截图整理自 WhatGhost 的申请指南（[中文](https://github.com/WhatGhost/whatghost_Notebooks/blob/main/other/AMD_AI_Developer_Program_Credits_%E7%94%B3%E8%AF%B7%E6%8C%87%E5%8D%97.md) / [English](https://github.com/WhatGhost/whatghost_Notebooks/blob/main/other/AMD_AI_Developer_Program_Credits_Application_Guide_EN.md)），感谢原作者
- [PenguinHarness 模型配置文档](https://penguin.ooo/docs/models)

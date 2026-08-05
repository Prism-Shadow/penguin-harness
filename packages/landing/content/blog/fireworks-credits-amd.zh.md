---
title: 携手 AMD 开发者计划：免费领取 $50 Fireworks 额度，直连 PenguinHarness
date: 2026-07-20
category: news
excerpt: 我们很高兴与 AMD AI Developer Program 合作，为大家带来 Fireworks 的免费兑换码——按本文申请 $50 Credits，再在 PenguinHarness 里三步用起来。
---

我们很高兴与 **AMD AI Developer Program**（AMD 开发者计划）合作，为大家带来 Fireworks 的免费兑换码：加入计划并通过审核，即可获得可兑换 **$50 Fireworks AI Credits** 的 Coupon Code。PenguinHarness 内置 Fireworks AI 网关分组——OpenAI 协议、预置 base URL 与五个模型，额度到手即刻可用。

> 页面内容、Credits 金额与有效期可能调整，请以申请时的页面及审批邮件为准。

## 第一步：打开 AMD AI Developer Program 页面

访问 AMD AI Developer Program 中国站官方入口：

点击此链接 [AMD AI Developer Program 中国站](https://developer.amd.com.cn/login?source=2a6CMBw3K)

或在浏览器中输入下面的网址

https://developer.amd.com.cn/login?source=2a6CMBw3K

- 没有 AMD ADP账户：点击 “注册账号”。输入个人信息，创建ADP账户。

- 已有 AMD ADP 账户：点击“登录”，然后按页面提示登录。

![image\.png](图片和附件/image%202.png)

## 第二步：进入活动页

点击首页“新闻/公告”或进入“活动中心”相关活动页，点击“去申请”。

![image\.png](图片和附件/image.png)

## 第三步：填写 Credits 申请表

进入申请表后，填写对应的个人信息。

在Product Needed 处默认选择Fireworks AI。

在Profile从处至少一个公开资料用于账户验证。审核人员将查看您的相关账号用于评估您的申请资格。



填写页面中其他带 `*` 的必填项，检查邮箱、身份、产品选项和公开资料链接无误后提交申请。



## 第四步：等待审核

提交后，AMD 会验证账户及申请资料。A通常需要 2–3 个工作日，实际时间可能因申请量、资料完整度或节假日而变化。



## 第五步：收到邮件并激活 Credits

审核通过后，AMD 会向申请邮箱发送附带兑换码的邮件

审批邮件包含一个唯一 Coupon Code，用于兑换 $50 Fireworks AI Credits，请妥善保存，请勿公开、转发或提交到代码仓库中。


## 第六步：兑换 Fireworks AI Credits 并创建 API Key

1. 打开 [https://fireworks\.ai/](https://fireworks.ai/) 并登录 Fireworks AI 账户。

2. 点击 Redeem Promo，输入邮件中的 Coupon Code，兑换 $50 Credits。

3. 兑换成功后，点击 Create API Key，即可生成 Fireworks API Key。

![image\.png](图片和附件/image%201.png)


## 在 PenguinHarness 中用起来

拿到 API key 后，三步接入：

**1. 安装并启动**

```bash
curl -fsSL https://penguin.ooo/install.sh | sh
penguin web        # 打开 http://127.0.0.1:7364（首次登录：admin，初始密码见首次启动输出）
```

**2. 配置 Fireworks 模型**

进入「模型仓库」页，找到 **Fireworks AI** 分组，点击「统一配置 key」粘贴刚创建的 API key。分组预置了五个模型——GLM 5.2、Kimi K2.7 Code、DeepSeek V4 Pro、MiniMax M3、DeepSeek V4 Flash——base URL 与价格已填好，任选一个设为默认即可；也可以点组头的「测速」，实测各模型的 TTFT 与 TPS 再决定。

**3. 开始使用**

回到对话页，把第一个任务交给 Agent——例如「分析 data.csv，输出各季度销售额汇总」。

## 参考链接

- [AMD AI Developer Program 中国站](https://developer.amd.com.cn/login?source=2a6CMBw3K)
- 申请步骤与截图整理自[AMD AI Developer Program 官方申请指南](https://acn658bi9o7j.feishu.cn/docx/T8VIdjkZXoqyDwxwNjacbcsYngd)，感谢原作者
- [PenguinHarness 模型配置文档](https://penguin.ooo/docs/models)

---
title: "Partnering with the AMD AI Developer Program: $50 in free Fireworks credits, ready to use in PenguinHarness"
date: 2026-07-20
category: news
excerpt: We have partnered with the AMD AI Developer Program to offer free Fireworks coupon codes. This guide shows how to apply for $50 in credits on AMD's global or China site, then set them up in PenguinHarness in three steps.
---

> Written for PenguinHarness 0.1.0. Later releases may differ in some details.

We have partnered with the **AMD AI Developer Program** to bring you free Fireworks redemption codes. Join the program and pass its review, and you receive a coupon code worth **$50 in Fireworks AI Credits**. PenguinHarness has a built-in Fireworks AI gateway group, with the OpenAI protocol, the base URL and five models preset, so you can use the credits as soon as they arrive.

The program has a global site and a China site. The first two steps differ between them; from the application form onward, the steps are the same.

> Page content, credit amounts and expiration dates may change. Check the application page and the approval email for the latest details.

## Step 1: Create an account or sign in

- **Global site:** open <https://developer.amd.com/ai-developer-program/>. In the **Join the AMD AI Developer Program** section, click **Create Account** and enter your personal information. If you already have an AMD ADP account, click **Log In** and follow the on-screen instructions.
- **China site:** open <https://developer.amd.com.cn/login?source=2a6CMBw3K>. Click **注册账号** (Register) and enter your personal information to create an ADP account. If you already have one, click **登录** (Log in) and follow the prompts.

![The Join the AMD AI Developer Program section on the global site, with the Create Account and Log In buttons](https://github.com/user-attachments/assets/47a3055b-9a95-40a1-80c6-e3bac7a9ac49)

## Step 2: Open the application

After you sign in:

- **Global site:**
  1. Click **Member Perks** in the top navigation bar.
  2. Find **Cloud Credit Options**.
  3. Click **Request Cloud Credits** at the bottom of the page.
- **China site:** open the campaign from **新闻/公告** (News/Announcements) on the home page, or open the campaign page in **活动中心** (Events Center). Then click **去申请** (Apply).

![Cloud Credit Options under Member Perks on the global site](https://github.com/user-attachments/assets/773f8cf1-d72f-4aa3-83b8-f31fc7c9ed9e)

## Step 3: Fill in the application form

Fill in the personal information the form asks for:

- Under **Product Needed**, select **Fireworks AI**.
- In the **Profile** section, give at least one public profile for account verification. LinkedIn, GitHub, a portfolio, a company or school profile, WeChat, WeCom and similar profiles all work. Reviewers look at these profiles to decide whether you are eligible.

![The application form, with Fireworks AI selected under Product Needed](https://github.com/user-attachments/assets/12a49136-0956-4f29-9d47-f0e473615075)

Complete the other required fields, marked with `*`. Check your email address, identity, product choice and profile links, then submit.

## Step 4: Wait for the review

AMD verifies your account and application. This usually takes 2–3 business days; the actual time depends on the number of applications, how complete your information is, and holidays.

## Step 5: Receive the coupon code

When your application is approved, AMD emails the address you applied with. The email contains a unique coupon code worth $50 in Fireworks AI Credits. Keep it safe: do not post it publicly, forward it, or commit it to a repository.

![The coupon code in the approval email](https://github.com/user-attachments/assets/c53129c7-2c87-4510-a4e3-31f52598dc24)

## Step 6: Redeem the credits and create an API key

1. Open <https://fireworks.ai/> and sign in.
2. Click **Redeem Promo** and enter the coupon code from the email to redeem the $50 credits.
3. Click **Create API Key** to generate your Fireworks API key.

![The Fireworks console, with the Redeem Promo and Create API Key buttons](https://github.com/user-attachments/assets/051a1e69-db7f-4867-b899-89981df15142)

## Set it up in PenguinHarness

With the API key in hand, setup takes three steps:

1. Install PenguinHarness and start the Web App:

   ```bash
   curl -fsSL https://penguin.ooo/install.sh | sh
   penguin web        # opens http://127.0.0.1:7364 (first login: admin / penguin-2026, shown on the login page)
   ```

2. Open the **Models** page and find the **Fireworks AI** group. Click **Set API key for group** and paste the API key you just created. The group has five preset models, with base URLs and pricing filled in: GLM 5.2, Kimi K2.7 Code, DeepSeek V4 Pro, MiniMax M3 and DeepSeek V4 Flash. Set any of them as the default. To compare real TTFT and TPS before you choose, click the group's **Speed test** button.
3. Go back to **Chat** and give the agent its first task, for example "Analyze data.csv and summarize quarterly sales".

## References

- [AMD AI Developer Program](https://developer.amd.com/ai-developer-program/)
- [AMD AI Developer Program China site](https://developer.amd.com.cn/login?source=2a6CMBw3K)
- [Official AMD video tutorial on applying for Cloud Credits](https://www.youtube.com/watch?v=masSW53JkTY)
- The global-site steps and screenshots are adapted from WhatGhost's guides ([中文](https://github.com/WhatGhost/whatghost_Notebooks/blob/main/other/AMD_AI_Developer_Program_Credits_%E7%94%B3%E8%AF%B7%E6%8C%87%E5%8D%97.md) / [English](https://github.com/WhatGhost/whatghost_Notebooks/blob/main/other/AMD_AI_Developer_Program_Credits_Application_Guide_EN.md)), and the China-site steps and screenshots from the [official AMD AI Developer Program application guide](https://acn658bi9o7j.feishu.cn/docx/T8VIdjkZXoqyDwxwNjacbcsYngd) (in Chinese). Thanks to the original authors.
- [PenguinHarness model configuration docs](https://penguin.ooo/docs/models)

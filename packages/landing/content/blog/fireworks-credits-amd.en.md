---
title: "Partnering with the AMD Developer Program: $50 in free Fireworks credits, wired into PenguinHarness"
date: 2026-07-20
category: news
excerpt: We are delighted to partner with the AMD AI Developer Program to bring you free Fireworks coupon codes — apply for the $50 credits with this guide, then set them up in PenguinHarness in three steps.
---

We are delighted to partner with the **AMD AI Developer Program** to bring you free Fireworks redemption codes: join the program, pass the review, and you receive a Coupon Code redeemable for **$50 in Fireworks AI Credits**. PenguinHarness ships a built-in Fireworks AI gateway group — OpenAI protocol, preset base URL, five preset models — so the credits are usable the moment they land.

> Page content, credit amounts, and expiration dates are subject to change. Please refer to the application page and approval email for the latest information.

## Step 1: Join the AMD AI Developer Program

Visit the official page: <https://developer.amd.com/ai-developer-program/>. In the **Join the AMD AI Developer Program** section:

- No AMD ADP account yet: click **Create Account** and enter your personal information;
- Already have one: click **Log In** and follow the on-screen instructions.

![The AMD AI Developer Program join page](https://github.com/user-attachments/assets/47a3055b-9a95-40a1-80c6-e3bac7a9ac49)

## Step 2: Request Cloud Credits under Member Perks

After registering and signing in:

1. Click **Member Perks** in the top navigation bar;
2. Find **Cloud Credit Options**;
3. Click **Request Cloud Credits** at the bottom of the page.

![Cloud Credit Options under Member Perks](https://github.com/user-attachments/assets/773f8cf1-d72f-4aa3-83b8-f31fc7c9ed9e)

## Step 3: Complete the application form

Fill in the requested personal information:

- Under **Product Needed**, select **Fireworks AI**;
- In the **Profile** section, provide at least one public profile for account verification: LinkedIn, GitHub, a portfolio, a company or school profile, WeChat, WeCom, and similar all work.

![Application form: select Fireworks AI under Product Needed](https://github.com/user-attachments/assets/12a49136-0956-4f29-9d47-f0e473615075)

Complete the other required fields marked with `*`, double-check your email, identity, product selection, and profile link, then submit.

## Step 4: Wait for the review

AMD verifies your account and application, usually within **2–3 business days** — actual time varies with application volume, information completeness, and holidays.

## Step 5: Receive and redeem the coupon code

Once approved, AMD emails a unique **Coupon Code** redeemable for **$50 in Fireworks AI Credits** to your application address. Keep it secure — do not share it publicly, forward it, or commit it to a repository.

![The Coupon Code in the approval email](https://github.com/user-attachments/assets/c53129c7-2c87-4510-a4e3-31f52598dc24)

Redeem it and create an API key:

1. Open <https://fireworks.ai/> and sign in;
2. Click **Redeem Promo** and enter the Coupon Code from the email to redeem the $50 credits;
3. Click **Create API Key** to generate your Fireworks API key.

![Redeeming and creating an API key in the Fireworks console](https://github.com/user-attachments/assets/051a1e69-db7f-4867-b899-89981df15142)

## Set it up in PenguinHarness

With the API key in hand, three steps:

**1. Install and launch**

```bash
curl -fsSL https://penguin.ooo/install.sh | sh
penguin web        # opens http://127.0.0.1:7364 (first login: admin / penguin-2026)
```

**2. Configure a Fireworks model**

Open the Models page and find the **Fireworks AI** group, then use its bulk key button to paste the API key you just created. The group presets five models — GLM 5.2, Kimi K2.7 Code, DeepSeek V4 Pro, MiniMax M3, and DeepSeek V4 Flash — with base URLs and pricing pre-filled; set any of them as the default. You can also hit the group's speed-test button to measure real TTFT and TPS before choosing.

**3. Start working**

Head back to Chat and hand the Agent its first task — e.g. "Analyze data.csv and summarize quarterly sales".

## References

- [AMD AI Developer Program](https://developer.amd.com/ai-developer-program/)
- [Official AMD Cloud Credits application video tutorial](https://www.youtube.com/watch?v=masSW53JkTY)
- Application steps and screenshots are adapted from WhatGhost's guides ([中文](https://github.com/WhatGhost/whatghost_Notebooks/blob/main/other/AMD_AI_Developer_Program_Credits_%E7%94%B3%E8%AF%B7%E6%8C%87%E5%8D%97.md) / [English](https://github.com/WhatGhost/whatghost_Notebooks/blob/main/other/AMD_AI_Developer_Program_Credits_Application_Guide_EN.md)) — thanks to the original author
- [PenguinHarness model configuration docs](https://penguin.ooo/docs/models)

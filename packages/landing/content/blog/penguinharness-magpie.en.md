---
title: "PenguinHarness Officially Supports Magpie: One-Click Integration for Any Model"
date: "2026-11-02"
category: "news"
excerpt: "Follow the screenshots below in three steps to bring your existing models into PenguinHarness."
---

If you use PenguinHarness regularly, you may have wondered:

When you already have available quota from supported subscription sources or configured API keys in other tools, can you use them directly in PenguinHarness?

Now, PenguinHarness officially supports Magpie integration, taking the hassle out of repeating your setup.

![Magpie website overview showing unified model management across supported Agents](/blog-assets/magpie-integration-overview-en.jpg)

Magpie is a model gateway built around managing models for your Agents in one place. It brings together your logged-in, supported subscription sources, provider API keys, and local models, making them available to supported Agents on your machine.

Once connected, you can select your configured, available model sources directly in PenguinHarness without re-entering API keys or endpoint URLs. Turn on the integration toggle in Magpie, and your configured models will sync to PenguinHarness for you to select and call.

![Diagram showing PenguinHarness connected through Magpie to subscription sources (ZCode, WorkBuddy), API platforms (DeepSeek, SiliconFlow), and local models (Ollama, LM Studio)](/blog-assets/magpie-integration-sources-en.svg)

Follow the screenshots below in three steps to bring your existing models into PenguinHarness.

## Step 1: Prepare Your Model Sources in Magpie

First, make sure both [PenguinHarness](https://github.com/Prism-Shadow/penguin-harness) and [Magpie](https://usemagpie.ai/) are installed and running on your computer.

Open Magpie and go to the **Providers** page on the left. Make sure you have at least one configured and available model source—whether that is a platform API key, a supported subscription source, or a local model running on your machine. If you have already set this up, skip ahead to the next step.

![Magpie Providers page listing configured model sources](/blog-assets/magpie-integration-providers-en.png)

## Step 2: Turn On the PenguinHarness Integration Toggle

Switch to the **Agents** page on the left side of Magpie and find **PenguinHarness** in the list. If you just installed it and do not see it yet, click the refresh icon in the top-right corner.

![Magpie Agents page highlighting the PenguinHarness row and its toggle](/blog-assets/magpie-integration-agent-card-en.png)

Turn on the toggle on the right side of the PenguinHarness row. Once the status shows **Connected**, the model configuration has been synced.

![PenguinHarness row in Magpie's Agents page with the toggle enabled and status showing Connected](/blog-assets/magpie-integration-connected-en.png)

Now return to PenguinHarness, and you will see the `magpie` model group under **Models**:

![PenguinHarness Models page displaying the synced magpie model group](/blog-assets/magpie-integration-model-library-en.png)

## Step 3: Select a magpie Model and Start a Conversation

In PenguinHarness, click **New chat** in the left sidebar and open the model picker to see the synced models under the `magpie` group. Here we select `GPT-6.1-Sol` as an example:

![Selecting GPT-6.1-Sol under the magpie group in the PenguinHarness model picker](/blog-assets/magpie-integration-model-picker-en.png)

After selecting the model, send a message—for example, asking it to calculate `17 × 23`. Receiving a normal reply confirms the call succeeded:

![PenguinHarness conversation showing GPT-6.1-Sol replying 17 × 23 = 391](/blog-assets/magpie-integration-conversation-en.png)

To verify how the request was routed, switch back to Magpie's **Usage** page and check the latest request record to confirm that it came from PenguinHarness and completed successfully.

![Magpie Usage page showing the completed gpt-6.1-sol request from PenguinHarness](/blog-assets/magpie-integration-usage-en.png)

Download Magpie: [https://usemagpie.ai/](https://usemagpie.ai/)

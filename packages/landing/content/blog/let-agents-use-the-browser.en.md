---
title: "The browser extension: agents drive your Chrome smoothly, at low cost"
date: 2026-10-13
category: practice
excerpt: "Pair the PenguinHarness Browser extension, and your agents work in your own Chrome: in tabs you hand them, signed in where you are, reading pages as text rather than screenshots. The desktop app's built-in browser works the same way."
---

Some tasks only work on a web page, such as reading an order history behind a sign-in. With the PenguinHarness Browser extension, an agent does them in your own Chrome: in a Penguin tab group beside your tabs, already signed in where you are, from the desktop app or from the Web App on any server. You keep using Chrome while it works, and you follow its tabs in the **Browser** panel beside the conversation.

It works the page from its shell with `penguin browser`, and cheaply: it reads the page as text with `scan`, then acts with a short script through `exec`, which costs a few dozen tokens. A screenshot is taken only when the layout matters. This scan-then-exec design comes from [GenericAgent](https://github.com/lsdefine/genericagent), whose `web_scan` and `web_execute_js` work the same way in a real, signed-in browser. Thanks to its authors.

The desktop app also has a built-in browser with its own sign-ins. Set up either one, then go to "Hand the agent a task".

## Before you start

- PenguinHarness 0.2.15 or later, with a model set up on the **Models** page.
- For your own Chrome, Chrome 116 or later.
- For the built-in browser, the desktop app on macOS, Windows or Linux. The Web App served by `penguin web`, Docker or a remote server does not have it.
- The `browser-automation` plugin on the agent. PenguinHarness installs it on `default_agent` when it creates that agent. For any other agent, or a `default_agent` created before 0.2.15, install it from the **Plugins** page.

## Option A: your own Chrome, through the extension

1. In PenguinHarness, select your name at the bottom of the sidebar, then **Settings**. On the **Browser** page, select **Connect your Chrome**.
2. Select **Open the Chrome Web Store**, add PenguinHarness Browser to Chrome, and pin it to the toolbar. If the store cannot be reached, the dialog offers a zip to load in developer mode instead.

   ![The Connect your Chrome dialog: install steps, the server address and a one-time pairing code, waiting for Chrome](/blog-assets/browser-connect-chrome-en.png)

3. In Chrome, select the extension's icon, then **Settings**. On the pairing page, paste the **Server address** and the **Pairing code** from the dialog and select **Connect**. The code works once, for 10 minutes. The dialog switches to **Connected** and closes.

   ![The extension's pairing page after pairing: the server listed as connected](/blog-assets/browser-extension-pair-en.png)

4. In the desktop app, an admin chooses **System Chrome** under **Browser agents use**. Members, and everyone on any other server, have only Chrome, so there is nothing to choose.

   ![Settings › Browser: agents use System Chrome, and the paired Chrome is connected](/blog-assets/browser-settings-en.png)

## Option B: the built-in browser

1. Open a conversation, select **Right sidebar** at the top right, and choose **Browser** (if the sidebar already shows panels, add it with **+**). A new tab shows a start page of common sites; pick one or type an address.

   ![The Browser panel with a new tab: the address bar is focused above tiles for Google, Bing, Baidu, GitHub, Stack Overflow and Wikipedia](/blog-assets/browser-start-page-en.png)

2. Sign in to the sites the agent will need, right in the panel. The built-in browser keeps these sign-ins between restarts, apart from your system browser.
3. Or bring your sign-ins over: open the toolbar's menu and select **Import from browser…**. Pick a browser profile, keep **Cookies and sign-ins** checked, and list the sites under **Only these sites**, such as `amazon.com`, to copy only what the agent needs. Then select **Import**.

   ![The toolbar menu of the Browser panel: Import from browser…, Clear browsing data…, Set homepage…, Open in system browser and Developer tools](/blog-assets/browser-menu-en.png)

Import reads Chrome, Edge, Brave, Arc (macOS only), Vivaldi, Opera, Chromium and Firefox profiles. It never writes to them.

## Hand the agent a task

1. In a new chat, ask for something that needs a page, for example: "Open the PenguinHarness blog and list the three newest posts with their dates."
2. The agent checks the browser with `penguin browser status`, opens the page with `open`, reads it with `scan`, and runs a short script with `exec` to pull out what it needs. When the conversation on screen is the one using the browser, the right sidebar switches to the **Browser** panel by itself. On the built-in browser, a pulsing ring runs around the page while the agent acts on it.

   ![The agent's steps in the conversation, with the blog open in the Browser panel](/blog-assets/browser-panel-en.png)

3. Each step is a command you can expand to see exactly what ran and what came back. The page stays open after the agent is done, so you can carry on from where it stopped.

With your own Chrome, the same commands open the page in a blue tab group named Penguin. Chrome shows a bar saying the extension is debugging the browser. The panel lists the agent's tabs and offers **Show in Chrome**.

![Chrome with the agent's tab in the Penguin group and the extension's debugging bar](/blog-assets/browser-chrome-window-en.png)

![The conversation beside the Browser panel in Chrome mode: This tab is open in your Chrome, with Show in Chrome](/blog-assets/browser-chrome-panel-en.png)

## Limits and safety

- The agent never types your passwords. At a sign-in page it stops and asks you to sign in yourself: inside the panel on the built-in browser, where it can also offer to import the sign-in, or in the Penguin tab in Chrome. It does not order, pay or change an account without your confirmation.
- In Chrome, the agent reaches only the tabs in its Penguin group: the ones it opened, the ones you hand over with the extension's **Add this tab**, and pages those tabs open. It cannot drive Chrome's own pages, the Chrome Web Store or local files. To take a tab back, drag it out of the group, close it, or choose **Release this tab**. **Pause** in the extension's popup stops every command.
- Don't click inside a page while the agent is working on it, because your clicks change the page under the agent.
- Import, history and clearing browsing data belong to the built-in browser and are for administrators. Each backend holds at most 20 tabs.
- The agent never picks the backend. If the one you chose is unavailable, `penguin browser status` says why and the agent tells you, instead of falling back to the other.

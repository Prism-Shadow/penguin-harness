---
title: "One window, agents on every machine you have"
date: 2026-10-13
category: practice
excerpt: "Add a machine your PenguinHarness server can reach over ssh, let the server install itself there, and start a conversation in a folder on that machine. The agent and its commands run on the machine; you keep working in the same window."
---

Some work has to happen on another computer, usually the one that holds the data. PenguinHarness 0.2.14 can install itself on a machine your server reaches over ssh, keep a connection to it, and run conversations there. The window stays on your own server. Only the calls that concern the machine go through the connection.

This tutorial adds a Linux machine called `devbox`, then asks an agent to run a check in a folder on it.

## Prerequisites

- PenguinHarness 0.2.14, signed in as an admin. The **Machines** page and everything on it are admin-only.
- A Linux or macOS machine that the server's OS account can sign in to over ssh, either with a key (`ssh <host>` works from a terminal on the server without a prompt) or with a password you save in PenguinHarness. Windows machines cannot be connected yet. Linux systems built on musl, such as Alpine, are not supported.
- Only ssh has to be reachable. The machine downloads the release from GitHub or the OSS mirror. When it can reach neither, or has no `curl`, the server sends the release over the ssh connection.
- A model on the **Models** page whose key is saved in the Project. A key the server reads from an environment variable is not copied to machines.

## Step 1: Add the machine

1. In the sidebar, select **Machines**, then **Add machine**.
2. Select **Fill in by hand**, and enter a **Name**, the **Host** and the **User name**. The name becomes the machine's ssh alias. Leave **Private key file** empty to use ssh's default keys.
3. Keep **Install and connect right after adding** ticked, and select **Add**.

![The Add machine dialog with the Name, Host and User name fields filled in](/blog-assets/machines-add-dialog-en.png)

The dialog appends a `Host` block to the server's `~/.ssh/config`, so `ssh devbox` works from the server's terminal as well:

```text
# Added by PenguinHarness on 2026-10-12T17:04:24.886Z
Host devbox
  HostName 172.17.0.6
  User penguin
  Port 22
  StrictHostKeyChecking accept-new
```

A host that is already in that file appears on the **From the ssh config** tab instead.

## Step 2: Let it install

The machine's card shows a bar with one segment per step and a line naming the current one. The steps, as the machine's dialog lists them, are **Check the machine**, **Install the program**, **Send the build**, **Restart its server**, **Connect** and **Sync the config**. A server that runs from a source checkout starts with **Build the install image**.

![The devbox card during the install, at the step Installing the program](/blog-assets/machines-installing-en.png)

The program goes to `~/.penguin` on the machine, with its data in `~/.penguin/data`. Its server listens on port 7364 on the machine's loopback address. Your server reaches it through the ssh connection. The last step hands the machine your Project's config: the models, the default model, the command policy, the new-chat defaults and the plugin list.

## Step 3: Check the connection

When the install finishes, the card's dot turns blue. Select the card to open its dialog, which shows the address, the data directory and whether the remote server is running.

![The Machines page with this server and devbox, both connected](/blog-assets/machines-page-en.png)

![The devbox dialog: Connected, with its address, data directory and remote server port](/blog-assets/machines-detail-en.png)

From the dialog's toolbar you can **Stop server**, **Restart server**, **Sync config**, **Configure SSH** or **Uninstall**. You do not need to keep the page open: the server keeps the machine connected and reconnects it on its own after a dropped session or a restart.

## Step 4: Open a Workspace on the machine

1. Select **New chat**, then the folder button under the message box. It reads **Temporary workspace** while no folder is picked.
2. Under **Machines**, select `devbox`. The picker now browses that machine's folders.
3. Find the folder you want to work in, select it, and select **Choose**.

![The Workspace picker browsing devbox, with the etl folder selected](/blog-assets/machines-workspace-en.png)

The card's **Use** button is a shortcut: it opens a new chat set to a temporary Workspace on the machine.

## Step 5: Run the agent there

Send a message. The machine's own server runs the agent, so every command runs on the machine. The messages, the Trace and any terminal you open live there too. The sidebar groups the conversation under the folder and the machine, `etl [SSH: devbox]`.

![A conversation in etl on devbox: the command printed devbox and the check results, and the agent reports one file with problems](/blog-assets/penguinharness-0-2-14-machines-en.png)

## Limits

- Agents belong to each server. In a Workspace on a machine, the agent picker offers the Agents that exist on that machine.
- A conversation on a machine has no **Archive** in its row menu yet.
- **Delete** on a card takes the machine off the Project. The program, its data and the `Host` block stay. **Uninstall** in the dialog removes the program.

---
title: Settings
description: Manage your profile, preferences and password, and, as an admin, users, the proxy, upload limits and company mode.
---

**System settings** is one dialog for the settings that belong to neither a Project nor an agent: your profile, your interface preferences and password, and, for an admin, the server's users, proxy, upload limits and company mode.

- Your own settings: [Profile](#profile), [General](#general), [Appearance](#appearance) and [Account](#account).
- Server settings, for admins: [Users](#users), [Proxy options](#proxy-options), [Upload limits](#upload-limits) and [Company mode](#company-mode).

## Open System settings

1. At the bottom of the sidebar, select your user row, or your avatar when the sidebar is collapsed. The account menu opens.
2. Select **System settings**.

## How the dialog is organized

The dialog shows a rail of pages on the left. Each page is a list of rows, with the title on the left and the control on the right. On a narrow screen the rail becomes a horizontal strip above the page.

The rail is grouped into **Personal** and **Server**:

| Page | Group | Who sees it |
| --- | --- | --- |
| [Profile](#profile) | Personal | Everyone |
| [General](#general) | Personal | Everyone |
| [Appearance](#appearance) | Personal | Everyone |
| [Account](#account) | Personal | Only where a password exists to change |
| [Users](#users) | Server | Admin only, and not in the desktop app |
| [Proxy options](#proxy-options) | Server | Admin only |
| [Upload limits](#upload-limits) | Server | Admin only |
| [Company mode](#company-mode) | Server | Admin only |

Personal preferences apply the moment they are touched. There is no Save button and nothing to lose by closing the dialog. The nickname on the Profile page is the one exception: typed text needs a commit, and its **Save** sits beside the field rather than under the page.

Where your personal preferences are stored:

- In this browser: language, currency, notifications, theme, terminal theme, font size, accent, the shortcuts launcher, and tool short names.
- With your account on the server: your profile and your personal Company mode switch.

The Server pages are admin-only and server-global. A non-admin sees neither those entries nor any hint that they exist: they are left with the Personal pages alone, and the rail draws no group headings at all.

In the desktop app the **Users** page is absent, because the server runs single-user. The desktop app's own window also has no **Account** page: it signs in through the shell's token and holds no password to change. A browser signed into the same server with a password keeps the page.

A "?" beside a row's title opens that row's explanation. A "?" beside a page heading explains the whole page.

Checking for updates is not a page here. See [Updates](/updates).

## Profile

The **Profile** page holds your **Avatar** and **Nickname**. It is personal and appears in every session, including the desktop app's own window, because neither field needs a password to change.

The page has no footer. Every control writes when it is used, and the button that writes a value stands next to that value.

Both fields start unset. Until you set them, your account shows your user id and a letter tile on the sidebar's bottom user row, on the collapsed rail's avatar, and at the head of the account menu they open.

Once set, your avatar and nickname replace that pair in all three places. Your user id stays visible under the nickname at the head of the account menu. The nickname also shows under the id in the **Users** list.

### Change your avatar

**Before you begin**

- An image in PNG, JPEG, or WebP format.

1. On the **Profile** page, select **Change avatar**.
2. Choose a PNG, JPEG, or WebP image.

The avatar applies at once. It is centre-cropped to a square and re-encoded at 128×128.

To put the letter tile back, select **Restore default** beside **Change avatar**.

### Change your nickname

1. On the **Profile** page, in **Nickname**, enter a nickname of 1–32 characters.
2. Select **Save**.

The limit counts characters, so a Chinese name may be 32 characters. Saving a blank nickname clears it.

**Restore default**, next to **Save**, puts your nickname back to its default, which is your user id. Both buttons write on click, and each is disabled when it would write what is already stored.

## General

The **General** page is personal.

| Setting | Options | What it does |
| --- | --- | --- |
| **Language** | English / 中文 / System | System follows the browser. |
| **Currency** | USD $ / CNY ¥ | The display currency for prices. Storage is always USD. Conversion happens only at the edge of the screen. |
| **Task completion notifications** | On / Off (off by default) | Shows a system notification when a Task finishes while the window is hidden or unfocused. Clicking the notification opens that Session. |
| **Company mode** | On / Off (on by default) | Shown only while an admin has turned company mode on for the server. Off hides your own **Development** / **Company** switch and nothing else; organizations keep running. See [Company mode](/company-mode). |
| **Import Trace** | — | Turns a Trace file into a conversation. The row is there only if you own a Project. See [Import a Trace](#import-a-trace). |

> [!NOTE]
> Turning on **Task completion notifications** asks the system for permission on the spot. The system asks only once: after a refusal the switch stays off with a hint, and the only way back is the system's own notification settings. A browser without system notifications shows the switch disabled.

### Import a Trace

**Import Trace** turns a `.jsonl` Trace file into a conversation of an agent.

**Before you begin**

- A `.jsonl` Trace exported from another install, at most 14MB.
- You must be an owner of the destination Project.

You choose both the destination Project and the destination agent. The agent is asked for because a Trace file cannot name a local agent of its own. The Project is asked for because this dialog does not show which Project is open, which also means a Trace can go to a Project other than the open one. The picker lists only the Projects you own, since importing is an owner's action; with none owned, the row is absent.

1. On the **General** page, in **Import Trace**, select the destination Project. It defaults to the open Project when you own it, and otherwise to the first Project you own.
2. Select the destination agent. It defaults to the open Project's `default_agent`.
3. Select **Choose file** and pick your `.jsonl` file. The import starts at once.

The Trace becomes a new conversation of that agent. An import is refused when that agent already has a Session with the same id.

Exporting is the other direction of the same road. It lives with the file it downloads, in a conversation's Trace panel.

## Appearance

The **Appearance** page is personal.

| Setting | Options | What it does |
| --- | --- | --- |
| **Theme** | Light / Dark / System | The interface theme. |
| **Terminal theme** | App / Light / Dark | The terminal panel keeps its own light or dark and follows the app theme by default. Pin it to Light or Dark to decouple the two, for prompts and TUIs tuned to one screen. |
| **Font size** | S / M / L | The interface font size. |
| **Accent** | Neutral, Blue, Green, Violet, Rose or Amber | The interface accent color. |
| **Shortcuts launcher** | On / Off | The round button floating on the conversation's right edge that fans out shortcuts to the workbench's panels and the terminal. The fan's **Hide launcher** entry does the same. |
| **Tool short names** | On / Off | Tool cards in a conversation name built-in tools by a short alias (`read_file` reads as "read"). Every other tool, MCP tools included, and the Trace viewer keep the tool's own name. Hovering a short name shows it. |
| **Tray icon** | On / Off (on by default) | Desktop app only. See below. |

About **Tray icon**: the desktop app keeps an icon in the system tray: the Windows notification area, the macOS menu bar, or the Linux tray. It stays there for as long as the app runs. Click the icon to come back to the window. Right-click it to start a new Session or quit.

Turning it off removes the icon at once, with no restart. Closing the window then no longer hides it there: the app stays in the Dock on macOS, and quits on Windows and Linux.

## Account

The **Account** page holds the **Change password** action.

The page exists only where a password exists to change. The desktop app's own window signs in through the shell's one-shot token and never sees a password, so it has no **Account** page. A browser signed into the same server with a password keeps the page.

> [!NOTE]
> A session signed in through the first-login link can set a password without entering the current one, because that account has never had a password anyone saw.

### Change your password

1. On the **Account** page, select **Change password**.
2. In **Current password**, enter your current password. This field is not shown after a first-login link sign-in.
3. In **New password**, enter the new password (at least 8 characters).
4. In **Confirm new password**, enter it again.
5. Select **Save**.

## Users

The **Users** page lists the server's users. It is admin-only, and it is absent from the desktop app, where the server runs single-user.

From the page you add users, reset passwords, and delete users.

### Add a user

1. On the **Users** page, select **Add user**.
2. Enter a **Username** (2–32 characters: a lowercase letter first, then lowercase letters, digits and underscores) and an **Initial password** (at least 8 characters).
3. Select **Create**.

The new user gets a default Project named `<userId>-default_project`. A user who is still on an initial password carries an **initial password** badge.

### Reset a user's password

1. On the **Users** page, find the user and select **Reset password**.
2. Enter a new **Initial password** and select **Save**.

The reset signs the user out of every sign-in session. They must sign in again with the new password.

### Delete a user

> [!WARNING]
> Deleting a user also deletes every Project they own, data directories included. It cannot be undone.

1. On the **Users** page, find the user and select **Delete**.
2. In the dialog, select **Delete**, then **Confirm**.

Users with the Admin role have no delete action, and the server refuses to delete the built-in admin.

## Proxy options

The **Proxy options** page is admin-only and server-global. It controls which outbound traffic goes through a proxy.

| Setting | Default | What it covers |
| --- | --- | --- |
| **Application uses the proxy** | On | The server's own outbound traffic: LLM requests, the update check, image fetches. |
| **Agent environment uses the proxy** | On | Agent command subprocess environments. |
| **Proxy address** | Empty | Optional, and shared by both switches. Empty means follow the proxy environment variables. |

**Proxy address** accepts any proxy URL undici's dispatcher takes: `http://`, `https://`, `socks5://`, or `socks://`, credentials allowed. A bare `host[:port]` is also accepted and stored normalized to `http://…`. Anything else is refused with the reason shown under the input.

Nothing is written until **Save**. Save applies the whole form in one PUT, so a rejected address writes none of it. A save rebuilds the outbound dispatcher and takes effect on new connections, with no restart. Loopback always goes direct.

### Set a proxy and test it

**Before you begin**

- The address of your proxy, in one of the accepted formats above.

1. On the **Proxy options** page, in **Proxy address**, enter your proxy address. Leave the field empty to follow the proxy environment variables.
2. Toggle **Application uses the proxy** to send the server's own outbound traffic through the proxy. It is on by default.
3. Toggle **Agent environment uses the proxy** to put the proxy into agent command subprocess environments. It is on by default.
4. Select **Save**. If the address is invalid, nothing is written and the reason appears under the input.
5. Below **Save**, select **Test** to run the **Reachability test**.

The test measures this server's own outbound hop to the model providers. It lists its targets before it runs: the model-list endpoints of OpenAI, Anthropic, Gemini, DeepSeek, Z.ai and BigModel. **Test** then sends each target one credential-free GET, and results appear one by one as they arrive. Each target waits at most five seconds.

- Any HTTP answer counts as **Reachable**, 401 and 403 included, because a refused credential still proves that DNS, TCP and TLS all completed. A reachable target shows the time it took.
- A failure is named: Timed out, DNS lookup failed, Connection refused, TLS handshake failed, or Unreachable.

> [!NOTE]
> The test measures the saved settings, because only a save rebuilds the outbound dispatcher. If you edited the address, save it before testing.

## Upload limits

The **Upload limits** page is admin-only and server-global. It sets two sizes, in whole MB:

| Field | Default | Allowed range |
| --- | --- | --- |
| **Max attachment size (MB)** | 100MB | 1–200MB |
| **Max total per message (MB)** | 120MB | 1–200MB |

The total may not sit below the per-file cap, because that combination would make a legal single attachment unsendable. A value outside the range, such as "100GB" typed into a MB field as 102400, is refused with the reason shown under the input rather than accepted. Validation precedes every write: one bad field in a PUT leaves the other fields untouched too.

### Change the upload limits

1. On the **Upload limits** page, in **Max attachment size (MB)**, enter a whole number of MB between 1 and 200.
2. In **Max total per message (MB)**, enter a whole number of MB between 1 and 200, and not below the per-file cap.
3. Select **Save**.

Saving takes effect immediately, with no restart: the attachment validators and the request body cap both read the setting per request.

## Company mode

The **Company mode** page is admin-only and server-global. It holds the **Enable company mode** master switch, off until an admin turns it on here.

The switch applies the moment it is flipped. There is no Save button.

Turning it off stops the organization scheduler and every organization route, and hides the mode switch for everyone. Organizations on disk are untouched. Turning it back on backfills no missed trigger.

> [!NOTE]
> Company mode is a beta. See [Company mode](/company-mode).

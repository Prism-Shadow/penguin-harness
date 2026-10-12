---
title: Built-in Browser
description: The browser you and your agents share, in the dock — the desktop app's built-in browser or your own Chrome — with automation through penguin browser.
---

The **Browser** panel in the dock holds the browser your agents drive from their shell with `penguin browser`: they read pages, click and type, and pull out data such as your Amazon orders, signed in with your own accounts. It has two backends:

- **The built-in browser**, a web browser inside the desktop app. You browse in it like in any browser, and the agents drive the same tabs. It keeps its own sign-ins and history, separate from your system browser, and can import both from Chrome, Edge, Brave, Arc, Vivaldi, Opera, Chromium or Firefox.
- **Your own Chrome**, through the PenguinHarness Browser extension, in the desktop app and in the Web App alike. The agents work in tabs of a **Penguin** tab group in your Chrome, signed in as you already are, and never touch your other tabs.

Where to go:

- To get started, see [Open the Browser panel](#open-the-browser-panel).
- To let agents use your Chrome, see [Use your own Chrome](#use-your-own-chrome).
- To let an agent use your accounts in the built-in browser, see [Sign in](#sign-in) and [Import from your browser](#import-from-your-browser).
- To automate it yourself or understand what an agent does, see [Drive it from the command line](#drive-it-from-the-command-line).
- If the built-in browser gets heavy or a page crashes, see [Performance](#performance).

## Before you begin

- **The built-in browser** is part of the desktop app on macOS, Windows and Linux. A browser window signed in to a server (`penguin web`), Docker or a remote machine has none.
- **Your own Chrome** works on any server whose administrator allows it, which is the default. It needs Chrome 116 or later and the PenguinHarness Browser extension.
- The desktop app uses the built-in browser until you [switch](#switch-between-built-in-and-chrome); every other server offers only Chrome. Your agents never choose the backend, and a backend that is unavailable never falls back to the other.
- An agent drives the browser of the person driving its conversation: the one who sent the message that started the run, or, for a scheduled task, the person who created it. On a server with several accounts, everyone pairs their own Chrome, and an agent never uses anyone else's.

## Open the Browser panel

Open the panel from the top right of the chat toolbar: select **Right sidebar** or **Bottom panel**, then choose **Browser**. If the dock already shows other panels, use its **Add panel** menu. See [Use side panels](/chat#use-side-panels).

There is one set of browser tabs for the whole app. Every conversation's dock shows the same tabs, so a page an agent opened in one conversation is still there when you switch to another.

The sections from [Browse](#browse) to [Clear browsing data](#clear-browsing-data) describe the built-in browser. When agents use your own Chrome, the panel shows [your Chrome's tabs](#in-the-browser-panel) instead.

When an agent opens a page from a conversation you are looking at, the dock switches to the Browser panel by itself, so you can watch.

## Browse

- The tab strip shows each tab's icon and title. Select **+** to open a new tab and **×** to close one.
- The panel always has a tab. When it has none, the first time you open it, after the app restarts, or after the last tab closes, it opens a new tab at once. If an agent closes the last tab while the panel is out of sight, the new tab opens when you show the panel again.
- The toolbar has **Back**, **Forward**, **Reload** (**Stop loading** while a page loads) and the address bar. Type a URL to open it. A bare domain such as `amazon.com` opens over `https://`. Anything else is searched with Bing. While you type, pages from the browser's history are suggested; use the arrow keys and Enter to pick one.
- The toolbar's menu holds **Import from browser…**, **Clear browsing data…**, **Set homepage…**, **Open in system browser** and **Developer tools**.
- A link that opens a new window, and a page's pop-up, open as new tabs. A page can open at most three tabs every five seconds; more are ignored.
- A download asks where to save the file, as the system browser does.

The panel follows the app's light or dark theme; the pages themselves keep their own colors.

## Set a homepage

The homepage is the page every new tab opens: the one **+** opens, the one the panel opens when it has no tab, and a new tab an agent opens without an address. While it loads, the tab already shows the homepage's address. Without a homepage, a new tab is blank and the address bar is ready for an address.

1. In the toolbar's menu, select **Set homepage…**.
2. Enter an address. It is read as the address bar reads one: a bare domain such as `example.com` opens over `https://`, and the field shows the page it will open. To take the page on screen, select **Use current page**.
3. Select **Save**.

While a homepage is set, a **Home** button beside **Reload** goes to it. To remove the homepage, select **Clear** in the same dialog and save the empty field.

## Open links from a conversation

Right-click a web link in a conversation, or press Shift+F10 or the Menu key while the link has focus, to open its menu:

- **Open in built-in browser** opens the link in a new tab and brings the Browser panel up in that conversation's dock. It appears while the browser is available. When agents use your Chrome, it reads **Open in agent's Chrome tab** and opens the tab in your Chrome's Penguin group.
- **Open in system browser** opens the link in your default browser. In a browser window, the item reads **Open in new tab**.
- **Copy link address** copies the link.

When text in the conversation is selected as well, **Copy** and **Add to conversation** follow below a divider. Links to files in the Workspace keep opening in the Files panel, and a right-click anywhere else in the conversation keeps the menu for selected text.

## When an agent uses the browser

While an agent is working in a tab, a slow pulsing ring runs around the page and an icon in the toolbar says so. The agent's commands act on the page through the browser's developer tools, not through your mouse and keyboard, so you can watch without anything moving on your screen. Avoid clicking inside the page while the agent is working on it: your clicks change the page under the agent.

A dialog the page opens while an agent acts is answered for it, so the page does not wait on you: an alert is accepted, and a confirmation or a leave-page dialog is dismissed unless the agent asked to accept it. Dialogs that appear while you browse show as usual.

The page on screen is laid out at the size of the panel, so in a narrow panel a site may show its mobile layout. A page you are not looking at, in another tab or while the dock is closed, stays loaded at the size it was last shown at, or at 1280×800 if it was never shown, and the agent keeps working in it.

## Sign in

Sign in to websites in the panel as you would in any browser. Sign-ins and site data are kept between restarts, in the browser's own profile: signing in here does not sign you in to your system browser, and the other way round.

Agents never type your passwords. When a page an agent needs asks for a sign-in, the `browser-automation` skill has it stop and ask you to sign in in the panel, or to import your sign-in from the browser you normally use. In your own Chrome, your sign-ins already apply; when one is missing, the agent asks you to sign in in its Penguin tab.

## Import from your browser

Import copies the cookies (which hold your sign-ins) and the history of one profile of a browser installed on this machine into the built-in browser.

1. In the toolbar's menu, select **Import from browser…**.
2. Pick a profile. Profiles are grouped by browser and named as the browser names them.
3. Choose **Cookies & sign-ins**, **History**, or both.
4. Optionally, list the sites to import cookies for, separated by commas, such as `amazon.com, github.com`. A site includes its subdomains. Leave the field empty to import the cookies of every site.
5. Start the import. The dialog shows how many cookies and history entries were found and imported, and any warnings.

| Browser | macOS | Windows | Linux |
| --- | --- | --- | --- |
| Chrome, Edge, Brave, Vivaldi, Opera, Chromium | Yes | Yes | Yes |
| Arc | Yes | — | — |
| Firefox | Yes | Yes | Yes |

What to expect on each platform:

- **macOS**: Chromium-based browsers encrypt cookies with a key kept in your Keychain, so macOS asks whether PenguinHarness may use the Keychain item named after the browser, such as "Chrome Safe Storage". Allow it; if you deny it, the encrypted cookies are skipped and the result says so.
- **Windows**: Chrome 127 and later protect most cookies with app-bound encryption, which only Chrome itself can read. Those cookies are skipped with a warning; sign in in the panel instead. A browser that is running may also hold its cookie file open; close it and import again.
- **Linux**: newer cookies are encrypted with a password kept in the desktop keyring, read through `secret-tool` (from the `libsecret-tools` package on Debian and Ubuntu). Without it those cookies are skipped with a warning.
- **Firefox** stores cookies unencrypted. Cookies kept for a container or partitioned to another site are left out.

Import only reads: every file is copied to a temporary directory, read there and deleted, and nothing is written to the other browser. Imported history is kept together with the built-in browser's own, up to the newest 5,000 pages. Import is available to administrators only.

From a shell, `penguin browser import --list` lists the profiles and `penguin browser import --from chrome --cookies --domain amazon.com` imports one site's sign-in; see [penguin browser](/cli#penguin-browser).

## Clear browsing data

Select **Clear browsing data…** in the toolbar's menu and choose what to remove: cookies and sign-ins, cached files, site storage, or the browsing history. This affects only the built-in browser.

## Use your own Chrome

Your agents can work in your own Chrome instead of the built-in browser: with your sign-ins, extensions and settings, from the desktop app or from the Web App on any server. The PenguinHarness Browser extension connects your Chrome to the server, and the agents drive only the tabs you let them have.

### Install the extension

We recommend installing from the Chrome Web Store, which keeps the extension up to date:

1. Open [PenguinHarness Browser](https://chromewebstore.google.com/detail/penguinharness-browser/dodgfhpcbmkjfcbgnoidablfgjjhhmgp) in the Chrome Web Store and select **Add to Chrome**.
2. Pin **PenguinHarness Browser** to the toolbar from the extensions menu, so its icon shows whether it is connected.

Where the Chrome Web Store cannot be reached, install the zip file published with each release instead:

1. Download [penguin-browser-extension.zip](https://github.com/Prism-Shadow/penguin-harness/releases/latest/download/penguin-browser-extension.zip) and unzip it.
2. In Chrome, open `chrome://extensions` and turn on **Developer mode** at the top right.
3. Select **Load unpacked** and pick the unzipped folder.
4. Pin the extension to the toolbar as above.

Chrome reminds you about extensions in developer mode when it starts; the extension keeps working. To update, unzip the new release over the same folder and select the reload icon on the extension's card.

Either way, Chrome opens the extension's pairing page once it is installed. Both carry the same extension ID, so Chrome holds only one of them: to move from the zip to the store, remove the loaded copy in `chrome://extensions` first, then install from the store and pair it again.

The extension's pages are in English whatever Chrome's language. **EN / 中文** at the top of the pairing page and at the bottom of the popup switches both pages, and the toolbar icon's tooltip, at once.

### Pair it with the server

Pairing gives your Chrome a key to your account on one server. You need the server address and a one-time pairing code from the Web App.

1. In the Web App, open the **Browser** panel. When no Chrome is paired, the panel shows the pairing steps itself; otherwise select **Connect your Chrome…** in the panel's menu, or **Connect another Chrome** in **Settings › Browser**.
2. The **Connect your Chrome** dialog shows the **Server address** and the **Pairing code**, each with a copy button. The code works once, for 10 minutes; **New code** replaces it.
3. In Chrome, select the extension's icon, then **Settings**, which opens the pairing page. Paste the server address and the code, and select **Connect**.

The dialog's **Waiting for Chrome…** turns into **Connected** and the dialog closes. The server address is the one your browser shows for the Web App, so a server behind a reverse proxy pairs at its public address. The desktop app's address is `http://localhost:<port>`; if the port ever changes, pair again.

Settings › **Browser** lists your paired Chromes with their name, extension version, last connection and a dot that shows the one connected now. **Revoke** asks first, then disconnects that Chrome and ends its key: agents can no longer use it, and it has to be paired again.

### In the Browser panel

When agents use your Chrome, the panel shows their tabs rather than pages:

- The tab strip lists the tabs the agents drive in your Chrome. **+** opens a new tab there, at the homepage or a blank page, and **×** closes one.
- The toolbar has the address bar, which opens an address in the active tab, and the menu.
- In place of the page, the panel says **This tab is open in your Chrome**. **Show in Chrome** brings Chrome to the front on that tab.
- While an agent acts in a tab, a pulsing ring and an icon in the toolbar say so, as with the built-in browser.
- When your Chrome is not connected, the panel says **Chrome is not connected**, names the paired Chrome, and offers **Reconnect help**. When an administrator has turned Chrome connections off, it says **Chrome connections are off**.

The menu's status row reads **Chrome: connected · <name>**, **Chrome: not connected**, **No Chrome paired** or **Chrome connections are off**, with **Connect your Chrome…** or **Manage…** beside it.

### What the agent can reach

The agent drives only these tabs:

- The tabs it opens. They open in a blue tab group named **Penguin**, one per window (**Penguin · <server>** when Chrome is paired with several servers).
- A tab you hand over: select the extension's icon on that tab, then **Add this tab**. It moves into the Penguin group.
- Pages those tabs open, such as a pop-up or a link opened in a new tab.

It cannot see or touch your other tabs and windows, your cookies, your passwords, your history or your downloads. Raw DevTools commands that would reach them are refused (`cdp_refused`). Chrome's own pages (`chrome://`), the Chrome Web Store and local files cannot be driven at all. Import, clearing browsing data and the browsing history belong to the built-in browser; Chrome keeps its own.

What reaches the server is what the agent asks of a driven tab, as with the built-in browser: the page as simplified HTML or text, the values its scripts return, screenshots and the text of dialogs. A script in the page can read the cookies the page itself can read; HttpOnly session cookies never leave Chrome.

### Take a tab back or stop the agent

- While the agent works, Chrome shows a bar saying **PenguinHarness Browser started debugging this browser**. It goes away a minute after the agent's last command, and comes back with the next one. **Cancel** on that bar takes every tab back at once; the agent cannot use them again until you hand them over.
- To take one tab back, drag it out of the Penguin group, close it, or select the extension's icon on it and choose **Release this tab**. The agent's next command on it fails with `tab_released`, and it opens a new tab instead.
- **Pause** in the extension's popup stops every command until you select **Resume**. The tabs stay where they are.
- **Revoke** the Chrome in **Settings › Browser**, turn the extension off in `chrome://extensions`, or, in the desktop app, switch back to the built-in browser.

### Several servers and several Chromes

One extension can be paired with several servers, such as the desktop app and a hosted Web App. Each server's tabs get a group of their own. You can pair several Chromes with your account, on different computers: one is connected at a time, and the last one to connect takes over.

### Behind a reverse proxy

The extension connects to the server over a WebSocket at `/api/builtin-browser/extension/ws`. A reverse proxy must forward the `Upgrade` header for that path, as it does for the terminal stream. The pairing request comes from the extension's own origin, and the server answers it for that origin alone.

## Switch between built-in and Chrome

In the desktop app you choose which browser your agents use:

- In the **Browser** panel's menu, under **Browser**, choose **Built-in** or **System Chrome**.
- Or, in **Settings › Browser**, set **Browser agents use**.

A notice confirms the switch, such as **Agents now use your Chrome**. While an agent is acting in the browser, the switch is refused with **An agent is using the browser; switch once it is done**. Switching closes nothing: the built-in browser's tabs stay open in the background, and the Penguin tabs stay in Chrome. Every window of the app follows the switch. On any other server there is only Chrome, and the choice does not appear.

## Turn Chrome connections off

An administrator can stop every user's Chrome from connecting: in **Settings › Chrome extension**, turn off **Allow Chrome extension connections**. It is on by default. Turning it off asks first, then disconnects every connected extension at once, and the Chrome backend is unavailable for everyone (`extension_disabled`). Pairings are kept: turning it back on lets the extensions reconnect, within an hour.

## Drive it from the command line

`penguin browser` drives the tabs from a shell, and it is how agents use the browser, built-in or your own Chrome alike. The preinstalled `browser-automation` plugin teaches them the loop: open a page, read it, act with JavaScript, and check what changed. `penguin browser status` names the backend in use; agents cannot change it.

```bash
penguin browser open https://www.amazon.com/your-orders/orders
penguin browser scan --text
penguin browser exec <<'EOF'
return [...document.querySelectorAll('.order-card')].length;
EOF
```

- `scan` prints the page as simplified HTML, or as text with `--text`: hidden, floating and covered elements are dropped, and long lists are cut to three items with a hint naming the selector of the rest.
- `exec` runs JavaScript in the page and reports its return value, how many elements changed, messages that appeared and vanished, and tabs that opened.
- `click` and `type` send real mouse and keyboard input, which pages cannot tell from a person's.
- `screenshot`, `cdp` (a raw Chrome DevTools Protocol command) and `history` cover the rest.

Every command and its output format are in the [CLI Reference](/cli#penguin-browser).

## Performance

This section is about the built-in browser; your own Chrome manages its own tabs.

Every tab is a whole web page with memory of its own: a busy shopping or news site takes 100 to 300 MB, and some take more than 1 GB. The app watches how much the browser uses and tells you before it gets too much.

- **A warning before trouble.** When the tabs together use more than 1.5 GB of memory, when this computer has less than 10% of its memory free (not measured on macOS), or when more than 12 tabs are open, an amber warning icon appears in the browser's toolbar. Its tooltip says how much memory the browser uses and in how many tabs. A notice pops up once when the warning starts, and the tabs using the most memory carry a small warning mark in the tab strip. Close the tabs you no longer need. `penguin browser status` prints the same figures on a `memory:` line, and a `warning:` line while the warning lasts.
- **Background tabs run slower.** A tab no agent is using may have its timers slowed to about once a second while it is out of sight, as a browser does with background tabs. A tab an agent works in runs at full speed, during each action and for 30 seconds after it, and so does a new tab while it loads.
- **A crashed page stays a tab.** When a page's process ends (it crashed, or the system took its memory back), its tab shows **This page crashed** with a **Reload** button instead of an empty area, and the rest of the app carries on. An agent that uses that tab gets `tab_crashed` at once. If the app's own window fails, it reloads, waiting longer between tries if it keeps failing; the browser's tabs close with it.
- **A log for bug reports.** The desktop app records what its processes do in `desktop.log`, including every process that ends unexpectedly and why. The file stops at 5 MB and starts again, keeping the previous one as `desktop.log.1`. Attach both when you report a crash:

| System | Log file |
| --- | --- |
| macOS | `~/Library/Application Support/PenguinHarness/logs/desktop.log` |
| Windows | `%APPDATA%\PenguinHarness\logs\desktop.log` |
| Linux | `~/.config/PenguinHarness/logs/desktop.log` |

## How it works

- Each tab is a Chromium page hosted by the desktop app, in its own persistent profile. Pages see an ordinary Chrome browser.
- The server drives pages through the Chrome DevTools Protocol, relayed by the desktop app. Reading, running scripts, clicking and typing all happen on the server's side of that link, so they improve with server updates.
- Pages are read and changes are tracked by scripts adapted from [GenericAgent](https://github.com/lsdefine/genericagent) (MIT): its DOM simplification and its `web_scan` / `web_execute_js` design.
- The history and the homepage are files in the data root, `builtin-browser/history.json` and `builtin-browser/settings.json`. Cookies and site storage live in the desktop app's own profile directory.
- With your own Chrome, the server sends the same commands over the extension's WebSocket, and the extension relays them through Chrome's debugger to the tab. Each paired Chrome has its own key, which travels in the WebSocket's subprotocol, never in an address; the server stores only a hash of it. The extension asks for no access to page content of its own and adds nothing to the pages.
- Everything goes through the server's `/api/builtin-browser` routes. The built-in browser, import, history and clearing data are for administrators; any signed-in user can pair and use their own Chrome. See [Agent Browser](/server-api#agent-browser).

## Limits

| Limit | Value |
| --- | --- |
| Where it works | Built-in: the desktop app only. Your own Chrome: any server that allows it, Chrome 116 or later |
| Tabs | 20 at most per backend; a new tab beyond them is refused (`too_many_tabs`) |
| Connected Chromes | One per user at a time; the last one to connect takes over |
| Pages your Chrome cannot drive | `chrome://` pages, the Chrome Web Store, local files |
| Import, clear data, history | The built-in browser only (`not_supported` in your Chrome) |
| Pairing code | Works once, for 10 minutes; five wrong tries end it |
| Load warning | Over 1.5 GB of memory in the tabs, under 10% of this computer's memory free, or over 12 tabs |
| `scan` body | 35,000 characters by default (`--max-chars`); a third of that with `--text` |
| `exec` return value shown | 8,000 characters; `--save` writes all of it to a file |
| `exec` script time | 15 seconds by default (`--timeout`) |
| Page load wait | 15 seconds for `open` |
| History | The newest 5,000 pages, imported ones included |
| Windows cookie import | Chrome's app-bound cookies (Chrome 127 and later) cannot be imported |

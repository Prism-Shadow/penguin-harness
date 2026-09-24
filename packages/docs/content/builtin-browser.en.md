---
title: Built-in Browser
description: A browser in the desktop app's dock that you and your agents share, with sign-ins imported from your own browser and automation through penguin browser.
---

The **Browser** panel is a web browser built into the desktop app's dock. You browse in it like in any browser, and your agents drive the same tabs from their shell with `penguin browser`: they read pages, click and type, and pull out data such as your Amazon orders, signed in with your own accounts. The browser keeps its own sign-ins and history, separate from your system browser, and can import both from Chrome, Edge, Brave, Arc, Vivaldi, Opera, Chromium or Firefox.

- To get started, see [Open the Browser panel](#open-the-browser-panel).
- To let an agent use your accounts, see [Sign in](#sign-in) and [Import from your browser](#import-from-your-browser).
- To automate it yourself or understand what an agent does, see [Drive it from the command line](#drive-it-from-the-command-line).

## Before you begin

The browser is part of the desktop app on macOS, Windows and Linux. It is not available in a browser window signed in to a server (`penguin web`), in Docker, or on a remote machine: the Web App hides the panel there, and `penguin browser` answers `browser_unavailable`. An agent that needs a browser has to run on the desktop app's own server, which is the default for conversations started in the app.

## Open the Browser panel

Open the panel from the top right of the chat toolbar: select **Right sidebar** or **Bottom panel**, then choose **Browser**. If the dock already shows other panels, use its **Add panel** menu. See [Use side panels](/chat#use-side-panels).

There is one set of browser tabs for the whole app. Every conversation's dock shows the same tabs, so a page an agent opened in one conversation is still there when you switch to another.

When an agent opens a page from a conversation you are looking at, the dock switches to the Browser panel by itself, so you can watch.

## Browse

- The tab strip shows each tab's icon and title. Select **+** to open a new tab and **×** to close one.
- The toolbar has **Back**, **Forward**, **Reload** (**Stop** while a page loads) and the address bar. Type a URL to open it. A bare domain such as `amazon.com` opens over `https://`. Anything else is searched with Bing. While you type, pages from the browser's history are suggested; use the arrow keys and Enter to pick one.
- The toolbar's menu holds **Import from browser…**, **Clear browsing data…**, **Open in system browser** and **Developer tools**.
- A link that opens a new window, and a page's pop-up, open as new tabs. A page can open at most three tabs every five seconds; more are ignored.
- A download asks where to save the file, as the system browser does.

The panel follows the app's light or dark theme; the pages themselves keep their own colors.

## When an agent uses the browser

While an agent is working in a tab, a slow pulsing ring runs around the page and an icon in the toolbar says so. The agent's commands act on the page through the browser's developer tools, not through your mouse and keyboard, so you can watch without anything moving on your screen. Avoid clicking inside the page while the agent is working on it: your clicks change the page under the agent.

A dialog the page opens while an agent acts is answered for it, so the page does not wait on you: an alert is accepted, and a confirmation, a prompt or a leave-page dialog is dismissed unless the agent asked to accept it. Dialogs that appear while you browse show as usual.

The page on screen is laid out at the size of the panel, so in a narrow panel a site may show its mobile layout. A page you are not looking at, in another tab or while the dock is closed, stays loaded at the size it was last shown at, or at 1280×800 if it was never shown, and the agent keeps working in it.

## Sign in

Sign in to websites in the panel as you would in any browser. Sign-ins and site data are kept between restarts, in the browser's own profile: signing in here does not sign you in to your system browser, and the other way round.

Agents never type your passwords. When a page an agent needs asks for a sign-in, the `browser-automation` skill has it stop and ask you to sign in in the panel, or to import your sign-in from the browser you normally use.

## Import from your browser

Import copies the cookies (which hold your sign-ins) and the history of one profile of a browser installed on this machine into the built-in browser.

1. In the toolbar's menu, select **Import from browser…**. When no tab is open, the panel offers the same button.
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

## Drive it from the command line

`penguin browser` drives the tabs from a shell, and it is how agents use the browser. The preinstalled `browser-automation` plugin teaches them the loop: open a page, read it, act with JavaScript, and check what changed.

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

## How it works

- Each tab is a Chromium page hosted by the desktop app, in its own persistent profile. Pages see an ordinary Chrome browser.
- The server drives pages through the Chrome DevTools Protocol, relayed by the desktop app. Reading, running scripts, clicking and typing all happen on the server's side of that link, so they improve with server updates.
- Pages are read and changes are tracked by scripts adapted from [GenericAgent](https://github.com/lsdefine/genericagent) (MIT): its DOM simplification and its `web_scan` / `web_execute_js` design.
- The history is a file in the data root, `builtin-browser/history.json`. Cookies and site storage live in the desktop app's own profile directory.
- Everything goes through the server's `/api/builtin-browser` routes, which only administrators may call. See [Server API](/server-api).

## Limits

| Limit | Value |
| --- | --- |
| Where it works | The desktop app only |
| Tabs | 30 at most; a new tab beyond them is refused (`too_many_tabs`) |
| `scan` body | 35,000 characters by default (`--max-chars`); a third of that with `--text` |
| `exec` return value shown | 8,000 characters; `--save` writes all of it to a file |
| `exec` script time | 15 seconds by default (`--timeout`) |
| Page load wait | 15 seconds for `open` |
| History | The newest 5,000 pages, imported ones included |
| Windows cookie import | Chrome's app-bound cookies (Chrome 127 and later) cannot be imported |

# A Browser tab in the dock: pages on a host of their own, with the app's theme offered

- **Date:** 2026-09-19
- **Type:** feat
- **Scope:** `server`, `web`, `docs`
- **PR:** [#806](https://github.com/Prism-Shadow/penguin-harness/pull/806)

[中文版](2026-09-19-dock-browser.zh.md)

The dock gets Browser tabs. `localhost:3000` in one means port 3000 of the machine the conversation's Workspace is on; any other address is the public internet. Every page runs on a host of its own, away from the app's cookie.

## Addresses

- **A loopback name is the Workspace's machine.** `localhost`, `127.0.0.1`, `[::1]` and `*.localhost` reach the loopback of the machine the Workspace is on, through the connection already held to it (it never opens ssh of its own), or directly for a Workspace on this server — over `http`, or `https` when the server there speaks TLS (its certificate is not verified: the hop is a loopback or an ssh channel). Never this server's own port. It needs no port forward and makes none.
- **Any other name is a public address**, fetched by this server through its ordinary outbound path, so the admin proxy settings apply.
- Only `http` and `https`; an address with a user name or password is refused; a bare address gets `http://`.

## Isolation

- **Each site gets `<label>.localhost`.** A site is `(user, machine, upstream origin)`. Browsers resolve `*.localhost` to the loopback without DNS, and the app's host-only session cookie on `localhost` is not sent there. Root-absolute paths, cookies and storage work untouched, and sites cannot see each other.
- **The label is 128 random bits**, stored in `web.db` (`browser_sites`, migration 14 `browser-sites`, swap-safe), so a site keeps its host, its cookies and its storage across a restart or a hot push. Each user keeps the 200 most recently used.
- **The app is not on a Browser host.** `HttpModule` gains a `hosts` slot: a request whose Host matches is dispatched to the bound app ahead of the body cap, the JSON-only rule, the cookie gate and every route group, and never falls back. An unknown label is `404`.
- **A site is minted only by the app**, at `POST /api/browser/sites`, behind the session cookie a Browser page never has. A machine's ports need an admin; this server's ports and the public internet are any signed-in user's.
- The label is that host's only credential, so every proxied response carries `Referrer-Policy: no-referrer`. The frame's sandbox withholds `allow-top-navigation`.
- **Popups and dialogs work.** A window the page opens (`window.open`, a `target="_blank"` link to its own site — an OAuth sign-in, a print view) is a real window on the site's host, outside the frame's sandbox: `window.opener` and `postMessage` back to the page work, and the popup navigates freely. `alert`, `confirm` and `prompt` are allowed too. In the desktop app such a popup opens as a window of the app (a `<label>.localhost` host on the instance's port is part of its local surface) rather than being handed to the system browser, where the opener relation would be lost.
- The Browser needs the app opened on `localhost` (desktop, local, or a tunnel to it); otherwise the mint answers `409` `browser_unavailable` and the tab says why.

## Egress guard

- On every request to a public target, every address the name resolves to must be on the public internet. Loopback, private, CGNAT, link-local (cloud metadata included), multicast and reserved ranges, IPv6 ULA and link-local, IPv4-mapped and NAT64 forms are refused, and so is a form that is not recognised.
- On a direct connection the check is the socket's own `lookup`, which closes DNS rebinding. Through a forward proxy the proxy resolves the name itself; the check runs beside it.
- Redirects are never followed server-side. A `Location` to the site itself is rewritten to the Browser host; any other is left to the browser.

## Proxy and theme

- The upstream is asked under its own `Host`, with `Origin` and `Referer` mapped back to its origin. `X-Frame-Options`, CSP `frame-ancestors` and HSTS are dropped from the answer.
- **A site's cookies work inside the tab.** The frame is cross-site to the app by design, and a browser drops a cookie there unless it says `SameSite=None; Secure` — the default, Lax, is refused from a header and from script alike. So every `Set-Cookie` loses `Domain=` and is rewritten to `SameSite=None; Secure; Partitioned`, and the bootstrap does the same to `document.cookie`. `Secure` is honoured on `*.localhost` over plain http; `Partitioned` keeps the cookie where third-party cookies are blocked.
- **An address the page wrote out in full comes back to its host.** A page that believes it is on `http://localhost:3000` and says so — `fetch("http://localhost:3000/api")`, `new WebSocket("ws://localhost:3000")` — would reach the viewer's own port 3000. The bootstrap brings such an address back to the Browser host, in `fetch`, `XMLHttpRequest`, `WebSocket` and `EventSource`.
- HTML up to 8MB gets a bootstrap script first in `<head>`, carrying the page's CSP nonce when it has one.
- **The theme is offered, not forced.** The bootstrap keeps `:root { color-scheme; --penguin-* }` in a `<style>` placed first, so the page's own declarations win. The variables are the app's resolved tokens under a `--penguin-` prefix — the roles resolved for the scheme in force (`--penguin-bg`, `--penguin-surface`, `--penguin-fg`, `--penguin-muted`, `--penguin-border`, `--penguin-hover`), the accent pair, the font stack and the gray scale — because the unprefixed names are Tailwind's too. They are posted to the frame on load and on every appearance change, to that tab's host only.
- The page reports its address and title, so the address bar follows its links and the tab takes its title. A link that leaves the site is handed to the tab, which opens it as a site of its own.

## Pages

- The entries sit next to the terminal's: the dock picker, the "+" menu and the launcher fan, plus a Ports panel row ("Open in a browser tab"). They land in the right dock by default.
- The bar has back, forward, reload and the address; a Workspace on this server also gets "Open in the system browser". A tab's address is remembered with the dock layout, so a reload returns to the page.

## The runtime's part: an upgrade seam

- **WebSockets are tunnelled.** A Response cannot carry a live socket, so upgrades get a seam of their own, the HTTP seam's counterpart: the runtime offers every Upgrade to the platform first (`PlatformApi.upgrade`, optional like `http`), and what the platform does not claim stays the terminal stream's, exactly as before. The Browser claims those whose Host is a Browser host and tunnels them to the site — request line and headers up as they came but for Host and Origin, then two sockets piped into each other. A dev server's hot-reload channel connects.
- **The App's `/api/*` defenses step aside on a Browser host.** The JSON-only rule and the body cap are the App's; a browsed site's `/api/*` is that site's, so a form post or a multipart upload there goes through. The upgrade channel (`/api/hmr`) keeps both on every host.
- Both are runtime code, so they reach an installed instance by reinstalling its program (Machines page: update; desktop: a release), not by a push. Nothing else is asked of the runtime: a platform from before the seam claims no upgrade, and a runtime from before it never offers one.

## Not proxied

- Nothing a page needs. A cross-site cookie profile aside, a site in a Browser tab behaves as it does in a tab of its own.

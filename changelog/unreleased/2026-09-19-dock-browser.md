# A Browser tab in the dock: pages on a host of their own, with the app's theme offered

- **Date:** 2026-09-19
- **Type:** feat
- **Scope:** `server`, `web`, `docs`
- **PR:** [#806](https://github.com/Prism-Shadow/penguin-harness/pull/806)

[中文版](2026-09-19-dock-browser.zh.md)

The dock gets Browser tabs beside the terminal. `localhost:3000` in one means port 3000 of the machine the conversation's Workspace is on; any other address is the public internet. Every page runs on a host of its own, away from the app's cookie.

## Addresses

- **A loopback name is the Workspace's machine.** `localhost`, `127.0.0.1`, `[::1]` and `*.localhost` reach the loopback of the machine the Workspace is on, through the connection already held to it (it never opens ssh of its own), or directly for a Workspace on this server. `http` only, and never this server's own port. It needs no port forward and makes none.
- **Any other name is a public address**, fetched by this server through its ordinary outbound path, so the admin proxy settings apply.
- Only `http` and `https`; an address with a user name or password is refused; a bare address gets `http://`.

## Isolation

- **Each site gets `<label>.localhost`.** A site is `(user, machine, upstream origin)`. Browsers resolve `*.localhost` to the loopback without DNS, and the app's host-only session cookie on `localhost` is not sent there. Root-absolute paths, cookies and storage work untouched, and sites cannot see each other.
- **The label is 128 random bits**, stored in `web.db` (`browser_sites`, migration 14 `browser-sites`, swap-safe), so a site keeps its host, its cookies and its storage across a restart or a hot push. Each user keeps the 200 most recently used.
- **The app is not on a Browser host.** `HttpModule` gains a `hosts` slot: a request whose Host matches is dispatched to the bound app ahead of the body cap, the JSON-only rule, the cookie gate and every route group, and never falls back. An unknown label is `404`.
- **A site is minted only by the app**, at `POST /api/browser/sites`, behind the session cookie a Browser page never has. A machine's ports need an admin; this server's ports and the public internet are any signed-in user's.
- The label is that host's only credential, so every proxied response carries `Referrer-Policy: no-referrer`. The frame's sandbox withholds `allow-top-navigation`.
- The Browser needs the app opened on `localhost` (desktop, local, or a tunnel to it); otherwise the mint answers `409` `browser_unavailable` and the tab says why.

## Egress guard

- On every request to a public target, every address the name resolves to must be on the public internet. Loopback, private, CGNAT, link-local (cloud metadata included), multicast and reserved ranges, IPv6 ULA and link-local, IPv4-mapped and NAT64 forms are refused, and so is a form that is not recognised.
- On a direct connection the check is the socket's own `lookup`, which closes DNS rebinding. Through a forward proxy the proxy resolves the name itself; the check runs beside it.
- Redirects are never followed server-side. A `Location` to the site itself is rewritten to the Browser host; any other is left to the browser.

## Proxy and theme

- The upstream is asked under its own `Host`, with `Origin` and `Referer` mapped back to its origin. `X-Frame-Options`, CSP `frame-ancestors` and HSTS are dropped from the answer, and `Set-Cookie` loses `Domain=`.
- HTML up to 8MB gets a bootstrap script first in `<head>`, carrying the page's CSP nonce when it has one.
- **The theme is offered, not forced.** The bootstrap keeps `:root { color-scheme; --penguin-* }` in a `<style>` placed first, so the page's own declarations win. The variables are the app's resolved tokens under a `--penguin-` prefix — the roles resolved for the scheme in force (`--penguin-bg`, `--penguin-surface`, `--penguin-fg`, `--penguin-muted`, `--penguin-border`, `--penguin-hover`), the accent pair, the font stack and the gray scale — because the unprefixed names are Tailwind's too. They are posted to the frame on load and on every appearance change, to that tab's host only.
- The page reports its address and title, so the address bar follows its links and the tab takes its title. A link that leaves the site is handed to the tab, which opens it as a site of its own.

## Pages

- Browser tabs open from the dock picker, the "+" menu, the launcher fan, and a Ports panel row ("Open in a browser tab"). They land in the right dock by default.
- The bar has back, forward, reload and the address; a Workspace on this server also gets "Open in the system browser". A tab's address is remembered with the dock layout, so a reload returns to the page.

## Limits

- A Browser host is a different site from the app, by design, so inside the tab a page is a third party: a browser profile that blocks third-party cookies (a private window, Safari, strict tracking protection) does not keep a browsed site's cookies. "Open in the system browser" is first party.

## Not proxied

- WebSocket upgrades, so a dev server's hot-reload channel does not connect. The handshake belongs to the runtime.
- A browsed site's own non-JSON writes under `/api/*`: the runtime shell applies its JSON-only and body-size rules to that prefix ahead of the platform.

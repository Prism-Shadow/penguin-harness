# Proxy options: SOCKS proxy addresses

The admin proxy address (the "Proxy options" dialog, `PUT /api/admin/settings`) now accepts any proxy URL undici's dispatcher takes — `http://`, `https://` and the (experimental in undici 7.29) `socks5://` / `socks://` schemes, credentials allowed — alongside the unchanged bare `host[:port]` shorthand (still normalized to `http://…`).

- The write-time gate is a probe ProxyAgent construction rather than a scheme list: what undici refuses (`socks4://`, `ftp://`, …) is `400 invalid_proxy_url` instead of a stored value that would crash every later startup — the dispatcher is rebuilt from the stored address on every boot, and undici throws at construction time on schemes it cannot speak.
- The canonical stored form moves from `url.origin` to `url.href` minus the parser's bare `/`: origin drops credentials and reads `"null"` for non-special schemes like socks.
- The agent-environment switch injects a `socks5://` address verbatim into `HTTP_PROXY` / `HTTPS_PROXY`; tools vary in accepting SOCKS URLs there. Desktop OS-proxy resolution still skips PAC SOCKS results for the same reason — OS-level SOCKS is opted into explicitly through the dialog instead.
- A new end-to-end test tunnels a fetch through a fake SOCKS5 server; the loopback NO_PROXY exemption applies to SOCKS addresses exactly as before.

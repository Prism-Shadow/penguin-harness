# Local and LAN destinations bypass the proxy

- **Date:** 2026-10-12
- **Type:** fix
- **Scope:** `server`, `docs`
- **PR:** [#1023](https://github.com/Prism-Shadow/penguin-harness/pull/1023)

[中文版](2026-10-12-local-destinations-bypass-proxy.zh.md)

The server's own outbound traffic no longer goes through a proxy to loopback, private or link-local addresses, or to `localhost` and `*.local` names, whatever the proxy settings and the proxy environment variables say. A model endpoint on the local network, such as `http://192.168.1.20:8000/v1`, failed whenever a desktop proxy was set, because such a proxy usually cannot reach a LAN address and answers `502`.

## Details

- The destinations are `127.0.0.0/8`, `::1`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `fc00::/7` and `fe80::/10` (IPv4-mapped IPv6 addresses included), and `localhost`, `*.localhost` and `*.local` names. Names are matched as written and not resolved. The entries of your own `NO_PROXY` keep working beside them, and every other destination follows the proxy settings as before.
- When the explicit proxy address is set and the Agent environment uses the proxy, the `NO_PROXY` given to an Agent's commands lists the same ranges as CIDR entries, plus `.local`, after the loopback names. curl 7.86 and later, Python and Go read CIDR entries; a tool that does not skips them. A passed-through environment keeps its own `NO_PROXY`.
- Nothing stored changes: the ranges are a default, not a setting.
- Traffic to connected machines never used a proxy, and still does not: a machine's API, events and terminals travel inside the ssh session the server holds to it.

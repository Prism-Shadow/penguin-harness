# Authorizing a TokenDance key works from a Web App opened on a LAN address

- **Date:** 2026-10-25
- **Type:** fix
- **Scope:** `server`, `web`
- **PR:** [#1328](https://github.com/Prism-Shadow/penguin-harness/pull/1328)

[中文版](2026-10-25-oauth-callback-origin.zh.md)

Connecting TokenDance from the Models page, with the Web App opened over plain HTTP on anything but loopback (a LAN address such as `http://192.168.1.10:7364`, a hostname, `0.0.0.0`), sent the browser to an authorization page that refused the request as invalid. That page redirects back only to an HTTPS address or to plain HTTP on `localhost`, `[::1]` or `127.x.x.x`, and the server had handed it the address the browser used.

The server now asks for the redirect only when the address can receive it. Otherwise it opens the flow in manual mode: no callback address, the same S256 PKCE challenge. The start answer's new `mode` field says which mode the flow opened in. The dialog then opens straight on the one-time code step: open the authorization page, paste the code it shows. The switch back to the automatic redirect is not offered there, because the provider would refuse it. On loopback and HTTPS addresses the redirect stays the default, and the switch between the two works as before.

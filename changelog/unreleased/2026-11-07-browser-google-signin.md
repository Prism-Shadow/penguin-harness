# Desktop: Google sign-in works in the built-in browser

- **Date:** 2026-11-07
- **Type:** fix
- **Scope:** `desktop`
- **PR:** [#1505](https://github.com/Prism-Shadow/penguin-harness/pull/1505)

[中文版](2026-11-07-browser-google-signin.zh.md)

Signing in to a Google account in the desktop app's built-in browser stopped after the email step with "Couldn't sign you in. This browser or app may not be secure." The browser presented itself to every site as plain Chrome, and Google's sign-in refuses a browser that claims to be Chrome while its other signals say otherwise. Google's sign-in pages now see Electron's own user agent, which says what the browser is. Every other site sees Chrome's user agent, as before.

## Details

- A tab presents Electron's own user agent while its main frame is on `accounts.google.com` or `accounts.youtube.com`. Its requests carry it, and so does its pages' `navigator.userAgent`. The tab presents Chrome's user agent again as soon as it leaves those hosts.
- Client hints (`Sec-CH-UA*`, `navigator.userAgentData`) stay Chromium's own on every page and are never rewritten.
- The tab switches user agent as a main-frame navigation starts. A server redirect into or out of Google's sign-in, such as a site's "Sign in with Google" button or Google's redirect back to the site afterwards, is cancelled and started again at its target, so the page it lands on gets the right user agent from its first request.

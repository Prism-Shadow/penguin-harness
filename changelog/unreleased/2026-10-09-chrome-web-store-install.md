# The Chrome extension installs from the Chrome Web Store

- **Date:** 2026-10-09
- **Type:** feature
- **Scope:** `web`, `docs`

[中文版](2026-10-09-chrome-web-store-install.zh.md)

PenguinHarness Browser is listed on the [Chrome Web Store](https://chromewebstore.google.com/detail/penguinharness-browser/dodgfhpcbmkjfcbgnoidablfgjjhhmgp), and the store is now the recommended way to install it. The release zip stays for networks that cannot reach the store.

- The first step of **Connect your Chrome** links to the store listing first. Below it, a quieter line gives the zip download and the developer-mode steps for when the store does not open.
- The listing has the extension ID that the manifest's pinned key gives the zip, so the server accepts both without a change. Chrome holds one copy per ID: moving from the zip to the store means removing the loaded copy first and pairing again.
- The **Use your own Chrome** docs page and the README recommend the store and keep the zip as the fallback.

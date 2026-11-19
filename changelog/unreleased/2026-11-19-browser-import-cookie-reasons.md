# Browser import gives every skipped cookie a reason, and can read Chrome's cookies through its extension

- **Date:** 2026-11-19
- **Type:** fix
- **Scope:** `server`, `web`, `cli`, `browser-extension`, `docs`
- **Issue:** [#1628](https://github.com/Prism-Shadow/penguin-harness/issues/1628)

[中文版](2026-11-19-browser-import-cookie-reasons.zh.md)

Importing from a browser into the built-in Browser now names a reason, with its count, for every
cookie it skips, and the reasons and notes appear in the reader's language. A connected System
Chrome extension became a second route to Chrome's cookies. It reaches the ones Chrome's
app-bound encryption keeps from the disk import on Windows, after the user allows each import on
a page in Chrome.

## Details

- Each skipped cookie is counted under one reason: `app_bound`, `dpapi`, `keychain`, `keyring`,
  `undecryptable`, `partitioned` (a cookie kept for one top-level site, or a Firefox container's)
  or `expired`. The counts add up to the skipped total. Partitioned and expired cookies were
  skipped before without being mentioned.
- `POST /api/builtin-browser/import` answers `cookies.skips`, `notes` (no cookie store or history,
  a store held open or unreadable, cookies the built-in browser refused) and `browserName`, in
  place of the English `warnings` list. The import dialog and `penguin browser import` word them
  from their own dictionaries; the CLI prints a `skipped:` line.
- `GET /api/builtin-browser/import/sources` lists the caller's connected Chrome extension as
  `chrome-extension` (cookies only, from the Chrome profile it runs in), or says in `extension`
  why it is missing. The import sends the extension `read-cookies`. The extension opens a consent
  page naming the server and reads `chrome.cookies.getAll` only after **Allow**. Deny, closing
  the page, or two minutes without an answer refuses with `import_declined` (403); an older
  extension answers `extension_outdated` (409). The cookies go through the disk import's rules
  into the same Project storage.
- The import dialog lists the extension under its own group. On Windows, with a Chrome profile
  chosen, it says in one line how to get the cookies Chrome keeps to itself. After app-bound
  skips, the outcome offers **Import through the Chrome extension**.
- The extension gained the `cookies` permission and the host permission `*://*/*`. Neither adds a
  warning to those its `debugger` permission already shows, so Chrome does not ask again on
  update.

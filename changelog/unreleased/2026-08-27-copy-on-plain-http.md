# Copy works on a plain-HTTP origin, and the check means it happened

- **Date:** 2026-08-27
- **Type:** fix
- **Scope:** `web`
- **PR:** [#523](https://github.com/Prism-Shadow/penguin-harness/pull/523)
- **Issue:** [#468](https://github.com/Prism-Shadow/penguin-harness/issues/468)

[中文版](2026-08-27-copy-on-plain-http.zh.md)

Every copy control in the Web App — a reply, a user message, a code block, a Session id, an Agent State path, a terminal selection, a copy row in a menu — reached for the async Clipboard API alone, which browsers expose only in a secure context. On a plain-HTTP origin that is not localhost, the shape a non-loopback `HOST` bind serves, the write was a no-op while the control still flashed its check (or its toast) and announced a copy to screen readers: the text went nowhere and the control said it had landed. Writes now go through the `copy-to-clipboard` package, which falls back to the document's own copy command where the Clipboard API is missing or refused, and the check, the tooltip, the announcement and the toast all wait for the write to report that it succeeded.

## Details

- Every copy control, the terminal's copy-selection keys and a program's own copy (OSC 52) call one module, `packages/web/src/lib/clipboard.ts`, which alone imports the package; a test asserts no other module under `packages/web/src` writes to `navigator.clipboard` or imports the package.
- The absent-API path reaches the document's copy command without suspending, inside the click's own task, because that command is only honoured while a user gesture is in progress.
- The element the fallback borrows is fixed-positioned and clipped to nothing, so selecting it cannot scroll the page; it is removed whether the copy succeeds or not, and the page's selection and the focused input — the terminal's, when copying a terminal selection — are handed back afterwards.
- A copy the browser refuses outright leaves the control idle instead of showing the check, so the copy can be retried rather than being reported as done. The package's `window.prompt` last resort stays off.
- Terminal paste was left as it was: `Ctrl+V`, `Ctrl+Shift+V` and `Shift+Insert` ride the browser's native paste event, which involves no clipboard permission.

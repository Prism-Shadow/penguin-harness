# Copy works on a plain-HTTP origin, and the check means it happened

- **Date:** 2026-08-27
- **Type:** fix
- **Scope:** `web`
- **PR:** [#523](https://github.com/Prism-Shadow/penguin-harness/pull/523)
- **Issue:** [#468](https://github.com/Prism-Shadow/penguin-harness/issues/468)

[中文版](2026-08-27-copy-on-plain-http.zh.md)

Every copy control in the Web App — a reply, a user message, a code block, a Session id, an Agent State path, a terminal selection — reached for the async Clipboard API alone, which browsers expose only in a secure context. On a plain-HTTP origin that is not localhost, the shape a non-loopback `HOST` bind serves, the write was a no-op while the button still flashed its check and announced a copy to screen readers: the text went nowhere and the control said it had landed. The write gained a fallback through a hidden textarea and the document's own copy command, and the check now waits for the write to report that it succeeded.

## Details

- The fallback was put in one module that every copy control and the terminal call, so a copy affordance cannot reintroduce the silent no-op by reaching for `navigator.clipboard` on its own — a test asserts no other module under `packages/web/src` writes to it.
- The textarea the fallback borrows is fixed-positioned and transparent rather than placed off-screen: `select()` scrolls its target into view, and a textarea below the fold would jump the page on every copy.
- The absent-API path reaches the document's copy command without suspending, inside the click's own task, because that command is only honoured while a user gesture is in progress.
- A copy the browser refuses outright — permission denied on an origin where the Clipboard API does exist — leaves the control idle instead of showing the check, so the copy can be retried rather than being reported as done.
- Terminal paste was left as it was: `Ctrl+V`, `Ctrl+Shift+V` and `Shift+Insert` ride the browser's native paste event, which involves no clipboard permission.

/**
 * Clipboard writes for the whole Web App — the one place that knows the async Clipboard
 * API is not always there.
 *
 * `navigator.clipboard` is secure-context-only: it is `undefined` on a plain-HTTP origin
 * that is not localhost, which is exactly the shape a non-loopback `HOST` bind serves (a
 * LAN address, a remote install reached at `http://<host>:7364`). Reaching straight for
 * it there writes nothing at all, so every copy affordance goes through this entry.
 *
 * The write itself is `copy-to-clipboard`'s: the Clipboard API in a secure context, and
 * otherwise (or when the API refuses) a hidden, out-of-layout element selected and copied
 * with the document's own copy command — reached without suspending, inside the click's
 * own task, because that command is only honoured while a user gesture is in progress —
 * with the page's selection and focused input handed back afterwards. The module stays so
 * callers never name the package or its options, and a later change of implementation
 * touches this file alone.
 *
 * Every write is plain text alone, on both paths. That is the reason for `format`: the copy
 * command copies the hidden element as the browser copies any selection, adding a `text/html`
 * flavour that carries the page's inherited ink and font — the dark theme's light text on a
 * pasted page — unless its copy event is cancelled and handed the text, which `format` makes
 * the library do. On the Clipboard API path it writes one ClipboardItem holding `text/plain`
 * instead of `writeText`; where ClipboardItem does not exist the library falls through to the
 * command, still plain text alone.
 */
import copy from "copy-to-clipboard";

/**
 * Copies `text`, resolving to whether it actually reached the clipboard. Never rejects, and
 * never reports a write it did not make — the callers show their "copied" feedback on this
 * result. The library's `window.prompt` last resort stays off (its default): a copy that
 * failed shows no check, not an unexpected dialog.
 */
export function writeClipboard(text: string): Promise<boolean> {
  return copy(text, { format: "text/plain" });
}

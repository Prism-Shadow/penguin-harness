/**
 * Clipboard writes for the whole Web App — the one place that knows the async Clipboard
 * API is not always there.
 *
 * `navigator.clipboard` is secure-context-only: it is `undefined` on a plain-HTTP origin
 * that is not localhost, which is exactly the shape a non-loopback `HOST` bind serves (a
 * LAN address, a remote install reached at `http://<host>:7364`). Reaching straight for
 * it there writes nothing at all, so every copy affordance goes through this fallback
 * instead.
 */

/**
 * Copies `text`, resolving to whether it actually reached the clipboard. Never throws, and
 * never reports a write it did not make — the callers show their "copied" feedback on this
 * result.
 *
 * The fallback selects a hidden textarea and asks the document to copy it. That command is
 * only honoured while the browser considers a user gesture in progress, which the
 * secure-context path preserves: with `navigator.clipboard` absent, reading `.writeText`
 * off it throws before the first `await` suspends, so the `catch` still runs inside the
 * click's own task. A rejected write (permission denied on an otherwise fine origin) has
 * already suspended by then and may find the gesture spent — it reports `false` rather
 * than a copy that did not happen.
 */
export async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    // Out of layout (fixed + transparent) rather than off-screen: `select()` scrolls
    // whatever it selects into view, and a textarea placed below the fold would jump the
    // page on every copy.
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.left = "0";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    try {
      ta.select();
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      ta.remove();
    }
  }
}

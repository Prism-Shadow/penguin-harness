/**
 * Sizing a window so one tab's content area (the page, without the window's frame, tab strip,
 * toolbar or bars) comes out at a given size: what `set-window-size` asks for.
 *
 * Chrome sizes windows, not pages, but it reports both: a window's `width`/`height` include its
 * frame, a tab's are its content area. The frame is the difference, so the window is asked for
 * the content size plus the frame as Chrome measures it now. Chrome answers that update before
 * the page has been laid out again, so the tab's size is read back until it settles. When it
 * settles off the size asked for because the frame changed meanwhile (a bar came or went), one
 * more pass asks again with the new frame. When it settles off because the window was kept within
 * the screen or above Chrome's smallest size, asking again would change nothing: the size Chrome
 * gave is the answer, and the server decides what to do with it. A window so large that less than
 * half of it would be on the screen Chrome refuses outright; the page then keeps its size, which
 * is the answer the same way.
 *
 * Only the extension's own windows are sized (tabs.ts moves a tab into one first), never one of
 * the user's.
 */

export interface Size {
  width: number;
  height: number;
}

/** How often the tab's size is read back while Chrome resizes it, and for how long at most. */
const POLL_MS = 50;
const SETTLE_MS = 1_000;

/** The window size that gives a content area of `want`, from the two sizes Chrome reports now. */
export function windowSizeFor(want: Size, content: Size, window: Size): Size {
  return {
    width: window.width + want.width - content.width,
    height: window.height + want.height - content.height,
  };
}

/**
 * Sizes the window so the tab in it shows a content area of `want`. Resolves with the content
 * area as Chrome reports it once it settled, which may differ from `want`.
 */
export async function sizeContentArea(tabId: number, windowId: number, want: Size): Promise<Size> {
  let content = await contentOf(tabId);
  let asked: Size | undefined;
  for (let pass = 0; pass < 2 && !same(content, want); pass++) {
    const window = await chrome.windows.get(windowId);
    const target = windowSizeFor(want, content, sizeOf(window, "window"));
    // Chrome held the window off the size asked for last time; it would again.
    if (asked !== undefined && same(target, asked)) break;
    asked = target;
    const update: chrome.windows.UpdateInfo = { width: target.width, height: target.height };
    // A maximized, minimized or full-screen window takes no size until it is normal again.
    if (window.state !== undefined && window.state !== "normal") update.state = "normal";
    try {
      await chrome.windows.update(windowId, update);
    } catch {
      // Chrome refuses a window less than half on the screen rather than shrink it: the page
      // keeps the size it has, and that is the answer (read again: a closed tab answers so).
      return contentOf(tabId);
    }
    content = await settled(tabId, content, want);
  }
  return content;
}

/**
 * The tab's size once Chrome has resized it: when it is `want`, or when it has moved off
 * `before` and held for one more read; at most SETTLE_MS later, whatever it is then.
 */
async function settled(tabId: number, before: Size, want: Size): Promise<Size> {
  let last = before;
  for (let waited = 0; waited < SETTLE_MS; waited += POLL_MS) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    const now = await contentOf(tabId);
    if (same(now, want) || (!same(now, before) && same(now, last))) return now;
    last = now;
  }
  return last;
}

async function contentOf(tabId: number): Promise<Size> {
  return sizeOf(await chrome.tabs.get(tabId), "tab");
}

function sizeOf(thing: { width?: number; height?: number }, what: "tab" | "window"): Size {
  if (thing.width === undefined || thing.height === undefined) {
    throw new Error(`Chrome did not report the ${what}'s size.`);
  }
  return { width: thing.width, height: thing.height };
}

const same = (a: Size, b: Size): boolean => a.width === b.width && a.height === b.height;

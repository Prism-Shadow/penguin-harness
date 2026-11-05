/**
 * A new page's tab id, found as early as its `<webview>` knows it
 * (features/builtin-browser/guest-id.ts). In the desktop app Electron reports `did-attach` and
 * `did-start-loading` before the element has been told its id, and the claim used to wait for
 * the next event that found one: the page's `dom-ready`, seconds later on a slow homepage, all of
 * which the new tab spent off screen, reading as a blank "New tab".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GUEST_ID_RETRIES,
  GUEST_ID_RETRY_MS,
  watchGuestId,
} from "../src/features/builtin-browser/guest-id";

/** A `<webview>` as far as the watcher sees it: events, and an id that arrives when `attach` says. */
class FakeView extends EventTarget {
  id: number | null = null;
  asked = 0;

  getWebContentsId(): number {
    this.asked += 1;
    if (this.id === null) {
      throw new Error(
        "The WebView must be attached to the DOM and the dom-ready event emitted before this method can be called.",
      );
    }
    return this.id;
  }

  fire(name: string): void {
    this.dispatchEvent(new Event(name));
  }
}

let view: FakeView;
let found: number[];
beforeEach(() => {
  vi.useFakeTimers();
  view = new FakeView();
  found = [];
});
afterEach(() => vi.useRealTimers());

describe("watchGuestId", () => {
  it("claims at the attach when the element already knows its id", () => {
    watchGuestId(view, (id) => found.push(id));
    view.id = 5;
    view.fire("did-attach");
    expect(found).toEqual([5]);
  });

  it("asks again after an attach that came before the id, without waiting for dom-ready", () => {
    watchGuestId(view, (id) => found.push(id));
    view.fire("did-start-loading");
    view.fire("did-attach");
    expect(found).toEqual([]);
    // The answer to the create request lands a few milliseconds later.
    vi.advanceTimersByTime(GUEST_ID_RETRY_MS * 2);
    expect(found).toEqual([]);
    view.id = 7;
    vi.advanceTimersByTime(GUEST_ID_RETRY_MS);
    expect(found).toEqual([7]);
  });

  it("reports the id once, however many events follow", () => {
    watchGuestId(view, (id) => found.push(id));
    view.id = 3;
    view.fire("did-attach");
    view.fire("load-commit");
    view.fire("dom-ready");
    vi.advanceTimersByTime(1000);
    expect(found).toEqual([3]);
  });

  it("asks one retry at a time, however many events find no id", () => {
    watchGuestId(view, (id) => found.push(id));
    view.fire("did-start-loading");
    view.fire("did-attach");
    const asked = view.asked;
    vi.advanceTimersByTime(GUEST_ID_RETRY_MS);
    expect(view.asked).toBe(asked + 1);
  });

  it("stops asking after a while, and a later event still finds the id", () => {
    watchGuestId(view, (id) => found.push(id));
    view.fire("did-attach");
    vi.advanceTimersByTime(GUEST_ID_RETRY_MS * (GUEST_ID_RETRIES + 10));
    const asked = view.asked;
    vi.advanceTimersByTime(10_000);
    expect(view.asked).toBe(asked);
    view.id = 9;
    view.fire("dom-ready");
    expect(found).toEqual([9]);
  });

  it("stops watching when asked to: no event and no pending retry reports anything", () => {
    const stop = watchGuestId(view, (id) => found.push(id));
    view.fire("did-attach");
    stop();
    view.id = 4;
    vi.advanceTimersByTime(1000);
    view.fire("dom-ready");
    expect(found).toEqual([]);
  });
});

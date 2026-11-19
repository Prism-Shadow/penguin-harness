// @vitest-environment jsdom
/**
 * The waiting state (components/feedback/waiting/waiting.tsx), on a real page with the clock
 * under the test's hand.
 *
 * - Given a load that answers inside the delay, nothing of the wait is ever shown or announced:
 *   the content replaces it before it would have shown.
 * - Given a slow load, the wait shows once the delay has passed and says what it waits for — the
 *   package's word when the caller names nothing — and the content then replaces it.
 * - Given either state, the placeholder already stands in the shape of what is coming, so showing
 *   it adds nothing and moves nothing: the same blocks, pending and shown.
 * - Given its forms, `rows` draws the rows asked for, `page` a title line over a body, and the
 *   caller's own blocks replace both.
 */
import { act, createElement, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Skeleton } from "../src/components/feedback/skeleton/skeleton";
import { WAITING_DELAY_MS, Waiting } from "../src/components/feedback/waiting/waiting";
import type { WaitingProps } from "../src/components/feedback/waiting/waiting";
import { DEFAULT_UI_STRINGS } from "../src/strings";
import { mount, unmountAll } from "./helpers/dom";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(async () => {
  await unmountAll();
  vi.useRealTimers();
});

const host = () => document.querySelector<HTMLElement>('[role="status"]');
const announced = () => host()?.textContent ?? "";
const blocks = () => document.querySelectorAll("[data-skeleton]").length;
const advance = (ms: number) =>
  act(async () => {
    vi.advanceTimersByTime(ms);
  });

/** A region that waits until `land()` hands it its content, the way a page waits on a read. */
function loadingRegion(props: WaitingProps = {}) {
  let land: () => void = () => {};
  function Region() {
    const [loaded, setLoaded] = useState(false);
    land = () => setLoaded(true);
    return loaded
      ? createElement("p", null, "Three vault keys")
      : createElement(Waiting, { label: "Loading the vault", ...props });
  }
  return { element: createElement(Region), land: () => act(async () => land()) };
}

describe("a wait", () => {
  it("that answers inside the delay is never shown nor announced", async () => {
    const { element, land } = loadingRegion();
    await mount(element);
    await advance(WAITING_DELAY_MS / 2);
    expect(host()?.dataset.state).toBe("pending");
    expect(announced()).toBe("");

    await land();
    await advance(WAITING_DELAY_MS * 2);
    expect(host()).toBeNull();
    expect(document.body.textContent).toBe("Three vault keys");
  });

  it("that outlasts the delay shows, says what it waits for, and gives way to the content", async () => {
    const { element, land } = loadingRegion();
    await mount(element);
    await advance(WAITING_DELAY_MS);
    expect(host()?.dataset.state).toBe("shown");
    expect(announced()).toBe("Loading the vault");

    await land();
    expect(host()).toBeNull();
    expect(document.body.textContent).toBe("Three vault keys");
  });

  it("says the package's word when the caller names nothing", async () => {
    await mount(createElement(Waiting));
    await advance(WAITING_DELAY_MS);
    expect(announced()).toBe(DEFAULT_UI_STRINGS.loading);
  });

  it("holds the shape of what is coming before it shows, so showing it moves nothing", async () => {
    await mount(createElement(Waiting, { rows: 4 }));
    const pending = { blocks: blocks(), state: host()?.dataset.state };
    await advance(WAITING_DELAY_MS);
    expect(pending).toEqual({ blocks: 4, state: "pending" });
    expect(blocks()).toBe(4);
    expect(host()?.dataset.state).toBe("shown");
  });
});

describe("a wait's forms", () => {
  it("draws the rows asked for, a page's title line over its body, or the caller's own blocks", async () => {
    const { container } = await mount(
      createElement(
        "div",
        null,
        createElement(Waiting, { rows: 5 }),
        createElement(Waiting, { form: "page" }),
        createElement(Waiting, null, createElement(Skeleton, { className: "size-14" })),
      ),
    );
    const [rows, page, custom] = [...container.querySelectorAll<HTMLElement>('[role="status"]')];
    expect(rows!.querySelectorAll("[data-skeleton]")).toHaveLength(5);
    expect(page!.querySelectorAll("[data-skeleton]")).toHaveLength(2);
    expect(custom!.querySelectorAll("[data-skeleton]")).toHaveLength(1);
    expect([rows, page, custom].map((el) => el!.dataset.form)).toEqual(["rows", "page", "custom"]);
  });
});

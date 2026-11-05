// @vitest-environment jsdom
/**
 * A reply settling (the UI package's StreamText, through AssistantText as the transcript renders
 * it): the moments after the text turns whole, while a theme eases its veil away. The browser's
 * Web Animations are the one fake: a theme's running transition of `--_stream-veil` is what
 * `getAnimations()` reports on the host.
 *
 * - Given a reply that finishes while the theme's veil transition runs, the host holds
 *   `data-settling` until that transition finishes, then carries no settling state at all.
 * - Given a theme that transitions nothing (Primer, Console, reduced motion), the finished reply
 *   never keeps `data-settling`.
 * - Given the veil's transition is cancelled, the host lets go of `data-settling` too.
 * - Given a reply that mounts finished, it never settles.
 */
import { createElement as h } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { AssistantText } from "@prismshadow/penguin-ui";
import { mount, settle, unmountAll } from "./helpers/dom";

interface FakeTransition {
  transitionProperty: string;
  finished: Promise<unknown>;
  finish(): void;
  cancel(): void;
}

function veilTransition(): FakeTransition {
  let finish = () => {};
  let cancel = () => {};
  const finished = new Promise<unknown>((resolve, reject) => {
    finish = () => resolve(undefined);
    cancel = () => reject(new DOMException("cancelled", "AbortError"));
  });
  return { transitionProperty: "--_stream-veil", finished, finish, cancel };
}

/** What the browser reports running on a `.ui-stream` host; nothing anywhere else. */
function animate(running: FakeTransition[]) {
  Object.defineProperty(Element.prototype, "getAnimations", {
    configurable: true,
    value(this: Element) {
      return this.classList.contains("ui-stream") ? running : [];
    },
  });
}

const host = () => document.querySelector(".ui-stream");

afterEach(async () => {
  await unmountAll();
  delete (Element.prototype as { getAnimations?: unknown }).getAnimations;
});

describe("a reply settling", () => {
  it("holds data-settling while the veil eases away, and carries nothing once it has", async () => {
    const veil = veilTransition();
    animate([veil]);
    const page = await mount(h(AssistantText, { text: "Hello", streaming: true }));
    expect(host()?.getAttribute("data-state")).toBe("streaming");
    expect(host()?.hasAttribute("data-settling")).toBe(false);

    await page.rerender(h(AssistantText, { text: "Hello world", streaming: false }));
    await settle();
    expect(host()?.getAttribute("data-state")).toBe("done");
    expect(host()?.hasAttribute("data-settling")).toBe(true);

    veil.finish();
    await settle();
    expect(host()?.hasAttribute("data-settling")).toBe(false);
  });

  it("never keeps data-settling where nothing transitions the veil", async () => {
    animate([]);
    const page = await mount(h(AssistantText, { text: "Hello", streaming: true }));
    await page.rerender(h(AssistantText, { text: "Hello world", streaming: false }));
    await settle();
    expect(host()?.getAttribute("data-state")).toBe("done");
    expect(host()?.hasAttribute("data-settling")).toBe(false);
  });

  it("lets go when the veil's transition is cancelled", async () => {
    const veil = veilTransition();
    animate([veil]);
    const page = await mount(h(AssistantText, { text: "Hello", streaming: true }));
    await page.rerender(h(AssistantText, { text: "Hello world", streaming: false }));
    await settle();
    expect(host()?.hasAttribute("data-settling")).toBe(true);
    veil.cancel();
    await settle();
    expect(host()?.hasAttribute("data-settling")).toBe(false);
  });

  it("never settles a reply that mounts finished", async () => {
    animate([veilTransition()]);
    await mount(h(AssistantText, { text: "Already here", streaming: false }));
    await settle();
    expect(host()?.getAttribute("data-state")).toBe("done");
    expect(host()?.hasAttribute("data-settling")).toBe(false);
  });
});

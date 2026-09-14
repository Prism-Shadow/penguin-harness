/**
 * The UI workbench panel's decisions (features/workbench/workbench-state.ts): what a typed
 * address becomes, which remembered address the panel opens on, what a failed load is called,
 * whether the page behind an address can be located precisely at all, and which of the guest's
 * signals wins when they disagree. These are the branches the panel apologizes for, so each one is
 * named here rather than discovered by a user.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_ADDRESS,
  classifyLoadFailure,
  entryModuleUrl,
  hasSourceMap,
  initialAddress,
  normalizeAddress,
  pickMode,
  reduceGuest,
  reducePick,
  selectionIdentity,
  sourceFor,
  NO_PICK,
} from "../src/features/workbench/workbench-state";
import type {
  GuestSignal,
  GuestState,
  PickEvent,
  PickState,
} from "../src/features/workbench/workbench-state";
import type { ElementFacts } from "../src/features/workbench/element-picker";

describe("normalizeAddress", () => {
  it("gives a bare host:port a scheme, because that is how the address gets typed", () => {
    expect(normalizeAddress("localhost:5173")).toBe("http://localhost:5173/");
    expect(normalizeAddress("127.0.0.1:3000")).toBe("http://127.0.0.1:3000/");
  });

  it("treats a bare number as a port on this machine", () => {
    expect(normalizeAddress("5173")).toBe("http://localhost:5173/");
  });

  it("keeps the path and query of an address that has them, and drops the fragment", () => {
    expect(normalizeAddress("http://localhost:5173/dashboard?tab=1#x")).toBe(
      "http://localhost:5173/dashboard?tab=1",
    );
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeAddress("  http://localhost:5173/  ")).toBe("http://localhost:5173/");
  });

  it("refuses what is not an http(s) address — file: would have the guest read the disk", () => {
    expect(normalizeAddress("")).toBeNull();
    expect(normalizeAddress("   ")).toBeNull();
    expect(normalizeAddress("file:///etc/passwd")).toBeNull();
    expect(normalizeAddress("ftp://localhost")).toBeNull();
    expect(normalizeAddress("http://")).toBeNull();
  });
});

describe("initialAddress", () => {
  it("opens on the remembered address when there is one", () => {
    expect(initialAddress("http://localhost:3000/")).toBe("http://localhost:3000/");
  });

  it("falls back to the default when nothing is stored, and when what is stored is unusable", () => {
    expect(initialAddress(null)).toBe(DEFAULT_ADDRESS);
    expect(initialAddress("")).toBe(DEFAULT_ADDRESS);
    expect(initialAddress("file:///etc/passwd")).toBe(DEFAULT_ADDRESS);
  });
});

describe("classifyLoadFailure", () => {
  it("names a port with nothing on it apart from a page that never answered", () => {
    expect(classifyLoadFailure(-102)).toBe("refused");
    expect(classifyLoadFailure(-7)).toBe("timeout");
  });

  it("separates the failure modes that suggest different next moves", () => {
    expect(classifyLoadFailure(-105)).toBe("dns");
    expect(classifyLoadFailure(-27)).toBe("blocked");
    expect(classifyLoadFailure(-6)).toBe("http-error");
    expect(classifyLoadFailure(-324)).toBe("refused");
  });

  it("calls our own cancellation a cancellation, not a failure", () => {
    expect(classifyLoadFailure(-3)).toBe("aborted");
  });

  it("keeps an unknown code unknown rather than guessing a cause", () => {
    expect(classifyLoadFailure(-999)).toBe("other");
    expect(classifyLoadFailure(0)).toBe("other");
  });
});

describe("reduceGuest", () => {
  const fold = (signals: GuestSignal[], from: GuestState = { kind: "idle" }): GuestState =>
    signals.reduce(reduceGuest, from);

  it("shows a load in progress from the moment the guest is pointed at an address", () => {
    expect(fold([{ kind: "navigating", url: "http://localhost:5173/" }])).toEqual({
      kind: "loading",
      url: "http://localhost:5173/",
    });
  });

  it("shows a page that loaded as connected, at the URL the guest actually reached", () => {
    expect(
      fold([
        { kind: "navigating", url: "http://localhost:5173/" },
        { kind: "ready", url: "http://localhost:5173/dashboard" },
      ]),
    ).toEqual({ kind: "ready", url: "http://localhost:5173/dashboard" });
  });

  it("keeps the failure when dom-ready follows it: a failed load still commits an error page", () => {
    // Measured order on a port with nothing listening: did-fail-load at 22ms, dom-ready at 25ms.
    expect(
      fold([
        { kind: "navigating", url: "http://localhost:58731/" },
        { kind: "failed", code: -102, description: "ERR_CONNECTION_REFUSED" },
        { kind: "ready", url: "http://localhost:58731/" },
      ]),
    ).toEqual({
      kind: "failed",
      failure: "refused",
      code: -102,
      description: "ERR_CONNECTION_REFUSED",
    });
  });

  it("lets a reload clear a failure, because a new navigation is what makes the old one stale", () => {
    expect(
      fold([
        { kind: "navigating", url: "http://localhost:5173/" },
        { kind: "failed", code: -102, description: "ERR_CONNECTION_REFUSED" },
        { kind: "navigating", url: "http://localhost:5173/" },
        { kind: "ready", url: "http://localhost:5173/" },
      ]),
    ).toEqual({ kind: "ready", url: "http://localhost:5173/" });
  });

  it("holds the failure through the abort a replaced navigation reports", () => {
    const failed = fold([
      { kind: "navigating", url: "http://localhost:5173/" },
      { kind: "failed", code: -102, description: "ERR_CONNECTION_REFUSED" },
    ]);
    expect(reduceGuest(failed, { kind: "failed", code: -3, description: "ERR_ABORTED" })).toEqual(
      failed,
    );
  });

  it("says the shell has no guest at all when the element is not one", () => {
    expect(fold([{ kind: "unsupported" }])).toEqual({ kind: "unsupported-guest" });
  });
});

describe("reducePick", () => {
  const badge: ElementFacts = {
    tagName: "span",
    id: null,
    classList: ["badge"],
    cssSelector: "div.card > span.badge",
    role: null,
    name: "hello",
    testId: null,
    attributes: { class: "badge" },
    text: "hello",
    computed: { "font-size": "12px" },
    rect: { x: 10, y: 20, width: 40, height: 18 },
    parentChain: ["div.card"],
  };
  const button: ElementFacts = { ...badge, tagName: "button", classList: ["primary"] };
  const page = {
    url: "http://127.0.0.1:5199/",
    title: "fixture",
    viewport: { width: 512, height: 526, dpr: 1 },
  };
  const elsewhere = { ...page, url: "http://127.0.0.1:5199/other" };

  const fold = (events: PickEvent[]): PickState =>
    events.reduce(reducePick, { ...NO_PICK, live: true });

  it("is on by default, and off until there is a page to pick in", () => {
    expect(pickMode(NO_PICK)).toBe("off");
    expect(pickMode(reducePick(NO_PICK, { kind: "installed" }))).toBe("picking");
  });

  it("leaves the switch alone when a page loads: a reload must not undo it", () => {
    const off = fold([{ kind: "toggle" }]);
    expect(pickMode(off)).toBe("off");
    expect(pickMode(reducePick(off, { kind: "installed" }))).toBe("off");
  });

  it("forgets the selection but not the switch when the page goes away", () => {
    const state = fold([
      { kind: "selected", target: badge, page },
      { kind: "toggle" },
      { kind: "guest-gone" },
    ]);
    expect(state).toEqual({ ...NO_PICK, wanted: false });
  });

  it("clears the highlight on the first Esc and leaves pick mode on the second", () => {
    const selected = fold([{ kind: "selected", target: badge, page }]);
    const cleared = reducePick(selected, { kind: "escape" });
    expect(cleared.selected).toBeNull();
    expect(pickMode(cleared)).toBe("picking");
    expect(pickMode(reducePick(cleared, { kind: "escape" }))).toBe("off");
  });

  it("keeps the selection across 暂离, because standing down is not forgetting", () => {
    const paused = fold([{ kind: "selected", target: badge, page }, { kind: "pause" }]);
    expect(paused.selected).toEqual(badge);
    expect(pickMode(paused)).toBe("paused");
    expect(pickMode(reducePick(paused, { kind: "resume" }))).toBe("picking");
  });

  it("takes the page's own word for it when the page's picker cleared or left", () => {
    const cleared = fold([{ kind: "selected", target: badge, page }, { kind: "cleared" }]);
    expect(cleared.selected).toBeNull();
    // The page it was found on stays: only the selection went away.
    expect(cleared.page).toEqual(page);
    expect(pickMode(fold([{ kind: "selected", target: badge, page }, { kind: "exited" }]))).toBe(
      "off",
    );
  });

  it("tracks the candidate under the cursor and the element clicked afterwards", () => {
    const state = fold([
      { kind: "hover", target: badge, page },
      { kind: "selected", target: button, page },
    ]);
    expect(state.hovered).toEqual(badge);
    expect(state.selected).toEqual(button);
  });

  it("keeps the page the element was picked on, and drops it with the document", () => {
    // The payload pairs element and page, so a route change inside the page has to reach the state:
    // the panel shows the URL read in the page, never the one the address box still holds.
    const state = fold([
      { kind: "selected", target: badge, page },
      { kind: "selected", target: button, page: elsewhere },
    ]);
    expect(state.page).toEqual(elsewhere);
    // A new document is a new page: keeping the old facts would put a URL in a payload for a page
    // the element was never picked on.
    expect(reducePick(state, { kind: "installed" }).page).toBeNull();
  });
});

describe("entryModuleUrl", () => {
  const page = "http://localhost:5173/";

  it("finds the module entry among other scripts and resolves it against the page", () => {
    const html = `<head><script src="/@vite/client" type="module"></script>
      <script>window.x = 1</script>
      <script type="module" src="/src/main.tsx"></script>`;
    expect(entryModuleUrl(html, page)).toBe("http://localhost:5173/src/main.tsx");
  });

  it("returns null when there is no module script — a production build, or not an app page", () => {
    expect(entryModuleUrl(`<script src="/assets/index-abc.js"></script>`, page)).toBeNull();
    expect(entryModuleUrl("", page)).toBeNull();
  });
});

describe("hasSourceMap", () => {
  it("accepts both forms a dev server serves — inline, and a .map named beside the module", () => {
    const inline =
      "const a = 1;\n//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozfQ==";
    expect(hasSourceMap(inline)).toBe(true);
    // Measured in M3.3: Vite 7 serves its large pre-bundled dependencies exactly like this, and the
    // resolver reads that `.map` — answering "cannot be located" here would be wrong.
    expect(hasSourceMap("const a = 1;\n//# sourceMappingURL=index-abc.js.map")).toBe(true);
    expect(hasSourceMap("const a = 1;")).toBe(false);
  });
});

describe("selectionIdentity", () => {
  const page = "http://localhost:5173/";

  it("names a selection by the element and the page it was found on", () => {
    expect(selectionIdentity(page, ".card-title")).toBe(selectionIdentity(page, ".card-title"));
    // Another element on the same page is another selection.
    expect(selectionIdentity(page, ".card-title")).not.toBe(
      selectionIdentity(page, '[data-testid="badge"]'),
    );
    // So is the same element on another page — a route change is a new document.
    expect(selectionIdentity(page, ".card-title")).not.toBe(
      selectionIdentity("http://localhost:5173/other", ".card-title"),
    );
  });

  it("separates the halves with a character neither half can hold", () => {
    // A NUL is not legal in a URL, and `CSS.escape`/the picker never emit one in a selector, so the
    // two halves cannot be re-split into a different pair — which is what a printable separator
    // (a space, a `|`) would allow. Asserted on the string rather than on a collision, because the
    // colliding inputs are exactly the ones that cannot occur.
    expect(selectionIdentity("http://localhost:5173/", ".card-title")).toContain("\u0000");
  });
});

describe("sourceFor", () => {
  const identity = selectionIdentity("http://localhost:5173/", ".card-title");
  const source = { confidence: "exact" as const, file: "src/App.jsx", line: 7, column: 7 };

  it("answers with the resolution tagged for this selection", () => {
    expect(sourceFor({ identity, source }, identity)).toEqual(source);
  });

  it("answers with nothing for another selection — the frame the card used to get wrong", () => {
    // M5.1 (`实测脚本/m54-卡片归属/`): a pick lands while the previous resolution is still in state,
    // and the element on screen is the new one. The old file and line are not this element's, so the
    // row must read `pending`, not the previous element's location.
    const other = selectionIdentity("http://localhost:5173/", '[data-testid="badge"]');
    expect(sourceFor({ identity, source }, other)).toBeNull();
  });

  it("answers with nothing when there is no resolution, or no selection to ask about", () => {
    expect(sourceFor(null, identity)).toBeNull();
    expect(sourceFor({ identity, source }, null)).toBeNull();
  });
});

/**
 * Scroll dismissal for the shared portal panel (src/components/ui/use-portal-panel.ts),
 * which OptionMenu, Select, InfoPopover and the chat header's context ring all open through.
 *
 * The panel listens for scroll in the capture phase because scroll does not bubble, and the
 * price of capture on `window` is that it hears every scrolling element in the document. The
 * rule that closes a panel whose position has gone stale must therefore ask whether the
 * scrolled container holds this panel's trigger — otherwise a chat pane auto-following a
 * streaming reply closes a panel opened in the header, over content that never moved.
 *
 * `scrollMovesAnchor` itself is exercised in context-menu.test.ts; what cannot be reached
 * from a node-only suite (`environment: "node"`, no jsdom) is the wiring, and the wiring is
 * where this silently breaks: the rule is answered with the trigger element, so a consumer
 * that never attaches `triggerRef` hands it a null owner and quietly gets the old
 * close-on-any-scroll behavior back for its own panel. So the scan below discovers the
 * hook's consumers rather than listing them, and a fifth one is covered on the day it is
 * written.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../src", import.meta.url));
const HOOK = join(SRC, "components", "ui", "use-portal-panel.ts");

/** Every .ts/.tsx under src, as absolute paths (required-mark.test.ts convention). */
function sourceFiles(dir = SRC, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

/** The body of a handler declared as `const <name> = ...` up to its closing `};`. */
function handler(src: string, name: string): string {
  const body = new RegExp(`const ${name} = [\\s\\S]*?\\n {4}\\};`).exec(src);
  expect(body, `${name} should be declared in use-portal-panel.ts`).not.toBeNull();
  return body![0];
}

describe("use-portal-panel scroll dismissal", () => {
  const hook = readFileSync(HOOK, "utf8");

  it("asks whether the scroll moved this panel's trigger before closing", () => {
    const onScroll = handler(hook, "onScroll");
    expect(onScroll).toContain("scrollMovesAnchor(");
    // The trigger is the owner: the panel is placed against that element's box, so a scroll
    // that did not move it did not invalidate the position.
    expect(onScroll).toContain("triggerRef.current");
  });

  it("still exempts the panel's own internal scroll", () => {
    // A long list scrolling inside the panel must not close the panel around it — the guard
    // that does this predates the ownership test and has to survive it.
    expect(handler(hook, "onScroll")).toContain("panelRef.current?.contains(");
  });

  it("leaves a resize closing unconditionally, because it moves every trigger at once", () => {
    const onResize = /const onResize = .*/.exec(hook);
    expect(onResize).not.toBeNull();
    expect(onResize![0]).toContain("onCloseRef.current()");
    expect(onResize![0]).not.toContain("scrollMovesAnchor");
  });
});

describe("use-portal-panel consumers", () => {
  /** Files that open a panel through the hook — the hook's own module excluded. */
  const consumers = sourceFiles().filter(
    (path) => path !== HOOK && readFileSync(path, "utf8").includes("usePortalPanel({"),
  );

  it("finds the call sites the rule has to cover, including the reported one", () => {
    // A scan that silently matched nothing would pass every assertion below. The context
    // ring is the panel the failure was reported against: it is opened to watch the context
    // fill while a run streams, which is exactly when the message list scrolls itself.
    expect(consumers.length).toBeGreaterThanOrEqual(4);
    expect(consumers).toContain(join(SRC, "features", "chat", "context-gauge.tsx"));
  });

  it("each attaches the hook's triggerRef, so the ownership test has an element to read", () => {
    const missing = consumers
      .filter((path) => !readFileSync(path, "utf8").includes("ref={triggerRef}"))
      .map((path) => path.slice(SRC.length + 1));
    expect(missing).toEqual([]);
  });
});

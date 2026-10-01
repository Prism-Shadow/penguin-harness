/**
 * Guard: every consumer of the shared portal panel (the UI package's use-portal-panel.ts, which
 * OptionMenu, Select, InfoPopover and the composer's context ring open through) attaches the
 * hook's `triggerRef`. The scroll-dismissal rule asks whether a scroll moved the panel's trigger
 * (`scrollMovesAnchor`, tested in the package's portal-panel.test.ts); a consumer without the ref
 * hands it a null owner and silently gets close-on-any-scroll back. The consumers are discovered,
 * not listed, so a new one is covered the day it is written.
 *
 * - The scan finds the call sites the rule covers, the reported one (the context ring) among them.
 * - Each attaches the hook's triggerRef.
 */
import { describe, expect, it } from "vitest";
import { scanSources, sourceFile } from "./helpers/roots";

/** Every .ts/.tsx under web and the shared UI package: a consumer is covered on either side. */
const SCAN = scanSources([".ts", ".tsx"]);
const HOOK = "packages/ui/src/components/overlays/portal-panel/use-portal-panel.ts";

describe("use-portal-panel consumers", () => {
  /** Files that open a panel through the hook — the hook's own module excluded. */
  const consumers = SCAN.files
    .filter((file) => file.id !== HOOK && file.text.includes("usePortalPanel({"))
    .map((file) => file.id);

  it("finds the call sites the rule has to cover, including the reported one", () => {
    // A scan that silently matched nothing would pass every assertion below. The context
    // ring is the panel the failure was reported against: it is opened to watch the context
    // fill while a run streams, which is exactly when the message list scrolls itself.
    expect(consumers.length).toBeGreaterThanOrEqual(4);
    expect(consumers).toContain("packages/web/src/features/chat/context-gauge.tsx");
  });

  it("each attaches the hook's triggerRef, so the ownership test has an element to read", () => {
    const missing = consumers.filter(
      (id) => !sourceFile(SCAN, id).text.includes("ref={triggerRef}"),
    );
    expect(missing).toEqual([]);
  });
});

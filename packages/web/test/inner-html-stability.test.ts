/**
 * `dangerouslySetInnerHTML` must be handed a value that keeps its identity across renders.
 *
 * React compares that prop by object identity, not by the markup inside it, and re-sets
 * `innerHTML` whenever the two differ. A fresh `{ __html }` literal in the JSX is therefore a
 * new object on every render, so every render of the surrounding component destroys and
 * rebuilds every node in the block — even when the markup is byte-identical.
 *
 * Two things break when that happens, and neither is visible in a screenshot. A text selection
 * the reader made inside the block is anchored to those nodes: replacing them collapses the live
 * Range, so a selection cannot survive so much as a sibling's state change — which is what made
 * the Files panel's "add selection to conversation" unable to keep its own highlight. And the
 * highlighted body is re-parsed by the browser on every keystroke that re-renders a streaming
 * transcript, for markup that did not change.
 *
 * vitest runs node-only here (`environment: "node"`, no jsdom), so this asserts against the
 * source text rather than a rendered DOM.
 */
import { describe, expect, it } from "vitest";
import { expectEveryRootScanned, scanSources } from "./helpers/roots";

/** Every source file under web and the shared UI package (test/helpers/roots.ts). */
const SCAN = scanSources();

/** Every `.tsx` under the scanned roots, as [repo-relative id, source text]. */
function sources(): Array<[string, string]> {
  return SCAN.files
    .filter((file) => file.name.endsWith(".tsx"))
    .map((file) => [file.id, file.text]);
}

describe("dangerouslySetInnerHTML", () => {
  it("is looked for in every source root", () => {
    expectEveryRootScanned(SCAN);
  });

  it("is never given an object literal built in the JSX", () => {
    // `dangerouslySetInnerHTML={{ __html: … }}` — the inline form, which is a new object every
    // render. The value has to come from a memo (or any other stable reference) instead.
    const inline = sources()
      .filter(([, src]) => /dangerouslySetInnerHTML=\{\{/.test(src))
      .map(([path]) => path);
    expect(inline).toEqual([]);
  });

  it("is used in exactly the two places that own untrusted markup", () => {
    // A third site is not forbidden, but it is worth noticing: each one is a place sanitisation
    // has to be argued, and each one carries the identity rule above.
    const users = sources()
      .filter(([, src]) => src.includes("dangerouslySetInnerHTML"))
      .map(([path]) => path)
      .sort();
    expect(users).toEqual([
      "packages/web/src/features/chat/code-block.tsx",
      "packages/web/src/features/skills/skill-icon-view.tsx",
    ]);
  });
});

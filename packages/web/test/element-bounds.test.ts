/**
 * PRD §9.4's honesty list, as the panel decides it (`features/workbench/element-bounds.ts`, M4.4).
 *
 * What is under test is *which line applies*, not the words — the copy is bilingual and lives in the
 * strings tables, and the last block here pins that every note has one in both languages. The module
 * is pure, so the whole matrix is stated as data: a shadow host, an iframe, an element that cannot be
 * seen, and a page that embeds frames.
 */
import { describe, expect, it } from "vitest";
import { boundsNotes, visibilityIssue } from "../src/features/workbench/element-bounds";
import type { BoundsNote, VisibilityIssue } from "../src/features/workbench/element-bounds";
import { zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

/** Just the three fields the module reads off an element, so a case is one line. */
const facts = (
  overrides: {
    domContext?: "shadow" | "frame";
    rect?: { x: number; y: number; width: number; height: number };
    computed?: Record<string, string>;
  } = {},
) => ({
  domContext: overrides.domContext,
  rect: overrides.rect ?? { x: 0, y: 0, width: 40, height: 18 },
  computed: overrides.computed ?? { display: "block" },
});

describe("visibilityIssue", () => {
  it("says nothing about an element that is there and can be seen", () => {
    expect(visibilityIssue(facts())).toBeNull();
    expect(visibilityIssue(facts({ computed: { display: "flex", opacity: "1" } }))).toBeNull();
  });

  it("names the style that hides the element, in the order that decides it", () => {
    expect(visibilityIssue(facts({ computed: { display: "none" } }))).toBe("display-none");
    expect(visibilityIssue(facts({ computed: { visibility: "hidden" } }))).toBe(
      "visibility-hidden",
    );
    expect(visibilityIssue(facts({ computed: { visibility: "collapse" } }))).toBe(
      "visibility-hidden",
    );
    // `opacity: 0` is the one that can still be *picked* — it takes up space and takes hits — so the
    // panel is the only place the user is told the element is invisible.
    expect(visibilityIssue(facts({ computed: { opacity: "0" } }))).toBe("opacity-zero");
    // A painted element that measures nothing: a fact about the box, not a guess about why.
    expect(visibilityIssue(facts({ rect: { x: 3, y: 4, width: 0, height: 12 } }))).toBe(
      "zero-size",
    );
    expect(visibilityIssue(facts({ rect: { x: 3, y: 4, width: 12, height: 0 } }))).toBe(
      "zero-size",
    );
  });

  it("lets the style win over the box, because it is the more specific answer", () => {
    expect(
      visibilityIssue(
        facts({ computed: { display: "none" }, rect: { x: 0, y: 0, width: 0, height: 0 } }),
      ),
    ).toBe("display-none");
  });
});

describe("boundsNotes", () => {
  const notes = (input: Parameters<typeof boundsNotes>[0]): BoundsNote[] => boundsNotes(input);

  it("has nothing to say about an ordinary element on a page with no frames", () => {
    expect(notes({ target: facts(), picking: true, frameCount: 0 })).toEqual([]);
    // Nobody asked the page yet: an unknown count is not a page with frames.
    expect(notes({ target: facts(), picking: true, frameCount: null })).toEqual([]);
  });

  it("says which structure the picker could not enter", () => {
    expect(
      notes({ target: facts({ domContext: "shadow" }), picking: true, frameCount: 0 }),
    ).toEqual([{ kind: "shadow" }]);
    expect(
      notes({ target: facts({ domContext: "frame" }), picking: false, frameCount: 0 }),
    ).toEqual([{ kind: "frame" }]);
  });

  it("can say both about one element: inside shadow DOM, and not visible", () => {
    expect(
      notes({
        target: facts({ domContext: "shadow", computed: { opacity: "0" } }),
        picking: false,
        frameCount: null,
      }),
    ).toEqual([{ kind: "shadow" }, { kind: "not-visible", reason: "opacity-zero" }]);
  });

  it("mentions the page's frames only while the user is picking", () => {
    expect(notes({ target: null, picking: true, frameCount: 2 })).toEqual([
      { kind: "frames-in-page", count: 2 },
    ]);
    // Not picking: a standing count is noise, and the user is not hunting for anything.
    expect(notes({ target: null, picking: false, frameCount: 2 })).toEqual([]);
  });

  it("keeps the page's frames and the selected frame apart — they are different statements", () => {
    expect(notes({ target: facts({ domContext: "frame" }), picking: true, frameCount: 1 })).toEqual(
      [{ kind: "frame" }, { kind: "frames-in-page", count: 1 }],
    );
  });

  it("says nothing about an element when there is none", () => {
    expect(notes({ target: null, picking: false, frameCount: 0 })).toEqual([]);
  });
});

describe("§9.4's copy", () => {
  const dictionaries = { zh, en };
  const issues: VisibilityIssue[] = [
    "display-none",
    "visibility-hidden",
    "opacity-zero",
    "zero-size",
  ];

  for (const [locale, dict] of Object.entries(dictionaries)) {
    it(`${locale} has a line for every note the panel can raise`, () => {
      const w = dict.workbench;
      expect(Object.keys(w.notVisible).sort()).toEqual([...issues].sort());
      for (const issue of issues) expect(w.notVisible[issue].trim().length).toBeGreaterThan(0);
      expect(w.notVisibleDetail.trim().length).toBeGreaterThan(0);
      expect(w.framesInPage(3)).toContain("3");
      // The host is named in the shadow line: without it the user cannot tell which element they got.
      expect(w.domContext.shadow("my-widget")).toContain("my-widget");
      expect(w.domContext.frame.trim().length).toBeGreaterThan(0);
      expect(w.domContextMessage.shadow.trim().length).toBeGreaterThan(0);
      expect(w.domContextMessage.frame.trim().length).toBeGreaterThan(0);
    });

    it(`${locale} keeps the message lead readable with and without the note`, () => {
      const plain = dict.workbench.elementLead("span.badge", "http://127.0.0.1:5199/");
      expect(plain).toContain("span.badge");
      const noted = dict.workbench.elementLead(
        "my-widget",
        "http://127.0.0.1:5199/",
        dict.workbench.domContextMessage.shadow,
      );
      expect(noted).toContain("my-widget");
      expect(noted).toContain(dict.workbench.domContextMessage.shadow);
    });
  }
});

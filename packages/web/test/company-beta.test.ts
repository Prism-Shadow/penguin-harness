import { en } from "../src/lib/strings-en";
/**
 * Company mode's two beta marks (features/company/beta-badge.tsx).
 *
 * The tag, on 「公司」 in the work-mode switch: it has to be legible, it has to reach a screen
 * reader through the option's name, and it must not move the switch around — which is the whole
 * reason it is positioned out of flow rather than laid out beside the word.
 *
 * The notice, the once-only sentence behind it: the first switch into the mode in a browser
 * raises it, every later one does not, and a storage that is absent or refuses to answer raises
 * nothing rather than raising it forever.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  BETA_NOTICE_KEY,
  BetaBadge,
  markBetaNoticeShown,
  shouldShowBetaNotice,
} from "../src/features/company/beta-badge";
import { Segmented } from "../src/components/ui/segmented";

/** The in-memory stand-in for localStorage (this package's vitest runs in Node, which has none). */
function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string): string | null => map.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      map.set(key, value);
    },
    read: (key: string): string | null => map.get(key) ?? null,
  };
}

/** A browser with site data blocked: every access throws rather than returning null. */
const throwingStorage = {
  getItem(): string | null {
    throw new Error("access denied");
  },
  setItem(): void {
    throw new Error("access denied");
  },
};

describe("shouldShowBetaNotice", () => {
  it("is owed on a browser that has never seen it, and not after it is marked", () => {
    const storage = memoryStorage();
    expect(shouldShowBetaNotice(storage)).toBe(true);
    markBetaNoticeShown(storage);
    expect(storage.read(BETA_NOTICE_KEY)).toBe("1");
    expect(shouldShowBetaNotice(storage)).toBe(false);
  });

  it("stays owed while the flag holds anything but the mark", () => {
    expect(shouldShowBetaNotice(memoryStorage({ [BETA_NOTICE_KEY]: "" }))).toBe(true);
    expect(shouldShowBetaNotice(memoryStorage({ [BETA_NOTICE_KEY]: "true" }))).toBe(true);
    expect(shouldShowBetaNotice(memoryStorage({ [BETA_NOTICE_KEY]: "0" }))).toBe(true);
  });

  it("answers no when storage throws, so the notice cannot repeat on every switch", () => {
    expect(shouldShowBetaNotice(throwingStorage)).toBe(false);
    expect(() => markBetaNoticeShown(throwingStorage)).not.toThrow();
  });

  it("answers no when there is no storage at all (Node, no localStorage)", () => {
    expect(shouldShowBetaNotice()).toBe(false);
    expect(() => markBetaNoticeShown()).not.toThrow();
  });
});

/** The work-mode switch as the sidebar builds it, with and without the tag on 「公司」. */
function workModeSwitch(withBadge: boolean): string {
  return renderToStaticMarkup(
    createElement(Segmented<"dev" | "company">, {
      options: [
        { value: "dev", label: en.company.modeDev },
        {
          value: "company",
          label: en.company.modeCompany,
          ...(withBadge
            ? { badge: { node: createElement(BetaBadge), name: en.company.beta } }
            : {}),
        },
      ],
      value: "dev",
      onChange: () => {},
      cols: 2,
    }),
  );
}

describe("the beta tag on the work-mode switch", () => {
  it("names itself in the option's accessible name, and only that option's", () => {
    const markup = workModeSwitch(true);
    expect(markup).toContain(`aria-label="${en.company.modeCompany} · ${en.company.beta}"`);
    // The other option keeps the label's own text as its name: an aria-label is only spent
    // where there is something the visible text does not already say.
    expect(markup).not.toContain(`aria-label="${en.company.modeDev}"`);
  });

  it("is a superscript, so the option's height and the control's size do not move", () => {
    const markup = workModeSwitch(true);
    expect(markup).toContain("absolute");
    // Out of flow means out of the name too, so the tag's text is hidden rather than announced
    // twice beside the suffix above.
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain(en.company.beta);
    // The tooltip is the one thing the tag still says on its own.
    expect(markup).toContain(`title="${en.company.betaTitle}"`);
  });

  it("costs an option without one nothing", () => {
    const markup = workModeSwitch(false);
    expect(markup).not.toContain("aria-label");
    expect(markup).not.toContain("absolute");
    expect(markup).not.toContain(en.company.beta);
  });
});

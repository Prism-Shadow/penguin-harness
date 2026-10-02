/**
 * The App info dialog's release notes (components/account/release-notes-list.tsx), rendered to
 * static markup.
 *
 * - On open, only the newest note's lines show; the earlier versions wait in the folded panel,
 *   and the fold says how many there are.
 * - Activating the fold asks for it to open, and the open list shows the earlier versions.
 * - A running version older than the newest note (a dev build) is folded with the rest: the
 *   newest is still the one shown, and the current-version mark goes into the fold with its entry.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, isValidElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReleaseNotesList } from "../src/components/account/release-notes-list";
import type { ReleaseNote } from "../src/lib/release-notes";
import { S, setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

const note = (version: string): ReleaseNote => ({
  version,
  date: "2026-09-15",
  zh: [`zh line of ${version}`],
  en: [`en line of ${version}`],
});

/** Out of order on purpose: the list sorts them itself. */
const NOTES = [note("0.2.10"), note("0.2.13"), note("0.2.11")];

type Props = Parameters<typeof ReleaseNotesList>[0];

const props = (over: Partial<Props> = {}): Props => ({
  notes: NOTES,
  currentVersion: "0.2.13",
  locale: "en",
  expanded: false,
  onToggle: () => {},
  panelId: "earlier-versions",
  ...over,
});

/** The markup split at the folded panel: what shows, and what the fold holds (empty when open). */
function render(over: Partial<Props> = {}): { shown: string; folded: string } {
  const html = renderToStaticMarkup(createElement(ReleaseNotesList, props(over)));
  const [shown = "", folded = ""] = html.split(/<ol[^>]*\bhidden=""[^>]*>/);
  return { shown, folded };
}

/** Every element of the tree the component returns, without rendering the components in it. */
function elements(node: ReactNode): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement(node)) return [];
  return [node, ...elements((node.props as { children?: ReactNode }).children)];
}

beforeEach(() => {
  setActiveStrings(en);
});

afterEach(() => {
  setActiveStrings(zh);
});

describe("release notes in the App info dialog", () => {
  it("on open, only the newest note's lines show, and the fold holds the rest", () => {
    const { shown, folded } = render();

    expect(shown).toContain("en line of 0.2.13");
    expect(shown).not.toContain("en line of 0.2.11");
    expect(shown).not.toContain("en line of 0.2.10");
    expect(folded).toContain("en line of 0.2.11");
    expect(folded).toContain("en line of 0.2.10");
    expect(shown).toContain(S.appInfo.earlierVersions(2));
  });

  it("activating the fold opens it, and the open list shows the earlier versions", () => {
    const onToggle = vi.fn();
    const fold = elements(ReleaseNotesList(props({ onToggle }))).find(
      (el) => el.type === "button",
    ) as ReactElement<{ onClick: () => void; "aria-expanded": boolean; "aria-controls": string }>;

    expect(fold.props["aria-expanded"]).toBe(false);
    expect(fold.props["aria-controls"]).toBe("earlier-versions");
    fold.props.onClick();
    expect(onToggle).toHaveBeenCalledTimes(1);

    const { shown, folded } = render({ expanded: true });
    expect(folded).toBe("");
    expect(shown).toContain("en line of 0.2.13");
    expect(shown).toContain("en line of 0.2.11");
    expect(shown).toContain("en line of 0.2.10");
  });

  it("a running version older than the newest note is folded with the rest, its mark with it", () => {
    const { shown, folded } = render({ currentVersion: "0.2.11" });

    expect(shown).toContain("en line of 0.2.13");
    expect(shown).not.toContain(S.appInfo.current);
    expect(folded).toContain("en line of 0.2.11");
    expect(folded).toContain(S.appInfo.current);
  });
});

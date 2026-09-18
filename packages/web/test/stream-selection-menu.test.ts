/**
 * The conversation's selection menu, rendered (react-dom/server static markup, and the rows'
 * own element tree for their click handlers — node env, no DOM): the rows it draws, and what
 * each does with the selection it was opened on. "Add to conversation" stages a chip
 * through the composer's control — the same `addReference` the Files panel stages through —
 * and that chip shows the excerpt rather than a path; Copy writes the selection and confirms
 * with a toast, the menu-row convention.
 *
 * Reading the selection off the page and anchoring the panel are DOM work this environment
 * cannot run; the rules deciding both are pinned in selection-menu.test.ts.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement, isValidElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SelectionMenuRows } from "../src/features/chat/stream-selection-menu";
import type { CapturedSelection } from "../src/features/chat/stream-selection-menu";
import type { ComposerControl } from "../src/features/chat/chat-input";
import { ReferenceChip } from "../src/features/chat/reference-chip";
import { QUOTE_ICON } from "../src/components/ui/icons";
import { excerptLabel } from "../src/lib/selection-menu";
import type { ComposerReference } from "../src/lib/workspace-tree";
import { S, setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

/** Toasts raised during a test (the real store would leave its dismiss timers running). */
const toasts = vi.hoisted(() => [] as string[]);

vi.mock("../src/components/ui/toast", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/components/ui/toast")>();
  return {
    ...actual,
    toastSuccess: (text: string) => {
      toasts.push(text);
    },
  };
});

const EXCERPT = "Run the migration first.\nThen restart the server so it picks up the new schema.";

/** A selection as the stream captures it: the text as selected (a trailing newline included). */
const SELECTION: CapturedSelection = { text: `${EXCERPT}\n`, range: {} as Range };

type Row = ReactElement<{ onClick: () => void; children: ReactNode }>;

/** The rows as the component returns them, to reach their click handlers. */
function rows(props: Parameters<typeof SelectionMenuRows>[0]): Row[] {
  const fragment = SelectionMenuRows(props) as ReactElement<{ children: ReactNode }>;
  return ([] as ReactNode[]).concat(fragment.props.children).filter(isValidElement) as Row[];
}

/** A row's visible label: its text children, without the glyph. */
const label = (row: Row) =>
  ([] as ReactNode[])
    .concat(row.props.children)
    .filter((child): child is string => typeof child === "string")
    .join("");

afterEach(() => {
  setActiveStrings(zh);
  toasts.length = 0;
  vi.unstubAllGlobals();
});

describe("SelectionMenuRows", () => {
  it("draws Copy, then Add to conversation", () => {
    const html = renderToStaticMarkup(
      createElement(SelectionMenuRows, {
        selection: SELECTION,
        onAddExcerpt: () => {},
        onDone: () => {},
      }),
    );
    const copy = html.indexOf(`${S.common.copy}</button>`);
    const add = html.indexOf(`${S.files.addToChat}</button>`);
    expect(copy).toBeGreaterThan(-1);
    expect(add).toBeGreaterThan(copy);
  });

  it("follows the UI language", () => {
    setActiveStrings(en);
    const html = renderToStaticMarkup(
      createElement(SelectionMenuRows, {
        selection: SELECTION,
        onAddExcerpt: () => {},
        onDone: () => {},
      }),
    );
    expect(html).toContain("Copy</button>");
    expect(html).toContain("Add to conversation</button>");
  });
});

describe("Add to conversation", () => {
  it("stages the excerpt as a chip through the composer's control, and nothing else", () => {
    const staged: ComposerReference[] = [];
    const fillPrompt = vi.fn();
    const control: ComposerControl = {
      fillPrompt,
      addReference: (reference) => {
        staged.push(reference);
      },
    };
    const onDone = vi.fn();
    const add = rows({ selection: SELECTION, onAddExcerpt: control.addReference, onDone }).find(
      (row) => label(row) === S.files.addToChat,
    );
    add!.props.onClick();

    // One reference, carried into the message as a blockquote; the draft itself is never filled.
    expect(staged).toEqual([
      {
        kind: "excerpt",
        excerpt: EXCERPT,
        text: "> Run the migration first.\n> Then restart the server so it picks up the new schema.",
      },
    ]);
    expect(fillPrompt).not.toHaveBeenCalled();
    // Then the panel closes and the highlight is put back, with the same selection.
    expect(onDone).toHaveBeenCalledExactlyOnceWith(SELECTION);

    // The chip the composer draws for it: the excerpt's start as its label, the whole excerpt
    // as its tooltip, the quotation glyph — and no path, because an excerpt has none.
    const chip = renderToStaticMarkup(
      createElement(ReferenceChip, { reference: staged[0]!, onRemove: () => {} }),
    );
    const name = excerptLabel(EXCERPT);
    expect(name.endsWith("…")).toBe(true);
    expect(chip).toContain(`title="${EXCERPT}"`);
    expect(chip).toContain(`>${name}</span>`);
    expect(chip).toContain(`d="${QUOTE_ICON}"`);
    expect(chip).toContain(`aria-label="${S.files.removeReference} ${name}"`);
  });
});

describe("Copy", () => {
  it("writes the selection as it was selected, and confirms with a toast", () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const onDone = vi.fn();
    const copy = rows({ selection: SELECTION, onAddExcerpt: () => {}, onDone }).find(
      (row) => label(row) === S.common.copy,
    );
    copy!.props.onClick();

    expect(writeText).toHaveBeenCalledExactlyOnceWith(SELECTION.text);
    expect(toasts).toEqual([S.common.copied]);
    expect(onDone).toHaveBeenCalledExactlyOnceWith(SELECTION);
  });
});

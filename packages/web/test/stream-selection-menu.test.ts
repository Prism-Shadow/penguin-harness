/**
 * The conversation's own menu, rendered (react-dom/server static markup, and the rows' own
 * element tree for their click handlers — node env, no DOM): the rows it draws, and what each
 * does with the selection or the link it was opened on. "Add to conversation" stages a chip
 * through the composer's control — the same `addReference` the Files panel stages through —
 * and that chip shows the excerpt rather than a path; Copy writes the selection through the
 * clipboard entry and confirms with a toast, the menu-row convention — once the write landed.
 * A link's rows open it in the built-in browser or outside the app, or copy its address.
 *
 * Reading the selection and the link off the page and anchoring the panel are DOM work this
 * environment cannot run; the rules deciding them are pinned in selection-menu.test.ts.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement, isValidElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LinkMenuRows, SelectionMenuRows } from "../src/features/chat/stream-selection-menu";
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

/** Links handed to the built-in browser (its real call talks to the server and the dock). */
const openedInBrowser = vi.hoisted(() => [] as string[]);

vi.mock("../src/features/builtin-browser/browser-actions", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/features/builtin-browser/browser-actions")>();
  return {
    ...actual,
    openLinkInBrowser: (url: string) => {
      openedInBrowser.push(url);
    },
  };
});

/** The clipboard entry's answer for the next write (its own behaviour is clipboard.test.ts's). */
const writeClipboard = vi.hoisted(() => vi.fn<(text: string) => Promise<boolean>>());

vi.mock("../src/lib/clipboard", () => ({ writeClipboard }));

const EXCERPT = "Run the migration first.\nThen restart the server so it picks up the new schema.";

/** A selection as the stream captures it: the text as selected (a trailing newline included). */
const SELECTION: CapturedSelection = { text: `${EXCERPT}\n`, range: {} as Range };

type Row = ReactElement<{ onClick: () => void; children: ReactNode }>;

/** The rows as the component returns them, to reach their click handlers. */
function rows(props: Parameters<typeof SelectionMenuRows>[0]): Row[] {
  const fragment = SelectionMenuRows(props) as ReactElement<{ children: ReactNode }>;
  return ([] as ReactNode[]).concat(fragment.props.children).filter(isValidElement) as Row[];
}

/** The same for a link's rows. */
function linkRows(props: Parameters<typeof LinkMenuRows>[0]): Row[] {
  const fragment = LinkMenuRows(props) as ReactElement<{ children: ReactNode }>;
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
  openedInBrowser.length = 0;
  writeClipboard.mockReset();
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
  it("writes the selection as it was selected, and confirms with a toast", async () => {
    writeClipboard.mockResolvedValue(true);
    const onDone = vi.fn();
    const copy = rows({ selection: SELECTION, onAddExcerpt: () => {}, onDone }).find(
      (row) => label(row) === S.common.copy,
    );
    copy!.props.onClick();

    expect(writeClipboard).toHaveBeenCalledExactlyOnceWith(SELECTION.text);
    expect(onDone).toHaveBeenCalledExactlyOnceWith(SELECTION);
    await vi.waitFor(() => expect(toasts).toEqual([S.common.copied]));
  });

  it("raises no toast when the write was refused", async () => {
    writeClipboard.mockResolvedValue(false);
    const onDone = vi.fn();
    const copy = rows({ selection: SELECTION, onAddExcerpt: () => {}, onDone }).find(
      (row) => label(row) === S.common.copy,
    );
    copy!.props.onClick();
    await writeClipboard.mock.results[0]?.value;
    await Promise.resolve();

    expect(toasts).toEqual([]);
    expect(onDone).toHaveBeenCalledExactlyOnceWith(SELECTION);
  });
});

const HREF = "https://example.com/your-orders";

describe("LinkMenuRows", () => {
  it("draws Open in built-in browser, Open in system browser, then Copy link address", () => {
    const html = renderToStaticMarkup(
      createElement(LinkMenuRows, {
        href: HREF,
        builtinBrowser: true,
        desktopShell: true,
        onDone: () => {},
      }),
    );
    const at = [
      S.chat.linkMenu.openInBuiltinBrowser,
      S.chat.linkMenu.openExternal,
      S.chat.linkMenu.copyLink,
    ].map((name) => html.indexOf(`${name}</button>`));
    expect(at.every((i) => i > -1)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("leaves the built-in browser out where it cannot run, and names a new tab in a browser", () => {
    const html = renderToStaticMarkup(
      createElement(LinkMenuRows, {
        href: HREF,
        builtinBrowser: false,
        desktopShell: false,
        onDone: () => {},
      }),
    );
    expect(html).not.toContain(S.chat.linkMenu.openInBuiltinBrowser);
    expect(html).not.toContain(S.chat.linkMenu.openExternal);
    expect(html).toContain(`${S.chat.linkMenu.openInNewTab}</button>`);
    expect(html).toContain(`${S.chat.linkMenu.copyLink}</button>`);
  });

  it("follows the UI language", () => {
    setActiveStrings(en);
    const html = renderToStaticMarkup(
      createElement(LinkMenuRows, {
        href: HREF,
        builtinBrowser: true,
        desktopShell: true,
        onDone: () => {},
      }),
    );
    expect(html).toContain("Open in built-in browser</button>");
    expect(html).toContain("Open in system browser</button>");
    expect(html).toContain("Copy link address</button>");
  });

  it("opens the link in the built-in browser through the browser's own new tab", () => {
    const onDone = vi.fn();
    const row = linkRows({ href: HREF, builtinBrowser: true, desktopShell: true, onDone }).find(
      (r) => label(r) === S.chat.linkMenu.openInBuiltinBrowser,
    );
    row!.props.onClick();
    expect(openedInBrowser).toEqual([HREF]);
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("opens the link outside the app as a new window with no handle back", () => {
    const open = vi.fn();
    vi.stubGlobal("window", { open });
    const onDone = vi.fn();
    const row = linkRows({ href: HREF, builtinBrowser: false, desktopShell: true, onDone }).find(
      (r) => label(r) === S.chat.linkMenu.openExternal,
    );
    row!.props.onClick();
    expect(open).toHaveBeenCalledExactlyOnceWith(HREF, "_blank", "noopener,noreferrer");
    expect(openedInBrowser).toEqual([]);
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("copies the address and confirms with a toast, as Copy does", async () => {
    writeClipboard.mockResolvedValue(true);
    const onDone = vi.fn();
    const row = linkRows({ href: HREF, builtinBrowser: true, desktopShell: true, onDone }).find(
      (r) => label(r) === S.chat.linkMenu.copyLink,
    );
    row!.props.onClick();
    expect(writeClipboard).toHaveBeenCalledExactlyOnceWith(HREF);
    expect(onDone).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(toasts).toEqual([S.common.copied]));
  });
});

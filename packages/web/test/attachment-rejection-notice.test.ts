/**
 * The composer's oversize-rejection notice (features/chat/attachment-rejection-notice): a pick
 * the upload limits refuse must stay where the user picked it, naming the file and the ceiling
 * that refused it, in both interface languages — a toast that leaves on its own was the silence
 * this notice replaces, so what is pinned here is what makes the refusal observable: the
 * `role="alert"` (the page's own announcement channel, what a reader — or a probe — asks for),
 * the production copy built from `S.chat.attachmentTooLarge`, and the clearing cross. Static
 * markup, node env, the way stream-selection-menu.test.ts renders its rows; the pick, drop and
 * clear wiring lives in the composer (chat-input) and is not re-pinned here.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AttachmentRejectionNotice } from "../src/features/chat/attachment-rejection-notice";
import { S, setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

/** The lines the composer's intakes build: one sentence per refused file, from the real copy. */
const refused = (names: readonly string[], limitMb: number): string[] =>
  names.map((name) => S.chat.attachmentTooLarge(name, limitMb));

const markup = (lines: string[]): string =>
  renderToStaticMarkup(createElement(AttachmentRejectionNotice, { lines, onClear: () => {} }));

afterEach(() => {
  setActiveStrings(zh);
});

describe("AttachmentRejectionNotice", () => {
  it("announces the refusal through role=alert, naming the file and the ceiling (zh)", () => {
    const html = markup(refused(["huge-file.bin"], 100));
    expect(html).toContain('role="alert"');
    expect(html).toContain("huge-file.bin");
    expect(html).toContain("超过 100MB 上限，未添加。");
    // A refusal is news the moment it happens, not advice that can wait: it reads as danger,
    // and it rides the same notice hook (`ui-notice`) every other notice in the app does.
    expect(html).toContain('data-tone="danger"');
    expect(html).toContain("ui-notice");
    // The cross: the reader can put the notice down once it has been read.
    expect(html).toContain('data-slot="actions"');
  });

  it("carries the same refusal in the English interface", () => {
    setActiveStrings(en);
    const html = markup(refused(["huge-image.png"], 20));
    expect(html).toContain('role="alert"');
    expect(html).toContain("huge-image.png");
    expect(html).toContain("exceeds the 20MB limit and was not attached.");
  });

  it("shows every refused file of a batch, in pick order, each with its own ceiling", () => {
    // A drop can refuse an image and a file in one event; the composer hands both sentences
    // to one notice, so each refusal keeps its own name and its own limit.
    const html = markup([...refused(["huge-image.png"], 20), ...refused(["huge-file.bin"], 100)]);
    expect(html.indexOf("huge-image.png")).toBeLessThan(html.indexOf("huge-file.bin"));
    expect(html).toContain("超过 20MB 上限，未添加。");
    expect(html).toContain("超过 100MB 上限，未添加。");
  });
});

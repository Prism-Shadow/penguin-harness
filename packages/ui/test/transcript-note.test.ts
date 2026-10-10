/**
 * TranscriptNote (src/components/chat/transcript-note/transcript-note.tsx): a frame whose only
 * child is a settled activity head of the event kind, so the themes draw it as they draw a work
 * group's header; its label is the fixed phrase and the names sit outside it, in a detail no
 * theme recases; a note that leads somewhere is one button named by the note as one sentence.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { TranscriptNote } from "../src/components/chat/transcript-note/transcript-note";
import type { TranscriptNoteProps } from "../src/components/chat/transcript-note/transcript-note";
import { renderStatic } from "../src/testing";

const note = (props: Partial<TranscriptNoteProps>) =>
  renderStatic(
    createElement(TranscriptNote, { label: "Using skills", subject: "pdf, docx", ...props }),
  );

describe("TranscriptNote", () => {
  it("is a frame holding one settled event head, the names outside the label", () => {
    const html = note({ meta: ["09:00", null] });
    expect(html).toMatch(
      /<div class="ui-frame [^"]*"><p class="ui-activity [^"]*" data-slot="head" data-kind="event" data-state="done">/,
    );
    expect(html).toMatch(/<span data-slot="label"[^>]*>Using skills<\/span>/);
    expect(html).toMatch(/<span data-slot="detail"[^>]*>pdf, docx<\/span>/);
    expect(html.match(/data-slot="detail"/g)).toHaveLength(2);
    expect(html).not.toContain("<button");
  });

  it("leads somewhere as one button named by the sentence, the arrow hidden", () => {
    const html = note({
      action: { onClick: () => {}, hint: "Back", name: "Using the pdf and docx skills" },
    });
    expect(html).toMatch(
      /<button type="button" aria-label="Using the pdf and docx skills" data-tooltip="Back" class="ui-activity /,
    );
    expect(html).toContain('<span aria-hidden="true" class="shrink-0 text-fg-subtle">→</span>');
  });

  it("cuts a long subject to the line with its whole text as the tooltip, and never wraps then", () => {
    const html = note({ truncate: true });
    expect(html).toContain('data-tooltip="pdf, docx" data-tooltip-content="text"');
    expect(html).not.toContain("flex-wrap");
  });
});

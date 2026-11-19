// @vitest-environment jsdom
/**
 * The composer notice's body after a refusal hand-off (features/chat/refused-handoff-notice.tsx):
 * why first, then the advice.
 *
 * - Given the provider's words, the first line holds them, the advice comes on the line after and
 *   does not repeat them, and pressing Details opens the failure's details once.
 * - Given words that are a JSON body, the first line holds only the sentence it carries for a
 *   person, none of the raw body (which stays behind Details).
 * - Given no words (none sent, or blank ones), the lead stands alone as a sentence of its own,
 *   with nothing but Details after it, and the advice follows.
 * - Given no details handler (a host without the failure dialog), there is no Details press: the
 *   words show and nothing on the notice can be pressed.
 * In both languages.
 */
import { createElement as h } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RefusedHandoffNotice } from "../src/features/chat/refused-handoff-notice";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { click, mount, unmountAll } from "./helpers/dom";

const WORDS =
  "400 This model's maximum context length is 131072 tokens. However, you requested 140211 tokens.";

/** The notice's two lines as the reader sees them, and its Details press. */
async function noticeOf(message: string | undefined, onDetails?: () => void) {
  const { container } = await mount(h(RefusedHandoffNotice, { message, onDetails }));
  const [first, second] = [...container.querySelectorAll("p")];
  const details = container.querySelector<HTMLButtonElement>("[data-failure-details]");
  /** The first line without its presses: what it says. */
  const said = [...first!.childNodes]
    .filter((node) => !(node instanceof HTMLButtonElement))
    .map((node) => node.textContent ?? "")
    .join("");
  return { container, first: first!, second: second!, said, details };
}

describe.each([
  ["zh", zh],
  ["en", en],
] as const)("the refusal hand-off notice (%s)", (_locale, dict) => {
  afterEach(async () => {
    await unmountAll();
    setActiveStrings(zh);
  });

  it("shows the provider's words before the advice, and Details opens the failure's details", async () => {
    setActiveStrings(dict);
    const onDetails = vi.fn();
    const notice = await noticeOf(WORDS, onDetails);
    expect(notice.first.textContent).toContain(WORDS);
    expect(notice.second.textContent).not.toContain(WORDS);
    expect(notice.second.textContent?.trim()).not.toBe("");
    expect(notice.details).not.toBeNull();
    await click(notice.details!);
    expect(onDetails).toHaveBeenCalledTimes(1);
  });

  it("shows only the sentence a JSON body holds for a person, none of the raw body", async () => {
    setActiveStrings(dict);
    const sentence = "prompt is too long: 140211 tokens > 131072 maximum";
    const body = `400 {"type":"error","error":{"type":"invalid_request_error","message":"${sentence}"},"request_id":"req_011CUz3tF8eJ2dQx6Q9pY7Ln"}`;
    const notice = await noticeOf(body, () => {});
    expect(notice.first.textContent).toContain(sentence);
    for (const raw of ["{", "invalid_request_error", "req_011CUz3tF8eJ2dQx6Q9pY7Ln"]) {
      expect(notice.first.textContent).not.toContain(raw);
    }
    expect(notice.details).not.toBeNull();
  });

  it("with no words, says the refusal alone", async () => {
    setActiveStrings(dict);
    const none = await noticeOf(undefined, () => {});
    const blank = await noticeOf("   ", () => {});
    const worded = await noticeOf(WORDS, () => {});
    for (const notice of [none, blank]) {
      // A sentence of its own, not a lead left hanging before nothing.
      expect(notice.said.trim()).toMatch(/[.。]$/);
      expect(notice.said).not.toBe(worded.said);
      expect(notice.first.querySelectorAll("button")).toHaveLength(1);
      expect(notice.details).not.toBeNull();
      expect(notice.second.textContent).toBe(worded.second.textContent);
    }
    expect(blank.said).toBe(none.said);
  });

  it("without a details handler there is no Details press", async () => {
    setActiveStrings(dict);
    const notice = await noticeOf(WORDS);
    expect(notice.first.textContent).toContain(WORDS);
    expect(notice.details).toBeNull();
    expect(notice.container.querySelectorAll("button")).toHaveLength(0);
  });
});

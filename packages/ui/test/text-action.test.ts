/**
 * The press that reads as text (src/components/actions/text-action/), as it first renders.
 *
 * - It is a real button the keyboard reaches, showing its word in brackets ("[Retry]") and named
 *   by its word alone: the brackets are drawn but hidden from that name.
 * - Given a press in flight, it says it is busy and takes no press; given a disabled one, it
 *   takes none either.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { TextAction } from "../src/components/actions/text-action/text-action";
import { renderStatic } from "../src/testing";

const press = (props: Parameters<typeof TextAction>[0]) =>
  renderStatic(createElement(TextAction, props));
/** The words the button shows, and the ones a screen reader hears (aria-hidden parts dropped). */
const words = (html: string) => html.replace(/<[^>]*>/g, "");
const heard = (html: string) => words(html.replace(/<span aria-hidden="true">[^<]*<\/span>/g, ""));

describe("a text action", () => {
  it("is a button showing its word in brackets, named by its word alone", () => {
    const html = press({ children: "Retry" });
    expect(html.startsWith('<button type="button"')).toBe(true);
    expect(words(html)).toBe("[Retry]");
    expect(heard(html)).toBe("Retry");
    expect(html).not.toMatch(/\sdisabled=""/);
  });

  it("in flight says it is busy and takes no press; disabled, takes none either", () => {
    const busy = /<button[^>]*>/.exec(press({ busy: true, children: "Retry" }))![0];
    expect(busy).toContain('aria-busy="true"');
    expect(busy).toMatch(/\sdisabled=""/);
    const off = /<button[^>]*>/.exec(press({ disabled: true, children: "Retry" }))![0];
    expect(off).toMatch(/\sdisabled=""/);
    expect(off).not.toContain("aria-busy");
  });
});

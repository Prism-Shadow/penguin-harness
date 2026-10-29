/**
 * The "could not load" notice a pane shows in place of its content
 * (src/components/feedback/load-failed/), as it first renders.
 *
 * - Given a failed load, it says what could not be loaded and, on a line of its own, why — never
 *   one "failed: <error>" string — and offers its one press under the caller's words.
 * - Given only a title, nothing else is drawn: no reason line, no press, no fold.
 * - Given no glyph of the caller's, the mark is the failure's cross; given the glyph of the thing
 *   whose state this is (a machine), that glyph instead.
 * - Given technical detail, it is folded under its own title, out of sight until opened; what the
 *   caller adds (a live status row) sits between the words and the press.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { ICONS } from "../src/components/icons/icons";
import { LoadFailed } from "../src/components/feedback/load-failed/load-failed";
import type { LoadFailedProps } from "../src/components/feedback/load-failed/load-failed";
import { renderStatic } from "../src/testing";

const render = (props: LoadFailedProps) => renderStatic(createElement(LoadFailed, props));
/** The text inside the first element of a tag, tags dropped. */
const textIn = (html: string, tag: string) =>
  new RegExp(`<${tag}\\b[^>]*>(.*?)</${tag}>`).exec(html)?.[1]?.replace(/<[^>]*>/g, "") ?? null;
const noop = () => {};

describe("the could-not-load notice", () => {
  it("says what could not be loaded and, on its own line, why, with its one press", () => {
    const html = render({
      title: "Could not load the message history",
      description: "Network error, please check your connection",
      action: { label: "Retry", onClick: noop },
    });
    expect(textIn(html, "h2")).toBe("Could not load the message history");
    expect(textIn(html, "p")).toBe("Network error, please check your connection");
    expect(textIn(html, "button")).toBe("Retry");
  });

  it("draws nothing but the title when that is all it is given", () => {
    const html = render({ title: "Could not load the message history" });
    expect(html).not.toMatch(/<p[\s>]/);
    expect(html).not.toContain("<button");
  });

  it("marks the failure with the cross, or with the caller's glyph for the thing whose state it is", () => {
    const failed = render({ title: "Couldn't load" });
    expect(failed).toContain(`d="${ICONS.xCircle}"`);
    const away = render({ title: "gpu-box is reconnecting", glyph: ICONS.server });
    expect(away).toContain(`d="${ICONS.server}"`);
    expect(away).not.toContain(`d="${ICONS.xCircle}"`);
  });

  it("keeps the technical detail folded, and puts the caller's status between the words and the press", () => {
    const html = render({
      title: "gpu-box is reconnecting",
      description: "The conversation loads once the connection is back.",
      action: { label: "Go to Machines", onClick: noop },
      details: { title: "Technical details", text: "connect ECONNREFUSED 127.0.0.1:37747" },
      children: createElement("div", { role: "status" }, "Reconnecting in 23 s"),
    });
    // The fold's body is in the page but hidden, so the error shows only on request.
    expect(html).toMatch(/<div id="[^"]+" hidden[^>]*><p[^>]*>connect ECONNREFUSED/);
    expect(html).toContain(">Technical details</button>");
    const at = (text: string) => html.indexOf(text);
    expect(at("loads once the connection")).toBeLessThan(at("Reconnecting in 23 s"));
    expect(at("Reconnecting in 23 s")).toBeLessThan(at(">Go to Machines</button>"));
  });
});

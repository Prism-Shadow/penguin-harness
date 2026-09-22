/**
 * features/proposals/proposal-links.tsx, via react-dom/server static markup (node env, no
 * DOM): the remark pass turns a bare `proposal:<n>` and a `[label](proposal:<n>)` link into the
 * shared `<data>` element with the reference as its value, keeps a reference inside inline
 * code or a fence literal, gives a sentence its closing mark back, and — with no company
 * context to name the proposal by — the capsule falls back to the reference's text, both on a
 * plain Markdown surface and inside a channel message body beside a mention.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Components } from "react-markdown";
import { Md } from "../src/features/chat/md";
import {
  PROPOSAL_COMPONENTS,
  PROPOSAL_REMARK_PLUGINS,
} from "../src/features/proposals/proposal-links";
import {
  ChannelMessageBody,
  ChannelReaderProvider,
} from "../src/features/company/channel-markdown";

/** The `<data>` element as a marker, so the test reads what the pass produced rather than what the capsule drew. */
const MARKER_COMPONENTS: Components = {
  data: (props: { value?: string | number | readonly string[] }) =>
    createElement("mark", { "data-ref": String(props.value ?? "") }),
};

const passOnly = (text: string) =>
  renderToStaticMarkup(
    createElement(Md, {
      text,
      extraPlugins: PROPOSAL_REMARK_PLUGINS,
      components: MARKER_COMPONENTS,
    }),
  );

const withCapsule = (text: string) =>
  renderToStaticMarkup(
    createElement(Md, {
      text,
      extraPlugins: PROPOSAL_REMARK_PLUGINS,
      components: PROPOSAL_COMPONENTS,
    }),
  );

describe("the proposal reference pass", () => {
  it("splits a bare reference out of prose, pattern included, and gives the sentence its full stop back", () => {
    const html = passOnly("see proposal:12#Rename. then proposal:3");
    expect(html).toContain('<mark data-ref="proposal:12#Rename"></mark>. then ');
    expect(html).toContain('<mark data-ref="proposal:3"></mark>');
  });

  it("replaces a link whose target is a reference, whole", () => {
    const html = passOnly("read [the batching change](proposal:12) first");
    expect(html).toContain('<mark data-ref="proposal:12"></mark> first');
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("batching change");
  });

  it("covers a list item and a table cell, and leaves code alone", () => {
    const html = passOnly(
      "- proposal:1\n\n| a |\n| - |\n| proposal:2 |\n\n`proposal:3`\n\n```\nproposal:4\n```",
    );
    expect(html).toContain('<li><mark data-ref="proposal:1"></mark></li>');
    expect(html).toContain('<td><mark data-ref="proposal:2"></mark></td>');
    expect(html).toContain("<code>proposal:3</code>");
    expect(html).toContain("proposal:4\n");
    expect(html).not.toContain('data-ref="proposal:3"');
    expect(html).not.toContain('data-ref="proposal:4"');
  });

  it("leaves a reference to nothing — number zero, no number — as text", () => {
    const html = passOnly("proposal:0 and proposal:x");
    expect(html).not.toContain("<mark");
    expect(html).toContain("proposal:0 and proposal:x");
  });
});

describe("the capsule without a company context", () => {
  it("renders the reference's text on a plain Markdown surface", () => {
    const html = withCapsule("see proposal:12#Rename");
    expect(html).toContain("proposal:12#Rename");
    expect(html).not.toContain("<button");
  });

  it("stands beside a mention chip in a channel body, each element told by its value", () => {
    const html = renderToStaticMarkup(
      createElement(ChannelReaderProvider, {
        reader: {
          names: new Map([["ceo", "Ada CEO"]]),
          titles: new Map(),
          me: "alice",
          employeeIds: new Set(["ceo"]),
        },
        children: createElement(ChannelMessageBody, { text: "@ceo proposal:12 is ready" }),
      }),
    );
    expect(html).toContain("@Ada CEO");
    expect(html).toContain("proposal:12");
    expect(html).not.toContain('value="proposal:12"');
  });
});

/**
 * The two Markdown extensions the content may use, tested on mdast directly: both
 * transforms are pure tree rewrites, so nothing here needs a renderer.
 */
import { describe, expect, it } from "vitest";
import { remarkCallout } from "../src/lib/remark-callout";
import type { CalloutNode } from "../src/lib/remark-callout";
import { remarkTabs, tabLabelOf } from "../src/lib/remark-tabs";
import type { TabNode } from "../src/lib/remark-tabs";

function quote(firstLine: string, ...rest: CalloutNode[]): CalloutNode {
  return {
    type: "blockquote",
    children: [{ type: "paragraph", children: [{ type: "text", value: firstLine }] }, ...rest],
  };
}

function runCallout(node: CalloutNode): CalloutNode {
  const tree: CalloutNode = { type: "root", children: [node] };
  remarkCallout()(tree);
  return tree.children![0]!;
}

describe("remarkCallout", () => {
  it("turns a marked blockquote into a collapsed details with a title", () => {
    const out = runCallout(quote("[!INFO]- First launch blocked"));
    expect(out.data?.hName).toBe("details");
    expect(out.data?.hProperties?.className).toBe("callout callout-info");
    expect(out.data?.hProperties?.open).toBeUndefined();

    const title = out.children![0]!;
    expect(title.data?.hName).toBe("summary");
    expect(title.children![0]!.value).toBe("First launch blocked");
  });

  it("renders '+' open and no flag as a plain, non-collapsible box", () => {
    expect(runCallout(quote("[!INFO]+ T")).data?.hProperties?.open).toBe(true);

    const plain = runCallout(quote("[!NOTE] T"));
    expect(plain.data?.hName).toBe("aside");
    expect(plain.children![0]!.data?.hName).toBe("p");
  });

  it("keeps the body, and drops the paragraph the marker occupied alone", () => {
    const out = runCallout(
      quote("[!INFO]- T", { type: "code", children: [{ type: "text", value: "x" }] }),
    );
    // summary + the code block: the marker's own paragraph is gone.
    expect(out.children!.map((child) => child.type)).toEqual(["calloutTitle", "code"]);
  });

  it("keeps text that followed the marker on later lines of the same paragraph", () => {
    const out = runCallout(quote("[!INFO]- T\nsecond line"));
    expect(out.children![1]!.children![0]!.value).toBe("second line");
  });

  it("falls back to the type when no title is given", () => {
    expect(runCallout(quote("[!INFO]-")).children![0]!.children![0]!.value).toBe("INFO");
  });

  it("leaves an ordinary blockquote alone", () => {
    const out = runCallout(quote("just a quote"));
    expect(out.data).toBeUndefined();
    expect(out.children![0]!.type).toBe("paragraph");
  });

  it("transforms callouts nested inside other containers", () => {
    const tree: CalloutNode = {
      type: "root",
      children: [{ type: "listItem", children: [quote("[!INFO] T")] }],
    };
    remarkCallout()(tree);
    expect(tree.children![0]!.children![0]!.data?.hName).toBe("aside");
  });
});

function code(lang: string, meta: string | null): TabNode {
  return { type: "code", meta, ...{ lang } } as TabNode;
}

function runTabs(children: TabNode[]): TabNode {
  const tree: TabNode = { type: "root", children };
  remarkTabs()(tree);
  return tree;
}

describe("remarkTabs", () => {
  it("reads the label out of the info string", () => {
    expect(tabLabelOf(code("bash", 'tab="Linux / macOS"'))).toBe("Linux / macOS");
    expect(tabLabelOf(code("bash", null))).toBeUndefined();
    expect(tabLabelOf({ type: "paragraph" })).toBeUndefined();
  });

  it("groups adjacent tab blocks, carrying the labels in child order", () => {
    const tree = runTabs([code("bash", 'tab="A"'), code("powershell", 'tab="B"')]);
    expect(tree.children!.length).toBe(1);

    const group = tree.children![0]!;
    expect(group.type).toBe("tabGroup");
    expect(group.data?.hProperties?.className).toBe("md-tabs");
    expect(group.data?.hProperties?.["data-tab-labels"]).toBe('["A","B"]');
    expect(group.children!.length).toBe(2);
  });

  it("starts a fresh label list per group", () => {
    const tree = runTabs([code("bash", 'tab="A"'), { type: "paragraph" }, code("bash", 'tab="B"')]);
    expect(tree.children!.map((child) => child.data?.hProperties?.["data-tab-labels"])).toEqual([
      '["A"]',
      undefined,
      '["B"]',
    ]);
  });

  it("does not join tab blocks separated by other content", () => {
    const tree = runTabs([code("bash", 'tab="A"'), { type: "paragraph" }, code("bash", 'tab="B"')]);
    expect(tree.children!.map((child) => child.type)).toEqual([
      "tabGroup",
      "paragraph",
      "tabGroup",
    ]);
  });

  it("leaves an ordinary fenced block untouched", () => {
    const tree = runTabs([code("bash", null)]);
    expect(tree.children![0]!.type).toBe("code");
    expect(tree.children![0]!.data).toBeUndefined();
  });
});

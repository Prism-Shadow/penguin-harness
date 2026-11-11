/**
 * The chat Markdown dialect (src/index.ts): what a reply's bare URLs and emphasis parse to, read
 * the way both hosts read it — remark-parse with `remarkChatMarkdown` — and shown as the inline
 * markup the tree stands for.
 *
 * - Given the report that started this — `**http://localhost:7367/**，要看的博文：http://…` — the
 *   first URL is a bold link ending at its `/`, the Chinese between stays text, and the second
 *   URL is a link of its own.
 * - Given a bare URL followed, with no space, by anything that is not an ASCII URL character
 *   (CJK text or punctuation, a full-width bracket, an emoji, a quote, a backtick, `<`, `{`), the
 *   URL ends before it and the rest stays text.
 * - Given a URL with unencoded CJK in its path, it ends before the CJK; percent-encoded, it is
 *   kept whole.
 * - Given a bold span closing right after a URL and before CJK, or after full-width punctuation
 *   and before CJK, the span is bold.
 * - Given English, the links GFM made are unchanged: trailing sentence punctuation, `**` and a
 *   trailing `&name;` are left out, `_`, `*`, `&` and balanced parentheses or brackets inside the
 *   URL stay in, a `]` the URL did not open ends it, `www.` links over `http://`, an email links
 *   over `mailto:`.
 * - Given a word that merely contains `http://`, a host GFM refuses, `www.` with no host after it,
 *   or an address that does not end in a letter, nothing links.
 * - Given a URL in inline code or a fenced block, it stays code; given `[t](url)` or a URL as a
 *   link's text, there is one link only; given a URL in brackets with no destination, it links.
 * - Given GFM's other constructs (a table, a task list, a footnote), they still parse.
 */
import { describe, expect, it } from "vitest";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { remarkChatMarkdown } from "../src/index.js";

interface Node {
  type: string;
  value?: string;
  url?: string;
  children?: Node[];
}

const processor = unified().use(remarkParse).use(remarkChatMarkdown);

/** A node's inline content as the markup it stands for: links, emphasis and code spelled out. */
function inline(node: Node): string {
  const inner = (node.children ?? []).map(inline).join("");
  switch (node.type) {
    case "text":
      return node.value ?? "";
    case "inlineCode":
      return `<code>${node.value}</code>`;
    case "link":
      return `<a href="${node.url}">${inner}</a>`;
    case "strong":
      return `<strong>${inner}</strong>`;
    case "emphasis":
      return `<em>${inner}</em>`;
    case "delete":
      return `<del>${inner}</del>`;
    default:
      return inner;
  }
}

/** The first block of `markdown`, as inline markup. */
function render(markdown: string): string {
  const root = processor.parse(markdown) as Node;
  return inline(root.children![0]!);
}

/** The `[href, text]` of every link in `markdown`, in order. */
function links(markdown: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const walk = (node: Node): void => {
    if (node.type === "link")
      out.push([node.url!, inline({ type: "root", children: node.children })]);
    for (const child of node.children ?? []) walk(child);
  };
  walk(processor.parse(markdown) as Node);
  return out;
}

const link = (url: string, text = url) => `<a href="${url}">${text}</a>`;

describe("the report", () => {
  it("links each URL on its own, the first in bold, the Chinese between as text", () => {
    expect(
      render(
        "**http://localhost:7367/**，要看的博文：http://localhost:7367/blog/keeping-the-prompt-cache-hot",
      ),
    ).toBe(
      `<strong>${link("http://localhost:7367/")}</strong>，要看的博文：` +
        link("http://localhost:7367/blog/keeping-the-prompt-cache-hot"),
    );
  });
});

describe("a bare URL ends at the first character a URL cannot hold", () => {
  it.each([
    [
      "CJK punctuation",
      "见 https://penguin.ooo，然后继续",
      "见 " + link("https://penguin.ooo") + "，然后继续",
    ],
    [
      "CJK text on both sides",
      "中文https://penguin.ooo英文",
      "中文" + link("https://penguin.ooo") + "英文",
    ],
    [
      "a full-width bracket after a query",
      "参考 https://penguin.ooo/a/b?c=1（备注）",
      "参考 " + link("https://penguin.ooo/a/b?c=1") + "（备注）",
    ],
    ["a full stop", "见 https://penguin.ooo。", "见 " + link("https://penguin.ooo") + "。"],
    ["an emoji", "看 https://penguin.ooo/docs👍", "看 " + link("https://penguin.ooo/docs") + "👍"],
    ["a double quote", 'see "https://a.com/x"', 'see "' + link("https://a.com/x") + '"'],
    ["a backtick", "见 http://x.test/`用法", "见 " + link("http://x.test/") + "`用法"],
    ["a `<`", "see http://x.test/a<b", "see " + link("http://x.test/a") + "<b"],
    [
      "a brace",
      "GET https://api.x.test/users/{id}",
      "GET " + link("https://api.x.test/users/") + "{id}",
    ],
  ])("before %s", (_, markdown, expected) => {
    expect(render(markdown)).toBe(expected);
  });

  it("cuts unencoded CJK out of a path, and keeps the same path percent-encoded", () => {
    expect(links("见 https://penguin.ooo/wiki/中文 完")).toEqual([
      ["https://penguin.ooo/wiki/", "https://penguin.ooo/wiki/"],
    ]);
    expect(links("见 https://penguin.ooo/wiki/%E4%B8%AD%E6%96%87 完")).toEqual([
      [
        "https://penguin.ooo/wiki/%E4%B8%AD%E6%96%87",
        "https://penguin.ooo/wiki/%E4%B8%AD%E6%96%87",
      ],
    ]);
  });

  it("leaves `*`, `~` and `_` before the end out of the URL, and keeps them inside it", () => {
    expect(render("见 http://x.test/?q=*看")).toBe("见 " + link("http://x.test/?q=") + "*看");
    expect(render("见 http://x.test/a~~好")).toBe("见 " + link("http://x.test/a") + "~~好");
    expect(render("见 http://x.test/a_看")).toBe("见 " + link("http://x.test/a") + "_看");
    expect(links("https://a.com/a_b?q=*b")).toEqual([
      ["https://a.com/a_b?q=*b", "https://a.com/a_b?q=*b"],
    ]);
  });
});

describe("bold beside a URL and beside CJK", () => {
  it("closes after a URL and before CJK", () => {
    expect(render("请**打开 http://127.0.0.1:4321/**查看")).toBe(
      `请<strong>打开 ${link("http://127.0.0.1:4321/")}</strong>查看`,
    );
  });

  it("closes after full-width punctuation and before CJK", () => {
    expect(render("**粗体（注）**后面")).toBe("<strong>粗体（注）</strong>后面");
  });

  it("closes around a URL ending in a letter, with Chinese right after", () => {
    expect(render("**见 https://a.com/index**查看")).toBe(
      `<strong>见 ${link("https://a.com/index")}</strong>查看`,
    );
  });
});

describe("English and the GFM links it already had", () => {
  it.each([
    ["a comma", "see https://penguin.ooo, then", "see " + link("https://penguin.ooo") + ", then"],
    ["parentheses it balances", "(https://a.com/x_(y))", "(" + link("https://a.com/x_(y)") + ")"],
    [
      "markers inside a path",
      "see https://a.com/src/__tests__/x.ts and https://a.com/**/y",
      "see " + link("https://a.com/src/__tests__/x.ts") + " and " + link("https://a.com/**/y"),
    ],
    [
      "a closing bold",
      "**see http://x.test/a_b**",
      `<strong>see ${link("http://x.test/a_b")}</strong>`,
    ],
    ["a closing emphasis", "_http://x.test/_", `<em>${link("http://x.test/")}</em>`],
    [
      "brackets it balances",
      "see https://a.com/?a[0]=1 now",
      "see " + link("https://a.com/?a[0]=1") + " now",
    ],
    [
      "punctuation inside brackets",
      "see https://a.com/?a[x.]=1",
      "see " + link("https://a.com/?a[x.]=1"),
    ],
    ["a query's `&`", "see https://a.com/?a=1&b=2&3", "see " + link("https://a.com/?a=1&b=2&3")],
    [
      "a trailing reference",
      "see https://a.com/?q=1&amp; then",
      "see " + link("https://a.com/?q=1") + "& then",
    ],
    ["a `]` it did not open", "见 http://x.test/a]看", "见 " + link("http://x.test/a") + "]看"],
    ["a `www.` host", "www.example.com.", link("http://www.example.com", "www.example.com") + "."],
    ["an email", "联系 a@b.com，谢谢", "联系 " + link("mailto:a@b.com", "a@b.com") + "，谢谢"],
    [
      "an email's full stop",
      "mail a.b@c-d.org.",
      "mail " + link("mailto:a.b@c-d.org", "a.b@c-d.org") + ".",
    ],
  ])("%s", (_, markdown, expected) => {
    expect(render(markdown)).toBe(expected);
  });

  it.each([
    ["a word that only contains a scheme", "xhttp://a.com and see:www"],
    ["a scheme that is not http", "ftp://a.com httpx://a.com http:/a.com"],
    ["a host starting with punctuation", "http://-a.com http://中文.com"],
    ["an underscore in the last two labels", "https://a_b.com https://a.b_c"],
    ["`www.` with no host after it", "see www. now, or wwww.a.com"],
    ["an address that does not end in a letter", "a@b a@b.c1 /a@b.com"],
  ])("does not link %s", (_, markdown) => {
    expect(links(markdown)).toEqual([]);
  });
});

describe("where a bare URL is not one", () => {
  it("stays code in inline code and in a fenced block", () => {
    expect(render("run `curl https://a.com/x` now")).toBe(
      "run <code>curl https://a.com/x</code> now",
    );
    expect(links("```\nhttps://a.com/x\n```")).toEqual([]);
  });

  it("is one link when written as a link, even with a URL for its text", () => {
    expect(links("[t](https://x)")).toEqual([["https://x", "t"]]);
    expect(links("[https://a.com](https://b.com)")).toEqual([["https://b.com", "https://a.com"]]);
  });

  it("links inside brackets that are not a link", () => {
    expect(render("见 [https://a.com] 注")).toBe("见 [" + link("https://a.com") + "] 注");
  });
});

describe("the rest of GFM", () => {
  it("still reads tables, task lists, footnotes and strikethrough", () => {
    const root = processor.parse(
      "| a |\n| - |\n| 1 |\n\n- [x] done\n\nnote[^1]\n\n[^1]: x\n\n~~gone~~",
    ) as Node;
    expect(root.children!.map((n) => n.type)).toEqual([
      "table",
      "list",
      "paragraph",
      "footnoteDefinition",
      "paragraph",
    ]);
    expect(render("~~gone~~")).toBe("<del>gone</del>");
  });
});

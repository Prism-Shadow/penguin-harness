/**
 * The Markdown conversion the four messaging channels relay a reply through: the shared
 * parse and chunking (markdown.ts), and each channel's own renderer.
 *
 * Four renderers rather than one because the four platforms accept four different
 * subsets, and the tests are organized to say so: every construct the model actually writes
 * is asserted per channel, including the ones a channel CANNOT show, because how a missing
 * construct degrades is the part a reader of a chat notices. The escaping cases are grouped
 * on their own — a reply is model output steered by whoever is in the chat, so text that
 * looks like markup has to arrive as text on every channel.
 *
 * Delivery — that a rendered send actually goes out with the right `parse_mode` / `msg_type`,
 * and that a refused one falls back to plain text — is proven against each channel's own
 * wire fake in messaging.test.ts, messaging-telegram.test.ts, messaging-qq.test.ts,
 * messaging-wechat.test.ts and messaging-wire.test.ts. Nothing here sends anything.
 */
import { describe, expect, it } from "vitest";
import { attachedFileLine } from "@prismshadow/penguin-core";
import { MESSAGING_TEXT_CHUNK_CHARS } from "../src/runtime/messaging/bridge.js";
import { chunkMarkdown, isSafeUrl, parseMarkdown } from "../src/runtime/messaging/markdown.js";
import { feishuCardOf, feishuMarkdownOf } from "../src/runtime/messaging/feishu-card.js";
import { qqMarkdownOf } from "../src/runtime/messaging/qq-markdown.js";
import { telegramHtmlOf } from "../src/runtime/messaging/telegram-html.js";
import { wechatMarkdownOf } from "../src/runtime/messaging/wechat-markdown.js";

describe("parseMarkdown", () => {
  it("reads GFM, so tables and task lists are constructs rather than punctuation", () => {
    const root = parseMarkdown("| a |\n| - |\n| 1 |\n\n- [x] done\n\n~~gone~~");
    expect(root.children.map((n) => n.type)).toEqual(["table", "list", "paragraph"]);
  });

  it("never throws: any text at all is a document", () => {
    for (const text of ["", "   ", "**unclosed", "```\nno end", "| broken |"]) {
      expect(() => parseMarkdown(text)).not.toThrow();
    }
  });
});

describe("isSafeUrl", () => {
  it("admits the schemes a chat can open and refuses the rest", () => {
    for (const url of [
      "https://x.com/a",
      "http://x.com",
      "mailto:a@b.c",
      "tel:+1",
      "tg://user?id=1",
    ]) {
      expect(isSafeUrl(url)).toBe(true);
    }
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,<script>",
      "file:///etc/passwd",
      "",
      "#anchor",
    ]) {
      expect(isSafeUrl(url)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Telegram — HTML, a closed tag set with no headings, lists or tables
// ---------------------------------------------------------------------------

describe("telegramHtmlOf", () => {
  it("renders the inline constructs Telegram has tags for", () => {
    expect(telegramHtmlOf("**b** *i* ~~s~~ `c`")).toBe("<b>b</b> <i>i</i> <s>s</s> <code>c</code>");
    expect(telegramHtmlOf("[label](https://x.com/p)")).toBe('<a href="https://x.com/p">label</a>');
    expect(telegramHtmlOf("> quoted\n> more")).toBe("<blockquote>quoted\nmore</blockquote>");
  });

  it("puts a fenced block in pre/code with its language, as the Bot API requires", () => {
    expect(telegramHtmlOf("```python\nprint(1)\n```")).toBe(
      '<pre><code class="language-python">print(1)</code></pre>',
    );
    // No language: a bare `pre`. The Bot API refuses a class on a standalone `code` tag, so
    // a fence with no info string must not grow one.
    expect(telegramHtmlOf("```\nplain\n```")).toBe("<pre>plain</pre>");
    // A fence's info string is free text and it would land in an attribute, so anything that
    // is not a plausible language tag drops back to the bare form rather than being quoted in.
    expect(telegramHtmlOf('```py"onerror=x\nprint(1)\n```')).toBe("<pre>print(1)</pre>");
  });

  it("degrades a heading to a bold line, since Telegram has no heading at any depth", () => {
    expect(telegramHtmlOf("# Top")).toBe("<b>Top</b>");
    expect(telegramHtmlOf("###### Deep")).toBe("<b>Deep</b>");
    // The hashes themselves must not survive into the text: that is leaking markup.
    expect(telegramHtmlOf("## Report")).not.toContain("#");
  });

  it("draws list markers as text, since Telegram will not draw them", () => {
    expect(telegramHtmlOf("- one\n- two")).toBe("• one\n• two");
    expect(telegramHtmlOf("3. three\n4. four")).toBe("3. three\n4. four");
    expect(telegramHtmlOf("- a\n  - b")).toBe("• a\n  • b");
    expect(telegramHtmlOf("- [ ] todo\n- [x] done")).toBe("• ☐ todo\n• ☑ done");
  });

  it("puts a table in a pre block, the only place its columns line up", () => {
    expect(telegramHtmlOf("| a | b |\n| - | - |\n| 1 | 2 |")).toBe(
      "<pre>| a | b |\n| 1 | 2 |</pre>",
    );
  });

  it("renders a rule as text and an image as a link, neither having a tag", () => {
    expect(telegramHtmlOf("---")).toBe("———");
    expect(telegramHtmlOf("![a chart](https://x.com/c.png)")).toBe(
      '<a href="https://x.com/c.png">a chart</a>',
    );
  });

  it("escapes the model's own HTML characters rather than emitting them as tags", () => {
    expect(telegramHtmlOf("5 < 6 and a & b and 7 > 2")).toBe("5 &lt; 6 and a &amp; b and 7 &gt; 2");
    // A `<script>` inside a fence is text about a script, and stays text.
    expect(telegramHtmlOf('```js\nconst s = "<script>alert(1)</script>";\n```')).toBe(
      '<pre><code class="language-js">const s = &quot;&lt;script&gt;alert(1)&lt;/script&gt;&quot;;</code></pre>'.replaceAll(
        "&quot;",
        '"',
      ),
    );
    // Raw HTML the model typed is shown, never forwarded: the tag set is closed, so a
    // forwarded tag is a 400 for the whole message.
    expect(telegramHtmlOf("<b>not mine</b>")).toBe("&lt;b&gt;not mine&lt;/b&gt;");
  });

  it("keeps an unopenable link's label and drops only its clickability", () => {
    expect(telegramHtmlOf("[click](javascript:alert(1))")).toBe("click");
    expect(telegramHtmlOf('[q](https://x.com/?a="b")')).toBe(
      '<a href="https://x.com/?a=&quot;b&quot;">q</a>',
    );
  });
});

// ---------------------------------------------------------------------------
// Feishu — the widest subset, entity escaping
// ---------------------------------------------------------------------------

describe("feishuMarkdownOf", () => {
  it("keeps every construct the rich-text component renders", () => {
    expect(feishuMarkdownOf("# One\n###### Six")).toBe("# One\n\n###### Six");
    expect(feishuMarkdownOf("**b** *i* ~~s~~ `c`")).toBe("**b** *i* ~~s~~ `c`");
    expect(feishuMarkdownOf("```python\nprint(1)\n```")).toBe("```python\nprint(1)\n```");
    expect(feishuMarkdownOf("- a\n    - b")).toBe("- a\n    - b");
    expect(feishuMarkdownOf("1. one\n2. two")).toBe("1. one\n2. two");
    expect(feishuMarkdownOf("> quoted")).toBe("> quoted");
    expect(feishuMarkdownOf("---")).toBe("---");
    expect(feishuMarkdownOf("[l](https://x.com)")).toBe("[l](https://x.com)");
    expect(feishuMarkdownOf("| a | b |\n| - | - |\n| 1 | 2 |")).toBe(
      "| a | b |\n| --- | --- |\n| 1 | 2 |",
    );
  });

  it("escapes literal text with entities, in ONE pass so entities cannot escape each other", () => {
    // The `#` of a `&#60;` must not be rewritten by the rule for `#`.
    expect(feishuMarkdownOf("5 < 6 & a > b")).toBe("5 &#60; 6 &amp; a &#62; b");
    // The backslashes are Markdown's own escapes and are consumed by the parse; what is
    // being escaped here is the characters they were protecting.
    expect(feishuMarkdownOf("literal \\* and \\# and ~ and \\[x]")).toBe(
      "literal &#42; and &#35; and &#126; and &#91;x&#93;",
    );
    // Underscores are deliberately left alone: `*` is the documented emphasis marker, and
    // snake_case is everywhere in this product's replies.
    expect(feishuMarkdownOf("call read_file_at once")).toBe("call read_file_at once");
  });

  it("leaves a code block's contents literal — a fence needs no escaping inside it", () => {
    expect(feishuMarkdownOf('```js\nconst s = "<script>alert(1)</script>"; // a & b\n```')).toBe(
      '```js\nconst s = "<script>alert(1)</script>"; // a & b\n```',
    );
    // A value containing a fence gets a longer one, or it would close early.
    expect(feishuMarkdownOf("````\nhas ``` inside\n````")).toContain("````\nhas ``` inside\n````");
  });

  it("neutralizes a block marker a paragraph happens to open with", () => {
    // Written escaped by the model, so it is a paragraph and must stay one.
    expect(feishuMarkdownOf("\\- 40 degrees below")).toBe("&#45; 40 degrees below");
    expect(feishuMarkdownOf("1\\. not a list")).toBe("1&#46; not a list");
  });

  it("sends an over-long table as a code block rather than letting rows be dropped", () => {
    const wide = [
      "| a | b |",
      "| - | - |",
      ...Array.from({ length: 7 }, (_, i) => `| r${i} | ${i} |`),
    ];
    const out = feishuMarkdownOf(wide.join("\n"));
    expect(out.startsWith("```")).toBe(true);
    // Every row survives, which a five-row table would not have managed.
    for (let i = 0; i < 7; i += 1) expect(out).toContain(`| r${i} | ${i} |`);
  });

  it("wraps the content in the schema 2.0 card envelope the IM API carries", () => {
    expect(feishuCardOf("**hi**")).toEqual({
      schema: "2.0",
      body: { elements: [{ tag: "markdown", content: "**hi**" }] },
    });
  });

  it("keeps an unopenable link's label and drops only its clickability", () => {
    expect(feishuMarkdownOf("[click](javascript:alert(1))")).toBe("click");
  });
});

// ---------------------------------------------------------------------------
// QQ — headings and lists but no code and no tables; backslash escaping
// ---------------------------------------------------------------------------

describe("qqMarkdownOf", () => {
  it("keeps the constructs QQ documents", () => {
    expect(qqMarkdownOf("## Two")).toBe("## Two");
    expect(qqMarkdownOf("**b** *i* ~~s~~")).toBe("**b** *i* ~~s~~");
    expect(qqMarkdownOf("- a\n    - b")).toBe("- a\n    - b");
    expect(qqMarkdownOf("1. one\n2. two")).toBe("1. one\n2. two");
    expect(qqMarkdownOf("> quoted")).toBe("> quoted");
    expect(qqMarkdownOf("[l](https://x.com)")).toBe("[l](https://x.com)");
  });

  it("uses the rule QQ documents, which is not the one Markdown writes", () => {
    expect(qqMarkdownOf("---")).toBe("***");
  });

  it("sends a code block as plain escaped lines, never as literal backticks", () => {
    const out = qqMarkdownOf("```python\n# a comment\nx = a ** b\n```");
    expect(out).not.toContain("```");
    // The `#` would have become a heading and the `**` a bold run; both are escaped, and
    // every character the model wrote is still present.
    expect(out).toBe("\\# a comment\nx = a \\*\\* b");
    expect(qqMarkdownOf("use `read_file` first")).toBe("use read\\_file first");
  });

  it("sends a table as its rows, there being no table syntax at all", () => {
    expect(qqMarkdownOf("| a | b |\n| - | - |\n| 1 | 2 |")).toBe("| a | b |\n| 1 | 2 |");
  });

  it("escapes with backslashes, which can only ever add a character", () => {
    expect(qqMarkdownOf("literal * and _ and ~ and [x] and `t`")).toBe(
      "literal \\* and \\_ and \\~ and \\[x\\] and t",
    );
    // `#` and `>` mean something only at the head of a line, so an ordinary sentence keeps
    // its punctuation unescaped.
    expect(qqMarkdownOf("issue \\#12 and a > b")).toBe("issue #12 and a > b");
    // At the head of one they are escaped, so a paragraph is not re-read as a heading.
    expect(qqMarkdownOf("\\# not a heading")).toBe("\\# not a heading");
  });

  it("keeps an unopenable link's label and drops only its clickability", () => {
    expect(qqMarkdownOf("[click](javascript:alert(1))")).toBe("click");
  });
});

// ---------------------------------------------------------------------------

describe("wechatMarkdownOf", () => {
  it("keeps the constructs WeChat reads, which is the most of the four", () => {
    expect(wechatMarkdownOf("## Two")).toBe("## Two");
    expect(wechatMarkdownOf("**b** ~~s~~")).toBe("**b** ~~s~~");
    expect(wechatMarkdownOf("- a\n    - b")).toBe("- a\n    - b");
    expect(wechatMarkdownOf("1. one\n2. two")).toBe("1. one\n2. two");
    expect(wechatMarkdownOf("> quoted")).toBe("> quoted");
    expect(wechatMarkdownOf("[l](https://x.com)")).toBe("[l](https://x.com)");
    expect(wechatMarkdownOf("---")).toBe("---");
  });

  it("keeps code as code, fence and language and all — the reason this channel is the widest", () => {
    // The renderer here subtracts rather than translates: what WeChat reads is emitted as
    // the model wrote it, and only what it cannot read loses its markers.
    expect(wechatMarkdownOf("```python\n# a comment\nx = a ** b\n```")).toBe(
      "```python\n# a comment\nx = a ** b\n```",
    );
    expect(wechatMarkdownOf("use `read_file` first")).toBe("use `read_file` first");
  });

  it("widens a fence past the backticks its own content holds", () => {
    // A three-backtick fence around content containing three would close at the content.
    expect(wechatMarkdownOf("````\n```\n````")).toBe("````\n```\n````");
    // A span whose CONTENT holds a backtick: one delimiter would close at it.
    expect(wechatMarkdownOf("use `` a`b `` here")).toBe("use ``a`b`` here");
  });

  it("keeps a table as a table, delimiter row included", () => {
    expect(wechatMarkdownOf("| a | b |\n| - | - |\n| 1 | 2 |")).toBe(
      "| a | b |\n| --- | --- |\n| 1 | 2 |",
    );
    // A pipe inside a cell would open a column that is not there.
    expect(wechatMarkdownOf("| a |\n| - |\n| x \\| y |")).toContain("| x \\| y |");
  });

  it("drops the markers of a heading deeper than the client's scale", () => {
    // Five `#` would arrive as five literal characters; the text becomes the paragraph it
    // was already going to look like.
    expect(wechatMarkdownOf("#### Four")).toBe("#### Four");
    expect(wechatMarkdownOf("##### Five")).toBe("Five");
    expect(wechatMarkdownOf("###### Six")).toBe("Six");
  });

  it("keeps Latin emphasis and drops the asterisks around CJK, which do not render", () => {
    // The markers need a word boundary, and a CJK run has none — `*中文*` would arrive as
    // asterisks around Chinese.
    expect(wechatMarkdownOf("*stress*")).toBe("*stress*");
    expect(wechatMarkdownOf("*重要*")).toBe("重要");
    expect(wechatMarkdownOf("*mixed 中文*")).toBe("mixed 中文");
    // Bold is unaffected: `**` renders on both sides of the boundary question.
    expect(wechatMarkdownOf("**重要**")).toBe("**重要**");
  });

  it("turns an inline image into a link rather than dropping the URL it named", () => {
    expect(wechatMarkdownOf("![a chart](https://x.com/c.png)")).toBe(
      "[a chart](https://x.com/c.png)",
    );
    // Nameless: the URL is its own label, which is better than an empty one.
    expect(wechatMarkdownOf("![](https://x.com/c.png)")).toBe(
      "[https://x.com/c.png](https://x.com/c.png)",
    );
  });

  it("escapes literal markup outside code, and never inside it", () => {
    expect(wechatMarkdownOf("literal * and _ and ~ and [x]")).toBe(
      "literal \\* and \\_ and \\~ and \\[x\\]",
    );
    // `#` means something only at the head of a line.
    expect(wechatMarkdownOf("issue \\#12 and a > b")).toBe("issue #12 and a > b");
    expect(wechatMarkdownOf("\\# not a heading")).toBe("\\# not a heading");
    // Inside a fence the markers ARE what makes the content literal: a backslash there
    // would land in code the reader is meant to copy.
    expect(wechatMarkdownOf("```\nrm -rf *_[x]\n```")).toBe("```\nrm -rf *_[x]\n```");
  });

  it("keeps an unopenable link's label and drops only its clickability", () => {
    expect(wechatMarkdownOf("[click](javascript:alert(1))")).toBe("click");
  });
});

// ---------------------------------------------------------------------------
// Inbound file paths quoted back out
// ---------------------------------------------------------------------------

/**
 * An inbound file is handed to the model as an `[attached file: <path>]` line folded into the
 * message text, and the model quotes that path back constantly ("I read …"). The path is
 * scratchpad-shaped and full of characters these renderers escape, so it is the one piece of
 * text guaranteed to travel both directions through the conversion.
 *
 * The spelling comes from core's own `attachedFileLine`, not a literal, so the case tracks the
 * marker rather than a copy of it.
 */
describe("a reply quoting an inbound file's attachment line", () => {
  const PATH = "/home/u/.penguin/data/scratchpad/session-2026-08-27-aa/my_report_v2.pdf";
  const LINE = attachedFileLine(PATH);

  it("keeps the marker line literal rather than reading it as a link or a reference", () => {
    // `[…]` with nothing after it is not a link, and the brackets are content: a reader who
    // sees the line at all has to see the path inside it.
    expect(telegramHtmlOf(`I read ${LINE}`)).toBe(`I read ${LINE}`);
    // Feishu entity-escapes the brackets, which is how they survive its Markdown.
    expect(feishuMarkdownOf(`I read ${LINE}`)).toBe(`I read &#91;attached file: ${PATH}&#93;`);
    expect(qqMarkdownOf(`I read ${LINE}`)).toBe(
      `I read \\[attached file: ${PATH.replaceAll("_", "\\_")}\\]`,
    );
  });

  it("carries a scratchpad path through a code span byte for byte", () => {
    // The everyday shape: the model puts the path in backticks. Intraword underscores are not
    // emphasis, so nothing about `my_report_v2` is at risk — and inside a code span the path is
    // literal on both channels that have one.
    expect(telegramHtmlOf(`The file \`${PATH}\` is here.`)).toBe(
      `The file <code>${PATH}</code> is here.`,
    );
    expect(feishuMarkdownOf(`The file \`${PATH}\` is here.`)).toBe(`The file \`${PATH}\` is here.`);
  });

  it("escapes a path's HTML characters, so Telegram's parser cannot be broken by one", () => {
    // A parse failure here would cost the whole message's formatting through the connector's
    // fallback — silently, which is the failure worth pinning.
    const nasty = "/tmp/a&b<c>d<script>.txt";
    const html = telegramHtmlOf(`Read ${attachedFileLine(nasty)} and \`${nasty}\`.`);
    expect(html).not.toMatch(/<(?!\/?(b|i|s|u|code|pre|a|blockquote)[ >])/);
    expect(html).toContain("a&amp;b&lt;c&gt;d&lt;script&gt;.txt");
    // Balanced, which is what makes it parseable at all.
    expect(html.split("<code>").length).toBe(html.split("</code>").length);
  });

  it("degrades a path that genuinely IS Markdown emphasis without losing its characters", () => {
    // `/_draft_/` is emphasis in the dialect the whole product reads, so the chat and the web
    // transcript agree about it — that is the point of parsing once. What must not happen is
    // characters going missing, and on the channels with a code span the backticked form is
    // exact.
    const emphasized = "/home/u/scratch/_draft_/notes.md";
    expect(telegramHtmlOf(`Read ${emphasized}`)).toBe("Read /home/u/scratch/<i>draft</i>/notes.md");
    expect(telegramHtmlOf(`Read \`${emphasized}\``)).toBe(`Read <code>${emphasized}</code>`);
    expect(feishuMarkdownOf(`Read \`${emphasized}\``)).toBe(`Read \`${emphasized}\``);
    // QQ has no code span, so the path arrives as escaped text — every character present,
    // with backslashes added rather than anything removed.
    const qq = qqMarkdownOf(`Read \`${emphasized}\``);
    expect(qq.replaceAll("\\", "")).toBe(`Read ${emphasized}`);
  });
});

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

describe("chunkMarkdown", () => {
  it("returns a reply that fits byte for byte, and nothing for an empty one", () => {
    expect(chunkMarkdown("**hi** there", MESSAGING_TEXT_CHUNK_CHARS)).toEqual(["**hi** there"]);
    expect(chunkMarkdown("   \n  ", MESSAGING_TEXT_CHUNK_CHARS)).toEqual([]);
  });

  it("cuts between blocks, so no chunk opens mid-construct", () => {
    const src = ["# Head", "", "para one here.", "", "para two here.", "", "para three."].join(
      "\n",
    );
    const out = chunkMarkdown(src, 20);
    expect(out).toEqual(["# Head", "para one here.", "para two here.", "para three."]);
    for (const chunk of out) expect(chunk.length).toBeLessThanOrEqual(20);
    // Blocks that fit together stay together, the blank lines between them included — those
    // are what keep two paragraphs two paragraphs.
    expect(chunkMarkdown(src, 40)).toEqual([
      "# Head\n\npara one here.\n\npara two here.",
      "para three.",
    ]);
  });

  it("re-fences a code block too long for one message, so every piece is still code", () => {
    const lines = Array.from({ length: 40 }, (_, i) => `const line${i} = ${i};`);
    const out = chunkMarkdown("```js\n" + lines.join("\n") + "\n```", 300);
    expect(out.length).toBeGreaterThan(1);
    for (const chunk of out) {
      expect(chunk.startsWith("```js\n")).toBe(true);
      expect(chunk.endsWith("\n```")).toBe(true);
      expect(chunk.length).toBeLessThanOrEqual(300);
    }
    // Nothing was dropped between the pieces.
    const rejoined = out.map((c) => c.slice("```js\n".length, -"\n```".length)).join("\n");
    expect(rejoined).toBe(lines.join("\n"));
  });

  it("cuts a long paragraph between inline runs, never through one", () => {
    const bold = "**one-unbroken-bold-run**";
    const src = `${"x".repeat(120)} ${bold} ${"y".repeat(120)}`;
    const out = chunkMarkdown(src, 150);
    expect(out.length).toBeGreaterThan(1);
    // The run lands whole in exactly one chunk — a cut through it would leave stray
    // asterisks in two messages and render as bold in neither.
    expect(out.filter((c) => c.includes(bold))).toHaveLength(1);
    for (const chunk of out) {
      expect(chunk.split("**").length % 2).toBe(1); // balanced markers
    }
  });

  it("keeps the line prefixes that make a blockquote and a list what they are", () => {
    const quote = Array.from({ length: 8 }, (_, i) => `> quoted line ${i} with padding text`);
    for (const chunk of chunkMarkdown(quote.join("\n"), 150)) {
      for (const line of chunk.split("\n")) expect(line.startsWith("> ")).toBe(true);
    }
    const list = Array.from({ length: 10 }, (_, i) => `- item ${i} with some padding text here`);
    for (const chunk of chunkMarkdown(list.join("\n"), 150)) {
      for (const line of chunk.split("\n")) expect(line.startsWith("- ")).toBe(true);
    }
  });

  it("still bounds a single unbreakable line, the last resort", () => {
    const out = chunkMarkdown("z".repeat(500), 100);
    expect(out.every((c) => c.length <= 100)).toBe(true);
    expect(out.join("")).toBe("z".repeat(500));
  });

  it("produces chunks each renderer accepts on its own", () => {
    // The whole point of cutting at document boundaries: a chunk is a document, so every
    // channel's renderer reads it as the constructs it was part of.
    const src = `# Head\n\n${"a".repeat(200)}\n\n\`\`\`js\nconst x = 1;\n\`\`\`\n\n- one\n- two`;
    for (const chunk of chunkMarkdown(src, 220)) {
      expect(() => telegramHtmlOf(chunk)).not.toThrow();
      expect(() => feishuMarkdownOf(chunk)).not.toThrow();
      expect(() => qqMarkdownOf(chunk)).not.toThrow();
      expect(() => wechatMarkdownOf(chunk)).not.toThrow();
    }
  });
});

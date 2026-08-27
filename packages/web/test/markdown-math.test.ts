/**
 * Math rendering across the shared Markdown pipeline (lib/markdown-plugins.ts), via
 * react-dom/server static markup — KaTeX renders synchronously, so the finished formula is in the
 * first pass with no DOM and no effects.
 *
 * What is pinned here is the set of decisions that are invisible once they work and silently wrong
 * when they break: which delimiters count, which look like delimiters but must not, what a
 * malformed formula does to the message around it, and that all five renderers still share one
 * plugin list.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { REHYPE_PLUGINS, REMARK_PLUGINS } from "../src/lib/markdown-plugins";
import { Md } from "../src/features/chat/md";
import { dropNonWoff2FontSources } from "../vite.config.js";

const render = (markdown: string) =>
  renderToStaticMarkup(
    createElement(
      ReactMarkdown,
      { remarkPlugins: REMARK_PLUGINS, rehypePlugins: REHYPE_PLUGINS },
      markdown,
    ),
  );

/** KaTeX rendered something here (as opposed to leaving the source as prose). */
const isMath = (html: string) => html.includes('class="katex');
/** KaTeX rendered it in display mode — its own block wrapper, not an inline run. */
const isDisplay = (html: string) => html.includes('class="katex-display"');
/**
 * The reader-visible text, tags stripped.
 *
 * KaTeX emits each formula twice: a visually hidden MathML tree (for screen readers, and carrying
 * the original TeX in an `<annotation>`) alongside the styled HTML. Dropping the `<math>` element
 * first is what makes this the text a reader actually sees rather than everything twice over.
 */
const text = (html: string) => html.replace(/<math\b[\s\S]*?<\/math>/g, "").replace(/<[^>]*>/g, "");

describe("delimiters that are math", () => {
  it("renders the reported shape: a display formula in \\[…\\] with CJK in \\text{}", () => {
    const html = render(
      String.raw`\[\text{采集} \rightarrow \text{解码} \rightarrow \text{干预}\]`,
    );
    expect(isDisplay(html)).toBe(true);
    // The source is gone from view: no stray backslash commands left in the prose.
    expect(text(html)).not.toContain(String.raw`\rightarrow`);
    expect(text(html)).toBe("采集→解码→干预");
  });

  it("accepts all three delimiter pairs", () => {
    for (const source of [
      String.raw`\(E=mc^2\)`,
      String.raw`\[E=mc^2\]`,
      "$$E=mc^2$$",
      // Fenced $$ on its own lines, the block form remark-math documents.
      "$$\nE=mc^2\n$$",
    ]) {
      expect(isMath(render(source)), source).toBe(true);
    }
  });

  it("distinguishes display from inline", () => {
    expect(isDisplay(render(String.raw`\[x\]`))).toBe(true);
    expect(isDisplay(render("$$\nx\n$$"))).toBe(true);
    expect(isDisplay(render(String.raw`\(x\)`))).toBe(false);
    expect(isMath(render(String.raw`\(x\)`))).toBe(true);
  });

  it("makes a $$…$$ pair display wherever it is written, not only on its own lines", () => {
    // remark-math decides by run length, which leaves a one-line `$$…$$` inline: nowrap, typeset
    // cramped, and behaving unlike `\[…\]` for content nobody writes meaning inline. A `$$` pair
    // has been display since plain TeX, and single-dollar math is off, so nothing else fits.
    for (const source of ["$$E=mc^2$$", "text $$E=mc^2$$ text", "# heading $$x^2$$"]) {
      expect(isDisplay(render(source)), source).toBe(true);
    }
  });

  it("clamps a sizing command to a size the message body absorbs", () => {
    // KaTeX defaults maxSize to Infinity, so `\rule{9999em}{9999em}` is a black square many
    // viewports wide and no overflow rule can help: the element's own height is the problem.
    const html = render(String.raw`\[\rule{9999em}{9999em}\]`);
    const sizes = [...html.matchAll(/(?:width|height)[:="]+([\d.]+)em/g)].map((m) => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(0);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(5);
  });

  it("renders \\[…\\] mid-sentence without breaking the paragraph open", () => {
    // Display math is emitted as a <span>, so it nests legally inside the surrounding <p>.
    const html = render(String.raw`before \[x\] after`);
    expect(isDisplay(html)).toBe(true);
    expect(html).not.toMatch(/<p>[\s\S]*<(?:div|pre)\b/);
    expect(text(html)).toContain("before");
    expect(text(html)).toContain("after");
  });

  it("carries a multi-line formula that sits inside one paragraph", () => {
    const html = render(
      "start\n\\[\n\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}\n\\]\nend",
    );
    expect(isDisplay(html)).toBe(true);
    expect(text(html)).toContain("start");
    expect(text(html)).toContain("end");
  });

  it("renders ordinary formulas: fractions, integrals, matrices, inline mass-energy", () => {
    for (const source of [
      String.raw`\[\frac{a}{b}\]`,
      String.raw`\[\int_0^\infty e^{-x^2}\,dx = \frac{\sqrt{\pi}}{2}\]`,
      String.raw`\[\begin{bmatrix} 1 & 2 \\ 3 & 4 \end{bmatrix}\]`,
      String.raw`\(E=mc^2\)`,
    ]) {
      const html = render(source);
      expect(isMath(html), source).toBe(true);
      expect(html, source).not.toContain("katex-error");
    }
  });

  it("gives CJK inside \\text{} the class the stylesheet hangs a font fallback on", () => {
    // KaTeX's own faces have no CJK glyphs; it tags the run `cjk_fallback` and defines nothing for
    // it, so styles.css points that class at the app's stack. Without the class there is no hook.
    expect(render(String.raw`\[\text{采集}\]`)).toContain("cjk_fallback");
  });
});

describe("delimiters that are not math", () => {
  it("leaves shell variables and prices alone (single-dollar math is off)", () => {
    for (const prose of [
      "Set $PATH and $HOME before running.",
      "It costs $5 and $10 in total.",
      "The range is $5-$10 per seat.",
      "Use $HOME/.penguin/data or $PENGUIN_HOME.",
      "echo $PATH; echo $HOME",
      "Prices: $1,200 and $3,400.",
      "50% off: $20 to $10",
      "Balance: $0. Fee: $3.",
    ]) {
      const html = render(prose);
      expect(isMath(html), prose).toBe(false);
      // Every dollar sign survives, and so does the wording around it.
      expect(text(html), prose).toBe(prose);
    }
  });

  it("never renders math inside inline code", () => {
    for (const source of ["`$$x$$`", "`\\(x\\)`", "`\\[x\\]`", "`$PATH`"]) {
      const html = render(source);
      expect(isMath(html), source).toBe(false);
      expect(html, source).toContain("<code>");
    }
  });

  it("does not reach into a code span for a closer", () => {
    // The opener is safe by construction — the tokenizer is only entered where inline content is
    // read — but a closer inside a code span is just more raw characters to a scan already inside
    // a formula. Prose about the delimiters is the shape that breaks.
    for (const source of [
      "In LaTeX you open with \\( and close with `\\)`.",
      "Open with \\[ and close with `\\]`.",
      "Write \\( then `\\)` then more text.",
    ]) {
      const html = render(source);
      expect(isMath(html), source).toBe(false);
      expect(html, source).toContain("<code>");
      // The code span survives intact: no backtick spilled into the surrounding prose.
      expect(text(html), source).not.toContain("`");
    }
  });

  it("never renders math inside a fenced or indented code block", () => {
    for (const source of [
      "```\n\\[x\\]\n$$y$$\n\\(z\\)\n```",
      "```bash\necho $PATH\n\\[x\\]\n```",
      "~~~\n\\[x\\]\n~~~",
      "    \\[x\\]\n    $$y$$",
    ]) {
      expect(isMath(render(source)), source).toBe(false);
    }
  });

  it("leaves an escaped backslash-bracket as literal text", () => {
    const html = render(String.raw`escaped \\[not math\\] here`);
    expect(isMath(html)).toBe(false);
    expect(text(html)).toBe(String.raw`escaped \[not math\] here`);
  });

  it("does not disturb the other character escapes", () => {
    const html = render(String.raw`a \* b and \_c\_ and \# d`);
    expect(text(html)).toBe("a * b and _c_ and # d");
    expect(html).not.toContain("<em>");
  });
});

describe("collisions resolved on purpose", () => {
  it("reads CommonMark's escaped brackets as math", () => {
    // `\[` and `\]` are also the escapes for a literal bracket, so a footnote marker or a
    // placeholder written that way becomes a formula — and, `\[…\]` being display, a centred one
    // that splits the sentence. Two syntaxes over one character, and only one can win; it goes to
    // the one models actually emit. Pinned so the trade stays a decision rather than a surprise.
    for (const source of [
      String.raw`See \[1\] and \[2\] for details.`,
      String.raw`Write \[TODO\] in the file.`,
      String.raw`Use \(foo\) to capture a group.`,
    ]) {
      expect(isMath(render(source)), source).toBe(true);
    }
  });
});

describe("input that arrives broken or half-written", () => {
  it("renders a malformed expression as its own source instead of throwing", () => {
    const html = render(String.raw`\[\frac{1\]`);
    expect(html).toContain("katex-error");
    expect(text(html)).toContain(String.raw`\frac{1`);
  });

  it("keeps the rest of the message when one formula fails", () => {
    const html = render(String.raw`before \(\frac{1\) after \(E=mc^2\) end`);
    expect(text(html)).toContain("before");
    expect(text(html)).toContain("after");
    expect(text(html)).toContain("end");
    expect(html).toContain("katex-error"); // the broken one
    expect(html).toContain('class="katex"'); // the good one still rendered
  });

  it("renders the user's own mangled paste rather than blanking the reply", () => {
    // `\text(…)` — braces typed as parentheses. LaTeX-incompatible, still renderable.
    const html = render(String.raw`\[\text(采集) \rightarrow \text(解码)\]`);
    expect(text(html)).toContain("采集");
    expect(html).not.toBe("");
  });

  it("shows an unterminated delimiter as ordinary text, then settles when the closer lands", () => {
    // The three states a streaming reply passes through, delta by delta.
    const partial = String.raw`结论：\[\text{采集} \right`;
    expect(isMath(render(partial))).toBe(false);
    expect(text(render(partial))).toContain(String.raw`\text{采集}`);

    const stillPartial = String.raw`结论：\[\text{采集} \rightarrow \text{解码}`;
    expect(isMath(render(stillPartial))).toBe(false);

    const settled = String.raw`结论：\[\text{采集} \rightarrow \text{解码}\]`;
    expect(isDisplay(render(settled))).toBe(true);
    expect(text(render(settled))).toContain("结论：");
  });

  it("an unclosed opener costs one scan, not one per opener", () => {
    // Each opener with no closer used to scan the rest of the paragraph, so a paragraph full of
    // stray ones cost a full pass each — 1000 of them in an 18k-character paragraph measured ~235x
    // the same paragraph on its own, and chat bodies re-parse as they stream. Guards the give-up
    // memo in remark-math-brackets.ts. Compared as a ratio against a control render in the same
    // process rather than against a wall clock, so a loaded CI box moves both numbers together.
    const paragraph = "中文段落内容".repeat(3000);
    const hostile = "\\[".repeat(1000) + paragraph;
    const measure = (source: string) => {
      const started = performance.now();
      render(source);
      return performance.now() - started;
    };
    measure(hostile); // warm the pipeline, JIT included
    measure(paragraph);
    const control = Math.max(measure(paragraph), 1);
    expect(measure(hostile) / control).toBeLessThan(20);
  });
});

describe("the chat renderer", () => {
  const renderMd = (text: string, streaming = false) =>
    renderToStaticMarkup(createElement(Md, { text, streaming }));

  it("typesets a formula on settle and shows its source until then", () => {
    // rehype-katex is the expensive half of the pipeline — KaTeX's markup is re-parsed into hast
    // and rebuilt as several hundred React elements per formula — and a streaming body re-renders
    // on every delta. So the stage is held back to the settle render, the same one that
    // re-highlights code blocks. Losing this is invisible in a screenshot and quadratic in a chat.
    expect(isDisplay(renderMd(String.raw`\[\frac{a}{b}\]`))).toBe(true);
    expect(isMath(renderMd(String.raw`\(E=mc^2\)`))).toBe(true);

    for (const [source, formula] of [
      [String.raw`\[\frac{a}{b}\]`, String.raw`\frac{a}{b}`],
      [String.raw`\(E=mc^2\)`, "E=mc^2"],
      ["$$E=mc^2$$", "E=mc^2"],
    ] as const) {
      const html = renderMd(source, true);
      expect(isMath(html), source).toBe(false);
      // The source, delimiters aside, stays legible while it streams.
      expect(text(html), source).toBe(formula);
    }
  });

  it("keeps a streaming $$ block out of the CodeBlock chrome", () => {
    // remark-math models block math as a `language-math` fence, which is exactly what the `pre`
    // override turns into CodeBlock. Settled, rehype-katex replaces the pair before the override
    // is consulted; streaming, nothing does — so a formula would grow a language label and a copy
    // button for as long as the reply takes to arrive, then lose them.
    const html = renderMd("$$\n\\frac{a}{b}\n$$", true);
    expect(html).not.toContain("code-block");
    expect(html).toContain("<pre>");
    expect(text(html)).toContain(String.raw`\frac{a}{b}`);
  });

  it("a $$ block becomes a formula, not a code block", () => {
    // remark-math models block math as <pre><code class="language-math">, which is exactly what the
    // chat renderer's `pre` override turns into CodeBlock chrome. rehype-katex replaces the <pre>
    // outright before that override is ever consulted, so the two never collide.
    const html = renderMd("$$\n\\frac{a}{b}\n$$");
    expect(isDisplay(html)).toBe(true);
    expect(html).not.toContain("code-block");
  });

  it("still routes real fenced code through CodeBlock", () => {
    const html = renderMd("```js\nconst a = 1;\n```");
    expect(html).toContain("code-block");
    expect(isMath(html)).toBe(false);
  });
});

describe("the pipeline every renderer shares", () => {
  const read = (relative: string) =>
    readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

  /**
   * A renderer that quietly dropped the shared list would still render Markdown, so no behavioural
   * test would fail — only its math and its URL boundaries would be wrong, on one surface. Hence a
   * source scan: every `<ReactMarkdown` in the app has to carry both stages.
   */
  const RENDERERS = [
    "../src/features/chat/md.tsx",
    "../src/features/chat/workspace-browser.tsx",
    "../src/features/benchmark/benchmark-case-browser.tsx",
    "../src/features/traces/trace-event-row.tsx",
  ];

  /**
   * Matched by the constant each prop names rather than by an exact string, because md.tsx picks
   * its rehype stage by `streaming`. What is being guarded is that the name comes from the shared
   * module, not the shape of the expression around it.
   */
  const SHARED = { remarkPlugins: "REMARK_PLUGINS", rehypePlugins: "REHYPE_PLUGINS" };

  it("every ReactMarkdown in the app is given both shared plugin lists", () => {
    let total = 0;
    for (const relative of RENDERERS) {
      const source = read(relative);
      const uses = source.split("<ReactMarkdown").length - 1;
      expect(uses, relative).toBeGreaterThan(0);
      total += uses;
      for (const [prop, constant] of Object.entries(SHARED)) {
        const values = [...source.matchAll(new RegExp(`${prop}=\\{([^}]*)\\}`, "g"))];
        expect(values.length, `${relative} ${prop}`).toBe(uses);
        for (const [, value] of values) expect(value, `${relative} ${prop}`).toContain(constant);
      }
      expect(source, relative).toContain('from "../../lib/markdown-plugins"');
    }
    expect(total).toBe(5); // md.tsx, workspace, benchmark, and two in trace-event-row
  });

  it("no renderer assembles its own pipeline out of the underlying plugins", () => {
    for (const relative of RENDERERS) {
      const source = read(relative);
      // The quotes are the point: a renderer may name a plugin in a comment, not import one.
      for (const plugin of ["remark-gfm", "remark-math", "rehype-katex"]) {
        expect(source, `${relative} imports ${plugin} directly`).not.toContain(`"${plugin}"`);
      }
    }
  });
});

describe("KaTeX fonts ship locally, woff2 only", () => {
  const SRC = `@font-face{font-display:block;font-family:KaTeX_Main;src:url(fonts/KaTeX_Main-Regular.woff2) format("woff2"),url(fonts/KaTeX_Main-Regular.woff) format("woff"),url(fonts/KaTeX_Main-Regular.ttf) format("truetype")}`;

  it("keeps the woff2 source and drops the woff and truetype ones", () => {
    const stripped = dropNonWoff2FontSources(SRC);
    expect(stripped).toContain('url(fonts/KaTeX_Main-Regular.woff2) format("woff2")');
    expect(stripped).not.toContain(".woff)");
    expect(stripped).not.toContain(".ttf)");
    expect(stripped).toContain("font-family:KaTeX_Main");
  });

  it("leaves a stylesheet that has no fallbacks untouched", () => {
    const only = `@font-face{src:url(fonts/A.woff2) format("woff2")}`;
    expect(dropNonWoff2FontSources(only)).toBe(only);
  });
});

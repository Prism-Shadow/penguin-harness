/**
 * Math rendering across the shared Markdown pipeline (src/components/content/prose/
 * markdown-plugins.ts), via react-dom/server static markup — KaTeX renders synchronously, so the
 * finished formula is in the first pass with no DOM and no effects.
 *
 * What is pinned here is the set of decisions that are invisible once they work and silently wrong
 * when they break: which delimiters count, which look like delimiters but must not, what a
 * malformed formula does to the message around it, and what `Md` holds back while a reply
 * streams. That every renderer in the app shares the one plugin list is the Web App's own guard
 * (packages/web/test/markdown-pipeline.test.ts).
 *
 * Single-dollar `$…$` (math-single-dollar.ts) has its own scenarios:
 *
 * - Given the reported reply, its five `$…$` formulas typeset inline and its CJK prose and
 *   punctuation come through untouched.
 * - Given shell variables and prices — `$PATH and $HOME`, `$5-$10`, `PATH=$HOME/bin:$PATH`,
 *   `"$A$B"`, `价格是$5，折扣后$3` — nothing typesets and every dollar sign and space survives.
 * - Given a formula holding Markdown punctuation (`$x*y*z$`, `$\{a\}$`), its TeX is kept whole.
 * - Given `$` in a code span or a code block, or escaped as `\$`, it stays what it is.
 * - Given a malformed `$\frac{$`, the reply keeps rendering and shows the source.
 * - Given a reply streamed in deltas, no frame shows a partial or a wrong formula, shell text
 *   never loses a dollar sign mid-stream, and the last frame holds the formulas a one-shot render
 *   typesets.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import { REHYPE_PLUGINS, REMARK_PLUGINS } from "../src/components/content/prose/markdown-plugins";
import { Md } from "../src/components/content/prose/prose";

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
/** The five entities React escapes in text, back to their characters. */
const unescape = (html: string) =>
  html
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
/**
 * The reader-visible text, tags stripped.
 *
 * KaTeX emits each formula twice: a visually hidden MathML tree (for screen readers, and carrying
 * the original TeX in an `<annotation>`) alongside the styled HTML. Dropping the `<math>` element
 * first is what makes this the text a reader actually sees rather than everything twice over.
 */
const text = (html: string) =>
  unescape(html.replace(/<math\b[\s\S]*?<\/math>/g, "").replace(/<[^>]*>/g, ""));
/** The TeX of every formula KaTeX typeset, in order — KaTeX keeps it in the MathML annotation. */
const typeset = (html: string) =>
  [...html.matchAll(/<annotation encoding="application\/x-tex">([\s\S]*?)<\/annotation>/g)].map(
    (match) => unescape(match[1]!),
  );
/** The TeX of every inline formula a streaming render holds as source, not yet typeset. */
const pending = (html: string) =>
  [...html.matchAll(/<span class="math math-inline">([^<]*)<\/span>/g)].map((match) =>
    unescape(match[1]!),
  );
/** The reader-visible text with each typeset formula replaced by `∎`, so the prose around it shows. */
const proseAround = (html: string) => {
  let out = "";
  let from = 0;
  for (;;) {
    const at = html.indexOf('<span class="katex">', from);
    if (at === -1) return text(out + html.slice(from));
    out += html.slice(from, at) + "∎";
    const tag = /<(\/?)span\b[^>]*>/g;
    tag.lastIndex = at;
    let depth = 0;
    for (let match = tag.exec(html); match !== null; match = tag.exec(html)) {
      depth += match[1] === "/" ? -1 : 1;
      if (depth === 0) break;
    }
    from = tag.lastIndex;
  }
};

/** The reply the single-dollar form was turned on for, as pasted (its `,` was most likely `\,`). */
const REPORTED = String.raw`判分逻辑是「一次运行 = 一个观测」：3 次运行给 3 个总分，然后报告 mean、样本标准差（分母 $n-1=2$，不是 $n$），以及均值标准误 $s/\sqrt{3}$。如果要 95% 置信区间，用 $t_{0.975,2}=4.303$，$\bar T\pm 4.303,s/\sqrt3$。算出来会很长，而这恰好说明 3 次不够用。`;
const REPORTED_FORMULAS = [
  "n-1=2",
  "n",
  String.raw`s/\sqrt{3}`,
  "t_{0.975,2}=4.303",
  String.raw`\bar T\pm 4.303,s/\sqrt3`,
];

/** Shell variables and prices, each with two dollar signs a looser rule would pair up. */
const SHELL_AND_PRICES = [
  "Set $PATH and $HOME before running.",
  "It costs $5 and $10 in total.",
  "The range is $5-$10 per seat.",
  "Use $HOME/.penguin/data or $PENGUIN_HOME.",
  "echo $PATH; echo $HOME",
  "Prices: $1,200 and $3,400.",
  "export PATH=$HOME/bin:$PATH",
  '"$A$B"',
  "价格是$5，折扣后$3",
  "50% off: $20 to $10",
  "Balance: $0. Fee: $3.",
];

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

  it("accepts all four delimiter pairs", () => {
    for (const source of [
      "$E=mc^2$",
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
    expect(isDisplay(render("$x$"))).toBe(false);
    expect(isMath(render("$x$"))).toBe(true);
    // Side by side, each keeps its own mode: `$$` is display, `$` inline.
    const mixed = render("inline $a$ and display $$b$$");
    expect(typeset(mixed)).toEqual(["a", "b"]);
    expect(mixed.match(/class="katex-display"/g)).toHaveLength(1);
  });

  it("makes a $$…$$ pair display wherever it is written, not only on its own lines", () => {
    // remark-math decides by run length, which leaves a one-line `$$…$$` inline: nowrap, typeset
    // cramped, and behaving unlike `\[…\]` for content nobody writes meaning inline. A `$$` pair
    // has been display since plain TeX, and a single `$` is the inline form, so nothing else fits.
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
    // it, so prose.css points that class at the reading face. Without the class there is no hook.
    expect(render(String.raw`\[\text{采集}\]`)).toContain("cjk_fallback");
  });
});

describe("single-dollar inline math", () => {
  it("renders the reported reply as five inline formulas, its CJK prose and punctuation intact", () => {
    const html = render(REPORTED);
    expect(typeset(html)).toEqual(REPORTED_FORMULAS);
    expect(isDisplay(html)).toBe(false);
    expect(html).not.toContain("katex-error");
    expect(proseAround(html)).toBe(
      "判分逻辑是「一次运行 = 一个观测」：3 次运行给 3 个总分，然后报告 mean、样本标准差（分母 ∎，不是 ∎），以及均值标准误 ∎。如果要 95% 置信区间，用 ∎，∎。算出来会很长，而这恰好说明 3 次不够用。",
    );
  });

  it("keeps a formula's TeX whole where Markdown would read emphasis or an escape", () => {
    // Read at the mdast stage these would already be `x<em>y</em>z` and `{a}`.
    for (const formula of ["x*y*z", String.raw`\{a\}`, String.raw`\$5`]) {
      const html = render(`then $${formula}$ holds`);
      expect(typeset(html), formula).toEqual([formula]);
      expect(html, formula).not.toContain("<em>");
    }
  });

  it("closes before a CJK character or punctuation, never before a letter or a digit", () => {
    for (const source of ["$x$.", "($x$)", "设$x$为变量", "$x$，", "**$x$**"]) {
      expect(typeset(render(source)), source).toEqual(["x"]);
    }
    for (const source of ["the $i$th row", "$x$2", "a$x$"]) {
      const html = render(source);
      expect(isMath(html), source).toBe(false);
      expect(text(html), source).toBe(source);
    }
  });

  it("needs a character right inside each delimiter, and stays on one line", () => {
    for (const source of ["$ x$", "$x $", "$x\ny$"]) {
      const html = render(source);
      expect(isMath(html), source).toBe(false);
      expect(text(html), source).toBe(source);
    }
  });

  it("lets the first dollar after an opener decide, never a later one", () => {
    // The `$` before `x` cannot close `$5` (a space precedes it); a scan that kept looking would
    // typeset `5 and $x` instead of leaving the price alone.
    const html = render("It costs $5 and $x$ is the rest.");
    expect(typeset(html)).toEqual(["x"]);
    expect(proseAround(html)).toBe("It costs $5 and ∎ is the rest.");
  });
});

describe("delimiters that are not math", () => {
  it("leaves shell variables and prices alone", () => {
    for (const prose of SHELL_AND_PRICES) {
      const html = render(prose);
      expect(isMath(html), prose).toBe(false);
      // Every dollar sign survives, and so does the wording around it.
      expect(text(html), prose).toBe(prose);
    }
  });

  it("keeps an escaped dollar sign a dollar sign", () => {
    for (const [source, shown] of [
      [String.raw`\$5 and \$10`, "$5 and $10"],
      [String.raw`\$x$ is not a formula`, "$x$ is not a formula"],
    ] as const) {
      const html = render(source);
      expect(isMath(html), source).toBe(false);
      expect(text(html), source).toBe(shown);
    }
  });

  it("never renders math inside inline code", () => {
    for (const source of ["`$x$`", "`$$x$$`", "`\\(x\\)`", "`\\[x\\]`", "`$PATH`"]) {
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
      "Type $a then `b$` to finish.",
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
      "```\n$x$ and $y$\n```",
      "    $x$",
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

  it("renders a malformed single-dollar formula as its own source", () => {
    const html = render(String.raw`before $\frac{$ after`);
    expect(html).toContain("katex-error");
    expect(text(html)).toContain(String.raw`\frac{`);
    expect(text(html)).toContain("before");
    expect(text(html)).toContain("after");
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

describe("Md, the renderer every Markdown surface shares", () => {
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
      ["$E=mc^2$ holds", "E=mc^2 holds"],
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
    // renderer's `pre` override turns into CodeBlock chrome. rehype-katex replaces the <pre>
    // outright before that override is ever consulted, so the two never collide.
    const html = renderMd("$$\n\\frac{a}{b}\n$$");
    expect(isDisplay(html)).toBe(true);
    expect(html).not.toContain("code-block");
  });

  it("streams the reported reply without a partial formula, ending on the ones settled typesets", () => {
    // Every prefix is a frame a paced reveal may show. A formula is on screen only once its closer
    // is decided; one shown is never taken back; the last frame holds what settling typesets.
    let shown: string[] = [];
    for (let length = 1; length <= REPORTED.length; length++) {
      const html = renderMd(REPORTED.slice(0, length), true);
      const formulas = pending(html);
      expect(REPORTED_FORMULAS.slice(0, formulas.length), REPORTED.slice(0, length)).toEqual(
        formulas,
      );
      expect(formulas.length).toBeGreaterThanOrEqual(shown.length);
      shown = formulas;
    }
    expect(shown).toEqual(typeset(renderMd(REPORTED)));
  });

  it("never takes a dollar sign away from shell text while it streams", () => {
    // `export PATH=$HOME/bin:$` pairs up until `P` arrives; typesetting that frame would drop both
    // dollar signs for a moment and put them back on the next.
    for (const prose of SHELL_AND_PRICES) {
      for (let length = 1; length <= prose.length; length++) {
        const frame = prose.slice(0, length);
        const html = renderMd(frame, true);
        expect(pending(html), frame).toEqual([]);
        expect(text(html), frame).toBe(frame.trimEnd());
      }
    }
  });

  it("holds a closing dollar at the edge of a stream, and typesets it once the message settles", () => {
    expect(text(renderMd("Let $x$", true))).toBe("Let $x$");
    expect(pending(renderMd("Let $x$ be", true))).toEqual(["x"]);
    expect(typeset(renderMd("Let $x$"))).toEqual(["x"]);
  });

  it("still routes real fenced code through CodeBlock", () => {
    const html = renderMd("```js\nconst a = 1;\n```");
    expect(html).toContain("code-block");
    expect(isMath(html)).toBe(false);
  });
});

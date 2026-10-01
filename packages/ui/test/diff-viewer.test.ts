/**
 * DiffViewer and its model (diff.ts): the line diff is a shortest edit script, changes group into
 * hunks with their context and `diff -u` headers, paired lines mark the words that changed, a patch
 * is read as given, the split view pairs removed with added lines, and highlighted markup cuts into
 * lines. The component is rendered once, unhighlighted — the highlight lands in an effect, which
 * static markup never runs.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import {
  DIFF_WORD_CLASS,
  MAX_EDIT,
  changedWords,
  diffTexts,
  editScript,
  parsePatch,
  splitHighlightedLines,
  splitLines,
  splitRows,
  wordMarks,
} from "../src/components/content/diff-viewer/diff";
import { DiffViewer } from "../src/components/content/diff-viewer/diff-viewer";
import { classTokens, renderStatic } from "../src/testing";

/** The longest common subsequence's length, by the textbook table: what a shortest script keeps. */
function lcs(a: readonly string[], b: readonly string[]): number {
  const row = new Array<number>(b.length + 1).fill(0);
  for (const x of a) {
    let diagonal = 0;
    for (let j = 1; j <= b.length; j++) {
      const up = row[j]!;
      row[j] = x === b[j - 1] ? diagonal + 1 : Math.max(up, row[j - 1]!);
      diagonal = up;
    }
  }
  return row[b.length]!;
}

/** A deterministic sequence over a small alphabet, so the pairs share a lot and differ a lot. */
function sequence(seed: number, length: number): string[] {
  let state = seed;
  return Array.from({ length }, () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return "abcde"[state % 5]!;
  });
}

describe("the edit script", () => {
  it("rebuilds the new sequence from the old one, keeping a longest common subsequence", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const a = sequence(seed, seed % 13);
      const b = sequence(seed * 7 + 3, (seed * 5) % 11);
      const script = editScript(a, b)!;
      const rebuilt: string[] = [];
      let i = 0;
      let j = 0;
      for (const edit of script) {
        if (edit === "equal") {
          expect(a[i]).toBe(b[j]);
          rebuilt.push(a[i++]!);
          j++;
        } else if (edit === "delete") i++;
        else rebuilt.push(b[j++]!);
      }
      expect(rebuilt, `seed ${seed}`).toEqual(b);
      expect(i).toBe(a.length);
      expect(script.filter((edit) => edit === "equal").length, `seed ${seed}`).toBe(lcs(a, b));
    }
  });

  it("replaces the middle outright past the limit, or gives up when asked to", () => {
    const a = ["head", "x", "y", "tail"];
    const b = ["head", "p", "q", "tail"];
    expect(editScript(a, b, 1)).toEqual(["equal", "delete", "delete", "insert", "insert", "equal"]);
    expect(editScript(a, b, 1, "none")).toBeNull();
    expect(MAX_EDIT).toBeGreaterThan(0);
  });
});

describe("the line diff", () => {
  it("reads lines as a text editor does", () => {
    expect(splitLines("")).toEqual([]);
    expect(splitLines("a\r\nb\n")).toEqual(["a", "b"]);
    expect(splitLines("a\n\n")).toEqual(["a", ""]);
  });

  it("groups a change with its context under a diff -u header", () => {
    const before = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"].join("\n");
    const after = ["1", "2", "3", "4", "five", "6", "7", "8", "9", "10"].join("\n");
    const { hunks } = diffTexts(before, after, 2);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.header).toBe("@@ -3,5 +3,5 @@");
    expect(hunks[0]!.lines.map((line) => `${line.kind}:${line.text}`)).toEqual([
      "context:3",
      "context:4",
      "del:5",
      "add:five",
      "context:6",
      "context:7",
    ]);
    const del = hunks[0]!.lines[2]!;
    expect([del.oldNo, del.newNo]).toEqual([5, null]);
  });

  it("merges changes closer than twice the context, and splits farther ones", () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
    const near = [...lines];
    near[4] = "changed";
    near[9] = "changed";
    expect(diffTexts(lines.join("\n"), near.join("\n"), 3).hunks).toHaveLength(1);
    const far = [...lines];
    far[2] = "changed";
    far[25] = "changed";
    const { hunks } = diffTexts(lines.join("\n"), far.join("\n"), 3);
    expect(hunks.map((hunk) => hunk.header)).toEqual(["@@ -1,6 +1,6 @@", "@@ -23,7 +23,7 @@"]);
  });

  it("has no hunks for identical texts, and names the line an insertion follows", () => {
    expect(diffTexts("a\nb", "a\nb").hunks).toEqual([]);
    expect(diffTexts("", "new\n").hunks[0]!.header).toBe("@@ -0,0 +1,1 @@");
  });

  it("lays the sides out for the highlighter, each line pointing at its own", () => {
    const model = diffTexts("a\nb\nc", "a\nx\nc");
    expect(model.oldSide).toEqual(["a", "b", "c"]);
    expect(model.newSide).toEqual(["a", "x", "c"]);
    const at = model.hunks[0]!.lines.map((line) => `${line.kind}@${line.at}`);
    expect(at).toEqual(["context@0", "del@1", "add@1", "context@2"]);
  });
});

describe("changed words", () => {
  it("marks what changed within a paired line", () => {
    const { removed, added } = changedWords(
      "const total = price * count;",
      "const total = price * quantity;",
    );
    expect(removed).toEqual([[22, 27]]);
    expect(added).toEqual([[22, 30]]);
  });

  it("splits CJK by character, since it has no spaces to split on", () => {
    const { removed, added } = changedWords("保存文件后关闭窗口", "保存文件后打开窗口");
    expect(removed).toEqual([[5, 7]]);
    expect(added).toEqual([[5, 7]]);
  });

  it("marks nothing when the lines share too little to be read as an edit", () => {
    expect(changedWords("alpha beta", "gamma delta")).toEqual({ removed: [], added: [] });
  });

  it("feeds the highlighter one mark per range, on the line's index in its side", () => {
    const model = diffTexts("x = 1;\nkeep\n", "x = 2;\nkeep\n");
    expect(wordMarks(model, "del")).toEqual([
      { line: 0, start: 4, end: 5, className: DIFF_WORD_CLASS },
    ]);
    expect(wordMarks(model, "add")).toEqual([
      { line: 0, start: 4, end: 5, className: DIFF_WORD_CLASS },
    ]);
  });
});

describe("a patch", () => {
  const PATCH = [
    "diff --git a/src/limits.ts b/src/limits.ts",
    "--- a/src/limits.ts",
    "+++ b/src/limits.ts",
    "@@ -1,4 +1,5 @@ export const LIMITS",
    " export const LIMITS = {",
    "-  uploadMb: 10,",
    "+  uploadMb: 14,",
    "+  previewKb: 256,",
    "   retries: 3,",
    " };",
    "\\ No newline at end of file",
    "",
  ].join("\n");

  it("is read hunk by hunk, its header verbatim and its file headers dropped", () => {
    const { hunks, oldSide, newSide } = parsePatch(PATCH);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.header).toBe("@@ -1,4 +1,5 @@ export const LIMITS");
    expect(hunks[0]!.lines.map((line) => [line.kind, line.oldNo, line.newNo])).toEqual([
      ["context", 1, 1],
      ["del", 2, null],
      ["add", null, 2],
      ["add", null, 3],
      ["context", 3, 4],
      ["context", 4, 5],
    ]);
    expect(oldSide).toHaveLength(4);
    expect(newSide).toHaveLength(5);
    expect(hunks[0]!.lines[1]!.words).toEqual([[12, 14]]);
  });

  it("pairs removed and added runs side by side, the shorter padded", () => {
    const rows = splitRows(parsePatch(PATCH).hunks[0]!.lines);
    expect(rows.map((row) => [row.left?.kind ?? null, row.right?.kind ?? null])).toEqual([
      ["context", "context"],
      ["del", "add"],
      [null, "add"],
      ["context", "context"],
      ["context", "context"],
    ]);
  });
});

describe("highlighted markup", () => {
  it("cuts into its lines' inner markup, decorations and all", () => {
    const html =
      '<pre class="shiki" tabindex="0"><code><span class="line"><span style="color:#d73a49">const</span></span>' +
      '<span class="line"><span class="diff-word"><span style="color:#005cc5">x</span></span></span>' +
      '<span class="line"></span></code></pre>';
    expect(splitHighlightedLines(html, 3)).toEqual([
      '<span style="color:#d73a49">const</span>',
      '<span class="diff-word"><span style="color:#005cc5">x</span></span>',
      "",
    ]);
  });

  it("is refused when the line count is not the side's", () => {
    expect(
      splitHighlightedLines('<pre><code><span class="line">a</span></code></pre>', 2),
    ).toBeNull();
    expect(splitHighlightedLines("<pre>no code</pre>", 1)).toBeNull();
  });
});

describe("DiffViewer", () => {
  const BEFORE = "const total = price * count;\nreturn total;\n";
  const AFTER = "const total = price * quantity;\nreturn total;\n";

  it("draws a unified diff: header row, both numbers, signs, and <del> / <ins> lines", () => {
    const html = renderStatic(
      createElement(DiffViewer, { before: BEFORE, after: AFTER, label: "Changes to cart.ts" }),
    );
    expect(html).toContain('aria-label="Changes to cart.ts"');
    expect(html).toMatch(/<td colSpan="4"[^>]*>@@ -1,2 \+1,2 @@<\/td>/i);
    expect(html).toContain(
      `<del>const total = price * <span class="${DIFF_WORD_CLASS}">count</span>;</del>`,
    );
    expect(html).toContain(
      `<ins>const total = price * <span class="${DIFF_WORD_CLASS}">quantity</span>;</ins>`,
    );
    expect(html).toMatch(/<tr data-kind="del" class="bg-\[var\(--ui-diff-del-bg\)\]">/);
    expect(html).toMatch(/<tr data-kind="add" class="bg-\[var\(--ui-diff-add-bg\)\]">/);
    expect(html).toMatch(/<tr data-kind="context"/);
  });

  it("draws the sides next to each other in split mode", () => {
    const html = renderStatic(
      createElement(DiffViewer, { before: "a\nb\n", after: "a\nb\nc\n", mode: "split" }),
    );
    expect(html).toMatch(/<td colSpan="6"/i);
    // The added line has no old counterpart: its left half is one empty cell.
    expect(html).toMatch(/<td colSpan="3" class="bg-surface-muted"><\/td>/i);
    expect(html).toContain("<ins>c</ins>");
  });

  it("reads a patch as given", () => {
    const html = renderStatic(
      createElement(DiffViewer, {
        patch: "@@ -1 +1 @@\n-old\n+new\n",
        language: "text",
      }),
    );
    expect(html).toContain("@@ -1 +1 @@");
    expect(html).toContain("<del>old</del>");
    expect(html).toContain("<ins>new</ins>");
  });

  it("paints from the diff and code tokens alone", () => {
    const tokens = classTokens(
      renderStatic(createElement(DiffViewer, { before: BEFORE, after: AFTER, mode: "split" })),
    );
    expect(tokens).toEqual(
      expect.arrayContaining([
        "code-diff",
        "border-[var(--ui-code-line)]",
        "bg-[var(--ui-diff-hunk-bg)]",
        "bg-[var(--ui-diff-add-bg)]",
        "bg-[var(--ui-diff-del-bg)]",
        "text-[var(--ui-code-gutter)]",
      ]),
    );
    expect(tokens.filter((token) => /gray|dark:|white(?!space)/.test(token))).toEqual([]);
  });
});

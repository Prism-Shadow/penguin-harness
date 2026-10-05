/**
 * features/proposals/proposal-diff.tsx and its model, via react-dom/server static markup (node
 * env, no DOM): the changed-files tree grouped by directory with status and counts, each file
 * folding on its own, unified and split layouts (and the remembered choice), a jump opening the
 * file it goes to, the ignore-whitespace toggle, the notes for a binary, too large or capped file
 * and for GitHub's comparison, totals that are the `+N/−M` sums, and the loading, empty and
 * error-with-retry states.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ProposalImplChangedFile, ProposalImplChanges } from "@prismshadow/penguin-server/api";
import {
  DiffView,
  type ChangesState,
  type DiffViewProps,
} from "../src/features/proposals/proposal-diff";
import {
  DIFF_LAYOUT_KEY,
  OPEN_BY_DEFAULT_MAX,
  groupByDirectory,
  isOpen,
  openFile,
  patchOf,
  readDiffLayout,
  toggleFile,
  totalsOf,
  writeDiffLayout,
} from "../src/features/proposals/proposal-diff-model";
import { scopeOfKey } from "../src/lib/install-scope";
import { S } from "../src/lib/strings";
import { blockedStorage, memoryStorage } from "./helpers/storage";

const file = (
  over: Partial<ProposalImplChangedFile> & { path: string },
): ProposalImplChangedFile => ({
  oldPath: null,
  status: "modified",
  additions: 0,
  deletions: 0,
  binary: false,
  omitted: null,
  hunks: [],
  ...over,
});

const KEEP = file({
  path: "src/keep.ts",
  additions: 1,
  deletions: 1,
  hunks: [
    {
      oldStart: 3,
      oldLines: 2,
      newStart: 3,
      newLines: 2,
      section: "function keep()",
      lines: [
        { kind: "context", text: "const a = 1;" },
        { kind: "del", text: "const b = 2;" },
        { kind: "add", text: "const b = 3;" },
      ],
    },
  ],
});
const FILES: ProposalImplChangedFile[] = [
  KEEP,
  file({ path: "README.md", status: "added", additions: 2, hunks: KEEP.hunks }),
  file({ path: "src/logo.png", status: "added", binary: true }),
  file({ path: "src/big.json", additions: 9000, deletions: 10, omitted: "tooLarge" }),
  file({ path: "docs/late.md", additions: 3, deletions: 0, omitted: "diffLimit" }),
  file({ path: "src/new-name.ts", oldPath: "src/old-name.ts", status: "renamed" }),
  file({ path: "src/gone.ts", status: "deleted", deletions: 4, omitted: "noPatch" }),
];

const changes = (over: Partial<ProposalImplChanges> = {}): ProposalImplChanges => {
  const files = over.files ?? FILES;
  return {
    head: { remote: "origin", repo: "acme/site", branch: "feat" },
    base: { remote: "origin", repo: "acme/site", branch: "main" },
    headSha: "a".repeat(40),
    baseSha: "b".repeat(40),
    mergeBase: "c".repeat(40),
    source: "mirror",
    fallbackReason: null,
    ignoreWhitespace: false,
    files,
    ...totalsOf(files),
    truncated: false,
    limits: { fileBytes: 512 * 1024, diffBytes: 4 * 1024 * 1024 },
    compareUrl: "https://github.com/acme/site/compare/main...feat",
    ...over,
  };
};

const noop = () => {};
const render = (state: ChangesState, over: Partial<DiffViewProps> = {}) =>
  renderToStaticMarkup(
    createElement(DiffView, {
      state,
      layout: "unified",
      ignoreWhitespace: false,
      flipped: new Set<string>(),
      onLayout: noop,
      onIgnoreWhitespace: noop,
      onToggle: noop,
      onJump: noop,
      onRetry: noop,
      ...over,
    }),
  );
const ready = (over: Partial<ProposalImplChanges> = {}): ChangesState => ({
  kind: "ready",
  changes: changes(over),
});
const escape = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

describe("the diff view's model", () => {
  it("groups the files by directory, root first, each group in path order", () => {
    const groups = groupByDirectory(FILES);
    expect(groups.map((g) => g.dir)).toEqual(["", "docs", "src"]);
    expect(groups[2]!.files.map((f) => f.path)).toEqual([
      "src/big.json",
      "src/gone.ts",
      "src/keep.ts",
      "src/logo.png",
      "src/new-name.ts",
    ]);
  });

  it("writes hunks back as the unified patch the shared viewer reads", () => {
    expect(patchOf(KEEP.hunks)).toBe(
      "@@ -3,2 +3,2 @@ function keep()\n const a = 1;\n-const b = 2;\n+const b = 3;",
    );
  });

  it("sums the counts the way +N/−M does", () => {
    expect(totalsOf(FILES)).toEqual({ additions: 9006, deletions: 15 });
  });

  it("remembers the layout per browser, and survives a storage that refuses", () => {
    expect(scopeOfKey(DIFF_LAYOUT_KEY)).toBe("browser");
    const storage = memoryStorage();
    expect(readDiffLayout(storage)).toBe("unified");
    writeDiffLayout(storage, "split");
    expect(storage.getItem(DIFF_LAYOUT_KEY)).toBe("split");
    expect(readDiffLayout(storage)).toBe("split");
    expect(readDiffLayout(memoryStorage({ [DIFF_LAYOUT_KEY]: "sideways" }))).toBe("unified");
    expect(readDiffLayout(blockedStorage())).toBe("unified");
    expect(() => writeDiffLayout(blockedStorage(), "split")).not.toThrow();
    expect(readDiffLayout(null)).toBe("unified");
  });

  it("folds a file on its own, starts a large diff folded, and opens the file a jump goes to", () => {
    const none = new Set<string>();
    expect(isOpen("a", 3, none)).toBe(true);
    const folded = toggleFile(none, "a");
    expect(isOpen("a", 3, folded)).toBe(false);
    expect(isOpen("b", 3, folded)).toBe(true);
    expect(isOpen("a", 3, toggleFile(folded, "a"))).toBe(true);
    // A jump opens a folded file and leaves an open one as it is.
    expect(isOpen("a", 3, openFile(folded, "a", 3))).toBe(true);
    expect(openFile(none, "a", 3)).toBe(none);
    // Past the threshold every file starts folded; a jump still opens its file.
    const many = OPEN_BY_DEFAULT_MAX + 1;
    expect(isOpen("a", many, none)).toBe(false);
    expect(isOpen("a", many, openFile(none, "a", many))).toBe(true);
  });
});

describe("the diff view", () => {
  const t = S.company.proposals.implDiff;

  it("draws the changed-files tree by directory, each file with its status, counts and a jump", () => {
    const html = render(ready());
    expect(html).toContain(`aria-label="${escape(t.files)}"`);
    expect(html).toContain(escape(t.rootDir));
    expect(html).toContain(">docs/<");
    expect(html).toContain(">src/<");
    // Every file is a button in the tree.
    const tree = html.slice(html.indexOf("<nav"), html.indexOf("</nav>"));
    expect(tree.match(/<button type="button"/g)).toHaveLength(FILES.length);
    expect(tree).toContain(`<span class="sr-only">${escape(t.status.renamed)}</span>`);
    expect(tree).toContain(">new-name.ts<");
    expect(tree).toContain(">+9000<");
    expect(tree).toContain(">−10<");
  });

  it("gives totals equal to the +N/−M sums of the same files", () => {
    const html = render(ready());
    const { additions, deletions } = totalsOf(FILES);
    expect(html).toContain(escape(t.totals(FILES.length, additions, deletions)));
    expect(S.company.proposals.impl.summary(FILES.length, additions, deletions, 1, 0)).toContain(
      `+${additions} −${deletions}`,
    );
    expect(html).toContain(`+${additions} −${deletions}`);
  });

  it("draws each open file's hunks unified, or split", () => {
    const unified = render(ready());
    expect(unified).toContain('colSpan="4"');
    expect(unified).not.toContain('colSpan="6"');
    expect(unified).toContain("@@ -3,2 +3,2 @@ function keep()");
    expect(unified).toContain('<del>const b = <span class="diff-word">2</span>;</del>');
    expect(unified).toContain('<ins>const b = <span class="diff-word">3</span>;</ins>');
    const split = render(ready(), { layout: "split" });
    expect(split).toContain('colSpan="6"');
    expect(split).not.toContain('colSpan="4"');
    // The layout control shows the choice.
    expect(split).toMatch(new RegExp(`aria-pressed="true"[^>]*>(<[^>]+>)*${t.split}`));
  });

  it("folds a file on its own: its header says so and its body is hidden and empty", () => {
    const html = render(ready({ files: [KEEP] }), { flipped: new Set([KEEP.path]) });
    expect(html).toContain('aria-expanded="false"');
    expect(html).toMatch(/<div id="impl-diff-file-0-body" hidden="">\s*<\/div>/);
    expect(html).not.toContain("<table");
    const open = render(ready({ files: [KEEP] }));
    expect(open).toContain('aria-expanded="true"');
    expect(open).toContain('<section id="impl-diff-file-0"');
  });

  it("says why a file has no hunks: binary, too large, past the diff cap, no patch, nothing", () => {
    const html = render(ready());
    expect(html).toContain(escape(t.binary));
    expect(html).toContain(escape(t.tooLarge(512)));
    expect(html).toContain(escape(t.diffLimit(4)));
    expect(html).toContain(escape(t.noPatch));
    expect(html).toContain(escape(t.noContent));
    expect(html).toContain(escape(t.renamedFrom("src/old-name.ts")));
  });

  it("says when the diff is GitHub's comparison, and why, and when GitHub cut the list", () => {
    const html = render(
      ready({ source: "github", fallbackReason: "the mirror is not built yet", truncated: true }),
    );
    expect(html).toContain(escape(t.fromGithub("the mirror is not built yet")));
    expect(html).toContain(escape(t.truncated(FILES.length)));
    expect(render(ready())).not.toContain(escape(t.fromGithub("")).slice(0, 10));
  });

  it("shows the ignore-whitespace toggle as it stands", () => {
    expect(render(ready())).toContain(escape(t.ignoreWhitespace));
    const on = render(ready({ files: [] }), { ignoreWhitespace: true });
    expect(on).toMatch(/<input[^>]*type="checkbox"[^>]*checked=""/);
    expect(on).toContain(escape(t.emptyWhitespace));
  });

  it("has a loading, an empty and an error-with-retry state", () => {
    const loading = render({ kind: "loading" });
    expect(loading).toContain('aria-busy="true"');
    expect(loading).toContain(`aria-label="${escape(t.loading)}"`);
    expect(render(ready({ files: [] }))).toContain(escape(t.empty));
    const error = render({ kind: "error", message: "HTTP 502" });
    expect(error).toContain('role="alert"');
    expect(error).toContain(escape(t.loadFailed));
    expect(error).toContain("HTTP 502");
    expect(error).toContain(`>${escape(t.retry)}</button>`);
  });
});

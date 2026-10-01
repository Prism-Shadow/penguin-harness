/**
 * Guard: every Markdown renderer in the Web App and the shared UI package uses the one shared
 * plugin pipeline (the UI package's prose/markdown-plugins.ts). A renderer that quietly dropped it
 * would still render Markdown, so no behaviour test fails; only its math and its URL boundaries go
 * wrong, on one surface. How the pipeline renders is the UI package's own suite
 * (packages/ui/test/prose-math.test.ts). The rule is held over every source file rather than a
 * list of known renderers, so a new renderer is covered the moment it is written.
 *
 * - Every `<ReactMarkdown>` is given both shared plugin lists, taken from the shared module (the
 *   package's own module inside the UI package, the package entry in the Web App).
 * - No source file imports the underlying remark/rehype plugins itself.
 */
import { describe, expect, it } from "vitest";
import { expectEveryRootScanned, scanSources } from "./helpers/roots";

const SCAN = scanSources([".ts", ".tsx"]);
const SHARED_MODULE = "packages/ui/src/components/content/prose/markdown-plugins.ts";

/** Where a renderer in each root takes the lists from. */
const HOME: Record<string, string> = {
  ui: 'from "./markdown-plugins"',
  web: 'from "@prismshadow/penguin-ui"',
};

describe("the Markdown pipeline every renderer shares", () => {
  it("gives every ReactMarkdown both shared plugin lists, from the shared module", () => {
    expectEveryRootScanned(SCAN);
    const renderers = SCAN.files.filter((file) => file.text.includes("<ReactMarkdown"));
    expect(renderers.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const file of renderers) {
      const uses = file.text.split("<ReactMarkdown").length - 1;
      // Matched by the constant each prop names rather than by an exact string: `Md` picks its
      // rehype stage by `streaming`. What is guarded is that the name comes from the shared module.
      for (const [prop, constant] of [
        ["remarkPlugins", "REMARK_PLUGINS"],
        ["rehypePlugins", "REHYPE_PLUGINS"],
      ] as const) {
        const values = [...file.text.matchAll(new RegExp(`${prop}=\\{([^}]*)\\}`, "g"))];
        if (values.length !== uses || values.some(([, value]) => !value!.includes(constant))) {
          offenders.push(`${file.id}: ${prop}`);
        }
      }
      if (!file.text.includes(HOME[file.root]!)) offenders.push(`${file.id}: not the shared lists`);
    }
    expect(offenders).toEqual([]);
  });

  it("leaves the underlying plugins to the shared module", () => {
    // The quotes are the point: a file may name a plugin in a comment, not import one.
    const offenders = SCAN.files
      .filter((file) => file.id !== SHARED_MODULE)
      .filter((file) =>
        ["remark-gfm", "remark-math", "rehype-katex"].some((plugin) =>
          file.text.includes(`from "${plugin}"`),
        ),
      )
      .map((file) => file.id);
    expect(offenders).toEqual([]);
  });
});

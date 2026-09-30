/**
 * Guard: every Markdown renderer in the app uses the one shared plugin pipeline
 * (lib/markdown-plugins.ts). A renderer that quietly dropped it would still render Markdown, so
 * no behaviour test fails; only its math and its URL boundaries go wrong, on one surface. The
 * rule is held over every source file rather than a list of known renderers, so a new renderer
 * is covered the moment it is written.
 *
 * - Every `<ReactMarkdown>` is given both shared plugin lists.
 * - No source file imports the underlying remark/rehype plugins itself.
 */
import { describe, expect, it } from "vitest";
import { expectEveryRootScanned, scanSources } from "./helpers/roots";

const SCAN = scanSources([".ts", ".tsx"]);
const SHARED_MODULE = "packages/web/src/lib/markdown-plugins.ts";

describe("the Markdown pipeline every renderer shares", () => {
  it("gives every ReactMarkdown both shared plugin lists", () => {
    expectEveryRootScanned(SCAN);
    const renderers = SCAN.files.filter((file) => file.text.includes("<ReactMarkdown"));
    expect(renderers.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const file of renderers) {
      const uses = file.text.split("<ReactMarkdown").length - 1;
      for (const [prop, constant] of [
        ["remarkPlugins", "REMARK_PLUGINS"],
        ["rehypePlugins", "REHYPE_PLUGINS"],
      ] as const) {
        const values = [...file.text.matchAll(new RegExp(`${prop}=\\{([^}]*)\\}`, "g"))];
        if (values.length !== uses || values.some(([, value]) => !value!.includes(constant))) {
          offenders.push(`${file.id}: ${prop}`);
        }
      }
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

/**
 * The app's side of the shared Markdown pipeline: every renderer in the Web App and the shared UI
 * package takes the same plugin lists, and KaTeX's fonts ship with the build. How the pipeline
 * renders math is the package's own suite (packages/ui/test/prose-math.test.ts).
 */
import { describe, expect, it } from "vitest";
import { dropNonWoff2FontSources } from "../vite.config.js";
import { expectEveryRootScanned, scanSources } from "./helpers/roots";

const SCAN = scanSources();

describe("the pipeline every renderer shares", () => {
  /**
   * A renderer that quietly dropped the shared list would still render Markdown, so no behavioural
   * test would fail — only its math and its URL boundaries would be wrong, on one surface. Hence a
   * source scan: every `<ReactMarkdown` in either root has to carry both stages.
   */
  const renderers = SCAN.files.filter(
    (file) => file.name.endsWith(".tsx") && file.text.includes("<ReactMarkdown"),
  );

  /**
   * Matched by the constant each prop names rather than by an exact string, because `Md` picks its
   * rehype stage by `streaming`. What is being guarded is that the name comes from the shared
   * module, not the shape of the expression around it.
   */
  const SHARED = { remarkPlugins: "REMARK_PLUGINS", rehypePlugins: "REHYPE_PLUGINS" };

  /** Where each root takes the lists from: the package's own module, or the package. */
  const HOME: Record<string, string> = {
    ui: 'from "./markdown-plugins"',
    web: 'from "@prismshadow/penguin-ui"',
  };

  it("are looked for in every source root", () => {
    expectEveryRootScanned(SCAN);
  });

  it("are the known renderers: Md, a Trace event and a plugin's page", () => {
    // The shared file browser draws its Markdown through `Md`, so it is not one of them.
    expect(renderers.map((file) => file.id).sort()).toEqual([
      "packages/ui/src/components/content/prose/prose.tsx",
      "packages/web/src/features/plugins/plugin-detail-page.tsx",
      "packages/web/src/features/traces/trace-event-row.tsx",
    ]);
  });

  it("every ReactMarkdown is given both shared plugin lists", () => {
    let total = 0;
    for (const file of renderers) {
      const uses = file.text.split("<ReactMarkdown").length - 1;
      total += uses;
      for (const [prop, constant] of Object.entries(SHARED)) {
        const values = [...file.text.matchAll(new RegExp(`${prop}=\\{([^}]*)\\}`, "g"))];
        expect(values.length, `${file.id} ${prop}`).toBe(uses);
        for (const [, value] of values) expect(value, `${file.id} ${prop}`).toContain(constant);
      }
      expect(file.text, file.id).toContain(HOME[file.root]);
    }
    expect(total).toBe(4); // Md, a plugin's page, two in trace-event-row
  });

  it("no renderer assembles its own pipeline out of the underlying plugins", () => {
    for (const file of renderers) {
      // The quotes are the point: a renderer may name a plugin in a comment, not import one.
      for (const plugin of ["remark-gfm", "remark-math", "rehype-katex"]) {
        expect(file.text, `${file.id} imports ${plugin} directly`).not.toContain(`"${plugin}"`);
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

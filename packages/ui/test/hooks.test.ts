/**
 * The closed list of style hooks (K-redesign §1.2, Appendices A and B).
 *
 * A hook is a class a component opts into and each theme's CSS gives meaning to. The list is
 * closed so that no theme grows a costume one class at a time: the W0 drafts had eleven hooks, and
 * five of them (a gradient wash, a column grid, a dot matrix, corner ticks, radius that eases on
 * hover, mono button labels) were decoration with no job. `src/hooks.ts` exports the six that
 * remain, and this suite holds the source to it:
 *
 * - no `ui-*` class in markup, and no `.ui-*` selector in a stylesheet, outside the list — in the
 *   package, the web app and the gallery;
 * - each hook applied only inside the components Appendix B names as its hosts: glass only on
 *   transient layers, the eyebrow only as a group label, the display face only on a page title. A
 *   host is the nearest enclosing PascalCase function, so a stand-in in `screens/` or `modules/`
 *   carries the name of the component it imitates;
 * - the markup the recipes select on: `.ui-live` names its signal in `data-live`, `.ui-display`
 *   sits on a page title (an `h1`, an `[aria-level="1"]`, or a `<Heading level={1}>` — the hook's
 *   own host, which states its level as a prop), `.ui-frame`'s slots are `head`, `body`, `foot`
 *   or `pane`.
 *
 */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HOOKS } from "../src/hooks";
import {
  analyzeFile,
  headingLevel,
  matchesPolicyPath,
  scanSourceRoots,
  unscannedRoots,
} from "../src/testing";
import type { ClassToken, FileAnalysis, SourceFile } from "../src/testing";
import { REPO_ROOT, SRC_DIR, WEB_DIR } from "./helpers/paths";

/** Appendix A. Adding a hook is a catalog change: this list, the host table and every theme. */
const APPENDIX_A = [
  "ui-glass",
  "ui-eyebrow",
  "ui-display",
  "ui-live",
  "ui-frame",
  "ui-underline-nav",
];

/**
 * Appendix B: the components that may apply each hook. "Login brand" is the login screen's
 * composition; the page-level hero states are `PageFrame` and `EmptyState`.
 */
const HOSTS: Readonly<Record<string, readonly string[]>> = {
  "ui-glass": ["FloatingPanel", "Modal", "ComposerCard", "PageHeader", "Tooltip"],
  "ui-eyebrow": ["Text", "GroupHeader", "MenuLabel", "PagedDialog", "Table"],
  "ui-display": ["Heading", "PageFrame", "LoginScreen", "EmptyState"],
  "ui-live": ["Dot", "Spinner", "StreamingCaret", "ActivityIcon"],
  "ui-frame": ["ToolCallCard", "WorkGroup", "CodeBlock", "LogView", "DiffViewer", "DockFrame"],
  "ui-underline-nav": ["Tabs"],
};

/** CSS keywords that start with `ui-` and are not classes. */
const NOT_HOOKS = new Set(["ui-sans-serif", "ui-serif", "ui-monospace", "ui-rounded"]);

const FRAME_SLOTS = new Set(["head", "body", "foot", "pane"]);
const LIVE_SIGNALS = new Set(["dot", "caret", "spinner"]);

/** Not UI: the test machinery spells the patterns the checks look for, and hooks.ts is the list. */
const NOT_UI = ["testing/", "hooks.ts"];

const GALLERY_DIR = join(REPO_ROOT, "packages", "ui-gallery", "src");
const ROOTS = {
  ui: SRC_DIR,
  web: join(WEB_DIR, "src"),
  gallery: GALLERY_DIR,
};
const SCAN = scanSourceRoots(ROOTS, { repoRoot: REPO_ROOT });
const filesOf = (root: string) =>
  SCAN.files.filter((f) => f.root === root && !(root === "ui" && matchesPolicyPath(f.rel, NOT_UI)));

/** Every `ui-*` class token in markup and every `.ui-*` class in a selector, with where it is. */
function hookNames(file: SourceFile): { name: string; line: number }[] {
  const analysis = analyzeFile(file);
  if (analysis.surface === "stylesheet") {
    return analysis.cssRules.flatMap((rule) =>
      [...[...rule.parents, rule.selector].join(" ").matchAll(/\.(ui-[a-z][\w-]*)/g)].map((m) => ({
        name: m[1]!,
        line: rule.line,
      })),
    );
  }
  return analysis.tokens
    .filter((t) => t.utility.startsWith("ui-") && !NOT_HOOKS.has(t.utility))
    .map((t) => ({ name: t.utility, line: t.line }));
}

/**
 * The innermost component a token was written in, or null at module level. A token in a class
 * attribute is answered by the element that carries it, which `analyzeFile` already resolves to
 * the nearest enclosing PascalCase function; the smallest-component sort is left for a token in a
 * loose string, where there is no element to ask.
 */
function componentOf(analysis: FileAnalysis, token: ClassToken): string | null {
  const element = analysis.elements.find((e) => e.classes.includes(token));
  if (element !== undefined) return element.component;
  const owners = analysis.components.filter((c) => c.classes.includes(token));
  owners.sort((a, b) => a.classes.length - b.classes.length);
  return owners[0]?.name ?? null;
}

/** Where an element applies a hook without the markup that hook's recipes select on. */
function recipeProblems(file: SourceFile): string[] {
  return analyzeFile(file).elements.flatMap((element) => {
    const names = new Set(element.classes.map((t) => t.utility));
    const at = `${file.id}:${element.line} <${element.tag}>`;
    const problems: string[] = [];
    const live = element.attributes.get("data-live");
    if (names.has("ui-live") && live !== null && !LIVE_SIGNALS.has(String(live))) {
      problems.push(`${at} .ui-live needs data-live="dot|caret|spinner", has ${String(live)}`);
    }
    // The page title's face: an `h1`, `aria-level="1"`, or `<Heading level={1}>`. Another
    // component's tag is judged where its own markup is written, not at the call site.
    if (names.has("ui-display") && (element.intrinsic || element.tag === "Heading")) {
      const level = headingLevel(element);
      if (level !== 1 && element.attributes.get("aria-level") !== "1") {
        problems.push(
          `${at} .ui-display belongs on an h1, [aria-level="1"] or <Heading level={1}>`,
        );
      }
    }
    if (names.has("ui-frame")) {
      for (const child of element.children) {
        if (child.kind !== "element") continue;
        const slot = child.element.attributes.get("data-slot");
        if (typeof slot === "string" && !FRAME_SLOTS.has(slot)) {
          problems.push(`${at} .ui-frame slot "${slot}" is not head, body, foot or pane`);
        }
      }
    }
    return problems;
  });
}

describe("style hooks", () => {
  const hooks = new Set<string>(HOOKS);

  it("are the six of Appendix A, each with its hosts", () => {
    expect([...HOOKS].sort()).toEqual([...APPENDIX_A].sort());
    expect(Object.keys(HOSTS).sort()).toEqual([...APPENDIX_A].sort());
  });

  it("scans the package and the web app", () => {
    expect(unscannedRoots(SCAN)).toEqual([]);
  });

  for (const root of Object.keys(ROOTS)) {
    it(`are the only ui-* classes and selectors in ${root}`, () => {
      const strays = filesOf(root).flatMap((file) =>
        hookNames(file)
          .filter((found) => !hooks.has(found.name))
          .map((found) => `${file.id}:${found.line} ${found.name}`),
      );
      expect(
        strays,
        "A ui-* class outside src/hooks.ts is a hook no theme has agreed to — the deleted ones " +
          "(wash, grid, grid-dots, ticks, pill-hover, button) were decoration; use tokens instead.",
      ).toEqual([]);
    });
  }

  // Hooks are applied in markup; a .ts module that names one (a catalog entry) is data, not a host.
  const markup = filesOf("ui").filter((f) => f.name.endsWith(".tsx"));
  if (markup.length === 0) {
    const pending = "PENDING: no .tsx under packages/ui/src yet (screens #763, modules #764, W1)";
    it.skip(`are applied by their hosts only — ${pending}`, () => {});
    it.skip(`carry the markup their recipes select on — ${pending}`, () => {});
    return;
  }

  it("are applied by their hosts only (Appendix B)", () => {
    const misplaced = markup.flatMap((file) => {
      const analysis = analyzeFile(file);
      return analysis.tokens
        .filter((t) => hooks.has(t.utility))
        .flatMap((t) => {
          const component = componentOf(analysis, t);
          return component !== null && HOSTS[t.utility]!.includes(component)
            ? []
            : [`${file.id}:${t.line} ${t.utility} in ${component ?? "module scope"}`];
        });
    });
    expect(
      misplaced,
      "Each hook belongs to the components K-redesign Appendix B names (see HOSTS). A stand-in " +
        "takes the name of the component it imitates; anything else uses tokens, not the hook.",
    ).toEqual([]);
  });

  it("carry the markup their recipes select on", () => {
    expect(markup.flatMap(recipeProblems)).toEqual([]);
  });
});

describe("the hook checks, on known shapes", () => {
  const file = (rel: string, text: string): SourceFile => ({
    root: "ui",
    rel,
    id: `packages/ui/src/${rel}`,
    path: `/virtual/${rel}`,
    name: rel.slice(rel.lastIndexOf("/") + 1),
    text,
  });

  it("find hook classes in markup and selectors, and nothing that only looks like one", () => {
    expect(
      hookNames(
        file(
          "a.tsx",
          [
            'const A = () => <div className="ui-wash flex" />;',
            'const font = "ui-monospace, SFMono-Regular";',
            "// a comment naming ui-ticks is not a class",
          ].join("\n"),
        ),
      ).map((f) => f.name),
    ).toEqual(["ui-wash"]);
    expect(
      hookNames(
        file("t.css", "@layer ui-theme {\n  :root .ui-grid.ui-grid-dots { --ui-canvas: #000; }\n}"),
      ).map((f) => f.name),
    ).toEqual(["ui-grid", "ui-grid-dots"]);
  });

  it("name the innermost component a hook is written in", () => {
    const analysis = analyzeFile(
      file(
        "b.tsx",
        [
          "export function Composer() {",
          '  const Card = () => <div className="ui-glass" />;',
          '  return <span className="ui-live" data-live="caret" />;',
          "}",
          'const LOOSE = "ui-frame";',
        ].join("\n"),
      ),
    );
    const named = (hook: string) =>
      componentOf(
        analysis,
        analysis.tokens.find((t) => t.utility === hook)!,
      );
    expect(named("ui-glass")).toBe("Card");
    expect(named("ui-live")).toBe("Composer");
    expect(named("ui-frame")).toBeNull();
  });

  it("name the inner component even when the outer one writes no class of its own", () => {
    const analysis = analyzeFile(
      file(
        "c.tsx",
        [
          "export function Tooltip() {",
          '  const Bubble = () => <div className="ui-glass rounded-md p-2" />;',
          "  return <Bubble />;",
          "}",
        ].join("\n"),
      ),
    );
    expect(
      componentOf(
        analysis,
        analysis.tokens.find((t) => t.utility === "ui-glass")!,
      ),
    ).toBe("Bubble");
  });

  it("judge .ui-display on a Heading's level, not only on intrinsic tags", () => {
    const at = (rel: string, text: string) =>
      recipeProblems(file(rel, text)).map((p) => p.slice(p.indexOf(" ") + 1));
    expect(
      at("d.tsx", 'const A = () => <Heading level={2} className="ui-display">T</Heading>;'),
    ).toEqual(['<Heading> .ui-display belongs on an h1, [aria-level="1"] or <Heading level={1}>']);
    expect(
      at("e.tsx", 'const A = () => <Heading level={1} className="ui-display">T</Heading>;'),
    ).toEqual([]);
    expect(at("f.tsx", 'const A = () => <h1 className="ui-display">T</h1>;')).toEqual([]);
    expect(at("g.tsx", 'const A = () => <div className="ui-display">T</div>;')).toHaveLength(1);
    // A component the check cannot resolve is judged where its own markup is written.
    expect(at("h.tsx", 'const A = () => <PageTitle className="ui-display" />;')).toEqual([]);
    expect(
      headingLevel(analyzeFile(file("i.tsx", "const A = () => <h3>T</h3>;")).elements[0]!),
    ).toBe(3);
  });
});

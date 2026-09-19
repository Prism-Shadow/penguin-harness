/**
 * The closed list of style hooks (K-redesign §1.2, Appendices A and B).
 *
 * A hook is a class a component opts into and each theme's CSS gives meaning to. The list is
 * closed so that no theme grows a costume one class at a time: the W0 drafts had eleven hooks, and
 * five of them (a gradient wash, a column grid, a dot matrix, corner ticks, radius that eases on
 * hover, mono button labels) were decoration with no job. `src/hooks.ts` exports the six that
 * remained plus the seventh added with the theme identities, `ui-shell` — the app window, the one
 * place a theme may lay a colour field (user decision, 2026-09-19) — and this suite holds the
 * source to it:
 *
 * - no `ui-*` class in markup, and no `.ui-*` selector in a stylesheet, outside the list — in the
 *   package, the web app and the gallery;
 * - each hook applied only inside the components Appendix B names as its hosts: glass only on
 *   transient layers, the eyebrow only as a group label, the display face only on a page title,
 *   the shell only on an app-window frame. A host is the nearest enclosing PascalCase function,
 *   so a stand-in in `screens/` or `modules/` carries the name of the component it imitates;
 * - the markup the recipes select on: `.ui-live` names its signal in `data-live`, `.ui-display`
 *   sits on an h1, `.ui-frame`'s slots are `head`, `body`, `foot` or `pane`, `.ui-shell`'s are
 *   `nav`, `main` or `dock`.
 *
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HOOKS } from "../src/hooks";
import { analyzeFile, matchesPolicyPath, scanSourceRoots, unscannedRoots } from "../src/testing";
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
  "ui-shell",
];

/**
 * Appendix B: the components that may apply each hook. "Login brand" is the login screen's
 * composition; the page-level hero states are `PageFrame` and `EmptyState`. The shell's one host
 * in the package is `AppShell` (screens/parts.tsx), the app-window frame the modules' mock window
 * and the chat, traces and settings screens all render through (the login screen has no
 * navigation column); the web app's `AppLayout` takes it when the app adopts the shell.
 */
const HOSTS: Readonly<Record<string, readonly string[]>> = {
  "ui-glass": ["FloatingPanel", "Modal", "ComposerCard", "PageHeader", "Tooltip"],
  "ui-eyebrow": ["Text", "GroupHeader", "MenuLabel", "PagedDialog", "Table"],
  "ui-display": ["Heading", "PageFrame", "LoginScreen", "EmptyState"],
  "ui-live": ["Dot", "Spinner", "StreamingCaret", "ActivityIcon"],
  "ui-frame": ["ToolCallCard", "WorkGroup", "CodeBlock", "LogView", "DiffViewer", "DockFrame"],
  "ui-underline-nav": ["Tabs"],
  "ui-shell": ["AppShell", "AppLayout"],
};

/** CSS keywords that start with `ui-` and are not classes. */
const NOT_HOOKS = new Set(["ui-sans-serif", "ui-serif", "ui-monospace", "ui-rounded"]);

const FRAME_SLOTS = new Set(["head", "body", "foot", "pane"]);
const SHELL_SLOTS = new Set(["nav", "main", "dock"]);
const LIVE_SIGNALS = new Set(["dot", "caret", "spinner"]);

/** Not UI: the test machinery spells the patterns the checks look for, and hooks.ts is the list. */
const NOT_UI = ["testing/", "hooks.ts"];

const GALLERY_DIR = join(REPO_ROOT, "packages", "ui-gallery", "src");
const ROOTS = {
  ui: SRC_DIR,
  web: join(WEB_DIR, "src"),
  ...(existsSync(GALLERY_DIR) ? { gallery: GALLERY_DIR } : {}),
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

/** The innermost component a token was written in, or null at module level. */
function componentOf(analysis: FileAnalysis, token: ClassToken): string | null {
  const owners = analysis.components.filter((c) => c.classes.includes(token));
  owners.sort((a, b) => a.classes.length - b.classes.length);
  return owners[0]?.name ?? null;
}

describe("style hooks", () => {
  const hooks = new Set<string>(HOOKS);

  it("are the seven of Appendix A, each with its hosts", () => {
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
  if (!existsSync(GALLERY_DIR)) {
    it.skip("in the gallery — PENDING: packages/ui-gallery does not exist on this branch (#764)", () => {});
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
    const broken = markup.flatMap((file) =>
      analyzeFile(file).elements.flatMap((element) => {
        const names = new Set(element.classes.map((t) => t.utility));
        const at = `${file.id}:${element.line} <${element.tag}>`;
        const problems: string[] = [];
        const live = element.attributes.get("data-live");
        if (names.has("ui-live") && live !== null && !LIVE_SIGNALS.has(String(live))) {
          problems.push(`${at} .ui-live needs data-live="dot|caret|spinner", has ${String(live)}`);
        }
        const level = element.attributes.get("aria-level");
        if (names.has("ui-display") && element.intrinsic && element.tag !== "h1" && level !== "1") {
          problems.push(`${at} .ui-display belongs on an h1`);
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
        if (names.has("ui-shell")) {
          for (const child of element.children) {
            if (child.kind !== "element") continue;
            const slot = child.element.attributes.get("data-slot");
            if (typeof slot === "string" && !SHELL_SLOTS.has(slot)) {
              problems.push(`${at} .ui-shell slot "${slot}" is not nav, main or dock`);
            }
          }
        }
        return problems;
      }),
    );
    expect(broken).toEqual([]);
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
});

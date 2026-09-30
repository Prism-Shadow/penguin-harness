/**
 * The closed list of style hooks (K-redesign §1.2, Appendices A and B).
 *
 * A hook is a class a component opts into and each theme's CSS gives meaning to. The list is
 * closed so that no theme grows a costume one class at a time: the W0 drafts had eleven hooks, and
 * five of them (a gradient wash, a column grid, a dot matrix, corner ticks, radius that eases on
 * hover, mono button labels) were decoration with no job. `src/hooks.ts` exports the six that
 * remained, the seventh added with the theme identities — `ui-shell`, the app window, the one
 * place a theme may lay a colour field (user decision, 2026-09-19) — the three structure hooks
 * that let the themes differ in organisation rather than in colour alone: `ui-icon-decor` (an icon
 * a theme may recolour or drop), `ui-tree` (rows that nest, which Console joins with connector
 * rules) and `ui-field` (a labelled control row, which Console sets as a table row) — and the
 * eleventh, `ui-activity` (a step of the agent's work: Frost sweeps a highlight across its label,
 * Console renders a transcript; user decision, 2026-09-29), the twelfth and thirteenth,
 * `ui-notice` and `ui-chart` (notices and charts that differ per theme; the same day), the
 * fourteenth, `ui-scrim` (the dimmed backdrop behind a dialog, which Frost blurs; 2026-09-30),
 * and the fifteenth, `ui-stream` (an assistant reply as it arrives: Frost's soft veil, Console's
 * block cursor; the same day). This suite holds the source to it:
 *
 * - no `ui-*` class in markup, and no `.ui-*` selector in a stylesheet, outside the list — in the
 *   package, the web app and the gallery;
 * - each hook applied only inside the components Appendix B names as its hosts: glass only on
 *   transient layers, the eyebrow only as a group label, the display face only on a page title,
 *   the shell only on an app-window frame, the tree only on a nesting list. A host is the nearest
 *   enclosing PascalCase function, so a stand-in in `screens/` or `modules/` carries the name of
 *   the component it imitates. The decorative-icon hook is applied through the icon renderers
 *   (`GlyphIcon`, `Glyph`), which write the class when a call site passes `decor`; the guard
 *   therefore reads `decor` on the call site and holds its enclosing component to the list, so
 *   the renderer being a host loosens nothing;
 * - the markup the recipes select on: `.ui-live` names its signal in `data-live`, `.ui-display`
 *   sits on an h1, `.ui-frame`'s slots are `head`, `body`, `foot` or `pane`, `.ui-shell`'s are
 *   `nav`, `main` or `dock`, `.ui-field`'s are `label`, `control` or `hint`, a tree row's
 *   `data-depth` is a digit 0–8 and its `data-last` is `"true"`, a decorative icon's
 *   `data-role` is one of the four the recipes tint apart, `.ui-activity` names its kind
 *   (`thinking` / `tool`), its state (`running` / `done` / `error`) and its slots (`label`,
 *   `detail`, `progress`), `.ui-notice` its tone (the five) and its slots (`icon`, `title`,
 *   `body`, `actions`), `.ui-stream` its state (`streaming` / `done`) and its one slot
 *   (`caret`), and a chart's parts are the seven the recipes style, wherever a `data-part` is
 *   written.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HOOKS } from "../src/hooks";
import { analyzeFile, matchesPolicyPath, scanSourceRoots, unscannedRoots } from "../src/testing";
import type { ClassToken, FileAnalysis, JsxElementInfo, SourceFile } from "../src/testing";
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
  "ui-icon-decor",
  "ui-tree",
  "ui-field",
  "ui-activity",
  "ui-notice",
  "ui-chart",
  "ui-scrim",
  "ui-stream",
];

/**
 * Appendix B: the components that may apply each hook — the web app's own components, which the
 * gallery frames as they are (the package itself renders none). A component is listed only while
 * it exists: the last test below fails on a host no scanned file declares.
 *
 * Glass is for the layers that float over the page (the composer card, dialogs, menus, popovers,
 * tooltips); the eyebrow and display rungs for the sidebar's list label and the page titles; live
 * marks for the spinner, a pulsing state dot and the machines page's working marks; frames for
 * the transcript's cards, the code block, the page's cards and a table that is its own box; the
 * shell for the app layout; a decorative icon for the rows and headers whose label already says
 * what the icon says (sidebar rows and group headers, a nav row's glyph in a rail, a menu row's
 * glyph, a tab, an empty state) — a session row is not a host, its avatar and marks carry
 * information; a tree for a file tree and a work group's steps; a field for a settings row;
 * activity for the transcript's work in progress (the work group's header, a tool call, the
 * thinking row).
 */
const HOSTS: Readonly<Record<string, readonly string[]>> = {
  "ui-glass": [
    "ChatInput",
    "Modal",
    "Dropdown",
    "Select",
    "OptionMenu",
    "InfoPopover",
    "Tooltip",
    "TooltipLayer",
    "TooltipPanel",
  ],
  // `Text` carries it for its eyebrow role (W5), the one door a group label takes in new code.
  "ui-eyebrow": ["Sidebar", "GroupHeader", "PagedDialog", "Text"],
  // The page titles are `PageHeader`'s; the usage page and the draft view's hero still write
  // their own until their waves (W8, W6).
  "ui-display": ["Heading", "PageHeader", "EmptyState", "UsagePage", "DraftView"],
  "ui-live": ["Spinner", "Dot", "Stepper", "MachineCard", "ProgressBar"],
  // The transcript's cards and the code block, and the page-level boxes (W4): the card and a
  // table that is its own box.
  "ui-frame": ["ToolCallCard", "WorkGroup", "CodeBlock", "Card", "Table"],
  "ui-underline-nav": ["Tabs"],
  "ui-shell": ["AppLayout"],
  "ui-icon-decor": [
    "GlyphIcon",
    "Sidebar",
    "NavRow",
    "SettingsDialog",
    "MenuItemGlyph",
    "MenuItem",
    "GroupHeader",
    "Tabs",
    "EmptyState",
  ],
  "ui-tree": ["FileTree", "WorkGroup"],
  "ui-field": ["Field", "PrefRow", "SettingRow"],
  "ui-activity": ["WorkGroup", "ToolCallCard", "DisclosureRow"],
  // The Web App's notices (2026-09-29): the toast, and the one shared strip every inline notice
  // renders through. The charts: the usage charts' frame (its children — the trend, requests and
  // token-bar charts — carry parts, not the hook), the token donut and the two sparklines.
  "ui-notice": ["Toaster", "NoticeStrip"],
  // The Trace timeline draws its lanes and spans as HTML (`grid` on a lane track, `bar` on a
  // span with a 1-based `data-series`), so the chart recipes carry HTML spellings beside the
  // SVG ones.
  "ui-chart": ["ChartFrame", "TokenDonut", "ScoreSparkline", "ActivitySparkline", "TimelineChart"],
  // The dimmed backdrop (2026-09-30): a sibling behind a sheet or drawer, or the full-viewport
  // overlay a modal, the command palette, the harness overlay and the lightbox sit in.
  "ui-scrim": ["Modal", "Sheet", "Drawer", "CommandPalette", "HarnessHistoryOverlay", "Lightbox"],
  // An assistant reply as it arrives (2026-09-30): the reply body the transcript renders and the
  // gallery frames on its own.
  "ui-stream": ["AssistantReplyBody"],
};

/** CSS keywords that start with `ui-` and are not classes. */
const NOT_HOOKS = new Set(["ui-sans-serif", "ui-serif", "ui-monospace", "ui-rounded"]);

const FRAME_SLOTS = new Set(["head", "body", "foot", "pane"]);
const SHELL_SLOTS = new Set(["nav", "main", "dock"]);
const FIELD_SLOTS = new Set(["label", "control", "hint"]);
const LIVE_SIGNALS = new Set(["dot", "caret", "spinner", "bar"]);
const ICON_ROLES = new Set(["nav", "group", "menu", "empty"]);
const ACTIVITY_KINDS = new Set(["thinking", "tool"]);
const ACTIVITY_STATES = new Set(["running", "done", "error"]);
const ACTIVITY_SLOTS = new Set(["label", "detail", "progress"]);
const NOTICE_TONES = new Set(["info", "success", "warning", "danger", "neutral"]);
const NOTICE_SLOTS = new Set(["icon", "title", "body", "actions"]);
const STREAM_STATES = new Set(["streaming", "done"]);
const STREAM_SLOTS = new Set(["caret"]);
/** A chart's parts, wherever a chart's children are written (a mark component draws into the frame's svg). */
const CHART_PARTS = new Set(["grid", "axis", "series", "area", "bar", "point", "label"]);
/** The icon renderers: a `decor` prop on one of these is the decorative-icon hook applied. */
const ICON_RENDERERS = new Set(["GlyphIcon"]);
/** A tree row's depth: the eight levels the recipes spell out, and the roots. */
const TREE_DEPTH = /^[0-8]$/;

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

/** The literal `data-slot` values of an element's direct children, with the child. */
function childSlots(element: JsxElementInfo): { slot: string; child: JsxElementInfo }[] {
  return element.children.flatMap((child) => {
    if (child.kind !== "element") return [];
    const slot = child.element.attributes.get("data-slot");
    return typeof slot === "string" ? [{ slot, child: child.element }] : [];
  });
}

describe("style hooks", () => {
  const hooks = new Set<string>(HOOKS);

  it("are the fifteen of Appendix A, each with its hosts", () => {
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
  // The web app is where the hosts live now, so its markup is checked alongside the package's.
  const markup = [...filesOf("ui"), ...filesOf("web")].filter((f) => f.name.endsWith(".tsx"));

  it("find markup to check", () => {
    expect(markup.length).toBeGreaterThan(0);
  });

  it("are applied by their hosts only (Appendix B)", () => {
    const misplaced = markup.flatMap((file) => {
      const analysis = analyzeFile(file);
      const byClass = analysis.tokens
        .filter((t) => hooks.has(t.utility))
        .flatMap((t) => {
          const component = componentOf(analysis, t);
          return component !== null && HOSTS[t.utility]!.includes(component)
            ? []
            : [`${file.id}:${t.line} ${t.utility} in ${component ?? "module scope"}`];
        });
      // The icon renderers write `ui-icon-decor` for a call site that passes `decor`, so the
      // call site is where the hook is applied: its enclosing component must be a host.
      const byProp = analysis.elements
        .filter((e) => ICON_RENDERERS.has(e.tag) && e.attributes.has("decor"))
        .flatMap((e) =>
          e.component !== null && HOSTS["ui-icon-decor"]!.includes(e.component)
            ? []
            : [`${file.id}:${e.line} decor on <${e.tag}> in ${e.component ?? "module scope"}`],
        );
      return [...byClass, ...byProp];
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
          problems.push(
            `${at} .ui-live needs data-live="dot|caret|spinner|bar", has ${String(live)}`,
          );
        }
        const level = element.attributes.get("aria-level");
        if (names.has("ui-display") && element.intrinsic && element.tag !== "h1" && level !== "1") {
          problems.push(`${at} .ui-display belongs on an h1`);
        }
        if (names.has("ui-frame")) {
          for (const { slot } of childSlots(element)) {
            if (!FRAME_SLOTS.has(slot)) {
              problems.push(`${at} .ui-frame slot "${slot}" is not head, body, foot or pane`);
            }
          }
        }
        if (names.has("ui-shell")) {
          for (const { slot } of childSlots(element)) {
            if (!SHELL_SLOTS.has(slot)) {
              problems.push(`${at} .ui-shell slot "${slot}" is not nav, main or dock`);
            }
          }
        }
        if (names.has("ui-field")) {
          for (const { slot } of childSlots(element)) {
            if (!FIELD_SLOTS.has(slot)) {
              problems.push(`${at} .ui-field slot "${slot}" is not label, control or hint`);
            }
          }
        }
        const role = element.attributes.get("data-role");
        if (names.has("ui-icon-decor") && typeof role === "string" && !ICON_ROLES.has(role)) {
          problems.push(`${at} .ui-icon-decor data-role="${role}" is not nav|group|menu|empty`);
        }
        // An activity row names its kind and its state as literals the recipes select on; a
        // slot is a literal too, and only the three the recipes style (the slots are found
        // anywhere inside the row, so every literal `data-slot` under it is checked by name).
        if (names.has("ui-activity")) {
          const kind = element.attributes.get("data-kind");
          if (kind !== null && (typeof kind !== "string" || !ACTIVITY_KINDS.has(kind))) {
            problems.push(
              `${at} .ui-activity needs data-kind="thinking|tool", has ${String(kind)}`,
            );
          }
          const state = element.attributes.get("data-state");
          if (state !== null && (typeof state !== "string" || !ACTIVITY_STATES.has(state))) {
            problems.push(
              `${at} .ui-activity needs data-state="running|done|error", has ${String(state)}`,
            );
          }
          for (const { slot } of childSlots(element)) {
            if (!ACTIVITY_SLOTS.has(slot)) {
              problems.push(`${at} .ui-activity slot "${slot}" is not label, detail or progress`);
            }
          }
        }
        // A notice names its tone as a literal the recipes select on, and its slots are the four.
        if (names.has("ui-notice")) {
          const tone = element.attributes.get("data-tone");
          if (tone !== null && (typeof tone !== "string" || !NOTICE_TONES.has(tone))) {
            problems.push(
              `${at} .ui-notice needs data-tone="info|success|warning|danger|neutral", has ${String(tone)}`,
            );
          }
          for (const { slot } of childSlots(element)) {
            if (!NOTICE_SLOTS.has(slot)) {
              problems.push(`${at} .ui-notice slot "${slot}" is not icon, title, body or actions`);
            }
          }
        }
        // A streaming reply names its state, as a literal the recipes select on or an
        // expression; its one direct-child slot is the stream's edge, the caret (Frost's veil
        // stops there, Console's cursor is drawn on it).
        if (names.has("ui-stream")) {
          const state = element.attributes.get("data-state");
          if (state !== null && (typeof state !== "string" || !STREAM_STATES.has(state))) {
            problems.push(
              `${at} .ui-stream needs data-state="streaming|done", has ${String(state)}`,
            );
          }
          for (const { slot } of childSlots(element)) {
            if (!STREAM_SLOTS.has(slot)) {
              problems.push(`${at} .ui-stream slot "${slot}" is not caret`);
            }
          }
        }
        // A chart's parts are written wherever a mark is drawn, inside the frame's svg or by a
        // component that renders into it: every literal `data-part` is one the recipes style.
        const part = element.attributes.get("data-part");
        if (typeof part === "string" && !CHART_PARTS.has(part)) {
          problems.push(`${at} data-part="${part}" is not grid|axis|series|area|bar|point|label`);
        }
        // Tree rows are written by the host, wherever it renders them: every literal depth and
        // last mark in the package must be what the recipes select on.
        const depth = element.attributes.get("data-depth");
        if (typeof depth === "string" && !TREE_DEPTH.test(depth)) {
          problems.push(`${at} data-depth="${depth}" is not a level from 0 to 8`);
        }
        const last = element.attributes.get("data-last");
        if (typeof last === "string" && last !== "true") {
          problems.push(`${at} data-last="${last}" — the last row of a level carries "true"`);
        }
        const branch = element.attributes.get("data-branch");
        if (branch !== undefined && branch !== true && branch !== null && branch !== "true") {
          problems.push(`${at} data-branch="${String(branch)}" — a branch carries the bare flag`);
        }
        if (branch !== undefined && depth === undefined) {
          problems.push(`${at} a branch carries the data-depth of the rows it holds`);
        }
        return problems;
      }),
    );
    expect(broken).toEqual([]);
  });

  it("name only hosts that exist", () => {
    const declared = new Set(
      markup.flatMap((file) => analyzeFile(file).components.map((c) => c.name)),
    );
    const missing = Object.entries(HOSTS).flatMap(([hook, hosts]) =>
      hosts.filter((host) => !declared.has(host)).map((host) => `${hook}: ${host}`),
    );
    expect(missing, "A host no scanned file declares is a stale entry: remove it.").toEqual([]);
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

  it("read a tree's rows and a field's slots as the recipes do", () => {
    const analysis = analyzeFile(
      file(
        "c.tsx",
        [
          "export function TreePane() {",
          "  return (",
          '    <ul className="ui-tree">',
          '      <li data-depth="0">root</li>',
          '      <div data-branch data-depth="1">',
          '        <li data-depth="1" data-last="true">leaf</li>',
          "      </div>",
          "    </ul>",
          "  );",
          "}",
          "export function Field() {",
          "  return (",
          '    <div className="ui-field">',
          '      <span data-slot="label">Name</span>',
          '      <div data-slot="control" />',
          "    </div>",
          "  );",
          "}",
        ].join("\n"),
      ),
    );
    const tree = analysis.elements.find((e) => e.classes.some((t) => t.utility === "ui-tree"))!;
    expect(childSlots(tree)).toEqual([]);
    const rows = analysis.elements.filter((e) => e.attributes.has("data-depth"));
    const marks = rows.map((e) => [e.attributes.get("data-depth"), e.attributes.get("data-last")]);
    expect(marks).toEqual([
      ["0", undefined],
      ["1", undefined],
      ["1", "true"],
    ]);
    expect(rows[1]!.attributes.get("data-branch")).toBe(true);
    const field = analysis.elements.find((e) => e.classes.some((t) => t.utility === "ui-field"))!;
    expect(childSlots(field).map((s) => s.slot)).toEqual(["label", "control"]);
  });

  it("read a stream's state and its caret as the recipes do", () => {
    // The state is usually an expression (the check accepts it and judges only a literal); the
    // caret is a direct child even when it is rendered conditionally.
    const analysis = analyzeFile(
      file(
        "d.tsx",
        [
          "export function AssistantReplyBody({ revealing }: { revealing: boolean }) {",
          "  return (",
          '    <div className="ui-stream" data-state={revealing ? "streaming" : "done"}>',
          "      <p>text</p>",
          '      {revealing && <span data-slot="caret" aria-hidden />}',
          "    </div>",
          "  );",
          "}",
        ].join("\n"),
      ),
    );
    const host = analysis.elements.find((e) => e.classes.some((t) => t.utility === "ui-stream"))!;
    expect(host.attributes.get("data-state")).toBeNull();
    expect(childSlots(host).map((s) => s.slot)).toEqual(["caret"]);
  });
});

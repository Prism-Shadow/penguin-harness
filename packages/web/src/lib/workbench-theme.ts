/**
 * Carrying the app's appearance into a workbench's page.
 *
 * The page is a separate document in a same-origin frame, so `html.dark`, the theme's tokens,
 * the bundled fonts and the root font size the app applies to ITS document reach nothing there.
 * Rather than recompute the theme (two copies of one fact), the app copies what it has already
 * resolved onto the frame's root: the light/dark class, the theme attributes, every token of
 * the UI package's contract (`TOKEN_NAMES`) and the root font size, and into its head the
 * `@font-face` rules of the faces the app bundles. public/workbench-ui.css — injected first in
 * the frame's head, so the page's own rules still win — maps the workbench's stable `--wb-*`
 * names onto those tokens. A page that hardcodes its colours keeps them; a page that writes plain
 * HTML, or uses the `--wb-*` (or `--ui-*`) names, follows the app through a theme, mode, accent
 * or font change.
 *
 * Reading the app's theme is cached per appearance (the root's class, attributes and font size),
 * and a frame that already carries a theme is not stamped with it again, so re-applying on every
 * appearance change and every frame load costs a lookup, not a style resolution.
 */
import {
  DEFAULT_THEME_ID,
  THEME_IDS,
  TOKEN_NAMES,
  resolveAccent,
  type ThemeId,
} from "@prismshadow/penguin-ui";

/** Where the base stylesheet is served from (packages/web/public). */
export const WORKBENCH_THEME_HREF = "/workbench-ui.css";

/** Marks the frame's `<style>` that holds the copied `@font-face` rules. */
export const WORKBENCH_FONTS_ATTR = "data-workbench-fonts";

/**
 * Names copied before the token contract reached the frame, kept because pages may read them:
 * the app's body font stack and Tailwind's gray scale (with the theme's overrides).
 */
const LEGACY_THEME_VARS = [
  "--font-app-sans",
  "--color-gray-50",
  "--color-gray-100",
  "--color-gray-200",
  "--color-gray-300",
  "--color-gray-400",
  "--color-gray-500",
  "--color-gray-600",
  "--color-gray-700",
  "--color-gray-800",
  "--color-gray-900",
  "--color-gray-950",
] as const;

/**
 * Custom properties copied from the app's root to the frame's: the whole token contract plus the
 * legacy names. Every one is read RESOLVED, so light/dark, the theme, the accent and the font
 * pairing are already applied and the frame needs none of that logic.
 */
export const WORKBENCH_THEME_VARS: readonly string[] = [...TOKEN_NAMES, ...LEGACY_THEME_VARS];

/**
 * Root attributes copied to the frame. `data-theme` is always written (the app leaves it off
 * for the stylesheet's fallback theme, which a page has no stylesheet to fall back to);
 * `data-accent` names the preset actually painted and is absent when the theme's own accent
 * shows; `data-font-latin` / `data-font-cjk` are absent when the theme's own faces apply.
 */
export const WORKBENCH_THEME_ATTRS = [
  "data-theme",
  "data-accent",
  "data-font-latin",
  "data-font-cjk",
] as const;
export type WorkbenchThemeAttr = (typeof WORKBENCH_THEME_ATTRS)[number];

export interface WorkbenchTheme {
  dark: boolean;
  /** Root font size the app resolved from the text-size setting (e.g. "16px"). */
  fontSize: string;
  /** The attributes to set, by name; one left out is removed. */
  attrs: Partial<Record<WorkbenchThemeAttr, string>>;
  /** Resolved custom properties, by name. */
  vars: Record<string, string>;
  /** The app's `@font-face` rules, with absolute `url()`s, so the copied font stacks load. */
  fontFaces: string;
}

interface AppRoot {
  classList: { contains(token: string): boolean };
  style: { fontSize: string };
  getAttribute(name: string): string | null;
}

function themeIdOf(root: AppRoot): ThemeId {
  const id = root.getAttribute("data-theme");
  return (THEME_IDS as readonly string[]).includes(id ?? "") ? (id as ThemeId) : DEFAULT_THEME_ID;
}

/**
 * The appearance the app has applied to its own document — read, not recomputed, so a new
 * token, accent or face needs no second definition here.
 */
export function readAppTheme(
  root: AppRoot,
  computed: (property: string) => string,
  fontFaces = "",
): WorkbenchTheme {
  const vars: Record<string, string> = {};
  for (const name of WORKBENCH_THEME_VARS) {
    const value = computed(name).trim();
    if (value !== "") vars[name] = value;
  }
  const themeId = themeIdOf(root);
  const attrs: WorkbenchTheme["attrs"] = { "data-theme": themeId };
  const accent = resolveAccent(themeId, root.getAttribute("data-accent"));
  if (accent !== null) attrs["data-accent"] = accent;
  for (const name of ["data-font-latin", "data-font-cjk"] as const) {
    const value = root.getAttribute(name);
    if (value !== null && value !== "") attrs[name] = value;
  }
  return {
    dark: root.classList.contains("dark"),
    fontSize: root.style.fontSize,
    attrs,
    vars,
    fontFaces,
  };
}

/**
 * What the resolved tokens depend on. Every token value is a function of the root's mode class,
 * its theme attributes and its font size (the theme files key on nothing else), so two reads
 * with one key resolve to the same theme.
 */
function appearanceKey(root: AppRoot): string {
  return [
    root.classList.contains("dark") ? "dark" : "light",
    ...WORKBENCH_THEME_ATTRS.map((name) => root.getAttribute(name) ?? ""),
    root.style.fontSize,
  ].join("|");
}

/** The parts of a `CSSRule` the font collector reads (a structural type, so a test can fake it). */
interface RuleLike {
  readonly type: number;
  readonly cssText: string;
  readonly cssRules?: ArrayLike<RuleLike>;
  readonly styleSheet?: SheetLike | null;
}

/** The parts of a `CSSStyleSheet` the font collector reads. */
interface SheetLike {
  readonly href: string | null;
  readonly cssRules: ArrayLike<RuleLike>;
}

// `CSSRule.type` values. The constants are deprecated in favour of `instanceof`, which the
// node test environment cannot use; the numbers themselves are frozen by the platform.
const STYLE_RULE = 1;
const IMPORT_RULE = 3;
const FONT_FACE_RULE = 5;
const KEYFRAMES_RULE = 7;

/** Rewrites every `url()` in a rule to an absolute URL, resolved against the sheet it came from. */
function absoluteCssUrls(cssText: string, base: string): string {
  return cssText.replace(/url\(\s*(["']?)(.*?)\1\s*\)/g, (whole, _quote: string, raw: string) => {
    try {
      return `url("${new URL(raw, base).href}")`;
    } catch {
      return whole;
    }
  });
}

/**
 * The `@font-face` rules of a document's stylesheets, as CSS text whose `url()`s are absolute:
 * pasted into another document, a relative URL would resolve against that document instead of
 * the stylesheet that declared it. Descends into `@import`ed sheets and grouping rules (`@layer`,
 * `@media`, `@supports`); a sheet whose rules cannot be read (another origin's) is skipped.
 */
export function collectFontFaces(sheets: Iterable<SheetLike>, documentBase: string): string {
  const out: string[] = [];
  const walk = (rules: ArrayLike<RuleLike>, base: string) => {
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i]!;
      if (rule.type === FONT_FACE_RULE) out.push(absoluteCssUrls(rule.cssText, base));
      else if (rule.type === IMPORT_RULE) {
        if (rule.styleSheet) visit(rule.styleSheet);
      } else if (rule.type !== STYLE_RULE && rule.type !== KEYFRAMES_RULE && rule.cssRules) {
        walk(rule.cssRules, base);
      }
    }
  };
  const visit = (sheet: SheetLike) => {
    let rules: ArrayLike<RuleLike>;
    try {
      rules = sheet.cssRules;
    } catch {
      return; // Another origin's sheet: its rules are not ours to read.
    }
    walk(rules, sheet.href ?? documentBase);
  };
  for (const sheet of sheets) visit(sheet);
  return out.join("\n");
}

/**
 * The app's font faces never change while it runs (they are declared in its main stylesheet),
 * so they are collected once per document. An empty result is not kept: the stylesheet may not
 * have been parsed yet.
 */
const fontFacesByDocument = new WeakMap<Document, string>();

function documentFontFaces(doc: Document): string {
  const cached = fontFacesByDocument.get(doc);
  if (cached !== undefined) return cached;
  const faces = collectFontFaces(
    Array.from(doc.styleSheets) as unknown as SheetLike[],
    doc.baseURI,
  );
  if (faces !== "") fontFacesByDocument.set(doc, faces);
  return faces;
}

const themeByDocument = new WeakMap<Document, { key: string; theme: WorkbenchTheme }>();

/**
 * Reads the theme of the document the app itself renders in. The same appearance returns the
 * same object, so the frame can tell an unchanged theme by identity.
 */
export function readDocumentTheme(doc: Document): WorkbenchTheme {
  const root = doc.documentElement;
  const key = appearanceKey(root);
  const cached = themeByDocument.get(doc);
  if (cached?.key === key) return cached.theme;
  const style = doc.defaultView?.getComputedStyle(root);
  const theme = readAppTheme(
    root,
    (property) => style?.getPropertyValue(property) ?? "",
    documentFontFaces(doc),
  );
  // A read before the theme's stylesheet applies resolves nothing; it is not worth keeping.
  if (Object.keys(theme.vars).length > 0) themeByDocument.set(doc, { key, theme });
  return theme;
}

/** The theme each frame document was last stamped with, so a repeat stamps nothing. */
const stampedByDocument = new WeakMap<Document, WorkbenchTheme>();

/**
 * Applies a theme to a workbench page's document. Safe to call on every load and on every
 * appearance change: the stylesheet link and the font rules are created once, the class stamp
 * is explicit in both directions so the app's choice beats the viewer's system preference, and
 * the token copy is skipped when the document already carries this theme.
 */
export function applyWorkbenchTheme(doc: Document, theme: WorkbenchTheme): void {
  const root = doc.documentElement;
  if (!root) return;
  root.classList.toggle("dark", theme.dark);
  root.classList.toggle("light", !theme.dark);
  for (const name of WORKBENCH_THEME_ATTRS) {
    const value = theme.attrs[name];
    if (value === undefined) root.removeAttribute(name);
    else root.setAttribute(name, value);
  }
  root.style.fontSize = theme.fontSize;

  const previous = stampedByDocument.get(doc);
  if (previous !== theme) {
    for (const name of WORKBENCH_THEME_VARS) {
      const value = theme.vars[name];
      if (value === undefined) root.style.removeProperty(name);
      else if (previous?.vars[name] !== value) root.style.setProperty(name, value);
    }
  }

  const head = doc.head;
  if (!head) return;
  if (previous?.fontFaces !== theme.fontFaces && theme.fontFaces !== "") {
    let fonts = head.querySelector(`style[${WORKBENCH_FONTS_ATTR}]`);
    if (fonts === null) {
      fonts = doc.createElement("style");
      fonts.setAttribute(WORKBENCH_FONTS_ATTR, "");
      head.prepend(fonts);
    }
    fonts.textContent = theme.fontFaces;
  }
  // First in the head, so the page's own rules come after it and win.
  if (head.querySelector(`link[href="${WORKBENCH_THEME_HREF}"]`) === null) {
    const link = doc.createElement("link");
    link.rel = "stylesheet";
    link.href = WORKBENCH_THEME_HREF;
    head.prepend(link);
  }
  stampedByDocument.set(doc, theme);
}

/**
 * Themes a frame's document, if it is reachable. A cross-origin document (never the case for
 * a workbench, which the server serves same-origin) or a frame that has not finished loading
 * simply gets nothing.
 */
export function themeWorkbenchFrame(frame: HTMLIFrameElement | null, theme: WorkbenchTheme): void {
  try {
    const doc = frame?.contentDocument;
    if (doc && doc.readyState !== "loading") applyWorkbenchTheme(doc, theme);
  } catch {
    // Not our document to style.
  }
}

/**
 * Sends the frame's own keyboard shortcuts on to the app.
 *
 * A page is a separate document, so a key pressed inside it never reaches the app's own
 * `window` — which is where the command palette listens. Its shortcuts must still work
 * after the reader clicks into the full-page workbench.
 * The frame is same-origin (that is what lets the theme be written into it), so the same
 * listener can be attached to its document and the event re-raised on the app's window.
 *
 * Returns a function that detaches it, and does nothing at all for a frame of another origin.
 */
export function forwardFrameKeys(
  frame: HTMLIFrameElement | null,
  host: Window = window,
): () => void {
  let doc: Document | null = null;
  const onKey = (e: KeyboardEvent) => {
    // Re-raised rather than handled here: whatever the app listens for decides, and a page
    // that has already acted on the key (preventDefault) is left alone.
    if (e.defaultPrevented) return;
    const copy = new KeyboardEvent(e.type, {
      key: e.key,
      code: e.code,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      bubbles: true,
      cancelable: true,
    });
    const ran = host.dispatchEvent(copy);
    if (!ran) e.preventDefault();
  };
  try {
    doc = frame?.contentDocument ?? null;
    doc?.addEventListener("keydown", onKey);
  } catch {
    doc = null; // Not our document to listen to.
  }
  return () => {
    try {
      doc?.removeEventListener("keydown", onKey);
    } catch {
      // The frame is gone; nothing to detach.
    }
  };
}

/**
 * Resolves every contract token in every theme × mode, as the browser computes it — and, on the
 * same footing, each theme's accent presets.
 *
 * The theme files select on `:root[data-theme]`, `:root.dark` and `:root[data-accent]`, so a
 * theme only takes effect on a document root. The probe therefore copies the page's own CSS into a
 * hidden, same-origin blank frame and flips that frame's root through the theme × mode pairs (and
 * the accent presets), reading each token with `getComputedStyle` — synchronous, and nothing on
 * the visible page restyles. A custom property's computed value has its `var()` references
 * substituted, so `--ui-accent-line: var(--ui-accent)` comes back as the colour it points at; an
 * undefined token comes back as the empty string.
 */
import { THEME_IDS, THEME_MODES, TOKEN_NAMES } from "@prismshadow/penguin-ui";
import type { ThemeId, ThemeModeName } from "@prismshadow/penguin-ui";
import { applyThemeAttributes } from "@prismshadow/penguin-ui/boot";
import { accentPresetsOf, THEME_ACCENT } from "./accents";
import type { Rgba } from "./color";

/** Token name → resolved value (`""` when the theme leaves it undefined). */
export type TokenValues = Readonly<Record<string, string>>;
export type TokenMatrix = Readonly<Record<ThemeId, Readonly<Record<ThemeModeName, TokenValues>>>>;

/**
 * Per theme × mode: `neutral` → the theme's own `--ui-accent`, and each listed preset id → the
 * `--ui-accent` it sets, so a swatch can be painted in the preset's own colour.
 */
export type AccentMatrix = Readonly<
  Record<ThemeId, Readonly<Record<ThemeModeName, Readonly<Record<string, string>>>>>
>;

function documentCss(doc: Document): string {
  const chunks: string[] = [];
  for (const sheet of Array.from(doc.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) chunks.push(rule.cssText);
    } catch {
      // A cross-origin sheet hides its rules; the gallery loads none, and none carries tokens.
    }
  }
  return chunks.join("\n");
}

/** Runs `read` against the root of a hidden frame that carries the page's CSS, then removes it. */
function withProbeRoot<T>(read: (root: HTMLElement, win: Window) => T): T {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.style.cssText =
    "position:fixed;width:0;height:0;border:0;visibility:hidden;pointer-events:none";
  document.body.appendChild(frame);
  try {
    const doc = frame.contentDocument;
    const win = frame.contentWindow;
    if (!doc || !win) throw new Error("token probe: the blank frame has no document");
    const style = doc.createElement("style");
    style.textContent = documentCss(document);
    doc.head.appendChild(style);
    return read(doc.documentElement, win);
  } finally {
    frame.remove();
  }
}

/** The root's `data-accent` for a choice: absent for the theme's own accent. */
function setAccent(root: HTMLElement, accent: string): void {
  if (accent === THEME_ACCENT) delete root.dataset.accent;
  else root.dataset.accent = accent;
}

export function probeTokens(): TokenMatrix {
  return withProbeRoot((root, win) => {
    const matrix = {} as Record<ThemeId, Record<ThemeModeName, TokenValues>>;
    for (const themeId of THEME_IDS) {
      matrix[themeId] = {} as Record<ThemeModeName, TokenValues>;
      for (const mode of THEME_MODES) {
        applyThemeAttributes(root, { themeId, dark: mode === "dark" });
        const computed = win.getComputedStyle(root);
        const values: Record<string, string> = {};
        for (const name of TOKEN_NAMES) values[name] = computed.getPropertyValue(name).trim();
        matrix[themeId][mode] = values;
      }
    }
    return matrix;
  });
}

export function probeAccents(): AccentMatrix {
  return withProbeRoot((root, win) => {
    const matrix = {} as Record<ThemeId, Record<ThemeModeName, Record<string, string>>>;
    for (const themeId of THEME_IDS) {
      matrix[themeId] = {} as Record<ThemeModeName, Record<string, string>>;
      for (const mode of THEME_MODES) {
        applyThemeAttributes(root, { themeId, dark: mode === "dark" });
        const values: Record<string, string> = {};
        for (const accent of [THEME_ACCENT, ...accentPresetsOf(themeId)]) {
          setAccent(root, accent);
          values[accent] = win.getComputedStyle(root).getPropertyValue("--ui-accent").trim();
        }
        setAccent(root, THEME_ACCENT);
        matrix[themeId][mode] = values;
      }
    }
    return matrix;
  });
}

let paintCtx: CanvasRenderingContext2D | null | undefined;

/**
 * Paints a CSS colour (optionally over an opaque backdrop) into one canvas pixel and reads it back
 * as 8-bit sRGB — the one way to get numbers out of `color-mix()`, `oklch()` or `color()` without
 * a colour library. Returns null for anything that is not a colour.
 */
export function paintColor(value: string, backdrop?: string): Rgba | null {
  if (value === "") return null;
  if (paintCtx === undefined) {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    paintCtx = canvas.getContext("2d", { willReadFrequently: true });
  }
  const ctx = paintCtx;
  if (!ctx) return null;
  // An invalid assignment leaves fillStyle unchanged; two different sentinels tell it apart from a
  // value that happens to equal one of them.
  const accepted = (sentinel: string) => {
    ctx.fillStyle = sentinel;
    const before = ctx.fillStyle;
    ctx.fillStyle = value;
    return ctx.fillStyle !== before;
  };
  if (!accepted("#010203") && !accepted("#040506")) return null;
  ctx.clearRect(0, 0, 1, 1);
  if (backdrop) {
    ctx.fillStyle = backdrop;
    ctx.fillRect(0, 0, 1, 1);
  }
  ctx.fillStyle = value;
  ctx.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0, a = 0] = ctx.getImageData(0, 0, 1, 1).data;
  return { r, g, b, a: a / 255 };
}

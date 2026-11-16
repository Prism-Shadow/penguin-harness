/**
 * Switching the theme on <html> without a half-styled frame.
 *
 * A built-in pack is in the bundled stylesheet, so switching to one is an attribute write. An
 * imported pack is a stylesheet of its own, `<link rel="stylesheet" data-theme-pack="<id>">` in
 * <head>. Switching to one installs that link first and writes `data-theme` / `data-theme-base`
 * only once it has loaded, so no frame paints the pack's attributes without its rules. Switching
 * away writes the attributes first and drops the old link after the next paint, so no frame
 * paints the old attributes without their rules either. A link the pre-paint script wrote is
 * taken over when it holds a sheet: written during parsing, it blocked the bundle as it blocked
 * the first paint, so by now it has loaded or failed. Without a sheet it failed, and a fresh link
 * is asked for.
 *
 * A link that fails leaves the attributes where they were: the theme on screen before the
 * switch, or the base when the failed pack is the one the page opened in. The failure is
 * reported, so the Appearance page can say so. The stored choice is never touched here.
 *
 * Only the newest switch acts. A link that loads after another switch began is dropped, and
 * a paint's clean-up that another switch overtook is skipped.
 */
import { INITIAL_THEME_ID, type ThemeBase } from "@prismshadow/penguin-ui";
import { applyThemeAttributes } from "@prismshadow/penguin-ui/boot";

/** Marks an imported pack's stylesheet link, valued with the pack's id (the pre-paint script's name). */
export const THEME_PACK_ATTR = "data-theme-pack";

/** The theme to show: its id, what it builds on, and its stylesheet unless it is bundled. */
export interface ThemeTarget {
  readonly id: string;
  readonly base: ThemeBase;
  /** The pack's own stylesheet; null for a built-in pack, which is in the bundled sheet. */
  readonly href: string | null;
}

export interface ThemeSwitchHooks {
  /** The root now shows `target`: its attributes are written and its rules are in. */
  applied(target: ThemeTarget): void;
  /** `id`'s stylesheet did not load; the root shows what it showed before. */
  failed(id: string): void;
  /** Runs `work` once the frame now on screen has painted. Two animation frames by default. */
  afterPaint?(work: () => void): void;
}

export interface ThemeSwitcher {
  show(target: ThemeTarget): void;
}

/** The base, as a target: where a page whose own pack failed falls back to. */
const FALLBACK: ThemeTarget = { id: INITIAL_THEME_ID, base: "modern", href: null };

const twoFrames = (work: () => void): void => {
  requestAnimationFrame(() => requestAnimationFrame(work));
};

export function createThemeSwitcher(doc: Document, hooks: ThemeSwitchHooks): ThemeSwitcher {
  const afterPaint = hooks.afterPaint ?? twoFrames;
  /** Switches so far: only the newest one's link may apply, and only its clean-up runs. */
  let latest = 0;

  const packLinks = (): HTMLLinkElement[] =>
    Array.from(doc.head.querySelectorAll<HTMLLinkElement>(`link[${THEME_PACK_ATTR}]`));

  const write = (target: ThemeTarget): void => {
    applyThemeAttributes(doc.documentElement, { themeId: target.id, themeBase: target.base });
    hooks.applied(target);
  };

  /** After the paint that shows `turn`'s attributes: every pack link but `keep` goes. */
  const dropAfterPaint = (turn: number, keep: HTMLLinkElement | null): void => {
    afterPaint(() => {
      if (turn !== latest) return;
      for (const link of packLinks()) if (link !== keep) link.remove();
    });
  };

  const show = (target: ThemeTarget): void => {
    const turn = ++latest;
    if (target.href === null) {
      write(target);
      dropAfterPaint(turn, null);
      return;
    }
    const current = packLinks().find(
      (link) =>
        link.getAttribute(THEME_PACK_ATTR) === target.id &&
        link.getAttribute("href") === target.href,
    );
    if (current !== undefined && current.sheet !== null) {
      write(target);
      dropAfterPaint(turn, current);
      return;
    }
    const link = doc.createElement("link");
    link.rel = "stylesheet";
    link.setAttribute(THEME_PACK_ATTR, target.id);
    link.setAttribute("href", target.href);
    link.addEventListener(
      "load",
      () => {
        if (turn !== latest) {
          link.remove();
          return;
        }
        write(target);
        dropAfterPaint(turn, link);
      },
      { once: true },
    );
    link.addEventListener(
      "error",
      () => {
        link.remove();
        if (turn !== latest) return;
        // A link the pre-paint script wrote for this pack failed too: it holds nothing.
        current?.remove();
        if (doc.documentElement.getAttribute("data-theme") === target.id) write(FALLBACK);
        hooks.failed(target.id);
      },
      { once: true },
    );
    doc.head.append(link);
  };

  return { show };
}

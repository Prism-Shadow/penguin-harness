/**
 * The hero: the product line, the one display title, a sentence and two buttons, over the app
 * window a reader can use — and that window on its own, for a page that brings its own opening.
 *
 * It lives in the package rather than in the gallery because the landing page reuses it: the
 * gallery's module file (modules/hero.module.tsx) is a thin wrapper, and a page that wants the
 * same opening imports `Hero` (or only the window, `AppWindow`) and sets the theme on its own root.
 *
 * Nothing here branches on the theme. The title carries `.ui-display` through `Heading`, the
 * window is an `AppShell`, and the rest is token utilities, so each theme lays the same markup
 * out its own way.
 */
import { fixturesFor } from "../fixtures";
import type { FixtureLang, Fixtures } from "../fixtures";
import { Button, GlyphIcon, Heading } from "../modules/parts";
import type { ThemeModeName } from "../tokens";
import type { ShellPage } from "./shell";
import { ShellWindow } from "./window";

/** The window's two openings: the app with a Task in it, and the app before a Session exists. */
export const HERO_VARIANTS = ["shell", "empty"] as const;
export type HeroVariant = (typeof HERO_VARIANTS)[number];

/**
 * What a caller sets on the window. Its state is its own; `resetKey` is the way back — a new
 * value remounts the window as it opened, which is what a page's Reset does. A React `key` on the
 * component does the same.
 */
export interface AppWindowProps {
  lang?: FixtureLang;
  mode?: ThemeModeName;
  variant?: HeroVariant;
  /** The page the window opens on; the chat by default. */
  page?: ShellPage;
  resetKey?: string | number;
}

function HeroIntro({ f }: { f: Fixtures }) {
  return (
    <div className="mx-auto grid max-w-2xl grid-cols-[minmax(0,1fr)] justify-items-center gap-4 text-center">
      <p className="text-sm font-(--ui-weight-medium) text-fg-muted">{f.copy.appName}</p>
      <Heading level={1}>{f.hero.title}</Heading>
      <p className="max-w-xl font-sans text-base leading-relaxed text-fg-muted">{f.hero.pitch}</p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button variant="primary" size="lg" leading={<GlyphIcon name="download" size={15} />}>
          {f.hero.primary}
        </Button>
        <Button
          variant="secondary"
          size="lg"
          trailing={<GlyphIcon name="chevronRight" size={14} />}
        >
          {f.hero.secondary}
        </Button>
      </div>
    </div>
  );
}

/**
 * The app window alone, laid out for a 1280 px window and falling to one column at phone width.
 * The sidebar switches pages, sessions open, the sidebar folds to the rail, the composer sends and
 * the scripted reply plays; nothing moves until the reader does.
 */
export function AppWindow({
  lang = "en",
  mode = "light",
  variant = "shell",
  page,
  resetKey,
}: AppWindowProps) {
  return (
    <ShellWindow
      key={resetKey}
      f={fixturesFor(lang)}
      lang={lang}
      mode={mode}
      start={variant === "empty"}
      page={page}
    />
  );
}

/**
 * The whole section: the opening over the window. The section is the container the window
 * measures itself against, so the same composition falls to one column inside the gallery's
 * 390 px frame and on a phone alike.
 */
export function Hero({
  lang = "en",
  mode = "light",
  variant = "shell",
  page,
  resetKey,
}: AppWindowProps) {
  const f = fixturesFor(lang);
  return (
    <section className="@container grid grid-cols-[minmax(0,1fr)] gap-10">
      <HeroIntro f={f} />
      <AppWindow lang={lang} mode={mode} variant={variant} page={page} resetKey={resetKey} />
    </section>
  );
}

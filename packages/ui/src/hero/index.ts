/**
 * The hero — the gallery's opening section and the composition the landing page reuses — and the
 * app window it stands over, which a page can also render on its own. The package exports these
 * and the window's page list; the pieces of the window (hero/window.tsx) stay inside, because what
 * a caller wants is the whole window in the theme it has set.
 */
export { AppWindow, HERO_VARIANTS, Hero } from "./hero";
export type { AppWindowProps, HeroVariant } from "./hero";
export { REPLY_FRAMES, REPLY_SCENE } from "./scene";
export { SHELL_PAGES } from "./shell";
export type { ShellPage } from "./shell";

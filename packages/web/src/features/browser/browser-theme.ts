/**
 * The app's appearance, as a Browser page is offered it.
 *
 * The same resolved tokens a workflow page gets (lib/workflow-theme.ts reads them off the
 * app's own root, so there is one palette), under names of their own: a Browser page is
 * anyone's page, and the app's unprefixed tokens — `--color-gray-*` — are Tailwind's names
 * too, which would repaint a stranger's Tailwind site. A page opts in by writing
 * `var(--penguin-bg)` / `var(--penguin-fg)` (the roles, which follow dark and light) or a
 * step of the scale (`var(--penguin-color-gray-900)`); one that does not is only told dark
 * or light (`color-scheme`), and keeps every colour it declares itself.
 *
 * The page is on another origin, so nothing is applied from here: the theme is posted to the
 * frame, and the bootstrap the proxy put in the page applies it (server browser/bootstrap.ts).
 */
import type { WorkflowTheme } from "../../lib/workflow-theme";

export interface BrowserThemeMessage {
  type: "penguin:browser:theme";
  dark: boolean;
  vars: Record<string, string>;
}

/** `--font-app-sans` is the one token named for the app rather than for what it is. */
function penguinName(name: string): string {
  return name === "--font-app-sans" ? "--penguin-font-sans" : `--penguin-${name.slice(2)}`;
}

/**
 * The roles a page actually writes with, resolved for the scheme in force — the same steps of
 * the gray scale public/workflow-ui.css assigns to `--wf-*`. The raw scale alone is not a
 * theme: `gray-50` is the same near-white in dark mode, so a page painting its background
 * with it would stay light while its text turned light too.
 */
const ROLES: Record<string, { light: string; dark: string }> = {
  "--penguin-bg": { light: "#ffffff", dark: "--color-gray-950" },
  "--penguin-surface": { light: "--color-gray-50", dark: "--color-gray-900" },
  "--penguin-fg": { light: "--color-gray-900", dark: "--color-gray-100" },
  "--penguin-muted": { light: "--color-gray-500", dark: "--color-gray-400" },
  "--penguin-border": { light: "--color-gray-200", dark: "--color-gray-700" },
  "--penguin-hover": { light: "--color-gray-100", dark: "--color-gray-800" },
};

export function browserThemeMessage(theme: WorkflowTheme): BrowserThemeMessage {
  const vars: Record<string, string> = {};
  for (const [name, value] of Object.entries(theme.vars)) vars[penguinName(name)] = value;
  for (const [role, steps] of Object.entries(ROLES)) {
    const step = theme.dark ? steps.dark : steps.light;
    const value = step.startsWith("--") ? theme.vars[step] : step;
    if (value !== undefined) vars[role] = value;
  }
  return { type: "penguin:browser:theme", dark: theme.dark, vars };
}

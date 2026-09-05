/**
 * Carrying the app's appearance into a workflow's page.
 *
 * The page is a separate document in a same-origin frame, so `html.dark`, the accent
 * variables and the root font size the app applies to ITS document reach nothing there.
 * Rather than recompute the palette (two copies of one fact), the app copies the values it
 * has already resolved onto the frame's root, and public/workflow-ui.css — injected first
 * in the frame's head, so the page's own rules still win — is written entirely in terms of
 * them. A page that hardcodes its colours keeps them; a page that writes plain HTML, or
 * uses the `--wf-*` tokens, follows the app into dark mode and through an accent change.
 */

/** Where the base stylesheet is served from (packages/web/public). */
export const WORKFLOW_THEME_HREF = "/workflow-ui.css";

/**
 * Custom properties copied from the app's root to the frame's. The gray scale is Tailwind's
 * (`@theme` in styles.css, with the dark overrides), the accent pair and font stack are the
 * app's own; every one is read RESOLVED, so light/dark and the chosen accent are already
 * applied and the frame needs none of that logic.
 */
export const WORKFLOW_THEME_VARS = [
  "--font-app-sans",
  "--accent-bg",
  "--accent-fg",
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

export interface WorkflowTheme {
  dark: boolean;
  /** Root font size the app resolved from the font-size setting (e.g. "16px"). */
  fontSize: string;
  /** Resolved custom properties, by name. */
  vars: Record<string, string>;
}

interface AppRoot {
  classList: { contains(token: string): boolean };
  style: { fontSize: string };
}

/**
 * The appearance the app has applied to its own document — read, not recomputed, so a new
 * accent or a changed gray needs no second definition here.
 */
export function readAppTheme(root: AppRoot, computed: (property: string) => string): WorkflowTheme {
  const vars: Record<string, string> = {};
  for (const name of WORKFLOW_THEME_VARS) {
    const value = computed(name).trim();
    if (value !== "") vars[name] = value;
  }
  return { dark: root.classList.contains("dark"), fontSize: root.style.fontSize, vars };
}

/** Reads the theme of the document the app itself renders in. */
export function readDocumentTheme(doc: Document): WorkflowTheme {
  const root = doc.documentElement;
  const style = doc.defaultView?.getComputedStyle(root);
  return readAppTheme(root, (property) => style?.getPropertyValue(property) ?? "");
}

/**
 * Applies a theme to a workflow page's document. Safe to call on every load and on every
 * appearance change: the stylesheet link is created once, and the class stamp is explicit in
 * both directions so the app's choice beats the viewer's system preference.
 */
export function applyWorkflowTheme(doc: Document, theme: WorkflowTheme): void {
  const root = doc.documentElement;
  if (!root) return;
  root.classList.toggle("dark", theme.dark);
  root.classList.toggle("light", !theme.dark);
  root.style.fontSize = theme.fontSize;
  for (const [name, value] of Object.entries(theme.vars)) root.style.setProperty(name, value);
  const head = doc.head;
  if (head && head.querySelector(`link[href="${WORKFLOW_THEME_HREF}"]`) === null) {
    const link = doc.createElement("link");
    link.rel = "stylesheet";
    link.href = WORKFLOW_THEME_HREF;
    head.prepend(link);
  }
}

/**
 * Themes a frame's document, if it is reachable. A cross-origin document (never the case for
 * a workflow, which the server serves same-origin) or a frame that has not finished loading
 * simply gets nothing.
 */
export function themeWorkflowFrame(frame: HTMLIFrameElement | null, theme: WorkflowTheme): void {
  try {
    const doc = frame?.contentDocument;
    if (doc && doc.readyState !== "loading") applyWorkflowTheme(doc, theme);
  } catch {
    // Not our document to style.
  }
}

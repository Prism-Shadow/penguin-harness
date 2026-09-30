/**
 * Static render helpers for component tests. The package's suites run in Node with no DOM, the
 * web app's convention: a component is rendered once with `react-dom/server` and the markup is
 * asserted as text. Effects, state transitions and portals are out of reach — keep that logic in
 * pure modules beside the component, where it can be called directly.
 */
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/** The element's initial render as an HTML string. */
export function renderStatic(element: ReactElement): string {
  return renderToStaticMarkup(element);
}

/**
 * Markup with every `class` and `style` attribute removed — what a theme is not allowed to change.
 * Two renders that differ after this differ in structure, text or ARIA, not in styling.
 */
export function markupStructure(html: string): string {
  return html.replace(/\s(?:class|style)="[^"]*"/g, "");
}

/** Every class token on elements in the markup, de-duplicated and sorted. */
export function classTokens(html: string): string[] {
  const tokens = new Set<string>();
  for (const match of html.matchAll(/\sclass="([^"]*)"/g)) {
    for (const token of match[1]!.split(/\s+/)) if (token !== "") tokens.add(token);
  }
  return [...tokens].sort();
}

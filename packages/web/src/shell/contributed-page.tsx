/**
 * Draws a page the server contributed (GET /api/contributions): an `iframe` renderer needs
 * nothing from this build; a `builtin` one names a component, which only the page's owner can
 * supply — the shell carries none, and company mode passes its own (features/company/org-routes.tsx).
 */
import type { ComponentType } from "react";
import { Navigate } from "react-router";
import type { PageEntry } from "./page-table";

export function ContributedPage({
  page,
  builtins = {},
}: {
  page: PageEntry;
  builtins?: Readonly<Record<string, ComponentType>>;
}) {
  if ("iframe" in page.renderer) {
    return (
      <iframe title={page.key} src={page.renderer.iframe.src} className="h-full w-full border-0" />
    );
  }
  const Component = builtins[page.renderer.builtin];
  return Component === undefined ? <Navigate to="/chat" replace /> : <Component />;
}

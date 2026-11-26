/**
 * Draws a page the server contributed (GET /api/contributions) in the iframe it names, the only
 * renderer a contributed page has: it needs nothing from this build.
 */
import type { PageEntry } from "./local-page-table";

export function ContributedPage({ page }: { page: PageEntry }) {
  return (
    <iframe title={page.key} src={page.renderer.iframe.src} className="h-full w-full border-0" />
  );
}

/**
 * A page's own tab title and meta description while it is mounted, in the reader's language.
 * Leaving the page puts back the site's: what the document had before, or — when the app booted
 * on this page, whose static shell already names it — the site's own, which the shell keeps in
 * `data-default` (scripts/route-shell.mjs). Crawlers and link unfurlers never see this: they read
 * the static shell.
 */
import { useEffect } from "react";

export function useDocumentMeta(title: string, description: string): void {
  useEffect(() => {
    const titleTag = document.querySelector("title");
    const meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const site = {
      title: titleTag?.dataset.default ?? document.title,
      description: meta?.dataset.default ?? meta?.content,
    };
    document.title = title;
    if (meta) meta.content = description;
    return () => {
      document.title = site.title;
      if (meta && site.description !== undefined) meta.content = site.description;
    };
  }, [title, description]);
}

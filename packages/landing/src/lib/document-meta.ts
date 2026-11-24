/** Route metadata for client navigation. The static shells carry the same fields for crawlers. */
import { useEffect } from "react";

/** Vite's development index has the template tags, before postbuild adds the Twitter fields. */
function metaTag(key: string): HTMLMetaElement | null {
  const attribute = key.startsWith("og:") ? "property" : "name";
  const existing = document.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`);
  if (existing || !key.startsWith("twitter:")) return existing;
  const source = metaTag(key.replace("twitter:", "og:"));
  if (!source) return null;
  const tag = document.createElement("meta");
  tag.name = key;
  tag.content = source.dataset.default ?? source.content;
  document.head.append(tag);
  return tag;
}

export function useRouteCanonical(pathname: string): void {
  useEffect(() => {
    const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) return;
    const url = new URL(canonical.href);
    url.pathname = import.meta.env.BASE_URL.replace(/\/+$/, "") + pathname.replace(/\/?$/, "/");
    canonical.href = url.href;
    for (const key of ["og:url", "twitter:url"]) {
      const tag = metaTag(key);
      if (tag) tag.content = url.href;
    }
  }, [pathname]);
}

export function useDocumentMeta(
  title: string | undefined,
  description: string | undefined,
  {
    type = "website",
    image = "og-cover.png",
    imageAlt = "PenguinHarness",
  }: {
    type?: "article" | "website";
    image?: string;
    imageAlt?: string;
  } = {},
): void {
  useEffect(() => {
    if (title === undefined || description === undefined) return;
    const siteTitle = document.querySelector("title")?.dataset.default ?? document.title;
    const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    const imageUrl = new URL(import.meta.env.BASE_URL + image, canonical?.href ?? document.URL)
      .href;
    const restore: (() => void)[] = [];
    for (const [key, value] of Object.entries({
      description,
      "og:title": title,
      "twitter:title": title,
      "og:description": description,
      "twitter:description": description,
      "og:type": type,
      "og:image": imageUrl,
      "twitter:image": imageUrl,
      "og:image:alt": imageAlt,
    })) {
      const tag = metaTag(key);
      if (!tag) continue;
      const original = (tag.dataset.default ??= tag.content);
      tag.content = value;
      restore.push(() => {
        tag.content = original;
      });
    }
    document.title = title;
    return () => {
      document.title = siteTitle;
      for (const reset of restore) reset();
    };
  }, [title, description, type, image, imageAlt]);
}

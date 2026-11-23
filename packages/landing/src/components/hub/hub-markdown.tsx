/**
 * A Markdown file from a hub source (a plugin's README, a task's statement) in the sites' prose.
 * The file was written for GitHub, so a relative link or image resolves against the file's folder
 * there (`base`), and every link leaves the site through the usual confirmation. Raw HTML stays
 * text: these files come from other repositories, not from this site's own content.
 *
 * A leading `# Title` is dropped: the page already shows the entry's title above it.
 */
import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import { highlightSiteCode, SITE_REMARK_PLUGINS, SiteMarkdown } from "@prismshadow/penguin-ui/site";
import type { SiteMarkdownComponents } from "@prismshadow/penguin-ui/site";
import { ExternalLink } from "../external-link";

const Base = createContext("");

/** `href` against the file's folder on GitHub; an image gets the file itself, not its page. */
function resolve(href: string | undefined, base: string, image = false): string | undefined {
  if (!href || href.startsWith("#")) return href;
  try {
    const url = new URL(href, base);
    if (image && url.hostname === "github.com" && url.pathname.includes("/tree/")) {
      url.pathname = url.pathname.replace("/tree/", "/blob/");
      url.searchParams.set("raw", "true");
    }
    return url.href;
  } catch {
    return href;
  }
}

function MdLink({ href, children }: { href?: string; children?: ReactNode }) {
  const base = useContext(Base);
  const target = resolve(href, base);
  if (!target || target.startsWith("#")) return <a href={target}>{children}</a>;
  return <ExternalLink href={target}>{children}</ExternalLink>;
}

function MdImage({ src, alt }: { src?: string | Blob; alt?: string }) {
  const base = useContext(Base);
  return (
    <img
      src={typeof src === "string" ? resolve(src, base, true) : undefined}
      alt={alt ?? ""}
      loading="lazy"
    />
  );
}

const COMPONENTS: SiteMarkdownComponents = { a: MdLink, img: MdImage };

export function HubMarkdown({ base, children }: { base: string; children: string }) {
  const body = children.replace(/^\s*#\s+[^\n]*\n/, "");
  return (
    <Base.Provider value={base}>
      <SiteMarkdown
        variant="doc"
        remarkPlugins={SITE_REMARK_PLUGINS}
        components={COMPONENTS}
        highlight={highlightSiteCode}
      >
        {body}
      </SiteMarkdown>
    </Base.Provider>
  );
}

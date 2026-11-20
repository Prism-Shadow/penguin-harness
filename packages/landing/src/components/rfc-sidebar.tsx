/**
 * The RFC surface's left rail: the index, then every RFC in number order — the docs' sidebar
 * shape, over the RFC directory's documents. Each entry links the language version the site is
 * reading in; the active entry is the page being read.
 */
import { Link, useLocation } from "react-router";
import { SiteSidebarNav, useSiteLocale } from "@prismshadow/penguin-ui/site";
import type { SiteLinkProps } from "@prismshadow/penguin-ui/site";
import { rfcEntries } from "../lib/rfcs";
import { S } from "../lib/strings";

function routeLink({ href, ...props }: SiteLinkProps) {
  return <Link to={href} {...props} />;
}

export function RfcSidebar() {
  const { pathname } = useLocation();
  const { locale } = useSiteLocale();
  const activeId = pathname
    .replace(/^\/rfcs\/?/, "")
    .replace(/\/$/, "");
  return (
    <SiteSidebarNav
      label={S.rfcs.indexLabel}
      sections={[
        {
          id: "rfcs",
          title: S.rfcs.title,
          items: [
            { id: "index", href: "/rfcs", label: S.rfcs.indexLabel, active: pathname === "/rfcs" },
            ...rfcEntries
              .filter((entry) => entry.status !== "drafting" && (locale === "zh" ? entry.zh : entry.en))
              .map((entry) => ({
                id: entry.id,
                href: locale === "zh" ? entry.zh!.href : entry.en!.href,
                label: `${entry.number} ${locale === "zh" ? (entry.titleZh ?? entry.title) : entry.title}`,
                active: activeId === entry.id || activeId === `${entry.id}.zh`,
              })),
          ],
        },
      ]}
      renderLink={routeLink}
    />
  );
}

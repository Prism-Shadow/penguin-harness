/** The landing page's footer columns in the shared site footer. */
import { Link } from "react-router";
import { SiteFooter, useSiteLocale } from "@prismshadow/penguin-ui/site";
import type { SiteLinkProps } from "@prismshadow/penguin-ui/site";
import { S } from "../lib/strings";
import { DOCS_URL, galleryUrl, LICENSE_URL, RELEASES_URL, REPO_URL } from "../lib/links";

function routeLink({ href, ...props }: SiteLinkProps) {
  return <Link to={href} {...props} />;
}

export function Footer() {
  const { locale } = useSiteLocale();
  return (
    <SiteFooter
      brand={{
        name: S.siteName,
        logo: `${import.meta.env.BASE_URL}penguin-logo.svg`,
        tagline: S.footer.tagline,
      }}
      columns={[
        {
          title: S.footer.product,
          links: [
            { id: "cases", href: "/#cases", label: S.footer.cases, render: routeLink },
            {
              id: "quickstart",
              href: "/#quickstart",
              label: S.footer.quickstart,
              render: routeLink,
            },
            { id: "blog", href: "/blog", label: S.footer.blog, render: routeLink },
            { id: "download", href: "/download", label: S.nav.download, render: routeLink },
            { id: "amsp", href: "/amsp", label: S.nav.amsp, render: routeLink },
          ],
        },
        {
          title: S.footer.resources,
          links: [
            { id: "repo", href: REPO_URL, label: S.footer.repo, external: true },
            { id: "docs", href: DOCS_URL, label: S.footer.docs },
            { id: "gallery", href: galleryUrl(locale), label: S.nav.gallery },
            { id: "releases", href: RELEASES_URL, label: S.footer.releases, external: true },
            { id: "license", href: LICENSE_URL, label: S.footer.license, external: true },
          ],
        },
      ]}
      copyright={S.footer.copyright}
    />
  );
}

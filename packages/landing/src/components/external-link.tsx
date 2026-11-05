/**
 * Links that leave the site ask first: the shared confirmation, with this site's words. A link
 * outside an `ExternalLinkScope` is an ordinary new-tab link.
 */
import type { ReactNode } from "react";
import { SiteExternalLink, SiteExternalLinkScope } from "@prismshadow/penguin-ui/site";
import { S } from "../lib/strings";

export const ExternalLink = SiteExternalLink;

export function ExternalLinkScope({ children }: { children: ReactNode }) {
  return <SiteExternalLinkScope labels={S.hero.externalLink}>{children}</SiteExternalLinkScope>;
}

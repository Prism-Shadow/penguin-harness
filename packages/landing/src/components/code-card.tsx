/** The shared terminal-style code card, with this site's copy labels. */
import { SiteCodeCard } from "@prismshadow/penguin-ui/site";
import { S } from "../lib/strings";

export function CodeCard(props: { code: string; label?: string; className?: string }) {
  return <SiteCodeCard {...props} copy={{ label: S.copy.copy, announcement: S.copy.copied }} />;
}

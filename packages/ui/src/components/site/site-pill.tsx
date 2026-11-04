/**
 * A small labelled pill for public-site metadata (a blog post's category, its pinned mark). The
 * tone is an identity, not a status: the host maps its categories onto these. The tones are
 * site-content.css's.
 */
import type { ReactNode } from "react";

export type SitePillTone = "brand" | "brand-outline" | "teal" | "neutral";

export function SitePill({ tone, children }: { tone: SitePillTone; children: ReactNode }) {
  return (
    <span className="site-pill" data-tone={tone}>
      {children}
    </span>
  );
}

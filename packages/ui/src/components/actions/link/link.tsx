/**
 * A text link, in the theme's link colour. Two placements:
 *
 * - `inline` — inside running text. Underlined at rest, because a link among words must not be
 *   told apart by its colour alone.
 * - `standalone` — on its own in a row or a header ("Get API key", "View releases"). Its place
 *   already says it is a link, so the underline waits for hover.
 *
 * `external` opens the page in a new tab, isolated from this one (`noopener noreferrer`: the page
 * gets no handle back to the app's window and no referrer), and draws the external-link glyph after
 * the text — the one visible sign that a click leaves the app. The glyph is decorative; the text,
 * or the caller's `aria-label` on a link whose text is hidden, carries the name.
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { ICON_SIZE } from "../../../icon-scale";
import { GlyphIcon } from "../../icons/glyph-icon/glyph-icon";
import { ICONS } from "../../icons/icons";

export type LinkVariant = "inline" | "standalone";

const VARIANT: Record<LinkVariant, string> = {
  inline: "underline underline-offset-2",
  standalone: "inline-flex items-center gap-1 underline-offset-2 hover:underline",
};

export interface LinkProps extends Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  "href" | "target" | "rel"
> {
  href: string;
  /** Opens in a new tab, isolated from the app, with the external-link glyph after the text. */
  external?: boolean;
  variant?: LinkVariant;
  children?: ReactNode;
}

export function Link({
  href,
  external = false,
  variant = "inline",
  className = "",
  children,
  ...rest
}: LinkProps) {
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className={`text-link transition-colors duration-150 hover:text-link-hover ${VARIANT[variant]} ${className}`}
      {...rest}
    >
      {children}
      {external &&
        (variant === "inline" ? (
          // Inside a sentence the anchor stays inline so its text can wrap; the glyph rides on
          // the last line in a box of its own, nudged onto the text's middle.
          <span className="ml-0.5 inline-block align-middle">
            <GlyphIcon d={ICONS.externalLink} size={ICON_SIZE.inlineGlyph} />
          </span>
        ) : (
          <GlyphIcon d={ICONS.externalLink} size={ICON_SIZE.inlineGlyph} />
        ))}
    </a>
  );
}

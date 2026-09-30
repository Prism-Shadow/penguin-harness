/**
 * A ruled section: a titled run of content on a page, separated from the one above by a rule
 * under its title rather than drawn as a box, so a page of sections reads as one column instead
 * of a grid of cards.
 *
 * The title names the items below it, so it is a group label — the eyebrow role
 * (`Text variant="eyebrow"`) inside the section's heading element, which keeps the outline — with
 * an optional count, the "?" that says what the section means, and trailing controls on the
 * other end of the rule.
 */
import type { ReactNode } from "react";
import { ICON_GAP } from "../../../icon-scale";
import { Text } from "../../content/typography/typography";
import { Count } from "../../feedback/badge/badge";
import { InfoPopover } from "../../overlays/info-popover/info-popover";

export interface RuledSectionProps {
  title: ReactNode;
  /** What the section means, disclosed by a "?" beside the title. */
  info?: ReactNode;
  /** How many items the body holds, after the title; omit it for a section that is not a list. */
  count?: number;
  /** Controls at the other end of the rule. */
  actions?: ReactNode;
  /** The heading's outline level: 2 on a page (the default), 3 inside a dialog or a card. */
  level?: 2 | 3;
  /** Layout on the section: the space above it, a grid placement. */
  className?: string;
  children?: ReactNode;
}

export function RuledSection({
  title,
  info,
  count,
  actions,
  level = 2,
  className = "",
  children,
}: RuledSectionProps) {
  const Title = level === 3 ? "h3" : "h2";
  return (
    <section className={`min-w-0 ${className}`}>
      <div className="mb-3 flex items-center justify-between gap-2 border-b border-line pb-2">
        <Title className={`flex min-w-0 items-center ${ICON_GAP.row}`}>
          <Text variant="eyebrow" as="span">
            {title}
          </Text>
          {count !== undefined && <Count n={count} />}
          {info !== undefined && (
            <InfoPopover label={typeof title === "string" ? title : undefined}>{info}</InfoPopover>
          )}
        </Title>
        {actions !== undefined && (
          <div className="flex shrink-0 items-center gap-1.5">{actions}</div>
        )}
      </div>
      {children}
    </section>
  );
}

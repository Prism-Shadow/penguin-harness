/**
 * The label pill: one shape for every short label that sits on a row beside a name — a state
 * ("Running", "Stopped"), a kind or a fact ("this server", "v0.2.16", "vision", "CLI"), a
 * restriction ("hidden from the Agent under test", "Beta") — differing only by tone: `neutral` for
 * a kind or a fact, a state's own tone for a state. It is the package's `Badge` at its small size
 * in its soft weight, with no way to pick another: two labels side by side never differ in
 * height, padding, radius, type or border, only in colour, which carries what they mean. Words
 * only, no glyph: the word is the label. A sentence behind the word (what a state means, why a
 * thing is hidden) rides on the `tooltip`, a marked hint that shows over the word.
 */
import type { ReactNode } from "react";
import type { ToneName } from "../../../tokens";
import { Badge } from "../badge/badge";

export interface PillProps {
  /** What the label means; `neutral` (the default) for a kind or a fact. */
  tone?: ToneName;
  /** What the word cannot say, on hover. */
  tooltip?: string;
  children: ReactNode;
}

export function Pill({ tone = "neutral", tooltip, children }: PillProps) {
  return (
    <Badge tone={tone} variant="soft" size="sm" {...(tooltip !== undefined ? { tooltip } : {})}>
      {children}
    </Badge>
  );
}

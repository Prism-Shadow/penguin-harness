/**
 * Which registry glyph each of these pages' navigation rows wears: cross-page jump actions
 * name a destination page by its glyph, and the drawings live in the shared registry, named
 * for what they draw. Only the pages these surfaces name are mapped.
 */
import { ICONS } from "@prismshadow/penguin-ui";

export const NAV_ICONS = {
  /** The organization's overview. */
  orgOverview: ICONS.dashboard,
  /** The ticket board. */
  orgTickets: ICONS.kanban,
  /** Proposals: a change written up, waiting to be approved. */
  orgProposals: ICONS.file,
  /** Roadmaps: where a discussion leads, and the proposals on the way. */
  orgRoadmaps: ICONS.gitBranch,
} as const;

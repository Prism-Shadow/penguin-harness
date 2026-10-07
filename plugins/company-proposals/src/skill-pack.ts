/**
 * The skill employees work proposals and roadmaps with, and the skills it replaced.
 *
 * `agent-company-proposals` ships one skill, `penguin-proposal`, with a section per role. It
 * replaced three (`proposal-author`, `proposal-implementer`, `proposal-tester`); a whole-plugin
 * reinstall writes the new skill but leaves those on an employee that carried them, so the
 * plugin's own install (ProposalService.ensureSkills) removes them by name.
 */

/** The one skill of the skills plugin, named in the hint a refused write carries (skill-hint.ts). */
export const PROPOSAL_SKILL = "penguin-proposal";

/**
 * The skills `penguin-proposal` replaced, removed wherever the skills plugin is installed or
 * brought up to date.
 * TODO(retired-proposal-skills): kept so employees hired before the merge into one skill lose
 * the old copies; remove once every organization's employees have been through an install of
 * agent-company-proposals 2026.10.07.1 or later (one release cycle after it ships).
 */
export const RETIRED_SKILLS: readonly string[] = [
  "proposal-author",
  "proposal-implementer",
  "proposal-tester",
];

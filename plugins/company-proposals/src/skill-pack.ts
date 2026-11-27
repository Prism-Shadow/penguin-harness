/**
 * The skill employees work proposals and roadmaps with.
 *
 * `agent-company-proposals` ships one skill, `penguin-proposal`, with a section per role; the
 * plugin's own install (ProposalService.ensureSkills) writes it wherever it is missing or
 * outdated.
 */

/** The one skill of the skills plugin, named in the hint a refused write carries (skill-hint.ts). */
export const PROPOSAL_SKILL = "penguin-proposal";

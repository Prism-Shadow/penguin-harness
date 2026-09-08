/**
 * The example missions offered under the create-organization dialog's mission field: three
 * companies that are worth starting, in the order they are shown. Only the ids live here —
 * the name and the mission of each are copy, and copy lives in the two dictionaries
 * (`S.company.missionExamples[id]`), the way the draft screen's example tasks do.
 *
 * Clicking one fills the mission (it replaces what is there — the click asks for THIS
 * mission) and the display name only while that field is still empty, so an example never
 * overwrites a name someone typed. The id is left alone: it is generated from the name.
 */
export const ORG_EXAMPLES = [
  { id: "research" },
  { id: "agentTuning" },
  { id: "cloudReseller" },
] as const;

export type OrgExampleId = (typeof ORG_EXAMPLES)[number]["id"];

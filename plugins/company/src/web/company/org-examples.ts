/**
 * The example companies offered as cards on the empty company landing: four that are worth
 * starting, in the order they are shown — three that produce work of their own, and one that
 * mirrors a real company into digital twins. Only the ids live here — the name, the one-line
 * summary and the mission of each are copy, and copy lives in the two dictionaries
 * (`S.company.missionExamples[id]`), the way the draft screen's example tasks do.
 *
 * A card shows the name and the summary, because a full mission runs to a paragraph and four
 * of them filled the landing with text. Clicking one opens the create-organization dialog
 * with the name and the whole mission filled in over whatever the saved draft held: the click
 * asks for THIS company. The id is left alone; it is generated from the name.
 */
export const ORG_EXAMPLES = [
  { id: "research" },
  { id: "agentTuning" },
  { id: "cloudReseller" },
  { id: "mirror" },
] as const;

export type OrgExampleId = (typeof ORG_EXAMPLES)[number]["id"];

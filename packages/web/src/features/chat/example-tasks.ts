/**
 * The start page's example cards, filed into collapsible folders in display order.
 *
 * Folders are what lets the showcase grow past a flat list: exactly ONE folder is open at a
 * time (bookmark-style — opening one closes the other), so the block's height is one row per
 * folder plus the open folder's own rows, never the whole catalog. Adding an example means
 * appending it to the folder it belongs to, not lengthening the page.
 *
 * Keep the folders within one row of each other (3–4 examples each today): the start page
 * reserves no scroll area for this block, and the open folder's rows stand beside the folder
 * rows, within their height — a folder much longer than its siblings is what would outgrow that
 * column, or, on a phone, make the block's height jump as folders are switched. The start page
 * appends one more folder that this registry does not describe — the user's own saved
 * shortcuts, whose length is theirs and not ours; it is exempt from the rule by capping how many
 * shortcuts it holds, not by scrolling (shortcuts-folder.tsx).
 *
 * Copy and prompts live in the active locale dictionary at `S.chat.exampleFolders[id]` and
 * `S.chat.exampleTasks[id]`, which is also where the rule for how long a prompt may get is
 * stated. Skills listed here are preselected in the composer only when the selected Agent has
 * them installed; an empty list fills the prompt alone.
 *
 * The first folder is the one open on arrival: building an AI app from one sentence.
 */
export const EXAMPLE_FOLDERS = [
  {
    id: "apps",
    tasks: [
      { id: "ragDocsExpert", skills: ["agent-initialization", "penguin-plugin", "web-design"] },
      { id: "investmentCopilot", skills: ["agent-initialization", "penguin-plugin", "web-design"] },
      { id: "legalDesk", skills: ["agent-initialization", "penguin-plugin", "web-design"] },
    ],
  },
  {
    id: "webapps",
    tasks: [
      { id: "game", skills: ["web-design"] },
      { id: "gamecenter", skills: ["web-design"] },
      { id: "lol", skills: ["web-design"] },
      { id: "rhythmRunner", skills: ["web-design"] },
    ],
  },
  {
    id: "evolve",
    tasks: [
      { id: "agentBenchmarkBuild", skills: [] },
      { id: "agentOptimization", skills: [] },
      { id: "benchmarkImport", skills: ["benchmark-design"] },
    ],
  },
  {
    id: "schedules",
    tasks: [
      { id: "dailyPlan", skills: [] },
      { id: "githubDigest", skills: [] },
      { id: "memoryReview", skills: [] },
    ],
  },
] as const;

export type ExampleFolder = (typeof EXAMPLE_FOLDERS)[number];
export type ExampleFolderId = ExampleFolder["id"];
export type ExampleTask = ExampleFolder["tasks"][number];
export type ExampleTaskId = ExampleTask["id"];

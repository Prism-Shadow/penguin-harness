/**
 * Draft-screen example cards, filed into collapsible folders in display order.
 *
 * Folders are what lets the showcase grow past a flat list: collapsed — the default — the
 * whole block is one row per folder, and an open folder scrolls inside a capped height rather
 * than pushing the draft's input card up the viewport. Adding an example means appending it to
 * the folder it belongs to, not lengthening the page.
 *
 * Copy and full prompts live in the active locale dictionary at `S.chat.exampleFolders[id]`
 * and `S.chat.exampleTasks[id]`. Skills listed here are pinned only when the selected Agent has
 * them installed; an empty list sends the prompt unchanged.
 */
export const EXAMPLE_FOLDERS = [
  {
    id: "games",
    tasks: [
      { id: "game", skills: ["web-design"] },
      { id: "gamecenter", skills: ["web-design"] },
    ],
  },
  { id: "webapps", tasks: [{ id: "lol", skills: ["web-design"] }] },
  { id: "knowledge", tasks: [{ id: "rag", skills: ["penguin-sdk", "web-design"] }] },
  {
    id: "agents",
    tasks: [
      { id: "agentBenchmarkBuild", skills: [] },
      { id: "agentOptimization", skills: [] },
    ],
  },
] as const;

export type ExampleFolder = (typeof EXAMPLE_FOLDERS)[number];
export type ExampleFolderId = ExampleFolder["id"];
export type ExampleTask = ExampleFolder["tasks"][number];
export type ExampleTaskId = ExampleTask["id"];

/**
 * Flat view of every example across folders, in display order. The folders drive the UI; this
 * is for whole-catalog work that doesn't care which folder an example sits in — looking one up
 * by id, or asserting across all of them.
 */
export const EXAMPLE_TASKS: readonly ExampleTask[] = EXAMPLE_FOLDERS.flatMap((folder) => [
  ...folder.tasks,
]);

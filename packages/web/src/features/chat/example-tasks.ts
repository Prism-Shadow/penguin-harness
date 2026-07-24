/**
 * Draft-screen example cards in display order.
 *
 * Copy and full prompts live in the active locale dictionary at
 * `S.chat.exampleTasks[id]`. Skills listed here are pinned only when the
 * selected Agent has them installed; an empty list sends the prompt unchanged.
 */
export const EXAMPLE_TASKS = [
  { id: "game", skills: ["web-design"] },
  { id: "lol", skills: ["web-design"] },
  { id: "rag", skills: ["penguin-sdk", "web-design"] },
  { id: "tuning", skills: [] },
] as const;

export type ExampleTask = (typeof EXAMPLE_TASKS)[number];
export type ExampleTaskId = ExampleTask["id"];

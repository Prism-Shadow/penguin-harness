/** Built-in start-page prompts. Each selects only Skills installed on the current Agent. */
export const EXAMPLE_TASKS = [
  { id: "buildApp", skills: ["penguin-plugin", "web-design"] },
  { id: "optimizeApp", skills: ["penguin-plugin", "web-design"] },
  { id: "publishApp", skills: ["penguin-plugin", "web-design"] },
] as const;

export type ExampleTask = (typeof EXAMPLE_TASKS)[number];
export type ExampleTaskId = ExampleTask["id"];

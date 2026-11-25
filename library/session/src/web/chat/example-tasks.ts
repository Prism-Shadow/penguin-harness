/** Built-in start-page prompts. Each selects only Skills installed on the current Agent. */
export const EXAMPLE_TASKS = [
  { id: "ragDocsExpert", skills: ["agent-initialization", "penguin-plugin", "web-design"] },
  { id: "investmentCopilot", skills: ["agent-initialization", "penguin-plugin", "web-design"] },
  { id: "legalDesk", skills: ["agent-initialization", "penguin-plugin", "web-design"] },
  { id: "game", skills: ["web-design"] },
  { id: "gamecenter", skills: ["web-design"] },
  { id: "lol", skills: ["web-design"] },
  { id: "rhythmRunner", skills: ["web-design"] },
  { id: "agentBenchmarkBuild", skills: [] },
  { id: "agentOptimization", skills: [] },
  { id: "benchmarkImport", skills: ["benchmark-design"] },
  { id: "dailyPlan", skills: [] },
  { id: "githubDigest", skills: [] },
  { id: "memoryReview", skills: [] },
] as const;

export type ExampleTask = (typeof EXAMPLE_TASKS)[number];
export type ExampleTaskId = ExampleTask["id"];

/** Deal a fresh row without replacing any of the prompts the viewer just saw. */
export function pickExamples(previous: readonly ExampleTask[] = []): ExampleTask[] {
  const remaining = EXAMPLE_TASKS.filter((task) => !previous.includes(task));
  const row: ExampleTask[] = [];
  while (row.length < 3 && remaining.length) {
    const index = Math.floor(Math.random() * remaining.length);
    row.push(remaining.splice(index, 1)[0]!);
  }
  return row;
}

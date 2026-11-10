/**
 * The demo Agent and Benchmark the "build" example creates and the "optimize" example then
 * improves (the start page's example cards, features/chat/example-tasks.ts). Both prompts, in
 * both dictionaries, read their ids from here, so the second always names what the first made.
 */
export const EVOLUTION_DEMO = {
  agentId: "finite_choice_agent",
  benchmarkId: "contextual-choice-adaptation",
} as const;

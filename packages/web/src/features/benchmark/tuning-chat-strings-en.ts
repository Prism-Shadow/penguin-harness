import type { tuningChatZh } from "./tuning-chat-strings";

export const tuningChatEn: typeof tuningChatZh = {
  reproduce: "Reproduce Benchmark",
  chooseMethod: "Choose an RSI method in chat",
  reproducePrompt: (targetAgentId: string): string =>
    "Use the `benchmark-reproduction` Skill to reproduce an existing benchmark in this Project.\n\n" +
    `- test_agent_id: \`${targetAgentId}\` (for smoke testing)\n\n` +
    "If I have not named a benchmark, list the Skill directory's identifiers, full paper titles, arXiv and GitHub links, ask which to reproduce and wait for my answer. Reuse an explicit choice. " +
    "If no recipe matches, ask whether to use the generic reproduction workflow for the same benchmark and wait for agreement. Then follow the selected reference, construct and smoke-test the benchmark, and ask before a full evaluation. " +
    "Record source links, source revisions and loaded reference paths, versions and hashes in reproduction.yaml; leave unavailable information unset.",
  optimizePrompt: (targetAgentId: string, benchmarkId: string): string =>
    "Use the `agent-optimization` Skill to improve the Test Agent against its frozen training Benchmark.\n\n" +
    `- test_agent_id: \`${targetAgentId}\`\n` +
    `- benchmark_id: \`${benchmarkId}\` (the Project's \`benchmarks/${benchmarkId}/\`)\n\n` +
    "If I have not selected an RSI method, list the Skill directory's method identifiers, full paper titles, arXiv and GitHub links, ask me to reply with an identifier and wait for my answer. Reuse an explicit choice; even the default option needs my selection. " +
    "Do not initialize, evaluate or train before selection. Then read that method's reference and resolve its mode, parameters, budget and baseline requirements; carry the same method into initialization. " +
    "Record the method, parameters, source links and loaded reference paths, versions and hashes in experiment.yaml; link each result to the experiment and State version. Leave unavailable information unset.",
};

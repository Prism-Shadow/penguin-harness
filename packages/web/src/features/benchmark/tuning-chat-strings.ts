export const tuningChatZh = {
  reproduce: "复现 Benchmark",
  chooseMethod: "在对话中选择 RSI 方法",
  reproducePrompt: (targetAgentId: string): string =>
    "请使用 `benchmark-reproduction` Skill，在当前 Project 中复现已有 benchmark。\n\n" +
    `- test_agent_id：\`${targetAgentId}\`（用于冒烟测试）\n\n` +
    "如果我尚未指定 benchmark，请列出技能目录中的标识、论文完整标题、arXiv 和 GitHub 链接，询问我想复现哪一个并等待回答。已有选择就沿用。" +
    "没有匹配配方时，先询问是否对同一个 benchmark 使用通用复现流程，得到同意后再做。选择后按对应 reference 构造并冒烟测试，再询问是否全量评估。" +
    "在 reproduction.yaml 中保存来源链接、源码版本和实际读取的 reference 路径、版本及哈希；缺失信息留空。",
  optimizePrompt: (targetAgentId: string, benchmarkId: string): string =>
    "请使用 `agent-optimization` Skill，针对已冻结的训练 Benchmark 优化被测智能体。\n\n" +
    `- test_agent_id：\`${targetAgentId}\`\n` +
    `- benchmark_id：\`${benchmarkId}\`（Project 的 \`benchmarks/${benchmarkId}/\`）\n\n` +
    "如果我尚未指定 RSI 方法，请列出技能目录中的方法标识、论文完整标题、arXiv 和 GitHub 链接，让我回复标识并等待回答。已有选择就沿用；默认选项也需要我选择。" +
    "选择前不初始化、不评估、不训练。选定后读取该方法的 reference，再确定它要求的模式、参数、预算和基线；初始化沿用同一个方法。" +
    "在 experiment.yaml 中保存方法、参数、来源链接和实际读取的 reference 路径、版本及哈希，并在结果中关联实验和 State 版本。缺失信息留空。",
};

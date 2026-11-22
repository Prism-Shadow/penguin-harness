/** Category manifest entry: id and titles (Chinese optional, displayed per UI language). */
export interface PluginCategory {
  id: string;
  title: string;
  titleZh?: string;
}

/**
 * Category manifest, in display order. Categories group by audience, not by technology: a
 * hook-only plugin sits with the skills it serves the same audience as (goal mode and
 * continual learning are office productivity, and so is company mode). `rsi` (agent
 * self-evolution) comes first and holds exactly the RSI toolkits — the default loop and one
 * plugin per algorithm — so its members are the self-evolution algorithms this build ships.
 * `learning-life` is for what a person learns or makes for themselves rather than for work (study
 * cards, a language tutor, crafts). The last one, `sandbox`, is where the server modules that
 * confine every Agent command sit — the sandbox backends, whose index rows name it
 * (`categories: ["sandbox"]`). A server older than a category lists its plugins under Other.
 * Docs: /docs/skills § "Built-in library".
 */
export const PLUGIN_CATEGORIES: PluginCategory[] = [
  { id: "rsi", title: "Agent Self-Evolution", titleZh: "Agent 自进化" },
  { id: "office-productivity", title: "Office Productivity", titleZh: "办公效率" },
  { id: "software-development", title: "Software Development", titleZh: "软件开发" },
  { id: "ai-app-development", title: "AI App Development", titleZh: "AI 应用开发" },
  { id: "learning-life", title: "Learning & Life", titleZh: "学习与生活" },
  { id: "utilities", title: "Utilities", titleZh: "实用工具" },
  { id: "entertainment", title: "Entertainment", titleZh: "娱乐" },
  { id: "sandbox", title: "Agent Sandbox", titleZh: "Agent 运行沙箱" },
];

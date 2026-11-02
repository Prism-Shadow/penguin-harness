/**
 * What the hero's three catalogue rows list, and where each entry links: the model providers
 * (their homepages), the self-evolution toolkits (the plugins of the library's `rsi` category,
 * each algorithm linked to its paper) and the benchmarks the built-in Benchmarks are drawn from
 * (each linked to its repository). Toolkit labels are names, the same in every language; a
 * benchmark is shown by its kind, which lives in the dictionaries, index-aligned with BENCHMARKS.
 *
 * test/rsi-stats.test.ts pins RSI_TOOLKITS to the library's `rsi` plugins and BENCHMARKS to
 * the shipped Benchmark packages' upstream links, so neither list can ship behind its
 * source.
 */
import type { ModelProvider } from "../components/icons";

/** In the order the hero draws the logos; `name` is the brand's own casing (link label). */
export const MODEL_PROVIDERS = [
  { id: "openai", name: "OpenAI", href: "https://openai.com" },
  { id: "anthropic", name: "Anthropic", href: "https://www.anthropic.com" },
  { id: "gemini", name: "Gemini", href: "https://deepmind.google/models/gemini/" },
  { id: "deepseek", name: "DeepSeek", href: "https://www.deepseek.com" },
  { id: "zai", name: "Z.ai", href: "https://z.ai" },
  { id: "moonshot", name: "Moonshot", href: "https://www.moonshot.cn" },
  { id: "qwen", name: "Qwen", href: "https://qwen.ai" },
  { id: "openrouter", name: "OpenRouter", href: "https://openrouter.ai" },
] as const satisfies ReadonlyArray<{ id: ModelProvider; name: string; href: string }>;

/**
 * The Default toolkit is this project's own loop and has no paper, so it is named without a
 * link (`href` null); every other toolkit links to its paper.
 */
export const RSI_TOOLKITS = [
  { plugin: "default-rsi-toolkit", label: "Default", href: null },
  { plugin: "opro-rsi-toolkit", label: "OPRO", href: "https://arxiv.org/abs/2309.03409" },
  { plugin: "ape-rsi-toolkit", label: "APE", href: "https://arxiv.org/abs/2211.01910" },
  { plugin: "ace-rsi-toolkit", label: "ACE", href: "https://arxiv.org/abs/2510.04618" },
  { plugin: "awm-rsi-toolkit", label: "AWM", href: "https://arxiv.org/abs/2409.07429" },
  { plugin: "skilladam-rsi-toolkit", label: "SkillAdam", href: "https://arxiv.org/abs/2609.08944" },
  { plugin: "skillopt-rsi-toolkit", label: "SkillOpt", href: "https://arxiv.org/abs/2605.23904" },
  { plugin: "openskill-rsi-toolkit", label: "OpenSkill", href: "https://arxiv.org/abs/2606.06741" },
  { plugin: "trace-rsi-toolkit", label: "TRACE", href: "https://arxiv.org/abs/2608.22793" },
] as const satisfies ReadonlyArray<{ plugin: string; label: string; href: string | null }>;

/**
 * One entry per upstream benchmark, in display order. GDPEVO Essential's six scenarios
 * share one upstream and one entry; package ids are owned by the Benchmark repository.
 */
export const BENCHMARKS = [
  {
    href: "https://github.com/Prism-Shadow/rag-bench-essential",
  },
  {
    href: "https://github.com/datacurve-ai/deep-swe",
  },
  {
    href: "https://github.com/zapier/AutomationBench",
  },
  {
    href: "https://github.com/harbor-framework/terminal-bench-science",
  },
  {
    href: "https://github.com/harbor-framework/terminal-bench",
  },
  {
    href: "https://github.com/Prism-Shadow/GDPevo",
  },
] as const;

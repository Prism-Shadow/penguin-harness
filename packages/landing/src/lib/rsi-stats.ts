/**
 * What the hero's three catalogue rows list, and where each entry links: the model providers
 * (their homepages), the self-evolution toolkits (the plugins of the library's `rsi` category,
 * each algorithm linked to its paper) and the benchmarks the built-in Benchmarks are drawn from
 * (each linked to its repository). Toolkit labels are names, the same in every language; a
 * benchmark is shown by its kind, which lives in the dictionaries, index-aligned with BENCHMARKS.
 *
 * test/rsi-stats.test.ts pins RSI_TOOLKITS to the library's `rsi` plugins and BENCHMARKS to
 * core's built-in Benchmarks, ids and upstream links alike, so neither list can ship behind its
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
] as const satisfies ReadonlyArray<{ plugin: string; label: string; href: string | null }>;

/**
 * One entry per benchmark the built-ins are drawn from, in core's order, with the ids of the
 * built-ins drawn from it: GDPEVO's six domains share one upstream and one entry.
 */
export const BENCHMARKS = [
  {
    ids: ["penguinharness-benchmark-sec-a"],
    href: "https://github.com/Prism-Shadow/rag-bench-essential",
  },
  {
    ids: ["penguinharness-benchmark-sec-b"],
    href: "https://github.com/datacurve-ai/deep-swe",
  },
  {
    ids: ["penguinharness-benchmark-sec-c"],
    href: "https://github.com/zapier/AutomationBench",
  },
  {
    ids: ["penguinharness-benchmark-sec-d"],
    href: "https://github.com/harbor-framework/terminal-bench-science",
  },
  {
    ids: ["penguinharness-benchmark-sec-e"],
    href: "https://github.com/harbor-framework/terminal-bench",
  },
  {
    ids: [
      "penguinharness-benchmark-gdpevo-crm-train",
      "penguinharness-benchmark-gdpevo-crm-test",
      "penguinharness-benchmark-gdpevo-erp-train",
      "penguinharness-benchmark-gdpevo-erp-test",
      "penguinharness-benchmark-gdpevo-finance-train",
      "penguinharness-benchmark-gdpevo-finance-test",
      "penguinharness-benchmark-gdpevo-healthcare-train",
      "penguinharness-benchmark-gdpevo-healthcare-test",
      "penguinharness-benchmark-gdpevo-legal-train",
      "penguinharness-benchmark-gdpevo-legal-test",
      "penguinharness-benchmark-gdpevo-data-analysis-train",
      "penguinharness-benchmark-gdpevo-data-analysis-test",
    ],
    href: "https://github.com/Prism-Shadow/GDPevo",
  },
] as const;

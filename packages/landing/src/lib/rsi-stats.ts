/**
 * What the hero's three catalogue rows list, and where each entry links: the model providers
 * (their homepages), the self-evolution toolkits (the plugins of the library's `rsi` category, each
 * linked to its paper, the Default toolkit to the docs) and the built-in Benchmark reproductions
 * (each linked to the repository of the benchmark it reproduces). Labels are names, the same in
 * every language; the Benchmark kinds shown beside them live in the dictionaries, index-aligned
 * with BENCHMARK_REPRODUCTIONS.
 *
 * test/rsi-stats.test.ts pins RSI_TOOLKITS to the library's `rsi` plugins and
 * BENCHMARK_REPRODUCTIONS to core's built-in Benchmarks, ids and upstream links alike, so neither
 * list can ship behind its source.
 */
import type { ModelProvider } from "../components/icons";
import { DOCS_URL } from "./links";

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
 * The Default toolkit is this project's own loop, so it links into the docs on this site and
 * opens without the external-link confirmation; every other toolkit links to its paper.
 */
export const RSI_TOOLKITS = [
  {
    plugin: "default-rsi-toolkit",
    label: "Default",
    href: `${DOCS_URL}self-improvement`,
    external: false,
  },
  {
    plugin: "opro-rsi-toolkit",
    label: "OPRO",
    href: "https://arxiv.org/abs/2309.03409",
    external: true,
  },
  {
    plugin: "ape-rsi-toolkit",
    label: "APE",
    href: "https://arxiv.org/abs/2211.01910",
    external: true,
  },
  {
    plugin: "ace-rsi-toolkit",
    label: "ACE",
    href: "https://arxiv.org/abs/2510.04618",
    external: true,
  },
  {
    plugin: "awm-rsi-toolkit",
    label: "AWM",
    href: "https://arxiv.org/abs/2409.07429",
    external: true,
  },
] as const;

export const BENCHMARK_REPRODUCTIONS = [
  {
    id: "penguinharness-benchmark-sec-a",
    label: "Sec A",
    href: "https://github.com/Prism-Shadow/rag-bench-essential",
  },
  {
    id: "penguinharness-benchmark-sec-b",
    label: "Sec B",
    href: "https://github.com/datacurve-ai/deep-swe",
  },
  {
    id: "penguinharness-benchmark-sec-c",
    label: "Sec C",
    href: "https://github.com/zapier/AutomationBench",
  },
  {
    id: "penguinharness-benchmark-sec-d",
    label: "Sec D",
    href: "https://github.com/harbor-framework/terminal-bench-science",
  },
  {
    id: "penguinharness-benchmark-sec-e",
    label: "Sec E",
    href: "https://github.com/harbor-framework/terminal-bench",
  },
] as const;

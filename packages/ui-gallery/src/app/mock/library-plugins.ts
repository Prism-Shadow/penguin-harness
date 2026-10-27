/**
 * The library plugins the demo's self-evolution story stands on, read from the packages the
 * product ships (`plugins/<name>/package.json` and `icon.svg`): the RSI toolkits, which make up
 * the library's `rsi` category, and the Agent Evaluation plugin they measure through. A card and
 * its detail say what the real plugin says, in both languages, and the start page counts the
 * toolkits from this list as the app counts them from the server's.
 *
 * Each Skill's metadata is spelled here (its SKILL.md's name, description and version): the
 * SKILL.md bodies are too large to bundle into every frame for one line each.
 * test/library-plugins.test.ts holds the toolkits, and every plugin's Skills, to the plugins
 * directory and core's category manifest.
 */
import type { PluginItem, SkillMetadataItem } from "@prismshadow/penguin-server/api";
import aceIcon from "../../../../../plugins/ace-rsi-toolkit/icon.svg?raw";
import acePkg from "../../../../../plugins/ace-rsi-toolkit/package.json";
import evaluationIcon from "../../../../../plugins/agent-evaluation/icon.svg?raw";
import evaluationPkg from "../../../../../plugins/agent-evaluation/package.json";
import apeIcon from "../../../../../plugins/ape-rsi-toolkit/icon.svg?raw";
import apePkg from "../../../../../plugins/ape-rsi-toolkit/package.json";
import awmIcon from "../../../../../plugins/awm-rsi-toolkit/icon.svg?raw";
import awmPkg from "../../../../../plugins/awm-rsi-toolkit/package.json";
import defaultIcon from "../../../../../plugins/default-rsi-toolkit/icon.svg?raw";
import defaultPkg from "../../../../../plugins/default-rsi-toolkit/package.json";
import oproIcon from "../../../../../plugins/opro-rsi-toolkit/icon.svg?raw";
import oproPkg from "../../../../../plugins/opro-rsi-toolkit/package.json";

/** The fields of a plugin's package.json the library listing reads. */
interface Manifest {
  name: string;
  version: string;
  description: string;
  license?: string;
  penguin: {
    title?: string;
    title_zh?: string;
    description_zh?: string;
    short_description?: string;
    short_description_zh?: string;
    quick_start?: { prompt: string; prompt_zh?: string; skills?: string[]; goal?: boolean };
  };
}

/** A library plugin as GET /api/plugins lists one this build ships. */
function libraryPlugin(manifest: Manifest, icon: string, skills: SkillMetadataItem[]): PluginItem {
  const p = manifest.penguin;
  const quick = p.quick_start;
  return {
    name: manifest.name.replace(/^@[^/]+\//, ""),
    ...(p.title ? { title: p.title } : {}),
    ...(p.title_zh ? { titleZh: p.title_zh } : {}),
    description: manifest.description,
    ...(p.description_zh ? { descriptionZh: p.description_zh } : {}),
    ...(p.short_description ? { shortDescription: p.short_description } : {}),
    ...(p.short_description_zh ? { shortDescriptionZh: p.short_description_zh } : {}),
    version: manifest.version,
    package: manifest.name,
    source: "builtin",
    ...(manifest.license ? { license: manifest.license } : {}),
    repository: "https://github.com/Prism-Shadow/penguin-harness",
    skills,
    hooks: [],
    icon,
    ...(quick
      ? {
          quickStart: {
            prompt: quick.prompt,
            ...(quick.prompt_zh ? { promptZh: quick.prompt_zh } : {}),
            ...(quick.skills ? { skills: quick.skills } : {}),
            ...(quick.goal ? { goal: true } : {}),
          },
        }
      : {}),
    mcpServers: [],
  };
}

/** Default frontmatter version for the demo's unchanged Skills. */
const SKILL_VERSION = "2026.10.12.1";

const skill = (name: string, description: string, version = SKILL_VERSION): SkillMetadataItem => ({
  name,
  description,
  version,
});

/** The library's self-evolution toolkits (the `rsi` category), in its order: by name. */
export function rsiToolkitPlugins(): PluginItem[] {
  return [
    libraryPlugin(acePkg, aceIcon, [
      skill(
        "ace-rsi-toolkit",
        "Run ACE (Agentic Context Engineering, Zhang et al. 2025) on an agent the sequential offline way - a Reflector reads each training Trace, a Curator adds the lessons to a playbook of rules the agent reads before every task, and the final playbook is measured on a published Benchmark.",
      ),
    ]),
    libraryPlugin(apePkg, apeIcon, [
      skill(
        "ape-rsi-toolkit",
        "Reproduce APE (Large Language Models are Human-Level Prompt Engineers, Zhou et al. 2022) on an agent and a frozen Benchmark, or on the house-style brief demo task shipped with this Skill: induce instructions from input/output examples, measure each one, keep the best.",
      ),
    ]),
    libraryPlugin(awmPkg, awmIcon, [
      skill(
        "awm-rsi-toolkit",
        "Run AWM (Agent Workflow Memory, Wang et al. 2024) on an agent - induce reusable workflows from its successful trajectories, online over a training stream or offline from supplied experiences, then freeze the workflow memory and measure it on a published Benchmark.",
      ),
    ]),
    libraryPlugin(defaultPkg, defaultIcon, [
      skill(
        "agent-optimization",
        "Improve an Agent State through versioned scores and score-linked Traces from a frozen Benchmark.",
      ),
    ]),
    libraryPlugin(oproPkg, oproIcon, [
      skill(
        "opro-rsi-toolkit",
        "Reproduce OPRO (Large Language Models as Optimizers, Yang et al. 2023) on an agent and a frozen Benchmark, or on the precise-summary demo task shipped with this Skill: propose instructions from the scored history, measure each one, keep the best.",
      ),
    ]),
  ];
}

/** The Agent Evaluation plugin: the evaluator every toolkit measures through, and Benchmark design. */
export function agentEvaluationPlugin(): PluginItem {
  return libraryPlugin(evaluationPkg, evaluationIcon, [
    skill(
      "agent-evaluation",
      "Run one specified Test Agent on one specified Benchmark Case exactly once, privately score that execution, and return one protocol result.",
      "2026.10.27.1",
    ),
    skill(
      "benchmark-design",
      "Design and calibrate a multi-Case capability Benchmark and establish a traceable Formal Baseline, or import a published Benchmark package.",
      "2026.10.27.1",
    ),
  ]);
}

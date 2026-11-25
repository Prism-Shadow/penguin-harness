/** The default Project in the homepage frame, before the reader starts its evolution example. */
import type { BenchmarkSummary, WorkbenchInfo } from "@prismshadow/penguin-server/api";
import { version } from "../../../../web/package.json";
import benchmark from "../../../../../plugins/agent-evaluation/workbenches/benchmark/package.json";
import benchmarkIcon from "../../../../../plugins/agent-evaluation/workbenches/benchmark/ui/icon.svg?url";
import images from "../../../../../plugins/multimodal-tools/workbenches/images/package.json";
import imagesIcon from "../../../../../plugins/multimodal-tools/workbenches/images/ui/icon.svg?url";
import slides from "../../../../../plugins/use-bento-slides/workbenches/slides/package.json";
import slidesIcon from "../../../../../plugins/use-bento-slides/workbenches/slides/ui/icon.svg?url";
import support from "../../../../../plugins/penguin-support/workbenches/support/package.json";
import supportIcon from "../../../../../plugins/penguin-support/workbenches/support/ui/icon.svg?url";
import type { DemoFixtures } from "./fixtures";
import example from "./example-benchmark.json";
import { IDS } from "./ids";

const SUPPORT = "penguin_support";
const SYSTEM = "system_agent";

export function seedFreshProject(f: DemoFixtures, playing: boolean): void {
  const general = f.agents.find((agent) => agent.agentId === IDS.agents.general)!;
  const docs = f.agents.find((agent) => agent.agentId === IDS.agents.docs)!;
  const clean = {
    ...general,
    sessionCount: 0,
    sessionActivity: general.sessionActivity.map(() => 0),
  };
  const system = {
    ...clean,
    agentId: SYSTEM,
    name: "System",
    description: "",
    system: true as const,
    skillCount: 0,
    toolCount: 0,
  };
  f.agents = [clean, system];
  if (playing) f.agents.push(docs);
  const base = f.agentConfigs[general.agentId]!;
  f.agentConfigs[SYSTEM] = {
    ...base,
    config: { ...base.config, name: system.name, description: system.description },
  };
  f.installed[SYSTEM] = { skills: [], hooks: [] };
  f.appCenter = { shortcuts: [], layout: null };
  f.project.name = "default_project";
  f.user.displayName = f.user.userId;
  const buildDate: string | null = import.meta.env.GALLERY_RELEASE_DATE;
  f.version = { ...f.version, version, describe: `v${version}`, buildDate, commit: null };
  f.update = {
    ...f.update,
    currentVersion: version,
    latestVersion: version,
    buildDate,
    publishedAt: null,
  };
  f.chatDefaults = {
    agentId: IDS.agents.general,
    approvalMode: "allow-all",
    sandbox: { mode: "danger-full-access", network: "open", switchOn: false },
  };
  f.benchmarks = [
    structuredClone(example) as BenchmarkSummary,
    ...f.benchmarks
      .filter((b) => (playing ? b.id !== IDS.benchmarks.draft : b.origin?.kind === "builtin"))
      .map((b) => (b.origin?.kind === "builtin" ? { ...b, evaluations: [], agentIds: [] } : b)),
  ];
}

/** Seed the same Agent-owned apps in the walkthrough and in the populated gallery. */
export function seedPresetWorkbenches(f: DemoFixtures, fresh: boolean): void {
  const general = f.agents.find((agent) => agent.agentId === IDS.agents.general)!;
  const supportAgent = {
    ...general,
    sessionCount: 0,
    sessionActivity: general.sessionActivity.map(() => 0),
    agentId: SUPPORT,
    name: "PenguinHarness Support",
    description:
      "Product support with questions, follow-ups and answers grounded in the official docs and source code.",
  };
  f.agents.splice(f.agents.indexOf(general) + 1, 0, supportAgent);
  const base = f.agentConfigs[general.agentId]!;
  f.agentConfigs[SUPPORT] = {
    ...base,
    config: { ...base.config, name: supportAgent.name, description: supportAgent.description },
  };
  const apps = [
    { agent: general, id: "benchmark", pkg: benchmark, icon: benchmarkIcon },
    ...(fresh
      ? [
          { agent: general, id: "slides", pkg: slides, icon: slidesIcon },
          { agent: general, id: "images", pkg: images, icon: imagesIcon },
        ]
      : []),
    { agent: supportAgent, id: "support", pkg: support, icon: supportIcon },
  ];
  for (const { agent, id, pkg, icon } of apps) {
    const tab = pkg.penguin.modules[0]!.contributes["WebModule.sessionTabs"][0]!;
    const base = `/api/projects/${IDS.project}/agents/${agent.agentId}/workbenches/${id}`;
    const appCenter: NonNullable<WorkbenchInfo["appCenter"]> = pkg.penguin.appCenter;
    const art = { url: icon, tint: false };
    const workbench: WorkbenchInfo = {
      id,
      name: pkg.name,
      version: pkg.version,
      revision: pkg.penguin.version,
      uiRev: pkg.penguin.version,
      loadedAt: null,
      error: null,
      hints: [],
      icon: art,
      appCenter,
      tabs: [
        {
          ...tab,
          renderer:
            "iframe" in tab.renderer
              ? { iframe: { src: `${base}/${tab.renderer.iframe.src}` } }
              : tab.renderer,
        },
      ],
    };
    (f.installed[agent.agentId]!.workbenches ??= []).push(workbench);
    f.appCenter.shortcuts.push({
      agentId: agent.agentId,
      agentName: agent.name ?? agent.agentId,
      workbenchId: id,
      ...(id === "benchmark" ? { plugin: "agent-evaluation" } : {}),
      title: appCenter.title ?? tab.title,
      titleZh: appCenter.titleZh ?? tab.titleZh,
      icon: art,
      tab: tab.key,
      build: "ready",
      path: `/app/${IDS.project}/${agent.agentId}/${id}`,
    });
  }
}

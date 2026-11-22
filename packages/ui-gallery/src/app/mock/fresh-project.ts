/** The default Project in the homepage frame, before the reader starts its evolution example. */
import type { BenchmarkSummary, WorkbenchInfo } from "@prismshadow/penguin-server/api";
import { version } from "../../../../web/package.json";
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
  const supportAgent = {
    ...clean,
    agentId: SUPPORT,
    name: "PenguinHarness Support",
    description:
      "Product support with questions, follow-ups and answers grounded in the official docs and source code.",
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
  f.agents = [clean, supportAgent, system];
  if (playing) f.agents.push(docs);
  for (const agent of [supportAgent, system]) {
    const base = f.agentConfigs[general.agentId]!;
    f.agentConfigs[agent.agentId] = {
      ...base,
      config: { ...base.config, name: agent.name, description: agent.description },
    };
    f.installed[agent.agentId] = { skills: [], hooks: [] };
  }
  f.appCenter = { shortcuts: [], layout: null };
  const apps = [
    { agent: clean, id: "slides", pkg: slides, icon: slidesIcon },
    { agent: clean, id: "images", pkg: images, icon: imagesIcon },
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
      tabs: [{ ...tab, renderer: { iframe: { src: `${base}/${tab.renderer.iframe.src}` } } }],
    };
    (f.installed[agent.agentId]!.workbenches ??= []).push(workbench);
    f.appCenter.shortcuts.push({
      agentId: agent.agentId,
      agentName: agent.name ?? agent.agentId,
      workbenchId: id,
      title: appCenter.title ?? tab.title,
      titleZh: appCenter.titleZh ?? tab.titleZh,
      icon: art,
      tab: tab.key,
      build: "ready",
      path: `/app/${IDS.project}/${agent.agentId}/${id}`,
    });
  }
  f.project.name = "default_project";
  f.user.displayName = f.user.userId;
  f.user.passwordIsInitial = true;
  f.prefs.initialPasswordBannerDismissed = false;
  f.version = { ...f.version, version, describe: `v${version}`, buildDate: null, commit: null };
  f.update = {
    ...f.update,
    currentVersion: version,
    latestVersion: version,
    buildDate: null,
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

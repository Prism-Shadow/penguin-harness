/**
 * A server install as one staged bar: which stages this install has, and where the server's
 * reports put the bar.
 *
 * The stages are the ones a person can tell apart, not the server's own: `check` (the registry is
 * asked about the name), `fetch` (the package is downloaded and installed, from whichever source
 * serves it), `start` (the server loads it) and `agents` (the person chooses who uses it). A plan
 * lists only the stages that will happen: enabling a plugin the build ships, and an install on
 * another machine (which fetches the package itself, later), only start; a plugin with nothing
 * for Agents has no `agents`; a package known to carry no server part has no `start`.
 *
 * The server reports a stage and, for a release channel's download alone, an amount. The bar
 * shows the amount where there is one and a live mark where there is not; it never invents one.
 * Within one attempt it only moves forward (`furthest`): a report that would put it behind where
 * it stands is not drawn.
 */
import type { ProgressStage, StagedProgressStatus } from "@prismshadow/penguin-ui";
import type { InstallStage } from "@prismshadow/penguin-web/internal";
import { formatBytes } from "@prismshadow/penguin-web/internal";
import { S } from "@prismshadow/penguin-web/internal";

export type InstallStep = "check" | "fetch" | "start" | "agents";

/** The order the steps run in, whatever a plan leaves out. */
const ORDER: readonly InstallStep[] = ["check", "fetch", "start", "agents"];

/** The download is the one stage with an amount, so it gets the room to show it. */
const WEIGHT: Readonly<Record<InstallStep, number>> = { check: 1, fetch: 3, start: 1, agents: 1 };

export interface DownloadProgress {
  received: number;
  total: number | null;
}

/** What the server's step is for the reader, as far as the plan needs it. */
export type PlanServer = "install" | "enable" | "none";

export function installPlan(input: {
  server: PlanServer;
  /** The install is written for another machine, which fetches the package itself. */
  remote?: boolean;
  /** Whether the package carries a server part to start; null while nobody has read it. */
  modules?: boolean | null;
  /** The reader chooses Agents at the end. */
  agents: boolean;
}): InstallStep[] {
  const plan: InstallStep[] = [];
  if (input.server === "enable" || (input.server === "install" && input.remote === true)) {
    plan.push("start");
  } else if (input.server === "install") {
    plan.push("check", "fetch");
    if (input.modules !== false) plan.push("start");
  }
  if (input.agents) plan.push("agents");
  return plan;
}

export const planStages = (plan: readonly InstallStep[]): ProgressStage[] =>
  plan.map((step) => ({ key: step, weight: WEIGHT[step] }));

/** Where a report stands: the step, and how far through it (0 to 1) when the server says. */
export interface InstallReading {
  step: InstallStep;
  value: number | null;
}

/** The server's report as a reading; null before it has said anything. */
export function installReading(
  stage: InstallStage | null | undefined,
  progress: DownloadProgress | null | undefined,
): InstallReading | null {
  if (progress != null) {
    const { received, total } = progress;
    return {
      step: "fetch",
      value: total !== null && total > 0 ? Math.min(1, Math.max(0, received / total)) : null,
    };
  }
  if (stage == null) return null;
  if (stage.stage === "checking") return { step: "check", value: null };
  if (stage.stage === "loading") return { step: "start", value: null };
  return { step: "fetch", value: null };
}

/** A bar's place: the plan's index under way, and the amount within it when known. */
export interface BarPlace {
  current: number;
  value: number | null;
}

/**
 * Where a reading puts the bar on a plan: its step's index, or, for a step the plan leaves out,
 * the next one the plan has (a registry check reported to a plan that only starts stands on
 * start). Before any report it stands on the plan's first stage.
 */
export function placeOf(plan: readonly InstallStep[], reading: InstallReading | null): BarPlace {
  if (reading === null) return { current: 0, value: null };
  const exact = plan.indexOf(reading.step);
  if (exact !== -1) return { current: exact, value: reading.value };
  const rank = ORDER.indexOf(reading.step);
  const next = plan.findIndex((step) => ORDER.indexOf(step) > rank);
  return { current: next === -1 ? Math.max(0, plan.length - 1) : next, value: null };
}

/** The further of two places: a later stage wins, then the larger amount in the same stage. */
export function furthest(prev: BarPlace | null, next: BarPlace): BarPlace {
  if (prev === null || next.current > prev.current) return next;
  if (next.current < prev.current) return prev;
  if (next.value === null) return prev;
  return prev.value === null || next.value > prev.value ? next : prev;
}

/** What the flow is doing, as the bar draws it. */
export type InstallPhase = "before" | "running" | "failed" | "agents" | "done";

export interface InstallBar {
  current: number;
  value?: number;
  status: StagedProgressStatus;
}

/**
 * The bar for a phase. Running or failed, it stands where the server's reports put it, short of
 * the Agents' stage, which only the person completes; choosing Agents, every server stage is
 * full and the Agents' stage waits; done, the whole bar is full, and only then.
 */
export function installBar(
  plan: readonly InstallStep[],
  phase: InstallPhase,
  place: BarPlace | null,
): InstallBar {
  if (phase === "done") return { current: plan.length, status: "running" };
  const agents = plan.indexOf("agents");
  if (phase === "agents") {
    return { current: agents === -1 ? plan.length : agents, status: "waiting" };
  }
  if (phase === "before" || place === null) {
    return { current: 0, status: phase === "before" ? "waiting" : statusOf(phase) };
  }
  const lastServer = (agents === -1 ? plan.length : agents) - 1;
  const current = Math.min(place.current, Math.max(0, lastServer));
  return {
    current,
    ...(place.value !== null && current === place.current ? { value: place.value } : {}),
    status: statusOf(phase),
  };
}

const statusOf = (phase: "running" | "failed"): StagedProgressStatus =>
  phase === "failed" ? "stopped" : "running";

/**
 * The words a running server install shows: the step it is at, as a sentence. `short` is for a
 * card's one-line control, which a sentence would overflow; there a download carries its percent
 * in the words, since the control has no room for an amount beside them.
 */
export function installStepWords(
  progress: DownloadProgress | null | undefined,
  stage: InstallStage | null | undefined,
  short = false,
  remote = false,
): string {
  const words = S.plugins.installModel;
  if (progress != null) {
    if (!short) return words.downloadingNow;
    const total = progress.total;
    return S.plugins.downloading(
      total !== null && total > 0 ? Math.floor((progress.received / total) * 100) : null,
    );
  }
  const said = short ? words.stepShort : words;
  if (stage?.stage === "checking") return said.checking;
  if (stage?.stage === "loading") return remote && !short ? words.handing : said.loading;
  if (stage?.stage === "installing" && stage.source === "offline") return said.fromOffline;
  if (stage?.stage === "installing" && stage.source === "channel" && !short) {
    return words.downloadingNow;
  }
  if (stage == null && !short) return words.starting;
  return said.installing;
}

/** The amount beside the sentence: the percent of a known total, else the bytes so far. */
export function installAmount(progress: DownloadProgress | null | undefined): string | null {
  if (progress == null) return null;
  const { received, total } = progress;
  if (total !== null && total > 0) return `${Math.floor((received / total) * 100)}%`;
  return received > 0 ? formatBytes(received) : null;
}

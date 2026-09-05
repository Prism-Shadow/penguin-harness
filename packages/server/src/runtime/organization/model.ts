/**
 * An organization as one pass sees it: the three root files read and validated together.
 * A broken config or chart does not hide the organization — it is listed with `invalid`
 * set and every automatic trigger is held until the file is fixed (the same rule as an
 * invalid schedule file: report, skip, recover on edit).
 */
import type { Desks, OrgChart, OrgConfig, OrgEmployee } from "../../organization/files.js";
import { ORG_CONFIG_DEFAULTS, ancestorsOf } from "../../organization/files.js";
import { ceoAgentId, workspaceDir } from "../../organization/paths.js";
import type { OrgDeps } from "./deps.js";

export interface LoadedOrg {
  projectId: string;
  orgId: string;
  dir: string;
  config: OrgConfig;
  chart: OrgChart;
  desks: Desks;
  byId: Map<string, OrgEmployee>;
  /** Set when a root file fails validation; the organization is then read-only for the scheduler. */
  invalid?: string;
}

/** Reads config, chart and ledger; null when the directory is not an organization. */
export async function loadOrg(
  deps: OrgDeps,
  projectId: string,
  orgId: string,
): Promise<LoadedOrg | null> {
  const dir = deps.store.dir(projectId, orgId);
  const configFile = await deps.store.readConfig(dir);
  if (configFile === null) return null;
  const problems: string[] = [];
  let config: OrgConfig;
  if (configFile.parsed.ok) {
    config = configFile.parsed.value;
  } else {
    problems.push(`org_config.toml: ${configFile.parsed.error}`);
    config = {
      name: orgId,
      mission: "",
      status: "paused",
      timezone: "UTC",
      approvalMode: ORG_CONFIG_DEFAULTS.approvalMode,
      mentionChainLimit: ORG_CONFIG_DEFAULTS.mentionChainLimit,
      budgetWarnRatio: ORG_CONFIG_DEFAULTS.budgetWarnRatio,
      budgetPauseRatio: ORG_CONFIG_DEFAULTS.budgetPauseRatio,
      createdBy: "",
    };
  }
  const chartFile = await deps.store.readChart(dir, orgId);
  let chart: OrgChart;
  if (chartFile === null) {
    problems.push("org_chart.yaml is missing");
    chart = { employees: [] };
  } else if (chartFile.parsed.ok) {
    chart = chartFile.parsed.value;
  } else {
    problems.push(`org_chart.yaml: ${chartFile.parsed.error}`);
    chart = { employees: [] };
  }
  const desksFile = await deps.store.readDesks(dir);
  let desks: Desks = {};
  if (desksFile.parsed.ok) desks = desksFile.parsed.value;
  else problems.push(`desks.toml: ${desksFile.parsed.error}`);
  return {
    projectId,
    orgId,
    dir,
    config,
    chart,
    desks,
    byId: new Map(chart.employees.map((e) => [e.agentId, e])),
    ...(problems.length > 0 ? { invalid: problems.join("; ") } : {}),
  };
}

/** The `employee:` line of a trigger block: id, title and reporting line for orientation. */
export function employeeLine(org: LoadedOrg, agentId: string): string {
  const e = org.byId.get(agentId);
  if (!e) return agentId;
  return e.reportsTo === null
    ? `${agentId} (${e.title})`
    : `${agentId} (${e.title}, reports to ${e.reportsTo})`;
}

/** The employee and everyone above it, for "any ancestor paused" checks. */
export function lineOf(org: LoadedOrg, agentId: string): string[] {
  return [agentId, ...ancestorsOf(org.chart, agentId)];
}

export function isCeo(org: LoadedOrg, agentId: string): boolean {
  return agentId === ceoAgentId(org.orgId);
}

/** The shared workspace root: the directory named in the config, else the organization's own `workspace/`. */
export function sharedWorkspace(org: LoadedOrg): string {
  return org.config.workspace ?? workspaceDir(org.dir);
}

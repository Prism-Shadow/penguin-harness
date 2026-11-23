/**
 * This backend's page in Settings: its status in the plugin page's shape (`report()`), read from
 * where the sandbox says this backend stands — in use, by which rung of DSH's chain, or refused
 * at load with DSH's reason folded under it — and what the serving rung leaves open, as notices.
 * The backend has no options of its own, so its settings group is empty: it exists to give the
 * page its status. A refused load cannot be retried (the loader is a promise, not a function), so
 * the page offers no "check again"; a restart loads it again.
 */
import { Bind, Component, Interface, Use } from "@prismshadow/penguin-core/plugin";

/** The name this backend registers with the sandbox. */
export const DSH_PROVIDER = "dsh-local";

/** What this page reads of the sandbox: the mounted backends (rung, limits) and the refused. */
@Interface()
export abstract class DshSandboxView {
  abstract backends(): Array<{
    name: string;
    mechanism?: string;
    limits?: ReadonlyArray<{ text: string; textZh?: string }>;
  }>;
  abstract failures(): Array<{ name: string; reason: string }>;
}

type Notice = { tone: "attention" | "muted" | "progress"; text: string; textZh?: string };

/** The report's shape, in this package's own words (the settings page's `PluginStatusReport`). */
export interface DshReport {
  summary?: { state: string; text: string; textZh?: string };
  checks?: Array<{
    id: string;
    label: string;
    labelZh?: string;
    state: string;
    text?: string;
    textZh?: string;
    details?: string;
  }>;
}

/** The page's report from what the sandbox says: pure, so the words are pinned by tests. */
export function dshReport(view: DshSandboxView): DshReport {
  const serving = view.backends().find((b) => b.name === DSH_PROVIDER);
  const refused = view.failures().find((f) => f.name === DSH_PROVIDER);
  const check =
    serving !== undefined
      ? {
          state: "ok",
          text: `Confines file writes by ${serving.mechanism ?? "DSH's chain"}`,
          textZh: `由 ${serving.mechanism ?? "DSH 后端链"} 限制文件写入`,
        }
      : refused !== undefined
        ? {
            state: "action",
            text: "No rung of DSH's chain can confine on this host",
            textZh: "DSH 后端链在本机没有可用的实现",
            details: refused.reason,
          }
        : { state: "unknown", text: "Checking…", textZh: "检查中…" };
  return {
    summary:
      serving !== undefined
        ? { state: "ready", text: "In use", textZh: "在用" }
        : refused !== undefined
          ? { state: "attention", text: "Not in use", textZh: "未启用" }
          : { state: "unknown", text: "Checking", textZh: "检查中" },
    checks: [{ id: "chain", label: "DSH chain", labelZh: "DSH 后端链", ...check }],
  };
}

/** What the serving rung leaves open, as the page's notices. */
export function dshNotices(view: DshSandboxView): Notice[] {
  const serving = view.backends().find((b) => b.name === DSH_PROVIDER);
  return (serving?.limits ?? []).map((l) => ({
    tone: "muted" as const,
    text: l.text,
    ...(l.textZh !== undefined ? { textZh: l.textZh } : {}),
  }));
}

@Component({
  contributes: {
    "PluginConfigPage.status": [{ id: "sandbox-dsh.status", group: "sandbox-dsh" }],
  },
})
export class SandboxDshStatus {
  @Use() private readonly sandbox!: DshSandboxView;
  @Bind("sandbox-dsh.status") status!: { notices(): Notice[]; report(): DshReport };

  setup() {
    const sandbox = this.sandbox;
    this.status = { notices: () => dshNotices(sandbox), report: () => dshReport(sandbox) };
  }
}

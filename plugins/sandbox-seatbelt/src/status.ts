/**
 * This backend's page in Settings: its status in the plugin page's shape (`report()`), read from
 * where the sandbox says this backend stands — in use, refused by its check, or not this host's.
 * The version element is the sandbox-exec program it runs (macOS's own unless the setting names
 * another); the check is the Seatbelt profile the backend loads with, the sandbox's own words for
 * a refusal folded under it; "check again" loads the backend again, as a save of this page does.
 */
import { Bind, Component, Interface, Use } from "@prismshadow/penguin-core/plugin";
import {
  SEATBELT_GROUP,
  SYSTEM_RUNNER,
  SeatbeltConfigReader,
  seatbeltSettingsOf,
} from "./settings.js";

/** The name this backend registers with the sandbox. */
export const SEATBELT_PROVIDER = "penguin-seatbelt";

/** What this page reads of the sandbox: where each backend stands, and a reload of the refused. */
@Interface()
export abstract class SeatbeltSandboxView {
  abstract backends(): Array<{ name: string }>;
  abstract failures(): Array<{ name: string; reason: string }>;
  abstract declined(): string[];
  abstract retryFailed(): Promise<void>;
}

/** Where a backend stands: in use, refused by its check (why), not this host's, not settled. */
export type Standing =
  | { kind: "serving" }
  | { kind: "refused"; reason: string }
  | { kind: "declined" }
  | { kind: "loading" };

export function standingOf(view: SeatbeltSandboxView, name: string): Standing {
  if (view.backends().some((b) => b.name === name)) return { kind: "serving" };
  const failed = view.failures().find((f) => f.name === name);
  if (failed !== undefined) return { kind: "refused", reason: failed.reason };
  if (view.declined().includes(name)) return { kind: "declined" };
  return { kind: "loading" };
}

/** The report's shape, in this package's own words (the settings page's `PluginStatusReport`). */
export interface SeatbeltReport {
  summary?: { state: string; text: string; textZh?: string };
  version?: {
    name: string;
    state: string;
    platform?: string;
    text?: string;
    textZh?: string;
    details?: string;
  };
  checks?: Array<{
    id: string;
    label: string;
    labelZh?: string;
    state: string;
    text?: string;
    textZh?: string;
    details?: string;
  }>;
  recheck?: string;
}

/** The page's report from what it read: pure, so the words for each standing are pinned by tests. */
export function seatbeltReport(inputs: {
  standing: Standing;
  platform: NodeJS.Platform;
  arch: string;
  runner: string;
}): SeatbeltReport {
  const { standing, platform, arch, runner } = inputs;
  if (platform !== "darwin" || standing.kind === "declined") {
    return {
      summary: { state: "off", text: "Not for this host", textZh: "不适用于本机" },
      version: {
        name: "sandbox-exec",
        state: "unsupported",
        text: "Seatbelt runs on macOS only.",
        textZh: "Seatbelt 只在 macOS 上运行。",
      },
      checks: [
        {
          id: "platform",
          label: "macOS host",
          labelZh: "macOS 主机",
          state: "na",
          text: `This host is ${platform}`,
          textZh: `本机是 ${platform}`,
        },
      ],
    };
  }
  const check =
    standing.kind === "serving"
      ? { state: "ok", text: "sandbox-exec accepts the profile", textZh: "sandbox-exec 接受配置" }
      : standing.kind === "refused"
        ? {
            state: "action",
            text: "sandbox-exec refuses the profile",
            textZh: "sandbox-exec 拒绝配置",
            details: standing.reason,
          }
        : { state: "unknown", text: "Checking…", textZh: "检查中…" };
  return {
    summary:
      standing.kind === "serving"
        ? { state: "ready", text: "In use", textZh: "在用" }
        : standing.kind === "refused"
          ? { state: "attention", text: "Not in use", textZh: "未启用" }
          : { state: "unknown", text: "Checking", textZh: "检查中" },
    version: {
      name: "sandbox-exec",
      state: standing.kind === "refused" ? "failed" : "installed",
      platform: `${platform}-${arch}`,
      text: runner === SYSTEM_RUNNER ? "Part of macOS" : "From the sandbox-exec program setting",
      textZh: runner === SYSTEM_RUNNER ? "macOS 自带" : "来自 sandbox-exec 程序设置",
      details: runner,
    },
    checks: [{ id: "profile", label: "Seatbelt profile", labelZh: "Seatbelt 配置", ...check }],
    recheck: "check",
  };
}

/** The page's live half, in the consumer's own shape (the settings page's `SettingsGroupStatus`). */
export interface SeatbeltStatus {
  notices(): Array<{ tone: "attention" | "muted" | "progress"; text: string; textZh?: string }>;
  report(): SeatbeltReport;
  actions(): Array<{
    id: string;
    title: string;
    titleZh?: string;
    description?: string;
    descriptionZh?: string;
  }>;
  run(action: string): Promise<{ ok: boolean; message: string; messageZh?: string }>;
  saved(): Promise<void>;
}

@Component({
  contributes: {
    "PluginConfigPage.status": [{ id: "sandbox-seatbelt.status", group: "sandbox-seatbelt" }],
  },
})
export class SandboxSeatbeltStatus {
  @Use() private readonly config!: SeatbeltConfigReader;
  @Use() private readonly sandbox!: SeatbeltSandboxView;
  @Bind("sandbox-seatbelt.status") status!: SeatbeltStatus;

  setup() {
    const config = this.config;
    const sandbox = this.sandbox;
    this.status = {
      notices: () => [],
      report: () =>
        seatbeltReport({
          standing: standingOf(sandbox, SEATBELT_PROVIDER),
          platform: process.platform,
          arch: process.arch,
          runner: seatbeltSettingsOf(config.get(SEATBELT_GROUP)).runner,
        }),
      actions: () => [
        {
          id: "check",
          title: "Check again",
          titleZh: "重新检查",
          description: "Runs the profile check again and loads the backend if it passes.",
          descriptionZh: "重新执行配置检查，通过即加载后端。",
        },
      ],
      run: async (action) => {
        if (action !== "check") return { ok: false, message: `No action ${action}.` };
        await sandbox.retryFailed();
        return { ok: true, message: "Checked again.", messageZh: "已重新检查。" };
      },
      // A saved program path is checked at once: the sandbox loads a refused backend again.
      saved: () => sandbox.retryFailed(),
    };
  }
}

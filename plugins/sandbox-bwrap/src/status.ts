/**
 * This backend's page in Settings: its status in the plugin page's shape (`report()`), read from
 * where the sandbox says this backend stands — in use, refused by its check, or not this host's —
 * and from the bubblewrap it would run. The version element is that program (the one this plugin
 * ships, a configured one, or bwrap on PATH) with the version it reports; the check is the base
 * profile the backend loads with, the sandbox's own words for a refusal folded under it; "check
 * again" loads the backend again, as a save of this page does.
 */
import { spawnSync } from "node:child_process";
import { Bind, Component, Interface, Use } from "@prismshadow/penguin-core/plugin";
import { BWRAP_GROUP, BwrapConfigReader, bwrapSettingsOf, vendoredRunner } from "./settings.js";

/** The name this backend registers with the sandbox. */
export const BWRAP_PROVIDER = "penguin-bwrap";

/** What this page reads of the sandbox: where each backend stands, and a reload of the refused. */
@Interface()
export abstract class BwrapSandboxView {
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

export function standingOf(view: BwrapSandboxView, name: string): Standing {
  if (view.backends().some((b) => b.name === name)) return { kind: "serving" };
  const failed = view.failures().find((f) => f.name === name);
  if (failed !== undefined) return { kind: "refused", reason: failed.reason };
  if (view.declined().includes(name)) return { kind: "declined" };
  return { kind: "loading" };
}

/** The program's version, as `bwrap --version` says it ("bubblewrap 0.11.2"); null when it will not say. */
export function bwrapVersion(runner: string): string | null {
  const out = spawnSync(runner, ["--version"], { encoding: "utf8", timeout: 2_000 });
  const match = /(\d+\.\d+(?:\.\d+)?)/.exec(String(out.stdout ?? ""));
  return out.status === 0 && match !== null ? match[1]! : null;
}

/** The report's shape, in this package's own words (the settings page's `PluginStatusReport`). */
export interface BwrapReport {
  summary?: { state: string; text: string; textZh?: string };
  version?: {
    name: string;
    state: string;
    version?: string;
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

export interface BwrapPageInputs {
  standing: Standing;
  platform: NodeJS.Platform;
  arch: string;
  /** The runner the backend uses, and where it comes from. */
  runner: string;
  source: "configured" | "shipped" | "path";
  version: string | null;
}

/** The page's report from what it read: pure, so the words for each standing are pinned by tests. */
export function bwrapReport(inputs: BwrapPageInputs): BwrapReport {
  const { standing, platform, arch, runner, source, version } = inputs;
  if (platform !== "linux" || standing.kind === "declined") {
    return {
      summary: { state: "off", text: "Not for this host", textZh: "不适用于本机" },
      version: {
        name: "bubblewrap",
        state: "unsupported",
        text: "Bubblewrap runs on Linux only.",
        textZh: "Bubblewrap 只在 Linux 上运行。",
      },
      checks: [
        {
          id: "platform",
          label: "Linux host",
          labelZh: "Linux 主机",
          state: "na",
          text: `This host is ${platform}`,
          textZh: `本机是 ${platform}`,
        },
      ],
    };
  }
  const from = {
    configured: { en: "From the bwrap program setting", zh: "来自 bwrap 程序设置" },
    shipped: { en: "Shipped with this plugin", zh: "随本插件附带" },
    path: {
      en: "bwrap on PATH: this plugin ships none for this host",
      zh: "PATH 上的 bwrap：本插件没有适配本机的自带版本",
    },
  }[source];
  const check =
    standing.kind === "serving"
      ? {
          state: "ok",
          text: "bwrap accepts the base profile",
          textZh: "bwrap 接受基础配置",
        }
      : standing.kind === "refused"
        ? {
            state: "action",
            text: "bwrap refuses the base profile: unprivileged user namespaces may be off",
            textZh: "bwrap 拒绝基础配置：本机可能未开放非特权用户命名空间",
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
      name: "bubblewrap",
      state: version !== null ? "installed" : "unknown",
      ...(version !== null ? { version } : {}),
      platform: `${platform}-${arch}`,
      text: version !== null ? from.en : `${runner} does not report a version`,
      textZh: version !== null ? from.zh : `${runner} 未报告版本`,
      details: runner,
    },
    checks: [{ id: "base-profile", label: "Base profile", labelZh: "基础配置", ...check }],
    recheck: "check",
  };
}

/** The page's live half, in the consumer's own shape (the settings page's `SettingsGroupStatus`). */
export interface BwrapStatus {
  notices(): Array<{ tone: "attention" | "muted" | "progress"; text: string; textZh?: string }>;
  report(): BwrapReport;
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
    "PluginConfigPage.status": [{ id: "sandbox-bwrap.status", group: "sandbox-bwrap" }],
  },
})
export class SandboxBwrapStatus {
  @Use() private readonly config!: BwrapConfigReader;
  @Use() private readonly sandbox!: BwrapSandboxView;
  @Bind("sandbox-bwrap.status") status!: BwrapStatus;

  setup() {
    const config = this.config;
    const sandbox = this.sandbox;
    // `--version` spawns: asked once per runner, not on every read of the page.
    const versions = new Map<string, string | null>();
    const versionOf = (runner: string) => {
      if (!versions.has(runner)) versions.set(runner, bwrapVersion(runner));
      return versions.get(runner)!;
    };
    this.status = {
      notices: () => [],
      report: () => {
        const doc = config.get(BWRAP_GROUP);
        const shipped = vendoredRunner();
        const { runner } = bwrapSettingsOf(doc, shipped);
        const configured = typeof doc.runner === "string" && doc.runner.trim() !== "";
        const platform = process.platform;
        return bwrapReport({
          standing: standingOf(sandbox, BWRAP_PROVIDER),
          platform,
          arch: process.arch,
          runner,
          source: configured ? "configured" : shipped !== "" ? "shipped" : "path",
          version: platform === "linux" ? versionOf(runner) : null,
        });
      },
      actions: () => [
        {
          id: "check",
          title: "Check again",
          titleZh: "重新检查",
          description: "Runs the base-profile check again and loads the backend if it passes.",
          descriptionZh: "重新执行基础配置检查，通过即加载后端。",
        },
      ],
      run: async (action) => {
        if (action !== "check") return { ok: false, message: `No action ${action}.` };
        versions.clear();
        await sandbox.retryFailed();
        return { ok: true, message: "Checked again.", messageZh: "已重新检查。" };
      },
      // A saved program path is checked at once: the sandbox loads a refused backend again.
      saved: async () => {
        versions.clear();
        await sandbox.retryFailed();
      },
    };
  }
}

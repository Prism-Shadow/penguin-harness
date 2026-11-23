/**
 * This backend's page in Settings, in the plugin page's shape (`report()`): WSL itself as the
 * version element — not installed (with Install), being installed, installed with its version,
 * or not known while it is read — then the checks: the sandbox distro (initialized, or the step
 * to take, with Initialize on the row) and each line of the last confinement check, wsl.exe's
 * own words folded under a line that failed; "check again" runs the confinement check once the
 * distro is there. Off Windows the page says the backend does not apply. Pure: the status reads
 * the machine and hands the facts in, so the words for each state are pinned by tests.
 */
import type { HostFacts, WslState } from "./host.js";
import { BASE_TITLES } from "./tasks.js";
import type { CheckLine, TaskKind, TaskOutcome, Text } from "./tasks.js";

/** The report's shape, in this package's own words (the settings page's `PluginStatusReport`). */
export interface WslReport {
  summary?: { state: string; text: string; textZh?: string };
  version?: {
    name: string;
    state: string;
    version?: string;
    text?: string;
    textZh?: string;
    action?: string;
  };
  checks?: Array<{
    id: string;
    label: string;
    labelZh?: string;
    state: string;
    text?: string;
    textZh?: string;
    details?: string;
    action?: string;
  }>;
  recheck?: string;
}

export interface WslFacts {
  platform: NodeJS.Platform;
  host: HostFacts | null;
  running: { kind: TaskKind; step: Text } | null;
  last: TaskOutcome | null;
  state: WslState | null;
  /** The distro the settings name, and whether that is the one initialized and still registered. */
  distro: string;
  initialized: boolean;
  lastCheck: { lines: CheckLine[] } | null;
}

export function wslReport(facts: WslFacts): WslReport {
  if (facts.platform !== "win32") {
    return {
      summary: { state: "off", text: "Not for this host", textZh: "不适用于本机" },
      version: {
        name: "WSL",
        state: "unsupported",
        text: "The WSL sandbox runs on Windows only.",
        textZh: "WSL 沙盒只在 Windows 上运行。",
      },
      checks: [
        {
          id: "platform",
          label: "Windows host",
          labelZh: "Windows 主机",
          state: "na",
          text: `This host is ${facts.platform}`,
          textZh: `本机是 ${facts.platform}`,
        },
      ],
    };
  }
  const { host, running, last, state, initialized } = facts;
  if (host === null) {
    return {
      version: {
        name: "WSL",
        state: "unknown",
        text: "Reading WSL on this machine…",
        textZh: "正在读取本机的 WSL…",
      },
    };
  }
  if (host.wsl === "missing") {
    const restart = last?.kind === "install" && last.restart === true;
    return {
      summary: { state: "attention", text: "Needs setup", textZh: "需要设置" },
      version:
        running?.kind === "install"
          ? { name: "WSL", state: "preparing", text: running.step.en, textZh: running.step.zh }
          : restart
            ? {
                name: "WSL",
                state: "missing",
                text: "Restart Windows to finish installing WSL.",
                textZh: "重启 Windows 以完成 WSL 安装。",
              }
            : {
                name: "WSL",
                state: "missing",
                text: `Not available on this machine${host.problem ? ` (${host.problem})` : ""}. Windows asks for permission once to install it.`,
                textZh: `这台机器上没有可用的 WSL${host.problem ? `（${host.problem}）` : ""}。安装时 Windows 会请求一次授权。`,
                ...(running === null ? { action: "install" } : {}),
              },
    };
  }
  const base = state !== null ? BASE_TITLES[state.base === "alpine" ? "alpine" : "ubuntu"] : "";
  const distro = initialized
    ? {
        id: "distro",
        label: "Sandbox distro",
        labelZh: "沙盒发行版",
        state: "ok",
        text: `${state!.distro} (${base}${state!.version === "" ? "" : ` ${state!.version}`}) as user ${state!.user}`,
        textZh: `${state!.distro}（${base}${state!.version === "" ? "" : ` ${state!.version}`}），用户 ${state!.user}`,
      }
    : {
        id: "distro",
        label: "Sandbox distro",
        labelZh: "沙盒发行版",
        state: "action",
        text:
          state !== null && state.distro !== facts.distro
            ? `The setting names ${facts.distro}, but ${state.distro} was initialized`
            : "Not initialized yet",
        textZh:
          state !== null && state.distro !== facts.distro
            ? `设置为 ${facts.distro}，但初始化的是 ${state.distro}`
            : "尚未初始化",
        ...(running === null ? { action: "initialize" } : {}),
      };
  const lines = initialized && running === null ? (facts.lastCheck?.lines ?? []) : [];
  const checkRows = lines.map((line, i) => ({
    id: `check-${i}`,
    label: line.name.en,
    labelZh: line.name.zh,
    state: line.ok === true ? "ok" : line.ok === false ? "action" : "unknown",
    ...(line.detail !== "" ? { details: line.detail } : {}),
  }));
  const healthy = initialized && lines.length > 0 && lines.every((l) => l.ok !== false);
  return {
    ...(running !== null
      ? {}
      : healthy
        ? { summary: { state: "ready", text: "In use", textZh: "在用" } }
        : { summary: { state: "attention", text: "Needs setup", textZh: "需要设置" } }),
    version: {
      name: "WSL",
      state: "installed",
      ...(host.version !== undefined && host.version !== "" ? { version: host.version } : {}),
    },
    checks: [distro, ...checkRows],
    ...(initialized && running === null ? { recheck: "check" } : {}),
  };
}

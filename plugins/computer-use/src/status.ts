/**
 * The Computer Use card's live half on Settings → Plugins: what agent-desktop's install is doing,
 * whether this machine is supported, and each precondition of its operating system (probe.ts) —
 * a muted line when it holds, an attention line saying what to do when it does not — with the
 * buttons that act on them: install or retry, check again, and on macOS open System Settings at
 * the permission PenguinHarness still needs (`permissions --guide`, which names the app to allow).
 *
 * While the plugin is switched off the page draws the switch alone, and this reports nothing.
 */
import { preconditionsOf } from "./probe.js";
import type { Probe } from "./probe.js";
import { INSTALL_NEXT_STEP } from "./service.js";
import type { ComputerUseService } from "./service.js";

/** The card's live half, in the consumer's own shape (the server's `SettingsGroupStatus`). */
export interface SettingsGroupStatus {
  notices(): Array<{
    tone: "attention" | "muted" | "progress";
    text: string;
    textZh?: string;
    details?: string;
    detailsZh?: string;
  }>;
  actions(): Array<{
    id: string;
    title: string;
    titleZh?: string;
    description?: string;
    descriptionZh?: string;
  }>;
  run(action: string): Promise<{
    ok: boolean;
    message: string;
    messageZh?: string;
    settled?: Promise<void>;
  }>;
  saved(): Promise<void>;
  /**
   * The status page's structured half (the host's PluginStatusReport): a summary, the installed
   * version as its own element, the checks block and its single recheck. An older host never asks
   * for it and draws the notices alone.
   */
  report?(): PluginStatusReport;
}

/**
 * The status page's data contract, declared here structurally until the host exports it (the
 * plugin settings pages work package): what each element shows, in both languages, with
 * agent-desktop's own English only ever in `details`.
 */
export interface PluginStatusReport {
  summary?: {
    state: "ready" | "attention" | "progress" | "off";
    text: string;
    textZh?: string;
    hint?: string;
    hintZh?: string;
  };
  version?: {
    name: string;
    state: "installed" | "preparing" | "failed" | "missing" | "unsupported";
    version?: string;
    platform?: string;
    /** 0..1, while preparing only. */
    progress?: number;
    text?: string;
    textZh?: string;
    details?: string;
    detailsZh?: string;
    /** An id from actions(), drawn on the version element. */
    action?: string;
  };
  checks?: Array<{
    id: string;
    label: string;
    labelZh?: string;
    state: "ok" | "action" | "unknown" | "na";
    text?: string;
    textZh?: string;
    details?: string;
    detailsZh?: string;
    action?: string;
  }>;
  /** An id from actions(): the checks block's one recheck, run without a confirm. */
  recheck?: string;
}

type Notice = ReturnType<SettingsGroupStatus["notices"]>[number];

/** A check's "Label: text" (or "标签：文本") as its two parts. */
function split(line: string, sep: string): { label: string; text?: string } {
  const at = line.indexOf(sep);
  if (at < 0) return { label: line };
  return { label: line.slice(0, at).trim(), text: line.slice(at + sep.length).trim() };
}

/** The installed version element of the status page. */
function versionOf(service: ComputerUseService): NonNullable<PluginStatusReport["version"]> {
  const state = service.state();
  const v = service.pin.version;
  const base = { name: "agent-desktop" };
  switch (state.kind) {
    case "unsupported": {
      const n = installNotice(service);
      return {
        ...base,
        state: "unsupported",
        text: n.text,
        ...(n.textZh !== undefined ? { textZh: n.textZh } : {}),
      };
    }
    case "missing":
      return {
        ...base,
        state: "missing",
        version: v,
        text: "Not installed yet: Install downloads it (about 16 MB) from the npm registry of Plugin Sources and checks it against the digests pinned in this plugin.",
        textZh:
          "尚未安装：「安装」会从「插件源」的 npm registry 下载它（约 16 MB），并按本插件钉死的摘要校验。",
        action: "install",
      };
    case "installing": {
      const p = state.progress;
      const n = installNotice(service);
      return {
        ...base,
        state: "preparing",
        version: v,
        ...(p !== null && p.step === "download" && p.total > 0
          ? { progress: Math.min(1, p.received / p.total) }
          : p !== null && p.step !== "download"
            ? { progress: 1 }
            : {}),
        text: n.text,
        ...(n.textZh !== undefined ? { textZh: n.textZh } : {}),
      };
    }
    case "installed":
      return {
        ...base,
        state: "installed",
        version: state.installed.version,
        platform: state.installed.target,
        details: state.installed.dir,
        detailsZh: state.installed.dir,
      };
    case "failed":
      return {
        ...base,
        state: "failed",
        version: v,
        text: `It could not be installed. ${INSTALL_NEXT_STEP.en}`,
        textZh: `安装失败。${INSTALL_NEXT_STEP.zh}`,
        details: state.message,
        detailsZh: state.message,
        action: "install",
      };
    case "override":
      return state.problem === null
        ? {
            ...base,
            state: "installed",
            ...(state.version !== null ? { version: state.version } : {}),
            text: "From the program path setting.",
            textZh: "来自程序路径设置。",
            details: state.path,
            detailsZh: state.path,
          }
        : {
            ...base,
            state: "failed",
            text: `The program path setting names a program that cannot be used. Clear it to use the pinned agent-desktop ${v}.`,
            textZh: `程序路径设置指向的程序不可用。清空它即改用钉死的 agent-desktop ${v}。`,
            details: `${state.path}: ${state.problem}`,
            detailsZh: `${state.path}: ${state.problem}`,
          };
  }
}

const mb = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1);

function installNotice(service: ComputerUseService): Notice {
  const state = service.state();
  const v = service.pin.version;
  switch (state.kind) {
    case "unsupported":
      return state.libc !== undefined
        ? {
            tone: "attention",
            text: `Computer Use cannot run on this server: ${state.libc.en}.`,
            textZh: `Computer Use 无法在这台服务器上运行：${state.libc.zh}。`,
          }
        : {
            tone: "attention",
            text: `This server is ${state.target}: agent-desktop runs on macOS, Windows and Linux, on x64 and arm64, so Computer Use cannot run here.`,
            textZh: `这台服务器是 ${state.target}：agent-desktop 只支持 x64 与 arm64 上的 macOS、Windows 与 Linux，Computer Use 无法在此运行。`,
          };
    case "missing":
      return {
        tone: "attention",
        text: `agent-desktop ${v} is not installed. Install downloads it (about 16 MB) from the npm registry of Plugin Sources and checks it against the digests pinned in this plugin.`,
        textZh: `agent-desktop ${v} 尚未安装。「安装」会从「插件源」的 npm registry 下载它（约 16 MB），并按本插件钉死的摘要校验。`,
      };
    case "installing": {
      const p = state.progress;
      const step =
        p === null
          ? { en: "starting", zh: "开始" }
          : p.step === "download"
            ? {
                en: `downloading, ${mb(p.received)} of ${mb(p.total)} MB`,
                zh: `下载中，${mb(p.received)} / ${mb(p.total)} MB`,
              }
            : p.step === "verify"
              ? { en: "checking the download", zh: "校验下载内容" }
              : { en: "writing the program", zh: "写入程序" };
      return {
        tone: "progress",
        text: `Installing agent-desktop ${v}: ${step.en}`,
        textZh: `正在安装 agent-desktop ${v}：${step.zh}`,
      };
    }
    case "installed":
      return {
        tone: "muted",
        text: `agent-desktop ${state.installed.version} is installed for ${state.installed.target}.`,
        textZh: `agent-desktop ${state.installed.version} 已安装（${state.installed.target}）。`,
        details: state.installed.dir,
        detailsZh: state.installed.dir,
      };
    case "failed":
      return {
        tone: "attention",
        text: `agent-desktop ${v} could not be installed. ${INSTALL_NEXT_STEP.en}`,
        textZh: `agent-desktop ${v} 安装失败。${INSTALL_NEXT_STEP.zh}`,
        details: state.message,
        detailsZh: state.message,
      };
    case "override":
      return state.problem === null
        ? {
            tone: "muted",
            text: `Runs the agent-desktop program at ${state.path} (version ${state.version ?? "unknown"}), from the program path setting.`,
            textZh: `按程序路径设置运行 ${state.path} 处的 agent-desktop（版本 ${state.version ?? "未知"}）。`,
          }
        : {
            tone: "attention",
            text: `The program path names ${state.path}, but ${state.problem}. Clear it to use the pinned agent-desktop ${v}.`,
            textZh: `程序路径指向 ${state.path}，但该程序不可用（${state.problem}）。清空它即改用钉死的 agent-desktop ${v}。`,
          };
  }
}

export function computerUseStatus(
  ready: () => { service: ComputerUseService; probe: Probe },
): SettingsGroupStatus {
  // A host that asks for the report draws the version and the checks from it: the notices then
  // keep only what has no element of its own (an older host never asks, and gets them all).
  let reported = false;
  return {
    report() {
      reported = true;
      const { service, probe } = ready();
      if (!service.settings().enabled) {
        return {
          summary: { state: "off", text: "Computer Use is off.", textZh: "电脑操作已关闭。" },
        };
      }
      void service.refresh();
      const version = versionOf(service);
      const state = service.state();
      const usable =
        state.kind === "installed" || (state.kind === "override" && state.problem === null);
      const result = usable ? probe.touch() : null;
      const checks: NonNullable<PluginStatusReport["checks"]> = usable
        ? preconditionsOf(service.platform, process.env, result).map((p) => {
            const en = split(p.text.en, ": ");
            const zh = split(p.text.zh, "：");
            const guide =
              service.platform === "darwin" &&
              p.ok === false &&
              (p.id === "accessibility" || p.id === "screen-recording");
            return {
              id: p.id,
              label: en.label,
              labelZh: zh.label,
              state: p.ok === true ? "ok" : p.ok === false ? "action" : "unknown",
              ...(en.text !== undefined ? { text: en.text } : {}),
              ...(zh.text !== undefined ? { textZh: zh.text } : {}),
              ...(p.detail !== undefined ? { details: p.detail, detailsZh: p.detail } : {}),
              ...(guide ? { action: "guide" } : {}),
            };
          })
        : [];
      if (usable && result?.unavailable !== undefined) {
        checks.unshift({
          id: "agent-desktop",
          label: "agent-desktop",
          state: "action",
          text: "It did not answer.",
          textZh: "它没有应答。",
          details: result.unavailable,
          detailsZh: result.unavailable,
        });
      }
      const summary: NonNullable<PluginStatusReport["summary"]> =
        version.state === "preparing"
          ? {
              state: "progress",
              text: "Installing agent-desktop.",
              textZh: "正在安装 agent-desktop。",
            }
          : !usable || checks.some((c) => c.state === "action")
            ? {
                state: "attention",
                text: usable
                  ? "Computer Use needs something on this machine: see the checks."
                  : "Computer Use cannot run until agent-desktop is installed.",
                textZh: usable
                  ? "电脑操作需要这台机器满足一些条件：见下方检查项。"
                  : "安装 agent-desktop 之前电脑操作无法运行。",
              }
            : result === null
              ? { state: "progress", text: "Checking this machine…", textZh: "正在检查这台机器…" }
              : {
                  state: "ready",
                  text: "Ready: Agents can use Computer Use.",
                  textZh: "就绪：Agent 可以使用电脑操作。",
                };
      return {
        summary,
        version,
        ...(checks.length > 0 ? { checks } : {}),
        ...(usable ? { recheck: "check" } : {}),
      };
    },
    notices() {
      const { service, probe } = ready();
      if (!service.settings().enabled) return [];
      void service.refresh();
      const out: Notice[] = [
        {
          tone: "muted",
          text: "An Agent with Computer Use can operate any window on this desktop, including a browser tab showing the PenguinHarness Web App, where it could approve its own requests or change settings. Do not leave the Web App open on this desktop while an Agent uses Computer Use; the desktop app's own windows are protected.",
          textZh:
            "使用电脑操作的 Agent 能操作这个桌面上的任何窗口，包括显示 PenguinHarness Web App 的浏览器标签页，并可能在那里批准自己的请求或修改设置。Agent 使用电脑操作时，不要在这个桌面上开着 Web App；桌面应用自己的窗口受到保护。",
        },
        ...(reported ? [] : [installNotice(service)]),
      ];
      const state = service.state();
      if (state.kind === "installed" && state.installed.helperProblem !== undefined) {
        out.push({
          tone: "attention",
          text: `${state.installed.helperProblem} can be written by other users, so agent-desktop refuses its clipboard helper below it. Remove group and other write access from that directory.`,
          textZh: `${state.installed.helperProblem} 可被其他用户写入，agent-desktop 因此拒绝其下的剪贴板辅助程序。请去掉该目录的组与其他用户写权限。`,
        });
      }
      if (reported || (state.kind !== "installed" && state.kind !== "override")) return out;
      const result = probe.touch();
      if (result === null) {
        out.push({ tone: "muted", text: "Checking this machine…", textZh: "正在检查这台机器…" });
        return out;
      }
      if (result.unavailable !== undefined) {
        out.push({
          tone: "attention",
          text: `agent-desktop did not answer: ${result.unavailable}`,
          textZh: `agent-desktop 没有应答：${result.unavailable}`,
        });
        return out;
      }
      for (const p of preconditionsOf(service.platform, process.env, result)) {
        out.push({
          tone: p.ok === false ? "attention" : "muted",
          text: p.text.en,
          textZh: p.text.zh,
          ...(p.detail !== undefined ? { details: p.detail, detailsZh: p.detail } : {}),
        });
      }
      return out;
    },
    actions() {
      const { service, probe } = ready();
      if (!service.settings().enabled) return [];
      const state = service.state();
      const out: ReturnType<SettingsGroupStatus["actions"]> = [];
      if (state.kind === "missing" || state.kind === "failed") {
        out.push({
          id: "install",
          title: state.kind === "failed" ? "Retry" : "Install agent-desktop",
          titleZh: state.kind === "failed" ? "重试" : "安装 agent-desktop",
          description: `Downloads agent-desktop ${service.pin.version} from the npm registry of Plugin Sources (then its npm registry mirror, when one is chosen under Plugin mirrors), checks it against the pinned digests and keeps this machine's program.`,
          descriptionZh: `从「插件源」的 npm registry（若在「插件镜像」中选了 npm registry 镜像，再试该镜像）下载 agent-desktop ${service.pin.version}，按钉死的摘要校验，只保留本机的程序。`,
        });
      }
      if (state.kind === "installed" || state.kind === "override") {
        out.push({
          id: "check",
          title: "Check again",
          titleZh: "重新检查",
          description: "Asks agent-desktop again what this machine offers.",
          descriptionZh: "重新向 agent-desktop 询问这台机器的情况。",
        });
        const missing = preconditionsOf(service.platform, process.env, probe.latest()).some(
          (p) => p.ok === false && (p.id === "accessibility" || p.id === "screen-recording"),
        );
        if (service.platform === "darwin" && missing) {
          out.push({
            id: "guide",
            title: "Open System Settings",
            titleZh: "打开系统设置",
            description:
              "Opens Privacy & Security at the permission still missing, with a guide naming the app to allow.",
            descriptionZh: "打开「隐私与安全性」中尚缺的权限，并附上指明应授权应用的引导。",
          });
        }
      }
      return out;
    },
    async run(action) {
      const { service, probe } = ready();
      if (action === "install") {
        const settled = service.install().then(async () => {
          if (service.state().kind === "installed") await probe.refresh();
        });
        return {
          ok: true,
          message: "Installing agent-desktop: its progress shows on the card.",
          messageZh: "正在安装 agent-desktop：进度显示在卡片上。",
          settled,
        };
      }
      if (action === "check") {
        await probe.refresh();
        return { ok: true, message: "Checked again.", messageZh: "已重新检查。" };
      }
      if (action === "guide") {
        const choice = await service.program();
        if (!choice.ok) return { ok: false, message: choice.message };
        const out = await service.run(choice, ["permissions", "--guide"], {
          stateDir: await service.probeDir(),
          budgetMs: 30_000,
        });
        await probe.refresh();
        return out.envelope?.ok === true
          ? {
              ok: true,
              message:
                "System Settings is open: allow PenguinHarness there, then select Check again.",
              messageZh: "系统设置已打开：在其中允许 PenguinHarness，然后点「重新检查」。",
            }
          : {
              ok: false,
              message: `System Settings could not be opened: ${out.envelope?.error?.message ?? out.stderr.trim()}`,
              messageZh: `无法打开系统设置：${out.envelope?.error?.message ?? out.stderr.trim()}`,
            };
      }
      return { ok: false, message: `No action ${action}.`, messageZh: `没有 ${action} 操作。` };
    },
    async saved() {
      const { service, probe } = ready();
      await service.refresh();
      const s = service.settings();
      if (s.enabled && s.binaryPath === "" && service.state().kind === "missing")
        void service.install();
      if (
        s.enabled &&
        (service.state().kind === "installed" || service.state().kind === "override")
      ) {
        await probe.refresh();
      }
    },
  };
}

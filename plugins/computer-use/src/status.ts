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
}

type Notice = ReturnType<SettingsGroupStatus["notices"]>[number];

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
        text: `agent-desktop ${v} could not be installed: ${state.message}`,
        textZh: `agent-desktop ${v} 安装失败：${state.message}`,
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
  return {
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
        installNotice(service),
      ];
      const state = service.state();
      if (state.kind === "installed" && state.installed.helperProblem !== undefined) {
        out.push({
          tone: "attention",
          text: `${state.installed.helperProblem} can be written by other users, so agent-desktop refuses its clipboard helper below it. Remove group and other write access from that directory.`,
          textZh: `${state.installed.helperProblem} 可被其他用户写入，agent-desktop 因此拒绝其下的剪贴板辅助程序。请去掉该目录的组与其他用户写权限。`,
        });
      }
      if (state.kind !== "installed" && state.kind !== "override") return out;
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
          description: `Downloads agent-desktop ${service.pin.version} from the npm registry of Plugin Sources, checks it against the pinned digests and keeps this machine's program.`,
          descriptionZh: `从「插件源」的 npm registry 下载 agent-desktop ${service.pin.version}，按钉死的摘要校验，只保留本机的程序。`,
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

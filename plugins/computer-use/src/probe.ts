/**
 * What this machine offers agent-desktop, as the card and `penguin computer status` report it: the
 * preconditions of each operating system, read from agent-desktop's own `status` (and on Linux a
 * `list-windows`, which is how a missing window manager shows), and from the server's own
 * environment. Reported, never worked around (05 「Computer Use」).
 *
 * The card's notices are read synchronously on every page load, so the probe keeps its last
 * result and refreshes it in the background once it is older than PROBE_TTL_MS.
 */
import type { IdleReading } from "./idle.js";
import type { Envelope } from "./runner.js";
import type { ComputerUseService } from "./service.js";

export const PROBE_TTL_MS = 30_000;

export interface ProbeResult {
  at: number;
  /** agent-desktop's `status`, or null when it could not run. */
  status: Envelope | null;
  /** Linux: `list-windows`. */
  windows: Envelope | null;
  /** Why the probe could not run agent-desktop at all. */
  unavailable?: string;
  /** The user's input idle time, or why it cannot be read here. */
  idle?: IdleReading;
}

/** One precondition: what it is, whether it holds (null: not known), and what to do about it. */
export interface Precondition {
  id: string;
  ok: boolean | null;
  text: { en: string; zh: string };
  /** What agent-desktop itself said, in its own words (English), shown beneath. */
  detail?: string;
}

type Permission = { state?: string; suggestion?: string };

function permissionOf(status: Envelope | null, name: string): Permission | undefined {
  const data = status?.data as { permissions?: Record<string, Permission> } | undefined;
  return data?.permissions?.[name];
}

/** The preconditions of `platform`, from a probe and the server's environment. */
export function preconditionsOf(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  probe: ProbeResult | null,
): Precondition[] {
  const out: Precondition[] = [];
  const status = probe?.status ?? null;
  const accessibility = permissionOf(status, "accessibility");
  if (platform === "linux") {
    const display = env.WAYLAND_DISPLAY ?? env.DISPLAY;
    out.push(
      display !== undefined && display !== ""
        ? {
            id: "display",
            ok: true,
            text: {
              en: `Display: ${env.WAYLAND_DISPLAY ? `Wayland ${env.WAYLAND_DISPLAY} (no pointer input; screenshots ask for consent)` : `X11 ${env.DISPLAY}`}`,
              zh: `显示：${env.WAYLAND_DISPLAY ? `Wayland ${env.WAYLAND_DISPLAY}（没有指针输入；截图需征得同意）` : `X11 ${env.DISPLAY}`}`,
            },
          }
        : {
            id: "display",
            ok: false,
            text: {
              en: "Display: the server has neither DISPLAY nor WAYLAND_DISPLAY. Start it inside the desktop session.",
              zh: "显示：服务端既没有 DISPLAY 也没有 WAYLAND_DISPLAY。请在桌面会话中启动它。",
            },
          },
    );
    if (accessibility !== undefined) {
      out.push(
        accessibility.state === "granted"
          ? {
              id: "accessibility",
              ok: true,
              text: {
                en: "Session bus and accessibility bus: reachable",
                zh: "会话总线与无障碍总线：可达",
              },
            }
          : {
              id: "accessibility",
              ok: false,
              text: {
                en: "Session bus and accessibility bus: not reachable. Start the server inside the desktop session, or under dbus-run-session.",
                zh: "会话总线与无障碍总线：不可达。请在桌面会话中启动服务端，或在 dbus-run-session 下启动。",
              },
              ...(accessibility.suggestion !== undefined
                ? { detail: accessibility.suggestion }
                : {}),
            },
      );
    }
    const windows = probe?.windows ?? null;
    if (windows !== null && accessibility?.state === "granted") {
      const kind = (windows.error?.details as { kind?: unknown } | undefined)?.kind;
      const open = Array.isArray(windows.data) ? windows.data.length : 0;
      out.push(
        windows.ok && open > 0
          ? {
              id: "window-manager",
              ok: true,
              text: { en: "Window manager: windows are visible", zh: "窗口管理器：窗口可见" },
            }
          : windows.ok
            ? {
                id: "window-manager",
                ok: null,
                text: {
                  en: "Window manager: no window is open to check it with",
                  zh: "窗口管理器：没有打开的窗口可供检查",
                },
              }
            : kind === "native_window_unproven"
              ? {
                  id: "window-manager",
                  ok: false,
                  text: {
                    en: "Window manager: none proves the windows. agent-desktop needs an EWMH window manager (any desktop environment's, or openbox).",
                    zh: "窗口管理器：没有窗口管理器为窗口作证。agent-desktop 需要 EWMH 窗口管理器（任一桌面环境自带的，或 openbox）。",
                  },
                }
              : {
                  id: "window-manager",
                  ok: false,
                  text: {
                    en: "Window manager: listing the windows failed.",
                    zh: "窗口管理器：列出窗口失败。",
                  },
                  detail: `${windows.error?.code ?? "error"}: ${windows.error?.message ?? ""}`,
                },
      );
    }
  } else if (platform === "darwin") {
    if (accessibility !== undefined) {
      out.push(
        accessibility.state === "granted"
          ? {
              id: "accessibility",
              ok: true,
              text: { en: "Accessibility: granted", zh: "辅助功能：已授权" },
            }
          : {
              id: "accessibility",
              ok: false,
              text: {
                en: "Accessibility: not granted. Computer Use cannot read or operate other apps until PenguinHarness is allowed in System Settings → Privacy & Security → Accessibility.",
                zh: "辅助功能：未授权。在「系统设置 › 隐私与安全性 › 辅助功能」中允许 PenguinHarness 之前，Computer Use 无法读取或操作其他应用。",
              },
            },
      );
    }
    const screen = permissionOf(status, "screen_recording");
    if (screen !== undefined && screen.state !== "not_required") {
      out.push(
        screen.state === "granted"
          ? {
              id: "screen-recording",
              ok: true,
              text: { en: "Screen Recording: granted", zh: "屏幕录制：已授权" },
            }
          : {
              id: "screen-recording",
              ok: false,
              text: {
                en: "Screen Recording: not granted. Only screenshots need it.",
                zh: "屏幕录制：未授权。只有截图需要它。",
              },
            },
      );
    }
  } else if (platform === "win32") {
    const session = env.SESSIONNAME;
    const interactive = session === "Console" || (session?.startsWith("RDP-") ?? false);
    out.push(
      interactive
        ? {
            id: "interactive-session",
            ok: true,
            text: { en: `Interactive desktop: ${session}`, zh: `交互式桌面：${session}` },
          }
        : {
            id: "interactive-session",
            ok: false,
            text: {
              en: "Interactive desktop: not detected. agent-desktop needs the signed-in user's desktop: a server run as a service, over SSH or in Session 0 sees no apps.",
              zh: "交互式桌面：未检测到。agent-desktop 需要已登录用户的桌面：以服务、经 SSH 或在 Session 0 中运行的服务端看不到任何应用。",
            },
          },
    );
    if (
      accessibility !== undefined &&
      accessibility.state !== "granted" &&
      accessibility.state !== "not_required"
    ) {
      out.push({
        id: "accessibility",
        ok: false,
        text: {
          en: "UI Automation: not available to this server.",
          zh: "UI Automation：此服务端无法使用。",
        },
        detail: `${accessibility.state ?? "unknown"}${accessibility.suggestion ? `: ${accessibility.suggestion}` : ""}`,
      });
    }
  }
  const idle = probe?.idle;
  if (idle !== undefined) {
    out.push(
      idle.seconds !== null
        ? {
            id: "idle",
            ok: true,
            text: {
              en: `User activity: readable (${idle.source}), so commands can pause while the person at this computer is using it`,
              zh: `用户活动：可读取（${idle.source}），命令可以在有人使用这台电脑时暂停`,
            },
          }
        : {
            id: "idle",
            ok: null,
            text: {
              en: "User activity: unknown here, so commands do not pause while someone is using this computer",
              zh: "用户活动：此处无法读取，因此有人使用这台电脑时命令不会暂停",
            },
            ...(idle.reason !== undefined ? { detail: idle.reason } : {}),
          },
    );
  }
  return out;
}

/** The last probe, refreshed in the background when stale. */
export class Probe {
  private last: ProbeResult | null = null;
  private running: Promise<ProbeResult> | null = null;

  constructor(
    private readonly service: ComputerUseService,
    private readonly now: () => number = Date.now,
  ) {}

  latest(): ProbeResult | null {
    return this.last;
  }

  /** Starts a refresh when the last result is older than the TTL; returns what is in hand. */
  touch(): ProbeResult | null {
    if (this.last === null || this.now() - this.last.at > PROBE_TTL_MS) void this.refresh();
    return this.last;
  }

  /** Runs the probe now (joining one that runs). */
  refresh(): Promise<ProbeResult> {
    this.running ??= this.read().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async read(): Promise<ProbeResult> {
    const idle = await this.service.idle();
    const choice = await this.service.program();
    if (!choice.ok) {
      this.last = {
        at: this.now(),
        status: null,
        windows: null,
        unavailable: choice.message,
        idle,
      };
      return this.last;
    }
    const stateDir = await this.service.probeDir();
    const status = await this.service.run(choice, ["status"], { stateDir, budgetMs: 10_000 });
    const windows =
      this.service.platform === "linux"
        ? await this.service.run(choice, ["list-windows"], { stateDir, budgetMs: 5_000 })
        : null;
    this.last = {
      at: this.now(),
      status: status.envelope,
      windows: windows?.envelope ?? null,
      idle,
      ...(status.envelope === null
        ? {
            unavailable:
              status.spawnError ??
              (status.timedOut
                ? "agent-desktop status did not answer"
                : `agent-desktop status exited ${status.code}`),
          }
        : {}),
    };
    return this.last;
  }
}

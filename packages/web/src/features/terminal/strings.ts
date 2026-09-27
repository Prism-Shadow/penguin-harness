/**
 * The terminal module's UI copy: the zh and en fragments of the app dictionaries.
 *
 * The app dictionaries (lib/strings.ts, lib/strings-en.ts) mount these objects by reference
 * as their `terminal` section, so components keep reading `S.terminal.*` and a locale switch
 * still swaps the whole tree. A new terminal string is added here, to both fragments, and
 * nowhere else — `TerminalStrings` makes a key missing from `terminalEn` a type error.
 */

export const terminalZh = {
  title: "终端",
  newShell: "新建终端",
  /** Tab strip ×: kills the shell itself (server-side), unlike closing the dock. */
  killShell: "关闭此终端",
  /** Pane body when creating/attaching a shell failed (the server message follows). */
  createFailed: "终端创建失败",
  /** A create that 404s: the server predates the terminal API (or the shell attached to an older one). */
  noTerminalApi:
    "该服务端没有终端接口：运行中的 runtime 早于该功能。热更新只替换平台与前端，终端接口属于 runtime，需更新 runtime 本身（重启无效）",
  /** Codex-style handoff: opens /terminal?id=… in a new window, the dock lets go. */
  detach: "在新窗口打开",
  status: {
    connecting: "连接中",
    ready: "已连接",
    /** The pty is fine; this page's socket dropped and is being reattached. */
    reconnecting: "重连中",
    exited: "已退出",
    error: "连接错误",
  },
  /** Suffix shown after `status.exited`; `code` is the shell's numeric exit code. */
  exitedWithCode: (code: string): string => `退出码 ${code}`,
  /**
   * The touch key bar (terminal-keybar.tsx), shown only under `(pointer: coarse)`: the
   * keys a phone's soft keyboard has none of. Cap faces are the key names themselves
   * (Esc / Tab / Ctrl / Alt / ^C) and stay untranslated, as on a physical keyboard; these
   * are their accessible names.
   */
  touchKeys: {
    label: "终端快捷键",
    esc: "Esc 键",
    tab: "Tab 键",
    /** Sticky: tap to arm, the next character composes with it. */
    ctrl: "Ctrl 键（点一下，下一个字符生效）",
    alt: "Alt 键（点一下，下一个字符生效）",
    up: "上方向键",
    down: "下方向键",
    left: "左方向键",
    right: "右方向键",
    interrupt: "中断（Ctrl+C）",
    paste: "粘贴",
    hideKeyboard: "收起键盘",
    showKeyboard: "调出键盘",
  },
  /** Confirming a shell kill (dock tab × and the /terminal page): it ends the process, so it asks first. `name` is the tab label. */
  killConfirmTitle: "关闭此终端？",
  killConfirmBody: (name: string): string => `将结束 Shell「${name}」的进程，无法恢复。`,
};

/** Fragment shape: constrains the en fragment so keys and function signatures line up. */
export type TerminalStrings = typeof terminalZh;

export const terminalEn: TerminalStrings = {
  title: "Terminal",
  newShell: "New terminal",
  killShell: "Kill this terminal",
  createFailed: "Could not start a terminal",
  noTerminalApi:
    "this server has no terminal API: the running runtime predates it. A hot push replaces the platform and Web App, but the terminal endpoints are runtime-owned — the runtime itself has to be updated (restarting will not help)",
  detach: "Open in new window",
  status: {
    connecting: "connecting",
    ready: "ready",
    reconnecting: "reconnecting",
    exited: "exited",
    error: "error",
  },
  exitedWithCode: (code: string): string => `exit code ${code}`,
  touchKeys: {
    label: "Terminal keys",
    esc: "Escape",
    tab: "Tab",
    ctrl: "Ctrl (tap, then the next character)",
    alt: "Alt (tap, then the next character)",
    up: "Arrow up",
    down: "Arrow down",
    left: "Arrow left",
    right: "Arrow right",
    interrupt: "Interrupt (Ctrl+C)",
    paste: "Paste",
    hideKeyboard: "Dismiss the keyboard",
    showKeyboard: "Show the keyboard",
  },
  killConfirmTitle: "Close this terminal?",
  killConfirmBody: (name: string): string =>
    `This ends the shell "${name}" — it cannot be restored.`,
};

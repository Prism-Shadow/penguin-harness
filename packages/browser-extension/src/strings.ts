/**
 * The extension's copy in English and Chinese. The pages and the toolbar title are in English
 * until the user picks 中文 with the switch on the options page or in the popup; the browser's
 * own language plays no part (storage.ts keeps the choice). The two dictionaries are typed
 * against each other, so a key missing from one fails the typecheck.
 */

export type UiLanguage = "en" | "zh";

export const UI_LANGUAGES: readonly UiLanguage[] = ["en", "zh"];

/** What the switch shows for each language, each in its own language. */
export const LANGUAGE_NAMES: Record<UiLanguage, string> = { en: "EN", zh: "中文" };

/** The `lang` attribute a page takes in each language. */
export const LANGUAGE_TAGS: Record<UiLanguage, string> = { en: "en", zh: "zh-CN" };

const en = {
  appName: "PenguinHarness Browser",
  titleConnected: (labels: string) => `PenguinHarness Browser — connected to ${labels}`,
  titleNotConnected: "PenguinHarness Browser — not connected",
  titlePaused: "PenguinHarness Browser — paused",
  groupTitle: "Penguin",
  languageLabel: "Language",

  pairHeading: "PenguinHarness Browser",
  pairIntro:
    "Lets the agents of a PenguinHarness server drive the Chrome tabs you hand them: the tabs they open in the Penguin group, and tabs you add with the toolbar icon. Your other tabs, your browsing history and Chrome's cookie store stay out of reach.",
  pairedTitle: "Paired servers",
  pairedNone: "No server is paired yet.",
  pairedBy: (user: string) => `paired by ${user}`,
  remove: "Remove",
  removeHint: "Forgets the server here. Revoke it in the Web App too, under Settings › Browser.",
  addTitle: "Add a server",
  serverUrlLabel: "Server address",
  serverUrlPlaceholder: "https://penguin.example.com",
  codeLabel: "Pairing code",
  codePlaceholder: "Paste the code from the Web App",
  connect: "Connect",
  connecting: "Connecting…",
  stepsTitle: "How to pair",
  step1: "In the PenguinHarness Web App, open the Browser panel and choose Connect your Chrome.",
  step2:
    "Copy the server address and the pairing code it shows. The code works once, for 10 minutes.",
  step3: "Paste both here and choose Connect.",
  docsLink: "Using your own Chrome",
  docsUrl: "https://penguin.ooo/docs/builtin-browser",
  updateAvailable: (version: string) =>
    `The server runs ${version}; update this extension to match.`,

  statusConnected: "Connected",
  statusConnecting: "Connecting",
  statusWaiting: "Not reachable; retrying",
  statusReplaced: "Another Chrome took over this pairing",
  statusRevoked: "Revoked in the Web App",
  statusProtocolMismatch: "This extension is too old or too new for the server; update it",
  statusDisabled: "Turned off by the server's administrator; retrying hourly",
  statusStopped: "Not connected",
  reconnect: "Reconnect",

  errorUrlEmpty: "Enter the server's address.",
  errorUrlInvalid: "That is not a web address.",
  errorUrlScheme: "The address must start with http:// or https://.",
  errorCode: "Paste the whole pairing code: 43 letters, digits, - or _.",
  errorUnreachable: (origin: string) =>
    `${origin} did not answer. Check the address, and that the server is running.`,
  errorRefused: (message: string) => `The server refused the code: ${message}`,
  errorBadResponse: "The server's answer is not a pairing. Is this a PenguinHarness server?",
  paired: (label: string) => `Paired with ${label}.`,

  popupTabs: (count: number) =>
    count === 0
      ? "No tabs handed over"
      : count === 1
        ? "1 tab handed over"
        : `${count} tabs handed over`,
  popupAdd: "Add this tab",
  popupAddTo: (label: string) => `Add this tab to ${label}`,
  popupRelease: "Release this tab",
  popupDriven: (label: string) => `${label} may drive this tab.`,
  popupReleased: "You stopped the agent on this tab. Add it again to hand it back.",
  popupRestricted: "Chrome does not let extensions drive this page.",
  popupPause: "Pause",
  popupResume: "Resume",
  popupPaused: "Paused: agents cannot act in any tab until you resume.",
  popupSettings: "Settings",
  popupNotPaired: "No server is paired. Open Settings to pair one.",
};

export type Strings = typeof en;

const zh: Strings = {
  appName: "PenguinHarness Browser",
  titleConnected: (labels) => `PenguinHarness Browser — 已连接 ${labels}`,
  titleNotConnected: "PenguinHarness Browser — 未连接",
  titlePaused: "PenguinHarness Browser — 已暂停",
  groupTitle: "Penguin",
  languageLabel: "界面语言",

  pairHeading: "PenguinHarness Browser",
  pairIntro:
    "让 PenguinHarness 服务器上的 Agent 驱动你交给它的 Chrome 标签页：它在 Penguin 标签组里打开的标签页，以及你用工具栏图标添加的标签页。其他标签页、浏览历史和 Chrome 的 Cookie 存储都不会被触及。",
  pairedTitle: "已配对的服务器",
  pairedNone: "还没有配对任何服务器。",
  pairedBy: (user) => `由 ${user} 配对`,
  remove: "移除",
  removeHint: "只在这里忘记该服务器。请同时在 Web App 的「设置 › 浏览器」中撤销。",
  addTitle: "添加服务器",
  serverUrlLabel: "服务器地址",
  serverUrlPlaceholder: "https://penguin.example.com",
  codeLabel: "配对码",
  codePlaceholder: "粘贴 Web App 给出的配对码",
  connect: "连接",
  connecting: "正在连接…",
  stepsTitle: "如何配对",
  step1: "在 PenguinHarness Web App 中打开浏览器面板，选择「连接你的 Chrome」。",
  step2: "复制面板给出的服务器地址和配对码。配对码只能用一次，10 分钟内有效。",
  step3: "把两者粘贴到这里，选择「连接」。",
  docsLink: "使用你自己的 Chrome",
  docsUrl: "https://penguin.ooo/docs/builtin-browser",
  updateAvailable: (version) => `服务器版本为 ${version}，请更新本扩展。`,

  statusConnected: "已连接",
  statusConnecting: "正在连接",
  statusWaiting: "无法访问，稍后重试",
  statusReplaced: "另一个 Chrome 接管了此配对",
  statusRevoked: "已在 Web App 中撤销",
  statusProtocolMismatch: "扩展版本与服务器不匹配，请更新扩展",
  statusDisabled: "服务器管理员已关闭此功能，每小时重试一次",
  statusStopped: "未连接",
  reconnect: "重新连接",

  errorUrlEmpty: "请输入服务器地址。",
  errorUrlInvalid: "这不是一个网址。",
  errorUrlScheme: "地址必须以 http:// 或 https:// 开头。",
  errorCode: "请粘贴完整的配对码：43 个字母、数字、- 或 _。",
  errorUnreachable: (origin) => `${origin} 没有响应。请检查地址，并确认服务器正在运行。`,
  errorRefused: (message) => `服务器拒绝了配对码：${message}`,
  errorBadResponse: "服务器的回应不是配对结果。这是 PenguinHarness 服务器吗？",
  paired: (label) => `已与 ${label} 配对。`,

  popupTabs: (count) => (count === 0 ? "没有交出的标签页" : `已交出 ${count} 个标签页`),
  popupAdd: "添加此标签页",
  popupAddTo: (label) => `将此标签页交给 ${label}`,
  popupRelease: "收回此标签页",
  popupDriven: (label) => `${label} 可以驱动此标签页。`,
  popupReleased: "你已停止 Agent 操作此标签页。再次添加即可交还。",
  popupRestricted: "Chrome 不允许扩展驱动此页面。",
  popupPause: "暂停",
  popupResume: "继续",
  popupPaused: "已暂停：恢复之前，Agent 无法在任何标签页中操作。",
  popupSettings: "设置",
  popupNotPaired: "还没有配对服务器。打开「设置」进行配对。",
};

export function stringsFor(language: UiLanguage): Strings {
  return language === "zh" ? zh : en;
}

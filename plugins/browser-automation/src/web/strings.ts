/**
 * The agent browser's UI copy: its own zh and en tables, outside the app dictionaries
 * (lib/strings.ts, lib/strings-en.ts). Read as `S` inside this folder: the face's live view
 * (`defineStrings` in @prismshadow/penguin-web-plugin) answers from the table of the language on
 * screen, so components keep reading `S.builtinBrowser.*` at render time and a language switch
 * still reaches them. A new string is added here, to both tables, and nowhere else —
 * `BrowserStrings` makes a key missing from `en` a type error.
 */
import { defineStrings } from "@prismshadow/penguin-web-plugin";
import type {
  BuiltinBrowserCookieSkip,
  BuiltinBrowserImportNote,
} from "@prismshadow/penguin-server/api";
import type { StartPageSiteId } from "./browser-start-sites";
import type { ImportExtensionRoute } from "./browser-import-route";

export const zh = {
  /** The agent browser — the built-in one (desktop app) or the user's own Chrome: its dock panel, toolbar and dialogs. */
  builtinBrowser: {
    panelTitle: "浏览器",
    machinePages: "这些页面在此会话所属机器的桌面浏览器中打开。",
    /** The browser's own tab strip (its accessible name). */
    tabs: "标签页",
    newTab: "新建标签页",
    closeTab: "关闭标签页",
    /** A tab with no title yet — a blank new tab. */
    untitled: "新标签页",
    back: "后退",
    forward: "前进",
    reload: "重新加载",
    stop: "停止加载",
    /** The address bar's accessible name, and its placeholder. */
    address: "地址栏",
    addressPlaceholder: "搜索或输入网址",
    /** The history suggestions under the address bar (their accessible name). */
    suggestions: "历史记录",
    /** The toolbar's overflow menu. */
    more: "更多",
    importAction: "从浏览器导入…",
    clearDataAction: "清除浏览数据…",
    /** Opens the homepage dialog. */
    setHomepageAction: "设置主页…",
    openExternal: "在系统浏览器中打开",
    devTools: "开发者工具",
    /** The toolbar's button to the homepage, beside reload; shown only while one is set. */
    home: "主页",
    /** The toolbar's mark while an agent drives the browser; `action` is one of `actions`. */
    agentBusy: (action: string): string => `智能体正在使用浏览器：${action}`,
    /** A busy tab's tooltip in the strip, after its title. */
    agentBusyTab: "智能体正在使用此标签页",
    actions: {
      navigate: "打开网页",
      scan: "读取页面",
      exec: "运行脚本",
      click: "点击页面",
      type: "输入文字",
      screenshot: "截取屏幕",
      cdp: "发送调试命令",
    },
    /** The panel where the browser cannot run; the title, then why. */
    unavailableTitle: "内置浏览器不可用",
    unavailableDesktop: "内置浏览器只能在 PenguinHarness 桌面应用中使用。",
    unavailableShell: "当前桌面应用版本过旧，请更新后使用内置浏览器。",
    unavailableWindow: "没有可以显示浏览器的应用窗口。",
    /** After the reason, where the server offers Chrome but none is paired: where to pair one. */
    unavailablePairChrome: "要让 Agent 改用你的 Chrome，先在设置 › 浏览器中配对。",
    /** The unavailable built-in panel's way out, where the server offers the user's Chrome. */
    useChrome: "改用系统 Chrome",
    /** A new tab without a homepage: the start page's common sites, and its landmark's name. */
    startPage: {
      label: "常用网站",
      sites: {
        google: "谷歌",
        bing: "必应",
        baidu: "百度",
        github: "GitHub",
        stackoverflow: "Stack Overflow",
        wikipedia: "维基百科",
      } satisfies Record<StartPageSiteId, string>,
    },
    openFailed: (reason: string): string => `无法打开标签页：${reason}`,
    closeFailed: (reason: string): string => `无法关闭标签页：${reason}`,
    /** The two backends, as Settings › Browser offers them (desktop app). */
    backendBuiltin: "内置",
    backendChrome: "系统 Chrome",
    /** The Chrome surface's menu row: the user's Chrome as the server last said. */
    chromeConnected: (name: string | null): string =>
      name !== null ? `Chrome：已连接 · ${name}` : "Chrome：已连接",
    chromeNotConnected: "Chrome：未连接",
    chromeNotPaired: "尚未配对 Chrome",
    chromeDisabled: "Chrome 连接已关闭",
    /** The status row's action: the pairing dialog, or Settings › Browser once one is paired. */
    connectChrome: "连接你的 Chrome…",
    manageChrome: "管理…",
    /** The toast after a switch, and the one when an agent at work refuses it. */
    switchedToChrome: "Agent 现在使用你的 Chrome",
    switchedToBuiltin: "Agent 现在使用内置浏览器",
    switchRefused: "Agent 正在使用浏览器，等它完成后再切换",
    switchFailed: (reason: string): string => `无法切换浏览器：${reason}`,
    /** The Chrome surface: in place of the page, a card for a tab that lives in the user's Chrome. */
    chromeTabCard: "此标签页在你的 Chrome 中打开",
    showInChrome: "在 Chrome 中显示",
    chromeNoTabsTitle: "你的 Chrome 里还没有 Agent 的标签页",
    chromeNoTabsBody: "Agent 打开的页面会出现在 Chrome 的 Penguin 标签组里。",
    /** Paired but not connected: the title, which Chrome, and the fold with what to check. */
    chromeDisconnectedTitle: "Chrome 未连接",
    chromeDisconnectedBody: (name: string | null): string =>
      name !== null
        ? `${name} 现在没有连到这台服务器。`
        : "你配对的 Chrome 现在没有连到这台服务器。",
    reconnectHelp: "重新连接帮助",
    reconnectOpen: "打开 Chrome，确认 PenguinHarness Browser 扩展在 chrome://extensions 中已启用。",
    reconnectResume: "点工具栏上的扩展图标；如果显示已暂停，选择「继续」。",
    reconnectPair: "服务器地址变了，或扩展里移除了这台服务器时，需要重新配对。",
    /** The admin's switch is off. */
    chromeDisabledTitle: "Chrome 连接已关闭",
    chromeDisabledBody: "这台服务器的管理员关闭了 Chrome 扩展连接。",
    /** No Chrome paired: the line above the pairing steps the panel shows in its place. */
    chromeUnpairedIntro:
      "安装 PenguinHarness Browser 扩展并完成配对后，Agent 就能在你自己的 Chrome 里打开和操作网页，使用你在 Chrome 中的登录状态。",
    /** The pairing dialog, and the same three steps inline in the panel while no Chrome is paired. */
    pairTitle: "连接你的 Chrome",
    pairStepInstall:
      "安装扩展并把它固定到工具栏。推荐从 Chrome 应用商店安装，Chrome 会自动更新它。",
    pairStore: "打开 Chrome 应用商店",
    /** Under the store link: the zip, for a network that cannot reach the store. */
    pairStepInstallZip:
      "打不开商店时，也可以下载 zip 并解压，在 chrome://extensions 开启「开发者模式」，选择「加载已解压的扩展程序」并选中解压出的文件夹。",
    pairDownload: "下载扩展（zip）",
    pairStepOpen: "点工具栏上的 PenguinHarness Browser 图标，选择「设置」，打开扩展的配对页。",
    pairStepPaste: "把下面的服务器地址和配对码粘贴进去，选择「连接」。",
    pairServer: "服务器地址",
    pairCode: "配对码",
    /** Under the code: one use, until when (a local HH:mm). */
    pairCodeExpiry: (time: string): string => `只能使用一次，${time} 前有效`,
    pairCodeExpired: "配对码已过期",
    pairNewCode: "换一个",
    pairCodeFailed: (reason: string): string => `无法生成配对码：${reason}`,
    pairWaiting: "正在等待 Chrome…",
    pairConnected: "已连接",
    /** The import dialog: copies sign-ins and history from a browser installed on this computer. */
    importTitle: "从浏览器导入",
    importIntro:
      "将系统浏览器的登录状态导入当前 Project，历史记录导入内置浏览器。其他 Project 的登录状态和原浏览器的数据不会改变。",
    importLoading: "正在查找浏览器…",
    importNone: "这台电脑上没有找到可以导入的浏览器。",
    importSourcesFailed: (reason: string): string => `无法读取浏览器列表：${reason}`,
    importSource: "导入来源",
    importWhat: "导入内容",
    importCookies: "Cookie 与登录状态",
    importHistory: "历史记录",
    importDomains: "仅限这些网站",
    importDomainsHint: "用逗号分隔，例如 amazon.com, github.com；留空则导入全部网站",
    importDomainsPlaceholder: "amazon.com, github.com",
    importKeychainNote: "Mac 可能会请求钥匙串访问权限。",
    importRun: "导入",
    importRunning: "正在导入…",
    importDone: "完成",
    importCookiesResult: (c: {
      found: number;
      imported: number;
      skipped: number;
      failed: number;
    }): string =>
      `Cookie：已导入 ${c.imported} / ${c.found}` +
      (c.skipped > 0 ? `，跳过 ${c.skipped}` : "") +
      (c.failed > 0 ? `，失败 ${c.failed}` : ""),
    importHistoryResult: (h: { found: number; imported: number }): string =>
      `历史记录：已导入 ${h.imported} / ${h.found} 条`,
    /** Under the counts: why that many cookies were skipped; `browser` is the source's name. */
    importSkip: ({ reason, count: n }: BuiltinBrowserCookieSkip, browser: string): string => {
      switch (reason) {
        case "app_bound":
          return `${n} 个受 ${browser} 的应用绑定加密保护，只有 ${browser} 自己能读取。`;
        case "dpapi":
          return `${n} 个的密钥 Windows 未能解开。`;
        case "keychain":
          return `${n} 个的密钥钥匙串未放行；在 macOS 询问时选择「允许」，再导入一次。`;
        case "keyring":
          return `${n} 个的密钥未能从桌面密钥环取得。`;
        case "undecryptable":
          return `${n} 个无法解密。`;
        case "partitioned":
          return `${n} 个是只属于某个站点或容器的分区 Cookie。`;
        case "expired":
          return `${n} 个已过期。`;
      }
    },
    /** Anything else the import reports. */
    importNote: (note: BuiltinBrowserImportNote, browser: string): string => {
      const store = (which: "cookies" | "history") =>
        which === "cookies" ? " Cookie 库" : "历史记录";
      switch (note.code) {
        case "no_cookie_store":
          return "这个个人资料没有 Cookie 库。";
        case "no_history":
          return "这个来源没有可导入的历史记录。";
        case "store_busy":
          return `${browser} 正占用它的${store(note.store)}，关闭 ${browser} 后再导入。`;
        case "store_unreadable":
          return `无法读取 ${browser} 的${store(note.store)}。`;
        case "cookies_not_set":
          return (
            `${note.count} 个 Cookie 未能写入内置浏览器` +
            (note.errors.length > 0 ? `：${note.errors.join("；")}` : "。")
          );
      }
    },
    /** The group the user's connected Chrome extension is listed under, and its row's hint. */
    importExtensionGroup: "经 Chrome 扩展",
    importExtensionHint:
      "读取扩展所在的 Chrome 个人资料的 Cookie，导入前要在 Chrome 中选择「允许」。",
    /** The import button while the extension waits for the user's answer in Chrome. */
    importWaitingChrome: "等待 Chrome 确认…",
    /**
     * Windows, a Chrome profile's cookies chosen: why most of them will be skipped, and the way
     * round it the extension's state leaves.
     */
    importAppBoundHint: (route: ImportExtensionRoute): string =>
      route === "not_paired"
        ? "Windows 上 Chrome 的 Cookie 多数只有 Chrome 自己能读取：在「设置 › 浏览器」中连接你的 Chrome 后可经扩展导入，或直接在浏览器面板中登录。"
        : route === "disconnected"
          ? "Windows 上 Chrome 的 Cookie 多数只有 Chrome 自己能读取：让你的 Chrome 连上 PenguinHarness Browser 扩展后可经扩展导入，或直接在浏览器面板中登录。"
          : route === "connected"
            ? "Windows 上 Chrome 的 Cookie 多数只有 Chrome 自己能读取，可改选下方的「经 Chrome 扩展」导入。"
            : "Windows 上 Chrome 的 Cookie 多数只有 Chrome 自己能读取，可直接在浏览器面板中登录。",
    /** After app-bound skips: how to get those cookies, given the extension's state. */
    importAppBoundAdvice: (route: ImportExtensionRoute): string =>
      route === "connected"
        ? "选择「经 Chrome 扩展」再导入一次即可取回它们，也可以直接在浏览器面板中登录。"
        : route === "not_paired"
          ? "在「设置 › 浏览器」中连接你的 Chrome 后，可经扩展导入它们；也可以直接在浏览器面板中登录。"
          : route === "disconnected"
            ? "让你的 Chrome 连上 PenguinHarness Browser 扩展后，可经扩展导入它们；也可以直接在浏览器面板中登录。"
            : "可以直接在浏览器面板中登录这些网站。",
    /** The outcome's way back to the form with the extension chosen. */
    importUseExtension: "经 Chrome 扩展导入",
    importFailed: (reason: string): string => `导入失败：${reason}`,
    /** The clear-browsing-data confirmation. */
    clearTitle: "清除浏览数据",
    clearBody:
      "Cookie、缓存和网站存储仅清除当前 Project 的数据；历史记录会从整个内置浏览器中清除。此操作无法撤销。",
    clearCookies: "Cookie 与登录状态",
    clearCache: "缓存的图片和文件",
    clearStorage: "网站存储的数据",
    clearHistory: "历史记录",
    clearConfirm: "清除",
    clearDone: "已清除浏览数据",
    clearFailed: (reason: string): string => `清除失败：${reason}`,
    /** The homepage dialog: the page new tabs and the Home button open. */
    homepageTitle: "设置主页",
    homepageIntro: "新建标签页和主页按钮会打开这个页面。",
    homepageAddress: "网址",
    homepagePlaceholder: "example.com",
    /** The address field's hint: what an empty field means, else the page the entry opens. */
    homepageHintEmpty: "留空表示不设主页，新建标签页为空白页。",
    homepageHintOpens: (url: string): string => `将打开 ${url}`,
    /** Fills the field with the page on screen. */
    homepageUseCurrent: "使用当前页面",
    /** Empties the field; saving it then removes the homepage. */
    homepageClear: "清除",
    homepageFailed: (reason: string): string => `无法保存主页：${reason}`,
    /** A tab whose page crashed: the panel's notice in its place, with Reload as the action. */
    crashedTitle: "此页面已崩溃",
    /** The notice's body when the page ran out of memory (the system took its memory back). */
    crashedOutOfMemory: "它耗尽了内存。请先关闭不再需要的标签页，再重新加载。",
    crashedBody: "重新加载即可再试一次。",
    /** A crashed tab's tooltip line in the strip, after its title, and its mark's accessible name. */
    crashedTab: "页面已崩溃",
    /**
     * The browser's load, when the server warns about it: the toolbar's mark (its tooltip and
     * accessible name) and the one toast per warning. Sentences joined in the order given here.
     */
    load: {
      memory: (size: string, tabs: number): string =>
        `浏览器正在使用 ${size} 内存（${tabs} 个标签页）。`,
      lowSystemMemory: (percent: number): string => `这台电脑的可用内存不足（剩余 ${percent}%）。`,
      manyTabs: (tabs: number): string => `已打开 ${tabs} 个标签页。`,
      advice: "请关闭不再需要的标签页。",
      /** The sentences above, as one warning. */
      join: (sentences: string[]): string => sentences.join(""),
      /** A heavy tab's tooltip line in the strip, after its title, and its mark's accessible name. */
      heavyTab: (size: string): string => `占用 ${size} 内存`,
    },
  },

  /** Settings › Personal › Browser (the user's agent browser) and Settings › Server › Chrome extension. */
  browserSettings: {
    /** The backend choice; only on the desktop app, which has both. */
    backend: "Agent 使用的浏览器",
    backendInfo:
      "内置浏览器在桌面应用里，有自己的登录状态；系统 Chrome 是你自己的 Chrome，Agent 只操作它打开的标签页和你交给它的标签页。Agent 自己不能切换。",
    paired: "已配对的 Chrome",
    pairedNone: "还没有配对的 Chrome。",
    /** A paired Chrome's line under its name: the extension's version, and when it was last connected. */
    pairedLine: (version: string, seen: string | null): string =>
      seen === null ? `扩展 ${version} · 尚未连接过` : `扩展 ${version} · 最近连接 ${seen}`,
    /** The state dot's accessible name. */
    connected: "已连接",
    notConnected: "未连接",
    revoke: "撤销",
    revokeTitle: "撤销这个 Chrome？",
    revokeBody: (name: string): string =>
      `撤销后，Agent 不能再操作「${name}」，它会立即断开；要再使用它，需要重新配对。`,
    revoked: (name: string): string => `已撤销「${name}」`,
    revokeFailed: (reason: string): string => `无法撤销：${reason}`,
    connectFirst: "连接你的 Chrome",
    connectAnother: "连接另一个 Chrome",
    loadFailed: (reason: string): string => `无法读取已配对的 Chrome：${reason}`,
    disabledNote: "这台服务器的管理员关闭了 Chrome 扩展连接。",
    /** Settings › Server › Chrome extension: the admin's switch, and the question before it goes off. */
    allow: "允许 Chrome 扩展连接",
    offTitle: "关闭 Chrome 扩展连接？",
    offBody:
      "所有用户的扩展会立即断开，整个服务器上的 Agent 都不能再使用 Chrome。配对会保留，重新开启后扩展会自行重连。",
    off: "关闭",
  },

  /** The two Settings pages' names on the rail, and the server page's explanation. */
  settings: {
    browserTitle: "浏览器",
    chromeExtensionTitle: "Chrome 扩展",
    chromeExtensionInfo:
      "开启时，这台服务器上的每个用户都可以配对自己的 Chrome，让 Agent 在其中操作；关闭时，所有扩展断开，已有的配对保留。",
  },

  /** The row the browser adds to the conversation's menu for a web link. */
  linkMenu: {
    openInBuiltinBrowser: "在内置浏览器中打开",
    /** The same row while the agents drive the user's Chrome: the link opens in a tab there. */
    openInChromeTab: "在 Agent 的 Chrome 标签页中打开",
  },

  /** The app's own words this feature uses, kept here so it reads no other dictionary. */
  common: {
    cancel: "取消",
    close: "关闭",
    copy: "复制",
    loading: "加载中…",
    save: "保存",
    saving: "保存中…",
  },

  /** The codes the browser's routes answer with; `apiErrorText` reads them after the app's own. */
  apiErrors: {
    browser_unavailable:
      "浏览器现在不可用：内置浏览器需要打开 PenguinHarness 桌面应用，你的 Chrome 需要连上 PenguinHarness Browser 扩展。",
    source_not_found: "找不到这个浏览器配置文件。",
    import_declined: "你没有在 Chrome 中允许这次导入。",
    extension_outdated: "Chrome 中的 PenguinHarness Browser 扩展版本过旧，请更新后重试。",
  },
};

/** The table's shape: constrains the English table so keys and function signatures line up. */
export type BrowserStrings = typeof zh;

export const en: BrowserStrings = {
  builtinBrowser: {
    panelTitle: "Browser",
    machinePages: "Pages open in the desktop browser on the machine running this session.",
    tabs: "Tabs",
    newTab: "New tab",
    closeTab: "Close tab",
    untitled: "New tab",
    back: "Back",
    forward: "Forward",
    reload: "Reload",
    stop: "Stop loading",
    address: "Address",
    addressPlaceholder: "Search or enter address",
    suggestions: "History",
    more: "More",
    importAction: "Import from browser…",
    clearDataAction: "Clear browsing data…",
    setHomepageAction: "Set homepage…",
    openExternal: "Open in system browser",
    devTools: "Developer tools",
    home: "Home",
    agentBusy: (action: string): string => `An agent is using the browser: ${action}`,
    agentBusyTab: "An agent is using this tab",
    actions: {
      navigate: "opening a page",
      scan: "reading the page",
      exec: "running a script",
      click: "clicking",
      type: "typing",
      screenshot: "taking a screenshot",
      cdp: "sending a DevTools command",
    },
    unavailableTitle: "Built-in browser unavailable",
    unavailableDesktop: "The built-in browser runs in the PenguinHarness desktop app.",
    unavailableShell: "This desktop app is too old for the built-in browser. Update it to use it.",
    unavailableWindow: "No app window is available to show the browser.",
    unavailablePairChrome: "To have agents use your Chrome instead, pair it in Settings › Browser.",
    useChrome: "Use System Chrome",
    startPage: {
      label: "Common sites",
      sites: {
        google: "Google",
        bing: "Bing",
        baidu: "Baidu",
        github: "GitHub",
        stackoverflow: "Stack Overflow",
        wikipedia: "Wikipedia",
      },
    },
    openFailed: (reason: string): string => `Could not open a tab: ${reason}`,
    closeFailed: (reason: string): string => `Could not close the tab: ${reason}`,
    backendBuiltin: "Built-in",
    backendChrome: "System Chrome",
    chromeConnected: (name: string | null): string =>
      name !== null ? `Chrome: connected · ${name}` : "Chrome: connected",
    chromeNotConnected: "Chrome: not connected",
    chromeNotPaired: "No Chrome paired",
    chromeDisabled: "Chrome connections are off",
    connectChrome: "Connect your Chrome…",
    manageChrome: "Manage…",
    switchedToChrome: "Agents now use your Chrome",
    switchedToBuiltin: "Agents now use the built-in browser",
    switchRefused: "An agent is using the browser; switch once it is done",
    switchFailed: (reason: string): string => `Could not switch the browser: ${reason}`,
    chromeTabCard: "This tab is open in your Chrome",
    showInChrome: "Show in Chrome",
    chromeNoTabsTitle: "No agent tabs in your Chrome yet",
    chromeNoTabsBody: "Pages an agent opens appear in Chrome's Penguin tab group.",
    chromeDisconnectedTitle: "Chrome is not connected",
    chromeDisconnectedBody: (name: string | null): string =>
      name !== null
        ? `${name} is not connected to this server right now.`
        : "Your paired Chrome is not connected to this server right now.",
    reconnectHelp: "Reconnect help",
    reconnectOpen:
      "Open Chrome and check that the PenguinHarness Browser extension is turned on in chrome://extensions.",
    reconnectResume:
      "Click the extension's icon in the toolbar; if it says it is paused, choose Resume.",
    reconnectPair:
      "If the server's address changed, or the server was removed in the extension, pair it again.",
    chromeDisabledTitle: "Chrome connections are off",
    chromeDisabledBody: "An admin of this server has turned off Chrome extension connections.",
    chromeUnpairedIntro:
      "Install the PenguinHarness Browser extension and pair it, and agents can open and work in pages in your own Chrome, signed in as you are there.",
    pairTitle: "Connect your Chrome",
    pairStepInstall:
      "Install the extension and pin it to the toolbar. The Chrome Web Store is the recommended source: Chrome keeps the extension up to date.",
    pairStore: "Open the Chrome Web Store",
    pairStepInstallZip:
      "If the store does not open, download the zip and unzip it instead. In chrome://extensions, turn on Developer mode, choose Load unpacked and pick the unzipped folder.",
    pairDownload: "Download the extension (zip)",
    pairStepOpen:
      "Click the PenguinHarness Browser icon in the toolbar and choose Settings to open its pairing page.",
    pairStepPaste: "Paste the server address and the pairing code below, and choose Connect.",
    pairServer: "Server address",
    pairCode: "Pairing code",
    pairCodeExpiry: (time: string): string => `Works once, until ${time}`,
    pairCodeExpired: "This code has expired",
    pairNewCode: "New code",
    pairCodeFailed: (reason: string): string => `Could not create a pairing code: ${reason}`,
    pairWaiting: "Waiting for Chrome…",
    pairConnected: "Connected",
    importTitle: "Import from browser",
    importIntro:
      "Copies sign-ins into this Project’s browser storage and history into the built-in browser. Other Projects’ sign-ins and the source browser stay unchanged.",
    importLoading: "Looking for browsers…",
    importNone: "No browser to import from was found on this computer.",
    importSourcesFailed: (reason: string): string => `Could not list the browsers: ${reason}`,
    importSource: "Import from",
    importWhat: "What to import",
    importCookies: "Cookies and sign-ins",
    importHistory: "History",
    importDomains: "Only these sites",
    importDomainsHint:
      "Comma separated, for example amazon.com, github.com. Leave empty to import every site.",
    importDomainsPlaceholder: "amazon.com, github.com",
    importKeychainNote: "Your Mac may ask for Keychain access.",
    importRun: "Import",
    importRunning: "Importing…",
    importDone: "Done",
    importCookiesResult: (c: {
      found: number;
      imported: number;
      skipped: number;
      failed: number;
    }): string =>
      `Cookies: ${c.imported} of ${c.found} imported` +
      (c.skipped > 0 ? `, ${c.skipped} skipped` : "") +
      (c.failed > 0 ? `, ${c.failed} failed` : ""),
    importHistoryResult: (h: { found: number; imported: number }): string =>
      `History: ${h.imported} of ${h.found} entries imported`,
    importSkip: ({ reason, count: n }, browser) => {
      switch (reason) {
        case "app_bound":
          return `${n} protected by ${browser}'s app-bound encryption, which only ${browser} itself can read.`;
        case "dpapi":
          return `${n} whose key Windows would not unlock.`;
        case "keychain":
          return `${n} whose key the Keychain did not release; allow the access when macOS asks, then import again.`;
        case "keyring":
          return `${n} whose key the desktop keyring could not provide.`;
        case "undecryptable":
          return `${n} that could not be decrypted.`;
        case "partitioned":
          return `${n} partitioned to a single site or container.`;
        case "expired":
          return `${n} expired.`;
      }
    },
    importNote: (note, browser) => {
      const store = (which: "cookies" | "history") =>
        which === "cookies" ? "cookie store" : "history";
      switch (note.code) {
        case "no_cookie_store":
          return "This profile has no cookie store.";
        case "no_history":
          return "This source has no history to import.";
        case "store_busy":
          return `${browser} is holding its ${store(note.store)} open; close ${browser} and import again.`;
        case "store_unreadable":
          return `The ${store(note.store)} of ${browser} could not be read.`;
        case "cookies_not_set":
          return (
            `${note.count} cookies could not be set in the built-in browser` +
            (note.errors.length > 0 ? `: ${note.errors.join("; ")}` : ".")
          );
      }
    },
    importExtensionGroup: "Through the Chrome extension",
    importExtensionHint:
      "Reads the cookies of the Chrome profile the extension runs in; Chrome asks you to allow it first.",
    importWaitingChrome: "Waiting for Chrome…",
    importAppBoundHint: (route) =>
      route === "not_paired"
        ? "On Windows, only Chrome can read most of its cookies: connect your Chrome in Settings › Browser to import them through the extension, or sign in inside the Browser panel."
        : route === "disconnected"
          ? "On Windows, only Chrome can read most of its cookies: once your Chrome's PenguinHarness Browser extension is connected, import them through it, or sign in inside the Browser panel."
          : route === "connected"
            ? "On Windows, only Chrome can read most of its cookies; choose the Chrome extension below to import them through it."
            : "On Windows, only Chrome can read most of its cookies; sign in inside the Browser panel instead.",
    importAppBoundAdvice: (route) =>
      route === "connected"
        ? "Import again through the Chrome extension to bring them over, or sign in inside the Browser panel."
        : route === "not_paired"
          ? "Connect your Chrome in Settings › Browser to import them through the extension, or sign in inside the Browser panel."
          : route === "disconnected"
            ? "Once your Chrome's PenguinHarness Browser extension is connected, import them through it, or sign in inside the Browser panel."
            : "Sign in to those sites inside the Browser panel instead.",
    importUseExtension: "Import through the Chrome extension",
    importFailed: (reason: string): string => `Import failed: ${reason}`,
    clearTitle: "Clear browsing data",
    clearBody:
      "Cookies, cache and site storage are cleared for this Project; history is cleared across the built-in browser. This cannot be undone.",
    clearCookies: "Cookies and sign-ins",
    clearCache: "Cached images and files",
    clearStorage: "Site storage",
    clearHistory: "History",
    clearConfirm: "Clear",
    clearDone: "Browsing data cleared",
    clearFailed: (reason: string): string => `Could not clear the data: ${reason}`,
    homepageTitle: "Set homepage",
    homepageIntro: "New tabs and the Home button open this page.",
    homepageAddress: "Address",
    homepagePlaceholder: "example.com",
    homepageHintEmpty: "Leave empty for none; new tabs then open blank.",
    homepageHintOpens: (url: string): string => `Opens ${url}`,
    homepageUseCurrent: "Use current page",
    homepageClear: "Clear",
    homepageFailed: (reason: string): string => `Could not save the homepage: ${reason}`,
    crashedTitle: "This page crashed",
    crashedOutOfMemory: "It ran out of memory. Close tabs you no longer need, then reload it.",
    crashedBody: "Reload it to try again.",
    crashedTab: "The page crashed",
    load: {
      memory: (size: string, tabs: number): string =>
        `The browser is using ${size} across ${tabs} ${tabs === 1 ? "tab" : "tabs"}.`,
      lowSystemMemory: (percent: number): string =>
        `This computer is low on memory (${percent}% free).`,
      manyTabs: (tabs: number): string => `${tabs} tabs are open.`,
      advice: "Close tabs you no longer need.",
      join: (sentences: string[]): string => sentences.join(" "),
      heavyTab: (size: string): string => `Uses ${size} of memory`,
    },
  },

  browserSettings: {
    backend: "Browser agents use",
    backendInfo:
      "The built-in browser lives in the desktop app and keeps its own sign-ins. System Chrome is your own Chrome, where agents act only in the tabs they open and the tabs you hand them. Agents cannot switch it themselves.",
    paired: "Paired Chromes",
    pairedNone: "No Chrome is paired yet.",
    pairedLine: (version: string, seen: string | null): string =>
      seen === null
        ? `Extension ${version} · never connected`
        : `Extension ${version} · last seen ${seen}`,
    connected: "Connected",
    notConnected: "Not connected",
    revoke: "Revoke",
    revokeTitle: "Revoke this Chrome?",
    revokeBody: (name: string): string =>
      `Agents lose ${name}: it disconnects now, and it has to be paired again before agents can use it.`,
    revoked: (name: string): string => `Revoked ${name}`,
    revokeFailed: (reason: string): string => `Could not revoke it: ${reason}`,
    connectFirst: "Connect your Chrome",
    connectAnother: "Connect another Chrome",
    loadFailed: (reason: string): string => `Could not read the paired Chromes: ${reason}`,
    disabledNote: "An admin of this server has turned off Chrome extension connections.",
    allow: "Allow Chrome extension connections",
    offTitle: "Turn off Chrome extension connections?",
    offBody:
      "Every user's extension disconnects at once, and no agent on this server can use a Chrome. Pairings are kept: turn it back on and the extensions reconnect.",
    off: "Turn off",
  },

  settings: {
    browserTitle: "Browser",
    chromeExtensionTitle: "Chrome extension",
    chromeExtensionInfo:
      "When on, every user of this server can pair their own Chrome for agents to work in. When off, every extension disconnects; pairings are kept.",
  },

  linkMenu: {
    openInBuiltinBrowser: "Open in built-in browser",
    openInChromeTab: "Open in agent's Chrome tab",
  },

  common: {
    cancel: "Cancel",
    close: "Close",
    copy: "Copy",
    loading: "Loading…",
    save: "Save",
    saving: "Saving…",
  },

  apiErrors: {
    browser_unavailable:
      "The browser is not available right now: the built-in browser needs the PenguinHarness desktop app open, and your Chrome needs the PenguinHarness Browser extension connected.",
    source_not_found: "That browser profile was not found.",
    import_declined: "The import was not allowed in Chrome.",
    extension_outdated:
      "The PenguinHarness Browser extension in Chrome is too old for this. Update it and try again.",
  },
};

/** The browser's copy in the language on screen; `zh` and `en` are the two tables themselves. */
export const S = defineStrings({ zh, en });

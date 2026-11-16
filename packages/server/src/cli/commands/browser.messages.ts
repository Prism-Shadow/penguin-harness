/**
 * The messages of browser command moved with its code into the server package, split out of the CLI's message table (hosted whole by the server
package). Field names and shapes are unchanged; the host's table spreads this file in.
 */

export interface BrowserText {
  /** `penguin browser`: the desktop app's built-in browser (commands/browser.ts, browser-output.ts). */
  browser: {
    desc: string;
    statusDesc: string;
    tabsDesc: string;
    openDesc: string;
    switchDesc: string;
    closeDesc: string;
    scanDesc: string;
    execDesc: string;
    clickDesc: string;
    typeDesc: string;
    screenshotDesc: string;
    cdpDesc: string;
    importDesc: string;
    historyDesc: string;
    /** --tab: which tab the command acts on. */
    tab: string;
    urlArg: string;
    newTab: string;
    tabIdArg: string;
    closeTabArg: string;
    textOnly: string;
    maxChars: string;
    scriptArg: string;
    file: string;
    save: string;
    noMonitor: string;
    timeout: string;
    selectorArg: string;
    index: string;
    at: string;
    textArg: string;
    selector: string;
    submit: string;
    /** exec / click / type --accept-dialogs: accept every dialog, not only alerts. */
    acceptDialogs: string;
    output: string;
    fullPage: string;
    methodArg: string;
    params: string;
    list: string;
    from: string;
    cookies: string;
    history: string;
    domain: string;
    queryArg: string;
    count: string;
    /** The labels of the output lines; `line` joins one with its value. */
    label: {
      status: string;
      tab: string;
      tabs: string;
      page: string;
      return: string;
      error: string;
      diff: string;
      transients: string;
      newTabs: string;
      note: string;
      clicked: string;
      source: string;
      cookies: string;
      history: string;
      warning: string;
      screenshot: string;
      dialog: string;
      memory: string;
      backend: string;
    };
    /** `label: value`, in the language's punctuation. */
    line(label: string, value: string): string;
    /** The header naming a tab: `tab 12 · title · url`. */
    tabHead(id: number, title: string, url: string, loading: boolean): string;
    /** The value of `tabs:` when none is open. */
    noTabs(): string;
    available(): string;
    unavailable(reason: string): string;
    /**
     * The value of `backend:` on the status line: `builtin` or `chrome` as the API names them, then
     * the user's Chrome when one is paired (its name and the extension's version).
     */
    backendValue(backend: string, extension?: { name: string; version: string }): string;
    /**
     * Why the browser cannot be driven, and what to do: the built-in browser lives in the desktop
     * app, which must be open; the user's own Chrome needs the extension paired, connected and
     * allowed on the server. Undefined: no server could be reached at all.
     */
    unavailableHint(reason: string | undefined): string;
    /** `not_supported`: what only the built-in browser has (import, history), asked of the user's Chrome. */
    notSupported(): string;
    /**
     * The value of `memory:`: what the browser's pages hold together and how many tabs, then this
     * computer's free and total memory when the server reports them.
     */
    memoryLine(total: string, tabs: number, system?: { free: string; total: string }): string;
    /** The `warning:` a load warning adds (the server's codes): what is wrong, and how an agent eases it. */
    loadWarning(warnings: readonly string[]): string;
    closed(tab: string): string;
    closedActive(): string;
    /** The value of `page:` when the page navigated or reloaded during the call. */
    reloaded(): string;
    elementsChanged(count: number): string;
    clickedAt(tag: string | undefined, text: string | undefined, x: number, y: number): string;
    /** The value of `dialog:`: the dialog and how the call answered it (a dismissal says how to accept). */
    dialogAnswered(type: string, message: string, accepted: boolean): string;
    /** Appended to a `return:` value cut at the display limit. */
    truncatedSave(): string;
    /** Appended to a `cdp` result cut at the display limit. */
    truncatedJson(): string;
    /** Appended to the start of a value `--save` wrote to a file. */
    savedTo(path: string): string;
    screenshotSaved(path: string, size: string, kilobytes: number): string;
    importData(cookies: boolean, history: boolean): string;
    importCookies(c: { found: number; imported: number; skipped: number; failed: number }): string;
    importHistory(h: { found: number; imported: number }): string;
    noSources(): string;
    noHistory(): string;
    /** A history line's visit count, the order the lines come in. */
    visits(count: number): string;
    colId(): string;
    colTitle(): string;
    colUrl(): string;
    colBrowser(): string;
    colProfile(): string;
    colData(): string;
    /** The one error line: `error: <code>: <message>`. */
    errorLine(code: string, message: string): string;
    tabInvalid(value: string): string;
    positiveInt(flag: string, value: string): string;
    indexInvalid(value: string): string;
    atInvalid(value: string): string;
    clickTarget(): string;
    newTabWithTab(): string;
    paramsInvalid(): string;
    methodInvalid(value: string): string;
    scriptSources(): string;
    scriptMissing(): string;
    scriptEmpty(): string;
    fileUnreadable(path: string, detail: string): string;
    fileUnwritable(path: string, detail: string): string;
    importMode(): string;
    sourceNotFound(from: string, known: string[]): string;
    sourceAmbiguous(from: string, ids: string[]): string;
  };
}

/** The English half of this contribution's messages. */
export const browserEn: BrowserText = {
  browser: {
    desc: "The agent browser: read pages, run JavaScript, click and type, import sign-ins",
    statusDesc: "Whether the agent browser is available, which backend it is, and its tabs",
    tabsDesc: "List the open tabs (* marks the active one)",
    openDesc:
      "Open a URL in the active tab (in a new one when none is open), or in a new tab with --new-tab",
    switchDesc: "Make a tab the active one",
    closeDesc: "Close a tab (default: the active one)",
    scanDesc:
      "Read the page as simplified HTML (or plain text with --text), after the tab list; hidden list items show as a [FAKE ELEMENT] hint",
    execDesc:
      "Run JavaScript in the page; prints its return value, the elements that changed, transient messages and new tabs",
    clickDesc: "Click an element by CSS selector, or a point with --at, with trusted mouse events",
    typeDesc:
      "Type text into the focused element (or --selector), optionally pressing Enter afterwards",
    screenshotDesc: "Save a PNG screenshot of the tab",
    cdpDesc: "Send a raw Chrome DevTools Protocol command to the tab",
    importDesc:
      "Import cookies (sign-ins) and history from a browser installed on this machine (neither flag: both)",
    historyDesc: "Search the built-in browser's history (most visited first, then most recent)",
    tab: 'Tab id, or "active" (default)',
    urlArg: "URL to open; https:// is added to a bare host",
    newTab: "Open it in a new tab",
    tabIdArg: "Tab id",
    closeTabArg: 'Tab id, or "active" (default)',
    textOnly: "Plain text instead of simplified HTML (fewer tokens)",
    maxChars: "Longest body to return, in characters (default 35000; a third of it with --text)",
    scriptArg:
      'JavaScript, run as the body of an async function: end with `return <value>`. "-" reads it from stdin',
    file: "Read the script from this file",
    save: "Write the whole return value to this file and print only its start",
    noMonitor: "Skip change tracking: faster, for scripts that only read",
    timeout: "Script time limit: 30s, 2m or bare seconds (default 15s)",
    selectorArg: "CSS selector of the element to click",
    index: "Which match of the selector to click, from 0 (default 0)",
    at: "Click this viewport point instead, as x,y in CSS pixels",
    textArg: "Text to type",
    selector: "Focus this element first (CSS selector)",
    submit: "Press Enter afterwards",
    acceptDialogs:
      "Accept the page's confirm, prompt and leave-page dialogs too (alerts always are; without this the others are dismissed)",
    output: "PNG file to write (default: screenshot-<time>.png in the working directory)",
    fullPage: "Capture the whole page, not only the viewport",
    methodArg: "CDP method, e.g. DOM.getDocument",
    params: "The method's parameters as a JSON object",
    list: "List the browser profiles on this machine",
    from: "Profile to import from: a source id from --list, or a browser (chrome, edge, firefox…) for its Default profile",
    cookies: "Import cookies and sign-ins",
    history: "Import history",
    domain: "Only the cookies of this site and its subdomains (repeatable, or comma-separated)",
    queryArg: "Words to find in titles and URLs",
    count: "How many entries (default 20)",
    label: {
      status: "status",
      tab: "tab",
      tabs: "tabs",
      page: "page",
      return: "return",
      error: "error",
      diff: "diff",
      transients: "transients",
      newTabs: "new tabs",
      note: "note",
      clicked: "clicked",
      source: "source",
      cookies: "cookies",
      history: "history",
      warning: "warning",
      screenshot: "screenshot",
      dialog: "dialog",
      memory: "memory",
      backend: "backend",
    },
    line: (label, value) => `${label}: ${value}`,
    tabHead: (id, title, url, loading) =>
      `tab ${id} · ${title || "(untitled)"} · ${url}${loading ? " · loading" : ""}`,
    noTabs: () => "none",
    available: () => "available",
    unavailable: (reason) => `unavailable (${reason})`,
    backendValue: (backend, extension) =>
      extension === undefined
        ? backend
        : `${backend} (${extension.name}, extension ${extension.version})`,
    unavailableHint: (reason) => {
      const base =
        "The built-in browser needs the PenguinHarness desktop app, and the app must be open";
      if (reason === "shell_unsupported")
        return `${base}: this desktop app is too old for it, so update the app.`;
      if (reason === "no_window") return `${base}: it has no open window, so open it.`;
      if (reason === "not_desktop") return `${base}: this server is not running inside it.`;
      if (reason === "extension_not_paired")
        return "No Chrome is paired for this user. Ask the user to install the PenguinHarness Browser extension and pair it: Browser panel → Connect your Chrome.";
      if (reason === "extension_disconnected")
        return "The user's Chrome is not connected. Ask the user to open Chrome with the PenguinHarness Browser extension enabled, or to pair it again in the Browser panel.";
      if (reason === "extension_disabled")
        return "An admin has turned off Chrome extension connections on this server, so the user's Chrome cannot be driven.";
      return "The browser is driven through a running PenguinHarness server, and none was reached: open the desktop app, or point --server or PENGUIN_API_URL at the server.";
    },
    notSupported: () =>
      "This belongs to the built-in browser; this user's agents drive their own Chrome, which keeps its own sign-ins and history. Ask the user to sign in in the Penguin tab in Chrome instead.",
    memoryLine: (total, tabs, system) =>
      `${total} across ${tabs} ${tabs === 1 ? "tab" : "tabs"}` +
      (system !== undefined ? ` · this computer: ${system.free} free of ${system.total}` : ""),
    loadWarning: (warnings) => {
      const said = [
        warnings.includes("memory") ? "the browser holds a lot of memory" : "",
        warnings.includes("low_system_memory") ? "this computer is low on memory" : "",
        warnings.includes("many_tabs") ? "many tabs are open" : "",
      ].filter(Boolean);
      const text = said.join(", and ") || "the browser is heavy";
      return `${text.charAt(0).toUpperCase()}${text.slice(1)}. Close the tabs you no longer need (penguin browser close <tab-id>).`;
    },
    closed: (tab) => `Closed tab ${tab}.`,
    closedActive: () => "Closed the active tab.",
    reloaded: () => "reloaded",
    elementsChanged: (count) => (count === 1 ? "1 element changed" : `${count} elements changed`),
    clickedAt: (tag, text, x, y) => `${tag ?? "element"}${text ? ` "${text}"` : ""} at ${x},${y}`,
    dialogAnswered: (type, message, accepted) =>
      `${type} "${message}" → ${accepted ? "accepted" : "dismissed (rerun with --accept-dialogs to accept)"}`,
    truncatedSave: () => "[truncated — use --save]",
    truncatedJson: () => "[truncated — use --json]",
    savedTo: (path) => `[saved to ${path}]`,
    screenshotSaved: (path, size, kilobytes) => `${path} (${size}, ${kilobytes} KB)`,
    importData: (cookies, history) =>
      [cookies ? "cookies" : "", history ? "history" : ""].filter(Boolean).join(", ") || "-",
    importCookies: (c) =>
      `${c.imported} imported, ${c.skipped} skipped, ${c.failed} failed (${c.found} found)`,
    importHistory: (h) => `${h.imported} imported (${h.found} found)`,
    noSources: () => "No browser profiles to import from were found on this machine.",
    noHistory: () => "No history matches.",
    visits: (count) => (count === 1 ? "1 visit" : `${count} visits`),
    colId: () => "ID",
    colTitle: () => "TITLE",
    colUrl: () => "URL",
    colBrowser: () => "BROWSER",
    colProfile: () => "PROFILE",
    colData: () => "DATA",
    errorLine: (code, message) => `error: ${code}: ${message}`,
    tabInvalid: (value) => `A tab is a tab id or "active", not "${value}".`,
    positiveInt: (flag, value) => `${flag} takes a positive whole number, not "${value}".`,
    indexInvalid: (value) => `--index takes a whole number from 0, not "${value}".`,
    atInvalid: (value) => `--at takes x,y in CSS pixels (e.g. --at 120,340), not "${value}".`,
    clickTarget: () => "Give either a selector (with --index) or --at x,y.",
    newTabWithTab: () => "--new-tab opens a new tab, so it takes no --tab.",
    paramsInvalid: () => "--params must be a JSON object.",
    methodInvalid: (value) =>
      `"${value}" is not a CDP method: write Domain.method, e.g. DOM.getDocument.`,
    scriptSources: () => "Give the script one way only: as an argument, with --file, or on stdin.",
    scriptMissing: () =>
      "No script: pass it as an argument, with --file, or on stdin (penguin browser exec <<'EOF' … EOF).",
    scriptEmpty: () => "The script is empty.",
    fileUnreadable: (path, detail) => `Cannot read ${path}: ${detail}`,
    fileUnwritable: (path, detail) => `Cannot write ${path}: ${detail}`,
    importMode: () =>
      "Use --list to see the browser profiles, or --from <source-id|browser> to import from one.",
    sourceNotFound: (from, known) =>
      `No browser profile matches "${from}"${known.length > 0 ? ` (this machine has: ${known.join(", ")})` : ""}; see penguin browser import --list.`,
    sourceAmbiguous: (from, ids) =>
      `${from} has several profiles and none is Default: ${ids.join(", ")}. Pass one with --from.`,
  },
};

/** The Chinese half of this contribution's messages. */
export const browserZh: BrowserText = {
  browser: {
    desc: "Agent 浏览器：读取页面、运行 JavaScript、点击与输入、导入登录状态",
    statusDesc: "Agent 浏览器是否可用、使用哪种后端，以及它的标签页",
    tabsDesc: "列出打开的标签页（* 标出当前标签页）",
    openDesc: "在当前标签页打开 URL（没有标签页时新开一个）；--new-tab 则在新标签页打开",
    switchDesc: "把一个标签页设为当前标签页",
    closeDesc: "关闭标签页（缺省为当前标签页）",
    scanDesc:
      "读取页面：先列标签页，再输出简化后的 HTML（--text 时为纯文本）；列表中被隐藏的条目以 [FAKE ELEMENT] 提示标出",
    execDesc: "在页面中运行 JavaScript；输出返回值、发生变化的元素、瞬时提示与新开的标签页",
    clickDesc: "用可信的鼠标事件点击一个元素（CSS 选择器），或用 --at 点击一个坐标",
    typeDesc: "向当前聚焦的元素（或 --selector 指定的元素）输入文字，可随后按下回车",
    screenshotDesc: "把标签页截图保存为 PNG",
    cdpDesc: "向标签页发送一条原始的 Chrome DevTools Protocol 命令",
    importDesc: "从本机安装的浏览器导入 Cookie（登录状态）与历史记录（两个开关都不给时两者都导入）",
    historyDesc: "搜索内置浏览器的历史记录（访问次数多的在前，次数相同时较近的在前）",
    tab: "标签页 id，或 active（缺省）",
    urlArg: "要打开的 URL；只写主机名时自动补上 https://",
    newTab: "在新标签页中打开",
    tabIdArg: "标签页 id",
    closeTabArg: "标签页 id，或 active（缺省）",
    textOnly: "输出纯文本而非简化 HTML（更省 Token）",
    maxChars: "正文最多返回多少个字符（缺省 35000；加 --text 时取其三分之一）",
    scriptArg:
      "JavaScript，作为一个 async 函数的函数体运行：以 `return <值>` 结尾；写 - 则从 stdin 读取",
    file: "从这个文件读取脚本",
    save: "把完整返回值写入这个文件，终端只显示开头部分",
    noMonitor: "不追踪页面变化：更快，适用于只读取不改动的脚本",
    timeout: "脚本时限：30s、2m 或纯数字秒数（缺省 15s）",
    selectorArg: "要点击的元素的 CSS 选择器",
    index: "点击选择器的第几个匹配，从 0 开始（缺省 0）",
    at: "改为点击视口中的这个坐标，格式为 x,y（CSS 像素）",
    textArg: "要输入的文字",
    selector: "先聚焦这个元素（CSS 选择器）",
    submit: "输入后按下回车",
    acceptDialogs:
      "同时接受页面的确认、输入和离开页面对话框（提示框总会接受；不加此选项时其余一律拒绝）",
    output: "要写入的 PNG 文件（缺省为工作目录下的 screenshot-<时间>.png）",
    fullPage: "截取整个页面，而不只是视口",
    methodArg: "CDP 方法，例如 DOM.getDocument",
    params: "方法参数，一个 JSON 对象",
    list: "列出本机的浏览器个人资料",
    from: "从哪个个人资料导入：--list 列出的来源 id，或浏览器名（chrome、edge、firefox……）以使用它的 Default 个人资料",
    cookies: "导入 Cookie 与登录状态",
    history: "导入历史记录",
    domain: "只导入这个网站及其子域名的 Cookie（可重复给出，也可用逗号分隔）",
    queryArg: "要在标题和 URL 中查找的词",
    count: "显示多少条（缺省 20）",
    label: {
      status: "状态",
      tab: "标签页",
      tabs: "标签页列表",
      page: "页面",
      return: "返回值",
      error: "错误",
      diff: "变化",
      transients: "瞬时提示",
      newTabs: "新标签页",
      note: "提示",
      clicked: "已点击",
      source: "来源",
      cookies: "Cookie",
      history: "历史记录",
      warning: "警告",
      screenshot: "截图",
      dialog: "对话框",
      memory: "内存",
      backend: "后端",
    },
    line: (label, value) => `${label}：${value}`,
    tabHead: (id, title, url, loading) =>
      `标签页 ${id} · ${title || "（无标题）"} · ${url}${loading ? " · 加载中" : ""}`,
    noTabs: () => "无",
    available: () => "可用",
    unavailable: (reason) => `不可用（${reason}）`,
    backendValue: (backend, extension) =>
      extension === undefined
        ? backend
        : `${backend}（${extension.name}，扩展 ${extension.version}）`,
    unavailableHint: (reason) => {
      const base = "内置浏览器需要 PenguinHarness 桌面应用，且应用必须处于打开状态";
      if (reason === "shell_unsupported") return `${base}：当前桌面应用版本过旧，请更新应用。`;
      if (reason === "no_window") return `${base}：应用当前没有打开的窗口，请打开它。`;
      if (reason === "not_desktop") return `${base}：当前服务器不是在桌面应用中运行的。`;
      if (reason === "extension_not_paired")
        return "该用户还没有配对 Chrome。请用户安装 PenguinHarness Browser 扩展并完成配对：浏览器面板 →「连接你的 Chrome…」。";
      if (reason === "extension_disconnected")
        return "该用户的 Chrome 未连接。请用户打开装有 PenguinHarness Browser 扩展的 Chrome 并确认扩展已启用，或在浏览器面板中重新配对。";
      if (reason === "extension_disabled")
        return "管理员已在本服务器上关闭 Chrome 扩展连接，无法驱动该用户的 Chrome。";
      return "浏览器要经由正在运行的 PenguinHarness 服务器驱动，但没有连上任何服务器：请打开桌面应用，或用 --server 或 PENGUIN_API_URL 指向该服务器。";
    },
    notSupported: () =>
      "这项功能只属于内置浏览器；该用户的 Agent 驱动的是用户自己的 Chrome，它自己保存登录状态和历史记录。需要登录时，请用户在 Chrome 的 Penguin 标签页中自行登录。",
    memoryLine: (total, tabs, system) =>
      `${total}（${tabs} 个标签页）` +
      (system !== undefined ? ` · 本机可用 ${system.free}，共 ${system.total}` : ""),
    loadWarning: (warnings) => {
      const said = [
        warnings.includes("memory") ? "浏览器占用的内存较多" : "",
        warnings.includes("low_system_memory") ? "本机可用内存不足" : "",
        warnings.includes("many_tabs") ? "打开的标签页过多" : "",
      ].filter(Boolean);
      return `${said.join("，") || "浏览器负载较高"}。请关闭不再需要的标签页（penguin browser close <tab-id>）。`;
    },
    closed: (tab) => `已关闭标签页 ${tab}。`,
    closedActive: () => "已关闭当前标签页。",
    reloaded: () => "已重新加载",
    elementsChanged: (count) => `${count} 个元素有变化`,
    clickedAt: (tag, text, x, y) => `${tag ?? "元素"}${text ? `「${text}」` : ""}，位于 ${x},${y}`,
    dialogAnswered: (type, message, accepted) =>
      `${type}「${message}」→ ${accepted ? "已接受" : "已拒绝（加 --accept-dialogs 重新运行即可接受）"}`,
    truncatedSave: () => "[已截断——完整内容请用 --save]",
    truncatedJson: () => "[已截断——完整结果请用 --json]",
    savedTo: (path) => `[已保存到 ${path}]`,
    screenshotSaved: (path, size, kilobytes) => `${path}（${size}，${kilobytes} KB）`,
    importData: (cookies, history) =>
      [cookies ? "Cookie" : "", history ? "历史记录" : ""].filter(Boolean).join("、") || "-",
    importCookies: (c) =>
      `导入 ${c.imported}，跳过 ${c.skipped}，失败 ${c.failed}（共找到 ${c.found}）`,
    importHistory: (h) => `导入 ${h.imported}（共找到 ${h.found}）`,
    noSources: () => "本机没有找到可导入的浏览器个人资料。",
    noHistory: () => "没有匹配的历史记录。",
    visits: (count) => `${count} 次访问`,
    colId: () => "ID",
    colTitle: () => "标题",
    colUrl: () => "URL",
    colBrowser: () => "浏览器",
    colProfile: () => "个人资料",
    colData: () => "数据",
    errorLine: (code, message) => `错误：${code}：${message}`,
    tabInvalid: (value) => `标签页应为标签页 id 或 active，而不是「${value}」。`,
    positiveInt: (flag, value) => `${flag} 的值应为正整数，而不是「${value}」。`,
    indexInvalid: (value) => `--index 的值应为从 0 起的整数，而不是「${value}」。`,
    atInvalid: (value) => `--at 的格式为 x,y（CSS 像素，例如 --at 120,340），而不是「${value}」。`,
    clickTarget: () => "请给出选择器（可加 --index）或 --at x,y，二者选一。",
    newTabWithTab: () => "--new-tab 会新开一个标签页，因此不接受 --tab。",
    paramsInvalid: () => "--params 必须是一个 JSON 对象。",
    methodInvalid: (value) =>
      `「${value}」不是 CDP 方法：应写作 Domain.method，例如 DOM.getDocument。`,
    scriptSources: () => "脚本只能用一种方式给出：参数、--file 或 stdin。",
    scriptMissing: () =>
      "没有脚本：请作为参数给出、用 --file 指定，或从 stdin 传入（penguin browser exec <<'EOF' … EOF）。",
    scriptEmpty: () => "脚本是空的。",
    fileUnreadable: (path, detail) => `无法读取 ${path}：${detail}`,
    fileUnwritable: (path, detail) => `无法写入 ${path}：${detail}`,
    importMode: () => "用 --list 查看浏览器个人资料，或用 --from <来源 id|浏览器> 从其中之一导入。",
    sourceNotFound: (from, known) =>
      `没有与「${from}」匹配的浏览器个人资料${known.length > 0 ? `（本机有：${known.join("、")}）` : ""}；请查看 penguin browser import --list。`,
    sourceAmbiguous: (from, ids) =>
      `${from} 有多个个人资料，且没有 Default：${ids.join("、")}。请用 --from 指定其中一个。`,
  },
};

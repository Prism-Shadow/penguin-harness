/**
 * The messages of the plugin command, split out of the CLI's message table (hosted whole by the server
package). Field names and shapes are unchanged; the host's table spreads this file in.
 */

export interface PluginText {
  /** `penguin plugin`: the plugins installed on the server (an admin's, via the local API token). */
  plugin: {
    desc: string;
    listDesc: string;
    installDesc: string;
    /** `install --overwrite`: replace another version of an uploaded package directory. */
    overwriteOpt: string;
    removeDesc: string;
    colName(): string;
    colKind(): string;
    colState(): string;
    /** What a row is: a package of server modules the Project lists, or a package of Skills, hooks or MCP servers in the library. */
    kindModules(): string;
    kindLibrary(): string;
    active(): string;
    pending(): string;
    failed(reason: string): string;
    /** Listed for other machines of the Project only. */
    elsewhere(): string;
    none(): string;
    installed(name: string, version: string | null): string;
    /** The server already has this version of an uploaded package directory: nothing was installed. */
    unchanged(name: string, version: string | null): string;
    /** A package directory the plugin library would refuse, with the reader's reason; nothing was sent. */
    dirRefused(dir: string, reason: string): string;
    /** A package directory without an ifaces.json: it was never built; nothing was sent. */
    dirNotBuilt(dir: string): string;
    /** A built package directory whose ifaces.json contributes nothing for an Agent and lists no server modules; nothing was sent. */
    dirNotPlugin(dir: string): string;
    /** A package directory past the server's upload caps; nothing was sent. */
    dirTooLarge(dir: string): string;
    /** On stderr while a package directory goes up as a zip. */
    uploading(name: string, version: string, files: number): string;
    /** After the server's 409 `plugin_exists` (its message comes first). */
    overwriteHint(): string;
    /** A plugin the build ships: listing it is all an install does. */
    listedOnly(specifier: string, projectId: string): string;
    /** After installing a package of Skills, hooks or MCP servers. */
    libraryNext(): string;
    /** After installing a package directory: one line per MCP server it carries. */
    mcpServerLine(name: string, transport: string, target: string): string;
    /** After installing a package of server modules, applied without a restart. */
    modulesLoaded(projectId: string): string;
    /** After installing a package of server modules this server could not apply in place. */
    restartNext(): string;
    removed(name: string): string;
  };

  /** The ambiguity report: one argv matched commands from two or more plugins. */
  ambiguous: {
    /** The header; `words` is the argv's command words, `packages` the matching package count. */
    header(words: string, packages: number): string;
    /** The closing note: what to do once one of the `exec` lines has run. */
    note(): string;
  };
}

/** The English half of this contribution's messages. */
export const pluginEn: PluginText = {
  plugin: {
    desc: "Manage the plugins installed on the server (admin)",
    listDesc:
      "List the server modules the Project lists and the plugins of Skills, hooks or MCP servers installed on the server",
    installDesc:
      "Install a plugin on the server: an npm package name (@scope/name, name@1.2.3), an https link to a git repository or a tarball, or a local package directory, which is read with the plugin library's reader, zipped without node_modules and uploaded. A plugin of server modules is loaded at once, which stops the agent runs in progress",
    overwriteOpt:
      "Replace another version of the package already on the server (a package directory only)",
    removeDesc: "Remove a plugin from the Project, and from the server once nothing else lists it",
    colName: () => "PLUGIN",
    colKind: () => "KIND",
    colState: () => "STATE",
    kindModules: () => "server modules",
    kindLibrary: () => "skills / hooks / MCP",
    active: () => "running",
    pending: () => "waits for a restart",
    failed: (reason) => `failed to load: ${reason}`,
    elsewhere: () => "on other machines only",
    none: () => "No plugins installed on the server.",
    installed: (name, version) =>
      version === null ? `Installed ${name}.` : `Installed ${name} ${version}.`,
    unchanged: (name, version) =>
      `${name}${version === null ? "" : ` ${version}`} is already installed on the server; nothing changed.`,
    dirRefused: (dir, reason) =>
      `${dir} is not a package the plugin library can read, so nothing was sent: ${reason}`,
    dirNotBuilt: (dir) =>
      `${dir} has no ifaces.json, so it is not a built plugin package: build it first (npm install, then npx penguin-gen-ifaces --project tsconfig.json --out ifaces.json). Nothing was sent.`,
    dirNotPlugin: (dir) =>
      `${dir} is not a PenguinHarness plugin: its ifaces.json contributes no Skills, hook package, MCP servers or workbenches, and lists no server modules with a code entry. Nothing was sent.`,
    dirTooLarge: (dir) =>
      `${dir} exceeds what a plugin package may hold (2000 files, 5MB per file, 50MB in all, a 14MB zip). Nothing was sent.`,
    uploading: (name, version, files) => `Uploading ${name} ${version} (${files} files)…`,
    overwriteHint: () => "Re-run with --overwrite to replace it.",
    listedOnly: (specifier, projectId) =>
      `${specifier} ships with this server; listed for Project ${projectId}.`,
    libraryNext: () =>
      "It is in the plugin library: install it on an agent from the Plugins page (Manage installs).",
    mcpServerLine: (name, transport, target) => `MCP server: ${name} (${transport}) ${target}`,
    modulesLoaded: (projectId) => `Listed for Project ${projectId} on this server and loaded.`,
    restartNext: () => "Listed; restart the server to load it.",
    removed: (name) => `Removed ${name}.`,
  },

  ambiguous: {
    header: (words, packages) =>
      `Ambiguous command: '${words}' matches commands from ${packages} plugins. Run the one you meant:`,
    note: () => "Note: after it runs, tell the user which plugin's command that was.",
  },
};

/** The Chinese half of this contribution's messages. */
export const pluginZh: PluginText = {
  plugin: {
    desc: "管理服务端安装的插件（管理员）",
    listDesc: "列出 Project 启用的服务端模块，以及服务端安装的 Skill / 钩子 / MCP Server 插件",
    installDesc:
      "把插件安装到服务端：npm 包名（@scope/name、name@1.2.3）、指向 git 仓库或 tarball 的 https 链接，或本地插件包目录（先用插件库的读取器校验，去掉 node_modules 打成 zip 后上传）。服务端模块插件会立即载入，正在进行的 Agent 运行会被中止",
    overwriteOpt: "替换服务端上已安装的该包的其他版本（仅用于插件包目录）",
    removeDesc: "从 Project 中移除插件；没有其他 Project 使用时一并从服务端删除",
    colName: () => "插件",
    colKind: () => "类型",
    colState: () => "状态",
    kindModules: () => "服务端模块",
    kindLibrary: () => "技能 / 钩子 / MCP",
    active: () => "运行中",
    pending: () => "待重启",
    failed: (reason) => `加载失败：${reason}`,
    elsewhere: () => "只在其他机器上",
    none: () => "服务端没有安装插件。",
    installed: (name, version) =>
      version === null ? `已安装 ${name}。` : `已安装 ${name} ${version}。`,
    unchanged: (name, version) =>
      `服务端已安装 ${name}${version === null ? "" : ` ${version}`}，没有任何改动。`,
    dirRefused: (dir, reason) => `插件库无法读取 ${dir} 中的包，未发送任何内容：${reason}`,
    dirNotBuilt: (dir) =>
      `${dir} 没有 ifaces.json，不是构建过的插件包：请先构建（npm install，然后 npx penguin-gen-ifaces --project tsconfig.json --out ifaces.json）。未发送任何内容。`,
    dirNotPlugin: (dir) =>
      `${dir} 不是 PenguinHarness 插件：它的 ifaces.json 既没有贡献 Skill、钩子包、MCP Server 或 Workbench，也没有列出带代码入口的服务端模块。未发送任何内容。`,
    dirTooLarge: (dir) =>
      `${dir} 超出插件包的上限（2000 个文件、单个文件 5MB、合计 50MB、zip 14MB）。未发送任何内容。`,
    uploading: (name, version, files) => `正在上传 ${name} ${version}（${files} 个文件）…`,
    overwriteHint: () => "加上 --overwrite 重新运行即可替换。",
    listedOnly: (specifier, projectId) =>
      `${specifier} 随本服务端自带，已为 Project ${projectId} 启用。`,
    libraryNext: () => "它已进入插件库：请在插件页通过「管理安装」把它安装到 Agent 上。",
    mcpServerLine: (name, transport, target) => `MCP Server：${name}（${transport}）${target}`,
    modulesLoaded: (projectId) => `已在本服务端为 Project ${projectId} 启用并载入。`,
    restartNext: () => "已启用；重启服务端后载入。",
    removed: (name) => `已移除 ${name}。`,
  },

  ambiguous: {
    header: (words, packages) =>
      `命令有歧义：'${words}' 同时命中 ${packages} 个插件的命令。请执行你所指的那一行：`,
    note: () => "注：执行之后，把实际运行的是哪个插件的命令告诉用户。",
  },
};

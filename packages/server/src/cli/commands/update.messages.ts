/**
 * The messages of the update command, split out of the CLI's message table (hosted whole by the server
package). Field names and shapes are unchanged; the host's table spreads this file in.
 */

import type { InstallerSource } from "../i18n.js";

export interface UpdateText {
  /** `penguin update`: help text and every line the command can print. */
  update: {
    desc: string;
    check: string;
    releaseOpt: string;
    yes: string;
    /** `--check` header: the running version against the resolved target. */
    checkReport(current: string, latest: string): string;
    upgradeAvailable(target: string): string;
    upToDate(current: string): string;
    /** `--release` naming a release older than the running one: allowed, but said out loud. */
    targetIsOlder(target: string): string;
    /** Pre-confirmation plan for a tarball install (mechanism, target, install dir, data-dir guarantee). */
    planTarball(current: string, target: string, installDir: string, universal: boolean): string;
    /** Pre-confirmation plan for a global npm install. */
    planNpm(current: string, target: string, manager: string, command: string): string;
    confirm(): string;
    /** stdin is not a TTY: require --yes instead of blocking on a prompt nobody can answer. */
    needsYes(): string;
    cancelled(): string;
    done(version: string): string;
    failed(): string;
    /** Running from a source checkout: refuse, because overwriting a working tree destroys work. */
    sourceCheckout(): string;
    /** Bundled into the desktop app: refuse, because the app updates itself. */
    desktopApp(): string;
    unknownInstall(modulePath: string): string;
    /** A global install whose package manager could not be identified: print the command, never guess. */
    npmUnknownManager(globalRoot: string, target: string): string;
    /** Windows, tarball install: the official installer is a POSIX shell script. */
    windowsUnsupported(): string;
    /**
     * Windows, global install: `spawn` cannot run a `.cmd` shim without a shell, so hand the user
     * the exact command instead of failing generically.
     */
    windowsGlobalInstall(command: string): string;
    networkFailed(url: string): string;
    rateLimited(): string;
    apiFailed(status: number): string;
    apiMalformed(): string;
    invalidDownloadSource(): string;
    downloadBaseMustBeHttps(name: string): string;
    ossUnavailable(): string;
    installerFetchFailed(sources: InstallerSource[]): string;
  };
}

/** The English half of this contribution's messages. */
export const updateEn: UpdateText = {
  update: {
    desc: "Upgrade this PenguinHarness install in place",
    check: "Only report the current and latest versions; change nothing",
    releaseOpt:
      "Target a specific release tag instead of the latest (e.g. v0.1.2 or 0.1.2); named --release because -v/--version is the CLI's own version flag",
    yes: "Skip the confirmation prompt",
    checkReport: (current, latest) => `Installed ${current} · latest ${latest}`,
    upgradeAvailable: (target) =>
      `An upgrade is available: run \`penguin update\` to install ${target}.`,
    upToDate: (current) => `Already on the latest version (${current}); nothing to do.`,
    targetIsOlder: (target) =>
      `${target} is older than the installed version — this would be a downgrade.`,
    planTarball: (current, target, installDir, universal) =>
      [
        `Upgrade ${current} -> ${target}`,
        `  how:         re-run the official installer (this install came from the tarball)`,
        `  install dir: ${installDir}${universal ? " (universal package, no bundled Node runtime)" : ""}`,
        `  replaces:    bin, lib, web${universal ? "" : ", node"} — your data dir is NOT touched`,
      ].join("\n"),
    planNpm: (current, target, manager, command) =>
      [
        `Upgrade ${current} -> ${target}`,
        `  how:     global ${manager} install (this install came from ${manager})`,
        `  command: ${command}`,
        `  your data dir is NOT touched`,
      ].join("\n"),
    confirm: () => "Proceed? [y/N] ",
    needsYes: () =>
      "Not running in a terminal, so the confirmation cannot be answered. Re-run with --yes to upgrade non-interactively.",
    cancelled: () => "Cancelled; nothing was changed.",
    done: (version) =>
      `PenguinHarness ${version} installed. Run \`penguin --version\` in a new shell to confirm.`,
    failed: () => "Upgrade failed; the previous install was left in place where possible.",
    sourceCheckout: () =>
      "This penguin runs from a source checkout, so there is nothing to download — update it with `git pull` and rebuild (`pnpm install && pnpm -r build`).",
    desktopApp: () =>
      "This penguin ships inside the PenguinHarness desktop app and is replaced when the app updates — check for updates from the application menu.",
    unknownInstall: (modulePath) =>
      `Cannot tell how this penguin was installed (running from ${modulePath}), so it will not be replaced. Re-install with the official installer, or upgrade with the package manager you used.`,
    npmUnknownManager: (globalRoot, target) =>
      `This is a global install under ${globalRoot}, but the package manager that owns it could not be identified. Upgrade it yourself with that manager, e.g. \`npm install -g @prismshadow/penguin-cli@${target}\`.`,
    windowsUnsupported: () =>
      "The official installer is a POSIX shell script and does not run on Windows. Re-install from the GitHub Releases page, or use a global npm install instead.",
    windowsGlobalInstall: (command) =>
      [
        "On Windows, penguin cannot run your package manager for you: Node will not execute an npm/pnpm/yarn `.cmd` shim without a shell.",
        "Run this yourself in a terminal, then reopen it:",
        `  ${command}`,
      ].join("\n"),
    networkFailed: (url) => `Could not reach ${url}. Check your network and retry.`,
    rateLimited: () =>
      "GitHub rate-limited the release lookup. Wait a few minutes and retry, or pass --release <tag> to skip the lookup.",
    apiFailed: (status) => `The GitHub release lookup failed with HTTP ${status}.`,
    apiMalformed: () =>
      "The GitHub release lookup returned an unexpected response with no usable version tag.",
    invalidDownloadSource: () => "PENGUIN_DOWNLOAD_SOURCE must be auto, oss, or github.",
    downloadBaseMustBeHttps: (name) => `${name} must be an absolute HTTPS URL.`,
    ossUnavailable: () => "The OSS mirror is unavailable or its release metadata is invalid.",
    installerFetchFailed: (sources) =>
      `Could not download the installer from ${sources
        .map((source) =>
          source === "configured"
            ? "the configured mirror"
            : source === "oss"
              ? "the OSS mirror"
              : "GitHub",
        )
        .join(" or ")}. Check your network and retry.`,
  },
};

/** The Chinese half of this contribution's messages. */
export const updateZh: UpdateText = {
  update: {
    desc: "原地升级当前的 PenguinHarness 安装",
    check: "只报告当前版本与最新版本，不做任何修改",
    releaseOpt:
      "指定目标版本而不是最新版（如 v0.1.2 或 0.1.2）；之所以叫 --release，是因为 -v/--version 是 CLI 自身的版本参数",
    yes: "跳过确认提示",
    checkReport: (current, latest) => `已安装 ${current} · 最新 ${latest}`,
    upgradeAvailable: (target) => `有可用升级：执行 \`penguin update\` 安装 ${target}。`,
    upToDate: (current) => `已是最新版本（${current}），无需升级。`,
    targetIsOlder: (target) => `${target} 低于当前已安装的版本——这将是一次降级。`,
    planTarball: (current, target, installDir, universal) =>
      [
        `升级 ${current} -> ${target}`,
        `  方式：    重新执行官方安装脚本（当前安装来自 tarball）`,
        `  安装目录：${installDir}${universal ? "（universal 包，不含内置 Node 运行时）" : ""}`,
        `  将替换：  bin、lib、web${universal ? "" : "、node"}——数据目录不会被改动`,
      ].join("\n"),
    planNpm: (current, target, manager, command) =>
      [
        `升级 ${current} -> ${target}`,
        `  方式：  ${manager} 全局安装（当前安装来自 ${manager}）`,
        `  命令：  ${command}`,
        `  数据目录不会被改动`,
      ].join("\n"),
    confirm: () => "确认继续？[y/N] ",
    needsYes: () => "当前不在终端中，无法回答确认提示。请加 --yes 以非交互方式升级。",
    cancelled: () => "已取消，未做任何修改。",
    done: (version) =>
      `PenguinHarness ${version} 安装完成。在新 shell 中执行 \`penguin --version\` 确认。`,
    failed: () => "升级失败；在可能的情况下已保留原有安装。",
    sourceCheckout: () =>
      "当前 penguin 运行自源码检出，无需下载——请用 `git pull` 更新并重新构建（`pnpm install && pnpm -r build`）。",
    desktopApp: () =>
      "当前 penguin 随 PenguinHarness 桌面应用一同分发，会在应用更新时一并替换——请从应用菜单检查更新。",
    unknownInstall: (modulePath) =>
      `无法判断当前 penguin 的安装方式（运行自 ${modulePath}），因此不会替换它。请用官方安装脚本重新安装，或用你当初使用的包管理器升级。`,
    npmUnknownManager: (globalRoot, target) =>
      `这是位于 ${globalRoot} 的全局安装，但无法确定是哪个包管理器安装的。请自行用该包管理器升级，例如 \`npm install -g @prismshadow/penguin-cli@${target}\`。`,
    windowsUnsupported: () =>
      "官方安装脚本是 POSIX shell 脚本，无法在 Windows 上运行。请从 GitHub Releases 页面重新安装，或改用 npm 全局安装。",
    windowsGlobalInstall: (command) =>
      [
        "在 Windows 上，penguin 无法代你调用包管理器：Node 不会在没有 shell 的情况下执行 npm/pnpm/yarn 的 `.cmd` 包装脚本。",
        "请在终端里自行执行下面的命令，然后重新打开终端：",
        `  ${command}`,
      ].join("\n"),
    networkFailed: (url) => `无法访问 ${url}。请检查网络后重试。`,
    rateLimited: () =>
      "GitHub 对版本查询做了限流。请等待几分钟后重试，或用 --release <tag> 跳过查询。",
    apiFailed: (status) => `GitHub 版本查询失败，HTTP ${status}。`,
    apiMalformed: () => "GitHub 版本查询返回了非预期的响应，其中没有可用的版本号。",
    invalidDownloadSource: () => "PENGUIN_DOWNLOAD_SOURCE 必须是 auto、oss 或 github。",
    downloadBaseMustBeHttps: (name) => `${name} 必须是绝对 HTTPS URL。`,
    ossUnavailable: () => "OSS 镜像不可用，或其版本元数据无效。",
    installerFetchFailed: (sources) => {
      const sourceText = sources
        .map((source) =>
          source === "configured" ? "配置的镜像" : source === "oss" ? "OSS 镜像" : "GitHub",
        )
        .join("或 ");
      const leadingSpace = /^[A-Za-z]/.test(sourceText) ? " " : "";
      const trailingSpace = /[A-Za-z]$/.test(sourceText) ? " " : "";
      return `无法从${leadingSpace}${sourceText}${trailingSpace}下载安装脚本。请检查网络后重试。`;
    },
  },
};

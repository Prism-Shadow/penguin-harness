/**
 * The serve group's runtime text, in both languages.
 *
 * These commands moved into the server package, so their text moved with them — the
 * descriptions a listing prints live in the package's `cli.commands` declaration
 * (module.ts); everything the commands themselves print lives here. The shapes are the
 * ones the CLI's own i18n module used, so the moved code reads the same way it always did,
 * keyed by the language the host resolved (`CliContext.language`) instead of a host
 * message table.
 */

/** Readiness probe failure classes; selects which hint `webProbeFailed` appends. */
export type WebProbeFailureKind =
  "timeout" | "refused" | "reset" | "permission" | "dns" | "unknown";

/** The serve group's runtime text (the one-line descriptions live in module.ts). */
export interface ServeMessages {
  /** The `--root` option of `server status` / `server stop`. */
  root: string;
  serve: {
    port: string;
    host: string;
    noOpen: string;
    /** Printed by the supervising process as it relaunches the service on a restart request (the web UI's "restart to update"). */
    restarting: string;
    app: string;
  };
  serverAlreadyRunning(url: string): string;
  webAlreadyRunning(url: string): string;
  webReady(url: string): string;
  webProbeFailed(url: string, detail: string, kind: WebProbeFailureKind, port: number): string;
  resetPassword: {
    /** Refusal while a live server owns the data root (stop it first, then retry). */
    serverRunning(url: string): string;
    /** The root has no Web database: nothing to reset. */
    noDatabase(dbPath: string): string;
    /** The database exists but the admin was never seeded. */
    noAdmin(): string;
    /** Success header, printed above the framed credentials notice. */
    done(root: string): string;
    /** Hint printed below the notice. */
    next(): string;
  };
}

const en: ServeMessages = {
  root: "Data root directory (overrides PENGUIN_HOME and ~/.penguin/data)",
  serve: {
    port: "Listen port (falls back to the PORT env var, default 7364)",
    host: "Listen address (falls back to the HOST env var, default 127.0.0.1)",
    noOpen: "Do not open a browser automatically",
    restarting: "Restarting the service to apply the update…",
    app: "Open one workflow page as the whole app: <project>/<agent>/<workflow>[/<tab>] (Ctrl+P or Ctrl+Shift+P in the page opens the command palette to leave)",
  },
  serverAlreadyRunning: (url) =>
    `A PenguinHarness server is already running on this data root: ${url}\n` +
    `Stop it first, or point PENGUIN_HOME at a separate data root.`,
  webAlreadyRunning: (url) =>
    `Already running on this data root — opening the existing instance: ${url}`,
  webReady: (url) => `Web UI ready: ${url}`,
  webProbeFailed: (url, detail, kind, port) => {
    const hint = {
      timeout:
        `The connection timed out. Check whether a firewall or security application is blocking it. ` +
        `Allow PenguinHarness to communicate on local port ${port}.`,
      refused:
        "Nothing accepted the connection. Check whether the server exited or HOST/PORT points somewhere else.",
      reset:
        "The connection closed before an HTTP response. Check local security software and retry.",
      permission:
        "The operating system denied the connection. Check firewall or security policy permissions.",
      dns: "The host name could not be resolved. Check --host or HOST.",
      unknown: `Open ${url} manually after the server is ready.`,
    }[kind];
    return `Server readiness check failed for ${url}.\nLast probe error: ${detail}\n${hint}`;
  },
  resetPassword: {
    serverRunning: (url) =>
      `A PenguinHarness server is running on this data root: ${url}\n` +
      `Stop it first, then run \`penguin server reset-admin-password\` again.`,
    noDatabase: (dbPath) =>
      `No Web database at ${dbPath} — nothing to reset. ` +
      `Start the service once (\`penguin web\`) to create the admin account.`,
    noAdmin: () =>
      "The Web database has no admin account yet — nothing to reset. " +
      "Start the service once (`penguin web`) to seed it.",
    done: (root) =>
      `The admin account on data root ${root} was returned to its unclaimed state, and all of its sign-in sessions were revoked.`,
    next: () =>
      "Start the service (`penguin web`): it will print a sign-in link that claims the account — usable until a password is set.",
  },
};

const zh: ServeMessages = {
  root: "数据根目录（优先于 PENGUIN_HOME 与 ~/.penguin/data）",
  serve: {
    port: "监听端口（其次取环境变量 PORT，缺省 7364）",
    host: "监听地址（其次取环境变量 HOST，缺省 127.0.0.1）",
    noOpen: "不自动打开浏览器",
    restarting: "正在重启服务以应用更新…",
    app: "以某个 workflow 页面占满整个应用打开：<project>/<agent>/<workflow>[/<tab>]（页面内按 Ctrl+P 或 Ctrl+Shift+P 打开命令面板可退出）",
  },
  serverAlreadyRunning: (url) =>
    `该数据根目录已有 PenguinHarness 服务在运行：${url}\n请先停止它，或用 PENGUIN_HOME 指定另一个数据根目录。`,
  webAlreadyRunning: (url) => `该数据根目录已有服务在运行，打开既有实例：${url}`,
  webReady: (url) => `Web 界面已就绪：${url}`,
  webProbeFailed: (url, detail, kind, port) => {
    const hint = {
      timeout: `连接超时。请检查防火墙或安全软件是否拦截。请允许 PenguinHarness 在本机端口 ${port} 上通信。`,
      refused: "没有进程接受连接。请检查服务是否已经退出，或 HOST/PORT 是否指向了其他地址。",
      reset: "连接在收到 HTTP 响应前已关闭。请检查本机安全软件后重试。",
      permission: "操作系统拒绝了连接。请检查防火墙或安全策略权限。",
      dns: "无法解析主机名。请检查 --host 或 HOST。",
      unknown: `请在服务就绪后手动打开 ${url}。`,
    }[kind];
    return `服务探活失败：${url}\n最后一次探测错误：${detail}\n${hint}`;
  },
  resetPassword: {
    serverRunning: (url) =>
      `该数据根目录已有 PenguinHarness 服务在运行：${url}\n` +
      `请先停止它，再重新执行 \`penguin server reset-admin-password\`。`,
    noDatabase: (dbPath) =>
      `${dbPath} 处没有 Web 数据库，无可重置。请先执行 \`penguin web\` 启动一次服务以创建管理员账号。`,
    noAdmin: () =>
      "Web 数据库中尚无管理员账号，无可重置。请先执行 `penguin web` 启动一次服务完成种子创建。",
    done: (root) => `数据根目录 ${root} 的管理员账号已退回未认领状态，其全部登录会话已吊销。`,
    next: () =>
      "启动服务（`penguin web`），它会打印一条登录链接用于认领该账号——在密码被设置之前一直有效。",
  },
};

/** The serve group's runtime text for the host-resolved language. */
export function serveMessages(language: "en" | "zh"): ServeMessages {
  return language === "zh" ? zh : en;
}

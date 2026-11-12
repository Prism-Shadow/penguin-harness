/**
 * The messages of the serve command, split out of the CLI's message table (hosted whole by the server
package). Field names and shapes are unchanged; the host's table spreads this file in.
 */

import type { WebProbeFailureKind } from "../i18n.js";

export interface ServeText {
  serve: {
    serverDesc: string;
    webDesc: string;
    port: string;
    host: string;
    noOpen: string;
    /** Printed by the supervising process as it relaunches the service on a restart request (the web UI's "restart to update"). */
    restarting: string;
    app: string;
  };

  /** URL prompt once the `penguin web` service is ready. */
  webReady(url: string): string;

  /** Refusal when `penguin server` finds a live server on the same data root. */
  serverAlreadyRunning(url: string): string;

  /** Notice when `penguin web` finds a live server on the same data root (it opens that instance instead). */
  webAlreadyRunning(url: string): string;

  /** Diagnostic shown after the `penguin web` ready-poll times out (15s). */
  webProbeFailed(url: string, detail: string, kind: WebProbeFailureKind, port: number): string;

  /** `penguin server status`: help text. */
  serverStatus: {
    /** One-line description in `penguin server --help`. */
    desc: string;
  };

  /** `penguin server stop`: help text. */
  serverStop: {
    desc: string;
  };
}

/** The English half of this contribution's messages. */
export const serveEn: ServeText = {
  serve: {
    serverDesc:
      "Start the Web service (HTTP API and the built-in frontend, same process); subcommand reset-admin-password resets a forgotten admin password",
    webDesc: "Start the Web service and open the UI in a browser once it is ready",
    port: "Listen port (falls back to the PORT env var, default 7364)",
    host: "Listen address (falls back to the HOST env var, default 127.0.0.1)",
    noOpen: "Do not open a browser automatically",
    restarting: "Restarting the service to apply the update…",
    app: "Open one workbench page as the whole app: <project>/<agent>/<workbench>[/<tab>] (Ctrl+P or Ctrl+Shift+P in the page opens the command palette to leave)",
  },

  webReady: (url) => `Web UI ready: ${url}`,

  serverAlreadyRunning: (url) =>
    `A PenguinHarness server is already running on this data root: ${url}\n` +
    `Stop it first, or point PENGUIN_HOME at a separate data root.`,

  webAlreadyRunning: (url) =>
    `Already running on this data root — opening the existing instance: ${url}`,

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

  serverStatus: {
    desc: "Print this data root's server state and machine id as one line of JSON",
  },

  serverStop: {
    desc: "Stop the server running on this data root and report the outcome as JSON",
  },
};

/** The Chinese half of this contribution's messages. */
export const serveZh: ServeText = {
  serve: {
    serverDesc:
      "启动 Web 服务（HTTP API 与内置前端，同一进程）；子命令 reset-admin-password 重置忘记的管理员密码",
    webDesc: "启动 Web 服务，就绪后用浏览器打开界面",
    port: "监听端口（其次取环境变量 PORT，缺省 7364）",
    host: "监听地址（其次取环境变量 HOST，缺省 127.0.0.1）",
    noOpen: "不自动打开浏览器",
    restarting: "正在重启服务以应用更新…",
    app: "以某个 workbench 页面占满整个应用打开：<project>/<agent>/<workbench>[/<tab>]（页面内按 Ctrl+P 或 Ctrl+Shift+P 打开命令面板可退出）",
  },

  webReady: (url) => `Web 界面已就绪：${url}`,

  serverAlreadyRunning: (url) =>
    `该数据根目录已有 PenguinHarness 服务在运行：${url}\n请先停止它，或用 PENGUIN_HOME 指定另一个数据根目录。`,

  webAlreadyRunning: (url) => `该数据根目录已有服务在运行，打开既有实例：${url}`,

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

  serverStatus: {
    desc: "以单行 JSON 打印本数据根目录的服务状态与本机 id",
  },

  serverStop: {
    desc: "停止本数据根目录上运行的服务，并以 JSON 报告结果",
  },
};

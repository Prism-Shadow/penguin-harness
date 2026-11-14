/**
 * The messages of the auth command, split out of the CLI's message table (hosted whole by the server
package). Field names and shapes are unchanged; the host's table spreads this file in.
 */

export interface AuthText {
  /** `penguin server reset-admin-password`: help text and every line the command can print. */
  auth: {
    desc: string;
    loginDesc: string;
    statusDesc: string;
    logoutDesc: string;
    server: string;
    userId: string;
    password: string;
    print: string;
    accountPrompt(fallback: string): string;
    prompt(userId: string): string;
    emptyPassword: string;
    noServer(root: string): string;
    unreachable(server: string, detail: string): string;
    refused(status: number, detail: string): string;
    noCookie: string;
    loggedIn(userId: string, server: string, file: string): string;
    notLoggedIn(file: string): string;
    statusLine(userId: string, server: string): string;
    expires(when: string): string;
    expired(when: string): string;
    loggedOut(server: string): string;
    loggedOutLocally(server: string): string;
  };

  authToken: {
    desc: string;
    userId: string;
    ttlSeconds: string;
    mark: string;
    badTtl: string;
    noServer(root: string): string;
    failed(detail: string): string;
  };
}

/** The English half of this contribution's messages. */
export const authEn: AuthText = {
  auth: {
    desc: "Sign in to a PenguinHarness server from the terminal",
    loginDesc: "Sign in with a password and remember the session",
    statusDesc: "Show the remembered session, if there is one",
    logoutDesc: "Revoke the remembered session and forget it",
    server: "Server URL (default: the server running on this data root)",
    userId: "Account to sign in as (asked for when omitted; default admin)",
    password: "Password (also read from PENGUIN_PASSWORD; prompted when neither is given)",
    print: "Also print the session token to stdout",
    accountPrompt: (fallback) => `Account [${fallback}]: `,
    prompt: (userId) => `Password for ${userId}: `,
    emptyPassword: "No password given.",
    noServer: (root) =>
      `No server is running on ${root}, so there is nothing to sign in to \u2014 pass --server <url>.`,
    unreachable: (server, detail) => `Could not reach ${server}: ${detail}`,
    refused: (status, detail) => `The server refused the sign-in (${status}): ${detail}`,
    noCookie: "The server accepted the sign-in but issued no session cookie.",
    loggedIn: (userId, server, file) => `Signed in as ${userId} on ${server}. Saved to ${file}.`,
    notLoggedIn: (file) => `Not signed in (no ${file}).`,
    statusLine: (userId, server) => `Signed in as ${userId} on ${server}.`,
    expires: (when) => `Expires ${when}.`,
    expired: (when) => `Expired ${when} \u2014 sign in again.`,
    loggedOut: (server) => `Signed out of ${server}; the session was revoked there.`,
    loggedOutLocally: (server) =>
      `Forgotten locally, but ${server} could not be reached \u2014 the session may still be valid there until it expires.`,
  },

  authToken: {
    desc: "Mint a short-lived API session token for this data root (for a controller reaching this machine over ssh)",
    userId: "Account to mint for (default: admin)",
    ttlSeconds: "Lifetime in seconds (default: 3600)",
    mark: "Print a fixed marker line before the token, for callers parsing it out of a shell",
    badTtl: "--ttl-seconds must be a positive integer.",
    noServer: (root) =>
      `${root} has no web.db — no server has ever run on this data root, so there is no account to mint for.`,
    failed: (detail) => `Could not mint a token: ${detail}`,
  },
};

/** The Chinese half of this contribution's messages. */
export const authZh: AuthText = {
  auth: {
    desc: "在终端里登录 PenguinHarness 服务",
    loginDesc: "用密码登录并记住会话",
    statusDesc: "显示已记住的会话",
    logoutDesc: "吊销并忘记已记住的会话",
    server: "服务地址（默认：该数据根上正在运行的服务）",
    userId: "登录的账号（不给时会询问；默认 admin）",
    password: "密码（也可用 PENGUIN_PASSWORD；都没给时会提示输入）",
    print: "同时把会话令牌打印到 stdout",
    accountPrompt: (fallback) => `账号 [${fallback}]：`,
    prompt: (userId) => `${userId} 的密码：`,
    emptyPassword: "没有输入密码。",
    noServer: (root) => `${root} 上没有正在运行的服务，无处登录——请用 --server <url> 指定。`,
    unreachable: (server, detail) => `连接不上 ${server}：${detail}`,
    refused: (status, detail) => `服务拒绝了登录（${status}）：${detail}`,
    noCookie: "服务接受了登录，但没有下发会话 Cookie。",
    loggedIn: (userId, server, file) => `已以 ${userId} 登录 ${server}，会话保存在 ${file}。`,
    notLoggedIn: (file) => `尚未登录（没有 ${file}）。`,
    statusLine: (userId, server) => `已以 ${userId} 登录 ${server}。`,
    expires: (when) => `有效期至 ${when}。`,
    expired: (when) => `已于 ${when} 过期——请重新登录。`,
    loggedOut: (server) => `已登出 ${server}，该会话已在服务端吊销。`,
    loggedOutLocally: (server) =>
      `已在本地忘记，但连接不上 ${server}——该会话可能在过期前仍然有效。`,
  },

  authToken: {
    desc: "为该数据根签发短期 API 会话令牌（供通过 ssh 连接本机的控制端使用）",
    userId: "签发给哪个账号（默认 admin）",
    ttlSeconds: "有效期秒数（默认 3600）",
    mark: "在令牌前打印固定标记行，供需要从 shell 输出里解析它的调用方使用",
    badTtl: "--ttl-seconds 必须是正整数。",
    noServer: (root) => `${root} 上没有 web.db——该数据根上从未运行过服务，因此没有可签发的账号。`,
    failed: (detail) => `签发失败：${detail}`,
  },
};

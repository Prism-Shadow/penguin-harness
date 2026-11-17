/**
 * The messages of the resetpassword command, split out of the CLI's message table (hosted whole by the server
package). Field names and shapes are unchanged; the host's table spreads this file in.
 */

export interface ResetPasswordText {
  resetPassword: {
    desc: string;
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

/** The English half of this contribution's messages. */
export const resetpasswordEn: ResetPasswordText = {
  resetPassword: {
    desc: "Reset the Web admin account so the next server start prints a new first-login link (the server must be stopped)",
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

/** The Chinese half of this contribution's messages. */
export const resetpasswordZh: ResetPasswordText = {
  resetPassword: {
    desc: "重置 Web 管理员账号，下次启动服务时会打印新的首次登录链接（须先停止服务）",
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

/**
 * The messages of the exec command, split out of the CLI's message table (hosted whole by the server
package). Field names and shapes are unchanged; the host's table spreads this file in.
 */

export interface ExecText {
  /** `penguin exec <package> [args…]`: a plugin's command, run by the server, named by its package. */
  exec: {
    /** The <package> argument's help text. */
    packageArg: string;
    /** The variadic arguments' help text. */
    argsArg: string;
    /** No plugin on the server contributes commands under the name given. */
    unknownPackage(name: string): string;
    /** The plugins that do, listed after the unknown-name error (empty: none does). */
    candidates(packages: readonly string[]): string;
    /** The short name names more than one package: only the full npm name is unambiguous. */
    shortCollision(short: string, packages: readonly string[]): string;
  };
}

/** The English half of this contribution's messages. */
export const execEn: ExecText = {
  exec: {
    packageArg: "The plugin: its unique short name, or its npm name when the short one collides",
    argsArg: "The command and its arguments, as they would follow `penguin`",
    unknownPackage: (name) => `No plugin on the server contributes commands as '${name}'.`,
    candidates: (packages) =>
      packages.length === 0
        ? "No plugin on the server contributes commands."
        : `Plugins with commands: ${packages.join(", ")}.`,
    shortCollision: (short, packages) =>
      `'${short}' names more than one plugin (${packages.join(", ")}); pass the full npm name.`,
  },
};

/** The Chinese half of this contribution's messages. */
export const execZh: ExecText = {
  exec: {
    packageArg: "插件：短名唯一时可用短名，撞名时用 npm 全名",
    argsArg: "命令与其参数，即跟在 `penguin` 后面的内容",
    unknownPackage: (name) => `服务端没有以 '${name}' 为名贡献命令的插件。`,
    candidates: (packages) =>
      packages.length === 0
        ? "服务端没有贡献命令的插件。"
        : `贡献命令的插件：${packages.join("、")}。`,
    shortCollision: (short, packages) =>
      `短名 '${short}' 对应多个插件（${packages.join("、")}），请传 npm 全名。`,
  },
};

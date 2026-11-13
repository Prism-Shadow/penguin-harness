/**
 * The messages of the exec command, split out of the CLI's message table (hosted whole by the server
package). Field names and shapes are unchanged; the host's table spreads this file in.
 */

export interface ExecText {
  /** `penguin exec <id> [args…]`: a plugin command by its dotted id, run by the server. */
  exec: {
    /** The variadic arguments' help text: the id and everything handed to the plugin command. */
    argsArg: string;
    /** `penguin exec ls`: lists the plugin commands, in the style of `penguin agent ls`. */
    lsDesc: string;
    /** The ls argument's help text: one plugin's commands only, by its full npm name. */
    lsPackageArg: string;
    /** The table header of the package column (the full-listing form). */
    colPackage(): string;
    /** The table header of the id column. */
    colId(): string;
    /** The table header of the summary column. */
    colSummary(): string;
    /** A single word was given where a dotted id belongs (an id is two segments or more). */
    invalidId(word: string): string;
    /** No plugin command contributes this id. */
    unknownId(id: string): string;
    /** The ids that are contributed, listed after the unknown-id error (empty: none is). */
    keys(keys: readonly string[]): string;
    /** No plugin on the server contributes commands under the package name given. */
    unknownPackage(name: string): string;
    /** The plugins that do, listed after the unknown-package error (empty: none does). */
    candidates(packages: readonly string[]): string;
    /** The id is contributed by more than one plugin: only `<package>:<id>` is unambiguous. */
    collision(key: string, packages: readonly string[]): string;
  };
}

/** The English half of this contribution's messages. */
export const execEn: ExecText = {
  exec: {
    argsArg: "The command's dotted id, then the arguments and options handed to it",
    lsDesc: "List the commands the plugins contribute",
    lsPackageArg: "List only this plugin's commands: its npm name, scope included",
    colPackage: () => "Package",
    colId: () => "Id",
    colSummary: () => "Summary",
    invalidId: (word) =>
      `'${word}' is not a command id: an id is the command's dotted path, two segments or more (sandbox.deploy, for example). Run 'penguin exec ls' to see the ids.`,
    unknownId: (id) => `No plugin contributes a command with the id '${id}'.`,
    keys: (keys) =>
      keys.length === 0
        ? "No plugin on the server contributes commands."
        : `Command ids: ${keys.join(", ")}.`,
    unknownPackage: (name) => `No plugin on the server contributes commands as '${name}'.`,
    candidates: (packages) =>
      packages.length === 0
        ? "No plugin on the server contributes commands."
        : `Plugins with commands: ${packages.join(", ")}.`,
    collision: (key, packages) =>
      `'${key}' is contributed by more than one plugin (${packages.join(
        ", ",
      )}); name it fully: penguin exec <package>:${key}.`,
  },
};

/** The Chinese half of this contribution's messages. */
export const execZh: ExecText = {
  exec: {
    argsArg: "命令的点分 id，其后全部交给插件命令的参数与选项",
    lsDesc: "列出各插件贡献的命令",
    lsPackageArg: "只列这一个插件的命令：npm 名，scope 不可省略",
    colPackage: () => "插件",
    colId: () => "Id",
    colSummary: () => "摘要",
    invalidId: (word) =>
      `'${word}' 不是命令 id：id 是命令的点分路径，至少两段（例如 sandbox.deploy）。运行 'penguin exec ls' 查看全部 id。`,
    unknownId: (id) => `没有插件贡献 id 为 '${id}' 的命令。`,
    keys: (keys) =>
      keys.length === 0 ? "服务端没有贡献命令的插件。" : `可用的命令 id：${keys.join("、")}。`,
    unknownPackage: (name) => `服务端没有以 '${name}' 为名贡献命令的插件。`,
    candidates: (packages) =>
      packages.length === 0
        ? "服务端没有贡献命令的插件。"
        : `贡献命令的插件：${packages.join("、")}。`,
    collision: (key, packages) =>
      `'${key}' 被多个插件贡献（${packages.join("、")}），请写全：penguin exec <插件名>:${key}。`,
  },
};

/**
 * The messages of the run command, split out of the CLI's message table (hosted whole by the server
package). Field names and shapes are unchanged; the host's table spreads this file in.
 */

export interface RunText {
  run: {
    desc: string;
    message: string;
    /** run's --goal: goal mode, with an optional token budget value (`--goal 500k`). */
    goal: string;
    /** run's --session: reuse an existing Session (full id or unique fragment). */
    session: string;
    /** run's --background: POST the task and exit immediately, printing the session id. */
    background: string;
    /** --session combined with --workspace / the model pair: both fixed at creation. */
    sessionNoOverride(): string;
    /** The retired --source given a value other than `benchmark`. Removed at 0.3.0 with the flag. */
    sourceInvalid(value: string): string;
    /** The retired `--source benchmark`, accepted as a no-op until 0.3.0: why it is ignored. */
    sourceIgnored(): string;
    /** --background never waits, so a wait budget cannot apply to it. */
    timeoutWithBackground(): string;
    /** run's --title: name the Session being run (manual rename; the auto-title never overwrites it; with --session it renames the reused Session). */
    title: string;
  };

  /** run's --goal given an empty/whitespace -m (the objective must be non-empty text). */
  goalObjectiveEmpty(): string;
}

/** The English half of this contribution's messages. */
export const runEn: RunText = {
  run: {
    desc: "Run a single Task",
    message: "Prompt for this Task",
    goal: "Goal mode: loop until the goal completes; optional token budget (e.g. 500k, 2m)",
    session: "Reuse an existing Session (full id or a unique fragment, e.g. the 8-hex tail)",
    background: "Post the task and exit immediately, printing the session id",
    title:
      "Name the Session (manual rename; the auto-generated title never overwrites it; with --session, renames the reused Session)",
    sessionNoOverride: () =>
      "--session reuses an existing Session: --workspace, --model-id and --provider cannot be combined with it (the Session keeps its own; /switch-model inside penguin chat --resume changes its model, compacting first).",
    sourceInvalid: (value) =>
      `Invalid --source value "${value}". penguin run takes no --source: every Session it creates is a CLI Session.`,
    sourceIgnored: () =>
      "--source benchmark is no longer needed and is ignored: every Session penguin run creates is a CLI Session, archived until you unarchive it (Web App: Settings › Archived chats).",
    timeoutWithBackground: () =>
      "--timeout bounds the wait, and --background does not wait: drop one of them.",
  },

  goalObjectiveEmpty: () => "Goal mode requires a non-empty objective: pass it via -m.",
};

/** The Chinese half of this contribution's messages. */
export const runZh: RunText = {
  run: {
    desc: "单次运行一个 Task",
    message: "本次 Task 的 Prompt",
    goal: "目标模式：循环运行直至目标完成；可选 token 预算（如 500k、2m）",
    session: "复用既有 Session（完整 id 或唯一片段，如末尾 8 位十六进制）",
    background: "提交任务后立即退出，打印 session id",
    title:
      "为 Session 命名（手动重命名；自动生成的标题不会覆盖它；配合 --session 时重命名被复用的 Session）",
    sessionNoOverride: () =>
      "--session 复用既有 Session：不能与 --workspace、--model-id、--provider 同时使用（均沿用该 Session；如需换模型，在 penguin chat --resume 内用 /switch-model，会先压缩上下文）。",
    sourceInvalid: (value) =>
      `无效的 --source 取值 "${value}"。penguin run 不再接受 --source：它创建的每个会话都是 CLI 会话。`,
    sourceIgnored: () =>
      "--source benchmark 已不再需要，已忽略：penguin run 创建的每个会话都是 CLI 会话，默认归档，列在 Web App 设置的「已归档对话」中，取消归档后进入侧栏。",
    timeoutWithBackground: () => "--timeout 限定等待，而 --background 不等待：二者去其一。",
  },

  goalObjectiveEmpty: () => "目标模式需要非空的目标文本：请通过 -m 传入。",
};

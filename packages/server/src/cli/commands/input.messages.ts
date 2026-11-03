/**
 * The messages of the input command, split out of the CLI's message table (hosted whole by the server
package). Field names and shapes are unchanged; the host's table spreads this file in.
 */

export interface InputText {
  /** `penguin session input`: send a message into an existing session (steer when running, task when idle). */
  input: {
    desc: string;
    message: string;
    /** Poll form on a session that has produced no assistant text yet. */
    noReplyYet(): string;
  };
}

/** The English half of this contribution's messages. */
export const inputEn: InputText = {
  input: {
    desc: "Send a message into a session (steering while it runs, a new task when idle); without -m, print its most recent assistant reply. The session defaults to the agent's most recent one",
    message: "Message text (omit to poll the session's last assistant reply instead)",
    noReplyYet: () => "(no assistant reply yet)",
  },
};

/** The Chinese half of this contribution's messages. */
export const inputZh: InputText = {
  input: {
    desc: "向会话发送消息（运行中即插话，空闲时发起新 Task）；不带 -m 时输出其最近一条助手回复。省略 session id 即取当前 Agent 最近一次会话",
    message: "消息文本（省略时改为轮询该会话的最近助手回复）",
    noReplyYet: () => "（还没有助手回复）",
  },
};

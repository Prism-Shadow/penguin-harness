/**
 * The messages of the session command, split out of the CLI's message table (hosted whole by the server
package). Field names and shapes are unchanged; the host's table spreads this file in.
 */

export interface SessionText {
  /** `penguin session`: the group that lists, reads, messages and renames sessions. */
  session: {
    /** Group description. */
    desc: string;
    /** `penguin session rename`'s own description. */
    renameDesc: string;
    /** rename's optional session_id argument. */
    renameSessionId: string;
    /** rename's required -t/--title option. */
    renameTitle: string;
    /** The success line (short id form; the full id is what --json prints). */
    renamed(sessionId: string, title: string): string;
  };
}

/** The English half of this contribution's messages. */
export const sessionEn: SessionText = {
  session: {
    desc: "Work with the project's sessions: list them, read a session's history, send it a message, rename it",
    renameDesc:
      "Set a session's title (the manual rename; the auto-generated title never overwrites it)",
    renameSessionId:
      "The session to rename (full id or a unique fragment, e.g. the 8-hex tail; default: PENGUIN_SESSION_ID, else the agent's most recent session)",
    renameTitle: "The new title",
    renamed: (sessionId, title) => `Renamed ${sessionId} to \u201c${title}\u201d`,
  },
};

/** The Chinese half of this contribution's messages. */
export const sessionZh: SessionText = {
  session: {
    desc: "管理 Project 的会话：列出会话、查看历史、发送消息、重命名",
    renameDesc: "设置会话标题（手动重命名；自动生成的标题不会覆盖它）",
    renameSessionId:
      "要重命名的会话，完整 id 或唯一片段（如末尾 8 位十六进制；缺省 PENGUIN_SESSION_ID，再缺省取当前 Agent 最近一次会话）",
    renameTitle: "新标题",
    renamed: (sessionId, title) => `已将 ${sessionId} 重命名为「${title}」`,
  },
};

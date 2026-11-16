/**
 * The messages of the version command, split out of the CLI's message table (hosted whole by the server
package). Field names and shapes are unchanged; the host's table spreads this file in.
 */

export interface VersionText {
  /** `penguin version`: help text only — the command's output is data, never prose. */
  version: {
    description: string;
    json: string;
  };
}

/** The English half of this contribution's messages. */
export const versionEn: VersionText = {
  version: {
    description: "Show which build is running",
    json: "Print the full build info as JSON (the body of GET /api/version)",
  },
};

/** The Chinese half of this contribution's messages. */
export const versionZh: VersionText = {
  version: {
    description: "显示当前运行的是哪个构建",
    json: "以 JSON 输出完整构建信息（即 GET /api/version 的响应体）",
  },
};

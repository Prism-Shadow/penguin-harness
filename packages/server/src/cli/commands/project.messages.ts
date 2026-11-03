/**
 * The messages of the project command, split out of the CLI's message table (hosted whole by the server
package). Field names and shapes are unchanged; the host's table spreads this file in.
 */

export interface ProjectText {
  /** `penguin project`: project listing. */
  project: {
    desc: string;
    lsDesc: string;
    colId(): string;
    colName(): string;
    colRole(): string;
  };
}

/** The English half of this contribution's messages. */
export const projectEn: ProjectText = {
  project: {
    desc: "Manage projects",
    lsDesc: "List the projects this account can reach",
    colId: () => "ID",
    colName: () => "NAME",
    colRole: () => "ROLE",
  },
};

/** The Chinese half of this contribution's messages. */
export const projectZh: ProjectText = {
  project: {
    desc: "管理 Project",
    lsDesc: "列出当前账号可用的 Project",
    colId: () => "ID",
    colName: () => "名称",
    colRole: () => "角色",
  },
};

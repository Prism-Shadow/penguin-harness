/**
 * The messages of the cost command, split out of the CLI's message table (hosted whole by the server
package). Field names and shapes are unchanged; the host's table spreads this file in.
 */

export interface CostText {
  /** `penguin cost`: token/cost aggregates. */
  cost: {
    desc: string;
    days: string;
    from: string;
    to: string;
    by: string;
    rangeIncomplete(): string;
    daysInvalid(value: string): string;
    byInvalid(value: string): string;
    today(): string;
    last7d(): string;
    total(): string;
    empty(): string;
    /** Cost cell when no model in the bucket has pricing configured. */
    noPricing(): string;
    colTokens(): string;
    colRequests(): string;
    colCost(): string;
    colGroup(dimension: string): string;
  };
}

/** The English half of this contribution's messages. */
export const costEn: CostText = {
  cost: {
    desc: "Show token usage and cost (summary card by default; --by prints a grouped table)",
    days: "Trailing window in days (sets --from/--to)",
    from: "Range start (yyyy-mm-dd); requires --to",
    to: "Range end (yyyy-mm-dd); requires --from",
    by: "Group the table by: date, agent, model or session",
    rangeIncomplete: () => "--from and --to must be given together.",
    daysInvalid: (value) => `Invalid --days value "${value}": expected a positive integer.`,
    byInvalid: (value) => `Invalid --by value "${value}": expected date, agent, model or session.`,
    today: () => "today",
    last7d: () => "last 7 days",
    total: () => "total",
    empty: () => "No usage recorded for this range.",
    noPricing: () => "-",
    colTokens: () => "TOKENS",
    colRequests: () => "REQUESTS",
    colCost: () => "COST",
    colGroup: (dimension) => dimension.toUpperCase(),
  },
};

/** The Chinese half of this contribution's messages. */
export const costZh: CostText = {
  cost: {
    desc: "查看 Token 用量与成本（缺省打印汇总卡片；--by 打印分组表格）",
    days: "最近 n 天（自动换算为 --from/--to）",
    from: "起始日期（yyyy-mm-dd）；须与 --to 成对",
    to: "结束日期（yyyy-mm-dd）；须与 --from 成对",
    by: "分组维度：date、agent、model 或 session",
    rangeIncomplete: () => "--from 与 --to 必须成对给出。",
    daysInvalid: (value) => `--days 值「${value}」无效：应为正整数。`,
    byInvalid: (value) => `--by 值「${value}」无效：应为 date、agent、model 或 session。`,
    today: () => "今日",
    last7d: () => "近 7 天",
    total: () => "累计",
    empty: () => "该范围内没有用量记录。",
    noPricing: () => "-",
    colTokens: () => "TOKEN",
    colRequests: () => "请求数",
    colCost: () => "成本",
    colGroup: (dimension) => dimension.toUpperCase(),
  },
};

import { approximateTokens, toolDefinitionsToSchemas } from "../../packages/core/dist/index.js";

export function schemaTokens(tools) {
  return approximateTokens(JSON.stringify(toolDefinitionsToSchemas(tools)));
}

export function syntheticTools(count) {
  return Array.from({ length: count }, (_, index) => ({
    name: `mcp__service_${Math.floor(index / 10)}__operation_${index}`,
    description:
      `Perform operation ${index} on a remote service resource with filtering, pagination, ` +
      "and audit metadata.",
    parameters: {
      type: "object",
      properties: {
        resource_id: {
          type: "string",
          description: "Stable identifier of the target resource.",
        },
        query: {
          type: "string",
          description: "Optional search expression used to filter results.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 100,
          description: "Maximum number of records.",
        },
        cursor: {
          type: "string",
          description: "Pagination cursor returned by the previous request.",
        },
        include_archived: {
          type: "boolean",
          description: "Whether archived records should be included.",
        },
      },
      required: ["resource_id"],
      additionalProperties: false,
    },
  }));
}

export const curatedTools = [
  ["github", "create_issue", "Create a repository issue or bug report.", ["repository", "title"]],
  ["github", "search_issues", "Search repository issues and pull requests.", ["query"]],
  ["calendar", "create_event", "Schedule a calendar event with attendees.", ["start", "end"]],
  ["calendar", "free_busy", "Find free time slots and attendee availability.", ["date"]],
  ["slack", "post_message", "Send a message to a Slack channel.", ["channel", "text"]],
  ["slack", "search_messages", "Search historical Slack messages.", ["query"]],
  ["drive", "upload_file", "Upload a document to cloud Drive storage.", ["path"]],
  ["drive", "search_files", "Search files and folders in cloud Drive storage.", ["query"]],
  ["postgres", "query_database", "Run a read-only SQL query against a database.", ["sql"]],
  ["postgres", "describe_table", "Inspect a database table, columns, and types.", ["table"]],
  ["jira", "transition_issue", "Change the workflow status of a Jira ticket.", ["issue", "status"]],
  ["jira", "add_comment", "Add a comment to a Jira ticket.", ["issue", "comment"]],
].map(([server, name, description, fields]) => ({
  name: `mcp__${server}__${name}`,
  description,
  parameters: {
    type: "object",
    properties: Object.fromEntries(fields.map((field) => [field, { type: "string" }])),
    required: fields,
    additionalProperties: false,
  },
}));

export const retrievalCases = [
  ["open a new bug in a github repository", "mcp__github__create_issue"],
  ["find unresolved github pull requests", "mcp__github__search_issues"],
  ["schedule a calendar meeting with attendees", "mcp__calendar__create_event"],
  ["find a free calendar time slot", "mcp__calendar__free_busy"],
  ["send a slack channel message", "mcp__slack__post_message"],
  ["search old slack messages", "mcp__slack__search_messages"],
  ["upload a document to drive", "mcp__drive__upload_file"],
  ["search cloud drive files", "mcp__drive__search_files"],
  ["run a read-only postgres sql query", "mcp__postgres__query_database"],
  ["inspect postgres table columns", "mcp__postgres__describe_table"],
  ["transition a jira ticket status", "mcp__jira__transition_issue"],
  ["comment on a jira ticket", "mcp__jira__add_comment"],
  ["在 GitHub 仓库中创建 issue", "mcp__github__create_issue"],
  ["给 Slack 频道发送 message", "mcp__slack__post_message"],
  ["查询 Postgres table 结构", "mcp__postgres__describe_table"],
  ["查询Postgres表table结构", "mcp__postgres__describe_table"],
];

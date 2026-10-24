/**
 * The display-name length ceiling, shared by the create dialogs (the Project's 显示名 and the
 * Agent's 名称): the server enforces the same 100 on both create routes (http/routes/projects.ts
 * and http/routes/agents.ts read the name with `maxLen: 100`), and the Project settings rename
 * caps its input at the same number. The dialogs measure the trimmed value — that is what they
 * send — and state the rule under the name field the moment the value outruns it, the way the id
 * field beside it teaches its own rule, so the limit is met before anything is sent and the
 * person is told the ceiling rather than having the input silently eat what was typed (a
 * truncated name is also the source the id generation reads, and must not be mangled unseen).
 */
export const NAME_MAX_LENGTH = 100;

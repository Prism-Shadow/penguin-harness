/**
 * The CLI host's face for command code: what a command's code may use from the host without
 * importing the server package or the CLI package. The server package's own commands reach
 * these through its `cli` subpath, which re-exports them; a shipped plugin's CLI module (its
 * `./cli` export, booted by the CLI) imports them from here, since both the server and the CLI
 * depend on the plugin and an import back would close a cycle.
 *
 * - `client`: `ServerClient` and `ApiError` — authenticated JSON requests and SSE to the server.
 * - `connection`: `resolveConnection` — which server a command talks to, and auto-start.
 * - `console-input`: `terminalInput` — the input an interactive read takes.
 * - `cut-text`, `table`: `cutText`, `renderTable`, `displayWidth` — text laid out for a terminal.
 * - `messages`: the host message groups the code above words its errors with, and
 *   `CliHostMessages`, the part of the host's bundle a command module may count on.
 * - `server-lock`, `stored-sign-in`: the readers of the two files on a data root the
 *   connection and the client consult; the server package writes them.
 */
export * from "./client.js";
export * from "./connection.js";
export * from "./console-input.js";
export * from "./cut-text.js";
export type * from "./messages.js";
export * from "./server-lock.js";
export * from "./stored-sign-in.js";
export * from "./table.js";

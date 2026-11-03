/**
 * The terminal group's server half: the terminal module, its HTTP routes, the
 * WebSocket attach point and the remote relay, exported for the server's
 * composition root and the protected hmr layer's shims.
 */
export {
  EXITED_SESSION_GRACE_MS,
  MAX_TERMINALS_PER_USER,
  TerminalManager,
  TerminalModule,
  Terminals,
} from "./terminal/manager.js";
export type {
  CreateTerminalRequest,
  Terminal,
} from "./terminal/manager.js";
export { terminalRoutes, resolveKeys } from "./terminal/routes.js";
export { bindTerminalStream } from "./terminal/stream.js";
export { attachTerminalWebSocket } from "./terminal/ws.js";
export type { TerminalWebSocketDeps } from "./terminal/ws.js";
export type { TerminalSession } from "./terminal/session.js";
export {
  identityFrom,
  readSessionCookie,
} from "./terminal/identity.js";
export type {
  AuthenticatesSessions,
  IdentifiedUser,
  Identity,
} from "./terminal/identity.js";
export {
  isRemoteTerminalRef,
  parseRemoteTerminalRef,
  relayTerminalStream,
  TerminalRelay,
} from "./terminal-relay.js";
export type {
  RelayDeps,
  RemoteTerminalRef,
  RemoteTerminals,
} from "./terminal-relay.js";

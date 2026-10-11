/**
 * The terminal module's public entry: everything outside this directory reaches the terminal
 * through here (test/module-boundaries.test.ts fails on an import that goes around it). The
 * one other file an outsider may name is ./strings.ts, and only the app dictionaries do — they
 * mount it while this entry is still evaluating, so routing them through here would be a cycle.
 *
 * Three hosts mount the terminal: the /terminal route (TerminalPage), the app shell
 * (TerminalDockRuntime keeps shells alive across dock tabs) and the dock (the list store, the
 * view pool and the chrome below).
 */
export { TerminalPage } from "./terminal-page";
export {
  TerminalDockRuntime,
  subscribeTerminalCloseRequests,
  subscribeTerminalViewStates,
  terminalViewContainer,
  terminalViewState,
} from "./terminal-view-pool";
export {
  displayTitle,
  killTerminal,
  liveTerminals,
  noteTerminalCreated,
  refreshTerminals,
  subscribeTerminals,
  terminalApiSupported,
} from "./terminal-list";
export {
  HttpStatusError,
  TerminalView,
  fetchJson,
  probeJson,
  type TerminalInfo,
  type TerminalStatus,
} from "./terminal-view";
export { useTerminalChrome } from "./terminal-appearance";

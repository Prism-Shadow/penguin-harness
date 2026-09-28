/**
 * The built-in agents mechanism: agents Penguin downloads, runs and updates itself (Models →
 * Built-in), declared apart from the service that implements it.
 */
import { Interface } from "@prismshadow/penguin-core/kernel";
import type { BuiltinAgentInfo } from "../api/types.js";

export abstract class BuiltinAgents extends Interface<{
  list(): BuiltinAgentInfo[];
  /**
   * Store the token (when given) and start downloading the pinned runtime; answers at once
   * with the downloading state. A first setup needs a token. A second call while one is
   * downloading joins it; with the pinned version already installed it only stores the token.
   * Not named `setup`: that is the kernel's lifecycle hook.
   */
  startSetup(id: "copilot", token?: string): BuiltinAgentInfo;
  /** Stop a download in progress; a cancelled download is not reported as a failure. */
  cancel(id: "copilot"): void;
  replaceToken(id: "copilot", token: string): BuiltinAgentInfo;
  /**
   * Delete the runtime, the token and the agent definition. Past sessions stay readable.
   * Refused while a live session runs the agent: its program is in use.
   */
  remove(id: "copilot"): Promise<void>;
}>() {}

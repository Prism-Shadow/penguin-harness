/**
 * The Agent API's place in the platform tree: one group holding the per-Agent settings and
 * keys (AgentApiRepo, exported as the AgentApi mechanism for the Agent list, the management
 * routes and the deletion cascades).
 */
import { Module } from "@prismshadow/penguin-core/kernel";
import { AgentApiRepo } from "../db/repos/agent-api.js";
import { AgentApi } from "../mechanisms/agent-api.js";

/** The Agent API: per-Agent settings and keys in web.db. */
@Module({
  children: [AgentApiRepo],
  exports: [AgentApi],
})
export class AgentApiModule {}

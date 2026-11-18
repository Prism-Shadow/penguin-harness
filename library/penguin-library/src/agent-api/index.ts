/**
 * The agent-api domain as a library package: the AgentApi mechanism (the storage
 * contract the agent_api repo implements), its settings/update vocabulary and the
 * ModelRefDto pair. One package, no server dependencies - the repo takes the Db
 * capability from @prismshadow/penguin-library/db and the approval vocabulary from
 * @prismshadow/penguin-library/session.
 *
 * Subpaths:
 * - `.` - the contract plus its vocabulary.
 * - `./agent-api` - the contract module on its own.
 * - `./agent-api-repo` - the storing component.
 */
export { AgentApi } from "./agent-api.js";
export type {
  AgentApiSettings,
  AgentApiUpdateRequest,
  AgentApiRow,
  AgentApiKeyRow,
} from "./agent-api.js";
export type { AgentApiKeyInfo, ModelRefDto } from "./agent-api.js";
export { AgentApiRepo } from "./agent-api-repo.js";
export { DEFAULT_API_CONCURRENT_RUNS } from "./agent-api.js";

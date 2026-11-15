/**
 * The projects domain as a library package: the Projects, Members, AgentIndex,
 * ModelPromotions and ModelProviderAuthTokens mechanisms with their DTOs and model
 * plumbing vocabulary, and the five repos that store them. One package, no server
 * dependencies - the repos take the Db capability from @prismshadow/penguin-library-db,
 * and the identity vocabulary from @prismshadow/penguin-library-identity.
 *
 * Subpaths:
 * - `.` - the five mechanism contracts and the DTOs they name.
 * - `./projects` - the contracts module on its own.
 * - `./repos` (and per-file) - the storing components.
 */
export * from "./projects.js";

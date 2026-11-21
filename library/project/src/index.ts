/**
 * The projects domain as a library package: the Projects, Members, AgentIndex, Access,
 * ProjectLifecycle, ProjectConfigStore and ProjectEvents mechanisms with their DTOs, and
 * the repos that store the tables. One package, no server dependencies - the repos take
 * the Db capability from @prismshadow/penguin-library-db, the identity vocabulary from
 * @prismshadow/penguin-library-auth, and the model plumbing vocabulary from
 * @prismshadow/penguin-library-model.
 *
 * Subpaths:
 * - `.` - the mechanism contracts and the DTOs they name.
 * - `./project` - the contracts module on its own.
 * - `./repos` (and per-file) - the storing components.
 */
export * from "./project.js";

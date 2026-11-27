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
 * - `./ports` - the ports the Project service takes: paths, preinstall plugins, app seeds.
 * - `./access` - the Access mechanism component.
 * - `./events` - the ProjectEvents component, publishing over a ProjectChannels port.
 * - `./project-service` - the Project service, the ProjectRuns vocabulary and the benchmark seeds.
 * - `./model-requests` - the project model request vocabulary and its component.
 * - `./project-config-service` - the ProjectConfigStore component (read, write, test, TOML seed).
 * - `./project-config-migrations` / `./project-config-seed` - config migrations and seeding.
 * - `./connect-default-offer`, `./protocol-detect`, `./vision-detect` - the connect/protocol/vision helpers.
 */
export * from "./project.js";
export type { ProjectSummary } from "@prismshadow/penguin-library-session";

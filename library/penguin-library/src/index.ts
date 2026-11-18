/**
 * The penguin domain libraries as one package: the storage and service contracts of every
 * server domain, with the repos that implement them, under one npm name. Each domain keeps
 * its own subpath (`./session`, `./session/repos/sessions`, …) and its own barrel; the root
 * re-exports every domain barrel, so a bare `@prismshadow/penguin-library` import reaches
 * all of the vocabulary. One package, no server dependencies — the repos take the `Db`
 * capability from the `./db` subpath of this same package.
 *
 * Domains: agent-api, auth, db, machine, messaging, model, observability, organization,
 * project, session, setting, trace, workbench.
 */
export * from "./agent-api/index.js";
export * from "./auth/index.js";
export * from "./db/index.js";
export * from "./machine/index.js";
export * from "./messaging/index.js";
export * from "./model/index.js";
export * from "./observability/index.js";
export * from "./organization/index.js";
export * from "./project/index.js";
export * from "./session/index.js";
export * from "./setting/index.js";
export * from "./trace/index.js";
export * from "./workbench/index.js";

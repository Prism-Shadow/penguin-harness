/**
 * The workbenches group's server half: the workbench store, compiler,
 * service and routes, exported for the server's composition root.
 */
export { WorkbenchService, WorkbenchNotFound } from "./workbenches/service.js";
export * from "./workbenches/service.js";
export { workbenchRoutes, WorkbenchRoutes } from "./workbenches/routes.js";
export type { WorkbenchRouteDeps } from "./workbenches/routes.js";
export * from "./workbenches/store.js";

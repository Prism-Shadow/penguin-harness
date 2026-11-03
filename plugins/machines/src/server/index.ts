/**
 * The machines group's server half: the machine supervisor and its transport
 * layer, the machine status probe and the routes, exported for the server's
 * composition root.
 */
export { MachinesService, MachinesModule, machinesServerProxyRoutes } from "./service.js";
export type { MachinesEffects } from "./service.js";
export { machinesRoutes } from "./machines.js";
export type { MachinesRouteDeps } from "./machines.js";
export { readMachineStatus } from "./machine-status.js";
export type { MachineStatus } from "./machine-status.js";
export * from "./layout.js";

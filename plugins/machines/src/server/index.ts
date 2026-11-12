/**
 * The machines group's server half: the machine supervisor and its transport
 * layer, the machine status probe and the routes, exported for the server's
 * composition root.
 */
export { MachinesService, MachinesModule, machinesServerProxyRoutes } from "./service.js";
export type { MachinesEffects } from "./service.js";
export { machinesRoutes } from "./machines.js";
export type { MachineApi } from "./machine-api.js";
export type { MachinesRouteDeps } from "./machines.js";
export { readMachineStatus } from "./machine-status.js";
export type { Machines } from "./service.js";
export { carriedStore } from "./install-server.js";
export type { MachineStatus } from "./machine-status.js";
export {
  MACHINE_SESSION_IFACE,
  SESSION_GROUP,
  SESSION_SHAPE_ID,
} from "./transport/index.js";
export type { HeldSession } from "./transport/index.js";
export * from "./layout.js";

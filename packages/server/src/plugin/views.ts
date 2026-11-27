/**
 * Read views a server module may require of the host (PRFC-0036), each the few members a plugin
 * reads and nothing it could write with. The host provides none of them as such: a node that has
 * the members satisfies the view — the kernel matches a requirement by structure — so a plugin
 * may as well declare the same view in its own package and require that.
 *
 *   ProjectModels    the Project's model table: its models, keys masked, and its default model
 *                    (ProjectConfigStore has it)
 *   ProjectMachines  the machines a Project uses, with a client to each one's API while it is
 *                    connected (the machines service has it); a route reads it for an
 *                    administrator only, as the machine proxy does
 *   MachineDial      a dial to a connected machine's server by its own id — through the connection
 *                    this server holds, its port there, a session there as its cookie — for a
 *                    module that keeps a socket of its own to it (the browser relay); the machines
 *                    service has it, and it acts as an administrator there, as the proxy does
 *
 * `Access` (who may see or own a Project) is the host's own interface, and `AgentSkills` (the
 * Skills installed on an Agent, services/agent-skills.ts) a host node of its own, exported beside these.
 */
import { Interface } from "@prismshadow/penguin-core/kernel";
import type { ModelsResponse } from "@prismshadow/penguin-library-model";
import type { MachineApi } from "../machines/machine-api.js";
import type { ProxyTarget } from "../machines/proxy.js";

@Interface()
export abstract class ProjectModels {
  /** The Project's models (keys masked, never their plaintext) and its default model. */
  abstract getModels(projectId: string): Promise<ModelsResponse>;
}

@Interface()
export abstract class ProjectMachines {
  /**
   * The machines the Project uses that this server knows by id, each with its alias and a client
   * to its own API while it is connected (null otherwise).
   */
  abstract projectApis(
    projectId: string,
  ): Promise<Array<{ machineId: string; alias: string; api: MachineApi | null }>>;
}

@Interface()
export abstract class MachineDial {
  /** A dial to the machine's server through the connection held to it; null when it is not connected. */
  abstract proxyTarget(machineId: string): Promise<ProxyTarget | null>;
}

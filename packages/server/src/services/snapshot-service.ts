/**
 * The snapshot service moved to the agent domain library package
 * (@prismshadow/penguin-library-agent/snapshot-service, services+http+cli restack S9d) — it
 * speaks library vocabulary and structural ports. This file keeps the assembly: the Provider
 * binds the service's paths/log/clock ports to the server's capabilities, and re-exports the
 * moved shapes for the server's own import paths.
 */
import { Module, Provide, Use } from "@prismshadow/penguin-core/kernel";
import type { Clock, Log, Paths } from "../hmr/capabilities.js";
import { Snapshots } from "@prismshadow/penguin-library-agent/contract";
import { SnapshotService } from "@prismshadow/penguin-library-agent/snapshot-service";

export { SnapshotService } from "@prismshadow/penguin-library-agent/snapshot-service";
export type { AgentPackage } from "@prismshadow/penguin-library-agent/contract";

/** The snapshot assembly: binds the service's ports (the kernel does not inject @Use on a hand-built instance). */
@Module()
export class SnapshotServiceProvider {
  @Use() private readonly paths!: Paths;
  @Use() private readonly log!: Log;
  @Use() private readonly clock!: Clock;
  @Provide() snapshots!: Snapshots;
  @Provide() service!: SnapshotService;

  setup() {
    // The service's ports are decorator-injected fields; the server binds them by hand here.
    this.service = Object.assign(new SnapshotService(), {
      paths: this.paths,
      log: this.log,
      clock: this.clock,
    });
    this.snapshots = this.service;
  }
}

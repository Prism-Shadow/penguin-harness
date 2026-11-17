/** Telemetry authoring example: real service boundaries, with a caller-supplied sample sink. */
import {
  decorate,
  interfaceRef,
  Module,
  pipe,
  provides,
  wrapMethods,
} from "@prismshadow/penguin-core/kernel";
import type { ModulePass } from "@prismshadow/penguin-core/kernel";
import type { Plugin } from "@prismshadow/penguin-core/plugin";
import type {
  Sessions,
  SessionLoaders,
  SessionServiceIface,
} from "../../runtime/session-manager.js";
import type { TraceIndex, Traces } from "../../mechanisms/traces.js";

export interface TelemetrySample {
  probe: string;
  status: "ok" | "error";
  durationMs: number;
}

export function telemetryPass(record: (sample: TelemetrySample) => void): ModulePass {
  const span =
    (probe: string) =>
    <Args extends unknown[], Result>(next: (...args: Args) => Promise<Result>) =>
    async (...args: Args): Promise<Result> => {
      const started = performance.now();
      let status: TelemetrySample["status"] = "error";
      try {
        const result = await next(...args);
        status = "ok";
        return result;
      } finally {
        // A sample sink is an observer; failure must not change the application's result.
        try {
          record({ probe, status, durationMs: performance.now() - started });
        } catch {
          /* Observer failure. */
        }
      }
    };
  return {
    id: "telemetry",
    source: "compile/demo/telemetry.ts",
    rewrite: pipe(
      decorate(provides(interfaceRef<Sessions>("@prismshadow/penguin-server#Sessions")), (api) =>
        wrapMethods(api, {
          startTask: span("task.accept"),
        }),
      ),
      decorate(
        provides(
          interfaceRef<SessionServiceIface>("@prismshadow/penguin-server#SessionServiceIface"),
        ),
        (api) =>
          wrapMethods(api, {
            listSessions: span("sessions.list"),
          }),
      ),
      decorate(provides(interfaceRef<Traces>("@prismshadow/penguin-server#Traces")), (api) =>
        wrapMethods(api, {
          readMessagesPage: span("session.messages"),
        }),
      ),
      decorate(
        provides(interfaceRef<TraceIndex>("@prismshadow/penguin-server#TraceIndex")),
        (api) =>
          wrapMethods(api, {
            reconcileAgent: span("trace.reconcile"),
          }),
      ),
      decorate(
        provides(interfaceRef<SessionLoaders>("@prismshadow/penguin-server#SessionLoaders")),
        (api) =>
          wrapMethods(api, {
            create:
              (next) =>
              (...args) =>
                wrapMethods(next(...args), {
                  load: span("session.load"),
                }),
          }),
      ),
    ),
  };
}

@Module({ contributes: { "CompileModule.passes": [{ id: "telemetry" }] } })
export class TelemetryDemo {}

/** The same export shape an installed plugin uses; nothing registers a global hook. */
export function telemetryPlugin(record: (sample: TelemetrySample) => void): Plugin {
  return { modules: [TelemetryDemo], passes: { telemetry: () => telemetryPass(record) } };
}

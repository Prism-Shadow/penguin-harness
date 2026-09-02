/**
 * The user input an App Center action sends to an app's owning Session: an `[app_center]`
 * origin block (built by core's marker module, whose parser the web uses to fold it into a
 * one-line banner) followed by plain instructions the model can act on. The instructions spell
 * out the registered commands and URL when there are any, and fall back to "the process you
 * started" otherwise — the Session that built the app knows how it runs.
 */
import { buildAppCenterMessage } from "@prismshadow/penguin-core/markers";
import type { AppCenterAction } from "@prismshadow/penguin-core/markers";
import type { AppDefinition } from "./app-registry.js";

export type AppActionFields = Pick<
  AppDefinition,
  "id" | "name" | "url" | "startCommand" | "stopCommand"
>;

function stopStep(def: AppActionFields): string {
  return def.stopCommand !== undefined
    ? `Stop the running process: run \`${def.stopCommand}\` (or stop the background process you started for it).`
    : "Stop the process you started for this app (it has no registered stop command).";
}

function startStep(def: AppActionFields): string {
  return def.startCommand !== undefined
    ? `Start it again in the background: run \`${def.startCommand}\` with exec_command and run_in_background.`
    : "Start it again in the background, the same way you started it before.";
}

export function composeAppActionMessage(def: AppActionFields, action: AppCenterAction): string {
  const lead = `The user asked the App Center to ${action} the app "${def.name}" (id: ${def.id}), which is registered from this conversation.`;
  const steps: string[] = [];
  if (action === "restart") {
    steps.push(stopStep(def), startStep(def));
    steps.push(
      def.url !== undefined
        ? `Wait until ${def.url} responds, then confirm to the user that the app is running and reachable at ${def.url}.`
        : "Verify that it is running, then confirm to the user.",
    );
    steps.push("If a step fails, report what went wrong instead of retrying indefinitely.");
  } else {
    steps.push(stopStep(def));
    steps.push(
      def.url !== undefined
        ? `Verify that ${def.url} no longer responds, then confirm to the user that the app is stopped.`
        : "Confirm to the user that the app is stopped.",
    );
    steps.push("Do not start it again unless the user asks.");
  }
  const body = [lead, ...steps.map((s, i) => `${i + 1}. ${s}`)].join("\n");
  return buildAppCenterMessage({ appId: def.id, appName: def.name, action }, body);
}

/**
 * The Plugins group's module requests page (admin only): the requests to run a library plugin's
 * server module on the server on screen, and the decisions on them (plugin-module-requests.tsx).
 * Each server keeps its own requests, so while the Project holds a connection to another machine
 * a picker at the top switches between this server and those machines, as on the other pages of
 * the group. The page holds no draft, so switching asks nothing.
 *
 * The rail shows how many requests wait on this server (`useModuleRequestsWaiting`), read from the
 * same ledger the list and the Plugins page's notice read, so the three agree.
 */
import { useState } from "react";
import { SettingsSection } from "@prismshadow/penguin-ui";
import { usePluginModuleRequests } from "@prismshadow/penguin-web/internal";
import { useSessionsIfAny } from "@prismshadow/penguin-web/internal";
import { PluginModuleRequests } from "./plugin-module-requests";
import { ConfigMachinePicker } from "./plugins-section";

const NO_MACHINES: readonly string[] = [];
const NO_LABELS: ReadonlyMap<string, string> = new Map();

/** How many requests wait on this server for an administrator's decision; 0 for anyone else. */
export function useModuleRequestsWaiting(isAdmin: boolean): number {
  return usePluginModuleRequests(null, isAdmin).value?.pending ?? 0;
}

export function ModuleRequestsPage() {
  // The Project's connected machines; none outside the app's providers (a test, the gallery).
  const sessions = useSessionsIfAny();
  const machineIds = sessions?.machineIds ?? NO_MACHINES;
  const labels = sessions?.machineLabels ?? NO_LABELS;
  const nameOf = (id: string) => labels.get(id) ?? id;
  /** The server whose requests the page shows: null for this one. */
  const [machine, setMachine] = useState<string | null>(null);
  return (
    <SettingsSection>
      <div className="space-y-6">
        {machineIds.length > 0 && (
          <ConfigMachinePicker
            machine={machine}
            machineIds={machineIds}
            nameOf={nameOf}
            disabled={false}
            onPick={setMachine}
          />
        )}
        <PluginModuleRequests
          key={machine ?? ""}
          machine={machine}
          {...(machine !== null ? { machineName: nameOf(machine) } : {})}
        />
      </div>
    </SettingsSection>
  );
}

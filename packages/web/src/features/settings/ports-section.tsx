/**
 * Ports (admin only, server-global): per machine, whether `out` forwards may go there when
 * the machine's sshd would bind them on every interface — or when where it binds them cannot
 * be read. An `out` forward asks for the machine's loopback; a sshd with `GatewayPorts yes`
 * widens that to every interface and says so only in a debug message, so the server probes
 * each machine once and carries `out` forwards on its own only where the answer is
 * "loopback". Everything else waits for the consent switched on here. Each row shows the last
 * verdict in words, offers a fresh probe, and the switch writes at once.
 */
import { useEffect, useState } from "react";
import type { MachineExposureInfo } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { Button } from "../../components/ui/button";
import { Skeleton } from "../../components/ui/skeleton";
import { Switch } from "../../components/ui/switch";
import { toastError } from "../../components/ui/toast";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import { PrefRow } from "./setting-row";
import { SectionShell } from "./section-shell";

/** The verdict in words, in the tone of what it means for the network behind the machine. */
function verdict(machine: MachineExposureInfo): { text: string; className: string } {
  const exposure = machine.exposure;
  if (exposure === null) return { text: S.settings.exposureNotProbed, className: toneInk.muted };
  switch (exposure.mode) {
    case "loopback":
      return { text: S.settings.exposureLoopback, className: toneInk.success };
    case "exposes":
      return { text: S.settings.exposureExposes, className: toneInk.danger };
    case "unknown":
      return { text: S.settings.exposureUnknown(exposure.detail), className: toneInk.attention };
  }
}

export function PortsSection() {
  const [machines, setMachines] = useState<MachineExposureInfo[] | null>(null);
  /** The machine a write or a probe is in flight for; its row's controls wait. */
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api
      .listForwardExposure()
      .then((res) => {
        if (!cancelled) setMachines(res.machines);
      })
      .catch((e: unknown) => {
        if (!cancelled) toastError(apiErrorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const replace = (machine: MachineExposureInfo) =>
    setMachines((current) =>
      current === null
        ? current
        : current.map((m) => (m.machineId === machine.machineId ? machine : m)),
    );

  const act = async (machineId: string, call: () => Promise<{ machine: MachineExposureInfo }>) => {
    if (busy !== null) return;
    setBusy(machineId);
    try {
      replace((await call()).machine);
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <SectionShell>
      <p className="text-sm text-gray-600 dark:text-gray-300">{S.settings.portsDesc}</p>
      {machines === null ? (
        <div className="space-y-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-2/3" />
        </div>
      ) : machines.length === 0 ? (
        <p className="text-sm text-gray-500">{S.settings.exposureEmpty}</p>
      ) : (
        <div className="divide-y divide-gray-100 dark:divide-gray-800/60">
          {machines.map((machine) => {
            const { text, className } = verdict(machine);
            return (
              <PrefRow key={machine.machineId} label={machine.alias} hint={text}>
                <div className="flex items-center gap-3">
                  <span className={`sr-only ${className}`}>{text}</span>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy !== null}
                    onClick={() =>
                      void act(machine.machineId, () => api.probeForwardExposure(machine.machineId))
                    }
                  >
                    {S.settings.exposureProbe}
                  </Button>
                  <Switch
                    checked={machine.allowed}
                    disabled={busy !== null}
                    aria-label={`${S.settings.exposureAllow}: ${machine.alias}`}
                    onChange={(next) =>
                      void act(machine.machineId, () =>
                        api.setForwardExposure(machine.machineId, next),
                      )
                    }
                  />
                </div>
              </PrefRow>
            );
          })}
        </div>
      )}
    </SectionShell>
  );
}

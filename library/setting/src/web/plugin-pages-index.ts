/**
 * What the Settings dialog reads, once per opening, to know its plugin pages: this server's plugin
 * library (any signed-in viewer: the pages' names and icons) and, for an admin, this server's
 * plugin settings (which plugin declares which group). Both are this server's own answers, read
 * side by side; a read that fails counts as empty, so a page still opens from what did answer.
 * Null until both have answered — the rail draws its plugin group only then, so a page's name
 * never changes under the reader.
 *
 * For an admin, each connected machine's plugin settings are read after that, one request per
 * machine, and join as each answers (`machines`, in the Project's order): a plugin only a machine
 * has gets its page then. A machine never holds back this server's pages; one that fails or does
 * not answer adds nothing, and one that leaves the Project takes its pages with it.
 */
import { useEffect, useState } from "react";
import type { PluginConfigEntry, PluginItem } from "@prismshadow/penguin-server/api";
import * as api from "@prismshadow/penguin-web/internal";

export interface PluginPagesIndex {
  library: PluginItem[];
  entries: PluginConfigEntry[];
  /** The machines that have answered, in the Project's order, each with its settings groups. */
  machines: Array<{ machine: string; entries: PluginConfigEntry[] }>;
}

const NO_MACHINES: readonly string[] = [];

export function usePluginPagesIndex(
  open: boolean,
  isAdmin: boolean,
  machineIds: readonly string[] = NO_MACHINES,
): PluginPagesIndex | null {
  const [local, setLocal] = useState<Omit<PluginPagesIndex, "machines"> | null>(null);
  const [answers, setAnswers] = useState<ReadonlyMap<string, PluginConfigEntry[]>>(new Map());
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLocal(null);
    setAnswers(new Map());
    const library = api.getPluginLibrary(null).then(
      (r) => r.groups.flatMap((g) => g.plugins),
      () => [],
    );
    const entries = isAdmin
      ? api.adminGetPluginConfig(null).then(
          (r) => r.plugins,
          () => [],
        )
      : Promise.resolve([]);
    void Promise.all([library, entries]).then(([lib, ents]) => {
      if (!cancelled) setLocal({ library: lib, entries: ents });
    });
    return () => {
      cancelled = true;
    };
  }, [open, isAdmin]);

  // A new array with the same machines is the same question.
  const machinesKey = machineIds.join("\0");
  const localKnown = local !== null;
  useEffect(() => {
    if (!open || !isAdmin || !localKnown || machinesKey === "") return;
    let cancelled = false;
    for (const machine of machinesKey.split("\0")) {
      void api.adminGetPluginConfig(machine).then(
        (r) => {
          if (!cancelled) setAnswers((prev) => new Map(prev).set(machine, r.plugins));
        },
        () => {
          // A machine that cannot answer adds no page; its groups stay out of reach until the
          // dialog opens again.
        },
      );
    }
    return () => {
      cancelled = true;
    };
  }, [open, isAdmin, localKnown, machinesKey]);

  if (local === null) return null;
  const machines = machineIds.flatMap((machine) => {
    const entries = answers.get(machine);
    return entries === undefined ? [] : [{ machine, entries }];
  });
  return { ...local, machines };
}

/**
 * activity id -> the name its card shows and its product code, for the sidebar's "Activity runs" folder. Read
 * from the project's activity list (the quick switcher's source) once per project, and
 * again when a run turns up for an activity the list has not named — one created after the
 * list was read. A project without activities access, or a failed read, names nothing: the
 * folder then falls back to a generic heading rather than hiding the runs.
 */
import { useEffect, useRef, useState } from "react";
import type { ActivityRecord } from "@prismshadow/penguin-server/api";
import { apiFetch } from "../api/client";
import type { ActivityLabel } from "../lib/activity-sessions";

const NO_LABELS: ReadonlyMap<string, ActivityLabel> = new Map();

export function useActivityLabels(
  projectId: string | null,
  activityIds: readonly string[],
): ReadonlyMap<string, ActivityLabel> {
  const [names, setNames] = useState<{ projectId: string | null; map: ReadonlyMap<string, ActivityLabel> }>(
    { projectId: null, map: NO_LABELS },
  );
  /** The unnamed ids a read was already spent on, so an id the list never names asks once. */
  const asked = useRef<{ projectId: string | null; ids: Set<string> }>({ projectId: null, ids: new Set() });
  const current = names.projectId === projectId ? names.map : NO_LABELS;
  if (asked.current.projectId !== projectId) asked.current = { projectId, ids: new Set() };
  const unnamed = activityIds.filter((id) => !current.has(id) && !asked.current.ids.has(id));
  const wanted = unnamed.length > 0 ? [...new Set(unnamed)].sort().join(",") : "";

  useEffect(() => {
    if (!projectId || wanted === "") return;
    for (const id of wanted.split(",")) asked.current.ids.add(id);
    // Not cancelled when `wanted` empties on the next render (the ids just went into
    // `asked`). A late answer for a project left behind is dropped instead: stored, it
    // would replace the current project's labels, whose ids are already marked asked.
    apiFetch<{ activities: ActivityRecord[] }>(
      `/api/projects/${encodeURIComponent(projectId)}/activities`,
    )
      .then((res) => {
        if (asked.current.projectId !== projectId) return;
        setNames({
          projectId,
          map: new Map(
            res.activities.map((a) => [
              a.id,
              { name: a.displayName ?? a.title, productCode: a.productCode },
            ]),
          ),
        });
      })
      .catch(() => {
        /* No activities access on this project; the headings stay generic. */
      });
  }, [projectId, wanted]);

  return current;
}

/**
 * The scene-videos experiment switch (admin only, server-global), on the general page: one
 * switch that applies the moment it is flipped, a single PUT to /api/admin/settings, like the
 * company-mode switch. It stays disabled until the stored value arrives and while a write is in
 * flight; a write that fails puts it back on the stored value and says why on the row.
 */
import { useEffect, useState } from "react";
import * as api from "../../api/endpoints";
import { Badge } from "../../components/ui/badge";
import { Switch } from "../../components/ui/switch";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";
import { PrefRow } from "./setting-row";

export function VideoExperimentRow() {
  /** The last value the server confirmed; null until the settings load. */
  const [stored, setStored] = useState<boolean | null>(null);
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void api
      .adminGetSettings()
      .then((res) => {
        if (cancelled) return;
        setStored(res.settings.activityVideoExperiment);
        setOn(res.settings.activityVideoExperiment);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(apiErrorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = async (next: boolean) => {
    if (stored === null || busy) return;
    setOn(next);
    setError(undefined);
    setBusy(true);
    try {
      const res = await api.adminPutSettings({ activityVideoExperiment: next });
      setStored(res.settings.activityVideoExperiment);
      setOn(res.settings.activityVideoExperiment);
    } catch (e) {
      setOn(stored);
      setError(apiErrorText(e));
    }
    setBusy(false);
  };

  return (
    // A failed write says why on the row's own line, under the label it went back on.
    <PrefRow label={S.settings.videoExperiment} info={S.settings.videoExperimentInfo} hint={error}>
      <div className="flex items-center gap-2">
        <Badge tone="amber">{S.activities.video.experimental}</Badge>
        <Switch
          checked={on}
          onChange={(next) => void toggle(next)}
          disabled={stored === null || busy}
          aria-label={S.settings.videoExperiment}
        />
      </div>
    </PrefRow>
  );
}

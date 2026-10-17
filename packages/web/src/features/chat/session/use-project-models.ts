/**
 * The Project's model config (context windows, pricing, the default model), refetched when the
 * Project's new-chat defaults change in this tab, and the once-per-lifetime credential guide.
 */
import { useEffect, useState } from "react";
import type { ModelsResponse } from "@prismshadow/penguin-server/api";
import * as api from "../../../api/endpoints";
import { hasConfiguredKey, sameModelRef } from "../../models";
import { CHAT_DEFAULTS_CHANGED_EVENT, chatDefaultsChangedDetail } from "../chat-defaults-event";

export function useProjectModels(projectId: string | null) {
  const [credentialGuide, setCredentialGuide] = useState(false);
  const [models, setModels] = useState<ModelsResponse | null>(null);
  // This server's model config (context window + credential guide): fetched once per Project.
  //
  // The credential guide **only ever nags once per lifetime** (first entry after registration):
  // gated by the server prefs' credentialGuideSeen — previously it checked "default model has no
  // key" and popped up a dialog on every visit to the chat page, which was repeated nagging for
  // users who simply don't intend to configure a key / use environment variables instead.
  // "Has a key" is hasConfiguredKey, the same rule the model library and the model picker use: a
  // model backed by an exported environment variable is configured and must not be nagged.
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setModels(null);
    void (async () => {
      try {
        const res = await api.getModels(projectId);
        if (cancelled) return;
        setModels(res);
        const { prefs } = await api.getPrefs();
        if (cancelled || prefs.credentialGuideSeen) return;
        const def = res.models.find((m) => sameModelRef(m, res.defaultModel));
        const missing = !res.defaultModel || !def || !hasConfiguredKey(def);
        if (missing) setCredentialGuide(true);
        // Mark as "seen" regardless of whether the dialog actually popped up: only ever once.
        void api.putPrefs({ credentialGuideSeen: true }).catch(() => undefined);
      } catch {
        // A failed fetch doesn't affect the rest of the page.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Project new-chat defaults saved in this tab (project-settings dialog) with a CHANGED
  // default model: refetch the model config so the "project default" marker and a later
  // draft mount see the fresh default. models goes null first — DraftView's model
  // fallback holds off while null, so it cannot re-pin the stale default from the old
  // response in the meantime (the mounted draft's own selection comes straight from the
  // event payload, see DraftView.onDefaultsChanged); a failed refetch leaves models null,
  // the same degraded state as a failed mount fetch.
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    const onEvent = (e: Event) => {
      const detail = chatDefaultsChangedDetail(e, projectId);
      if (!detail || detail.defaultModel === undefined) return;
      setModels(null);
      api
        .getModels(projectId)
        .then((res) => {
          if (!cancelled) setModels(res);
        })
        .catch(() => undefined);
    };
    window.addEventListener(CHAT_DEFAULTS_CHANGED_EVENT, onEvent);
    return () => {
      cancelled = true;
      window.removeEventListener(CHAT_DEFAULTS_CHANGED_EVENT, onEvent);
    };
  }, [projectId]);
  return { models, credentialGuide, setCredentialGuide };
}

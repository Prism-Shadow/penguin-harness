/**
 * Admin HTTP-proxy settings dialog (server-global, design § "出网与系统代理"), opened
 * from the sidebar user menu. A LIVE settings surface, not a form: the switch saves
 * immediately on toggle (optimistic, reverted with a toast on failure) and the address
 * commits on Enter/blur — the server validates and normalizes (bare "host:port" comes
 * back as "http://host:port"), the echoed settings replace the draft, and a rejected
 * value reverts it with the error toast. Hence no Save/Cancel footer; closing is the
 * Modal's own affordances (header X, Esc, overlay).
 *
 * Settings hydrate on every open (always fresh, even if another admin changed them
 * meanwhile); both controls are disabled until they arrive, so a click can never write
 * a value the admin was not looking at. The scope/loopback hint that used to live in a
 * row tooltip is visible dialog text here.
 */
import { useEffect, useRef, useState } from "react";
import type { ServerSettings } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { Input } from "../ui/input";
import { Modal } from "../ui/modal";
import { Switch } from "../ui/switch";
import { toastError, toastSuccess } from "../ui/toast";

export function ProxySettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  /** null = not hydrated yet (controls disabled, showing the defaults: on, empty). */
  const [settings, setSettings] = useState<ServerSettings | null>(null);
  /** Proxy-address input draft (committed on Enter/blur; synced from the stored value). */
  const [proxyUrlDraft, setProxyUrlDraft] = useState("");
  /** In-flight proxy-address save — guards the Enter-then-blur double commit. */
  const proxyUrlSaving = useRef(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setSettings(null);
    setProxyUrlDraft("");
    void api
      .adminGetSettings()
      .then((res) => {
        if (cancelled) return;
        setSettings(res.settings);
        setProxyUrlDraft(res.settings.proxyUrl ?? "");
      })
      .catch((e: unknown) => {
        // Controls stay disabled; closing and reopening retries the fetch.
        if (!cancelled) toastError(apiErrorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  /** Saved immediately on toggle: optimistic flip, reverted with a toast on failure. */
  const setUseSystemProxy = (value: boolean) => {
    setSettings((prev) => (prev === null ? prev : { ...prev, useSystemProxy: value }));
    void api
      .adminPutSettings({ useSystemProxy: value })
      .then((res) => setSettings(res.settings))
      .catch((e: unknown) => {
        setSettings((prev) => (prev === null ? prev : { ...prev, useSystemProxy: !value }));
        toastError(apiErrorText(e));
      });
  };

  /**
   * Commits the proxy-address input (Enter/blur): no-ops when unchanged, otherwise lets
   * the server validate and normalize (see the module doc).
   */
  const commitProxyUrl = () => {
    if (settings === null || proxyUrlSaving.current) return;
    const stored = settings.proxyUrl ?? "";
    if (proxyUrlDraft.trim() === stored) {
      setProxyUrlDraft(stored); // canonicalize a whitespace-only edit back to the stored value
      return;
    }
    proxyUrlSaving.current = true;
    void api
      .adminPutSettings({ proxyUrl: proxyUrlDraft })
      .then((res) => {
        setSettings(res.settings);
        setProxyUrlDraft(res.settings.proxyUrl ?? "");
        toastSuccess(S.common.saved);
      })
      .catch((e: unknown) => {
        setProxyUrlDraft(stored);
        toastError(apiErrorText(e));
      })
      .finally(() => {
        proxyUrlSaving.current = false;
      });
  };

  return (
    <Modal open={open} title={S.settings.proxyDialogTitle} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium">{S.settings.useSystemProxy}</span>
          <Switch
            checked={settings?.useSystemProxy ?? true}
            onChange={setUseSystemProxy}
            disabled={settings === null}
          />
        </div>
        {(settings?.useSystemProxy ?? true) && (
          <Input
            label={S.settings.proxyAddress}
            size="sm"
            value={proxyUrlDraft}
            placeholder={S.settings.proxyAddressPlaceholder}
            disabled={settings === null}
            hint={S.settings.proxyAddressHint}
            onChange={(e) => setProxyUrlDraft(e.target.value)}
            onBlur={commitProxyUrl}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitProxyUrl();
            }}
          />
        )}
        <p className="text-xs leading-relaxed text-gray-500 dark:text-gray-400">
          {S.settings.useSystemProxyHint}
        </p>
      </div>
    </Modal>
  );
}

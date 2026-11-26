import { useEffect, useState } from "react";
import { Button, Input } from "@prismshadow/penguin-ui";
import type { BuiltinBrowserTab } from "@prismshadow/penguin-server/api";
import { apiErrorText, type SessionWorkbenchScope } from "@prismshadow/penguin-web-plugin";
import { listManagedPages, openManagedPage, closeManagedPage } from "./api";
import { S } from "./strings";

/**
 * The native guests live in the desktop app this server runs in. A window that cannot host them
 * (a browser tab on the same server) lists and controls the Session's group here.
 */
export function ManagedBrowserPages({
  scope,
  active,
}: {
  scope: SessionWorkbenchScope;
  active: boolean;
}) {
  const { projectId, sessionId, machineId } = scope;
  const [tabs, setTabs] = useState<BuiltinBrowserTab[] | null>(null);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [address, setAddress] = useState("");
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!active) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const result = await listManagedPages({ projectId, sessionId, machineId });
        if (alive) {
          setTabs(result.tabs);
          setError("");
          timer = setTimeout(() => void refresh(), 3000);
        }
      } catch (err) {
        if (alive) setError(apiErrorText(err));
      }
    };
    void refresh();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [sessionId, projectId, machineId, active, revision]);

  const change = async (tab?: BuiltinBrowserTab) => {
    setSaving(true);
    setActionError("");
    try {
      if (tab) await closeManagedPage(scope, tab.id);
      else {
        await openManagedPage(scope, address.trim());
        setAddress("");
      }
    } catch (err) {
      setActionError(apiErrorText(err));
    } finally {
      setSaving(false);
      setRevision((current) => current + 1);
    }
  };
  return (
    <div className="flex h-full min-w-0 flex-col gap-3 overflow-y-auto p-3">
      <p className="text-sm text-fg-muted">{S.builtinBrowser.machinePages}</p>
      <form
        className="flex min-w-0 flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!saving && tabs !== null && !error) void change();
        }}
      >
        <Input
          className="min-w-0 flex-1"
          aria-label={S.builtinBrowser.address}
          value={address}
          onChange={(event) => setAddress(event.target.value)}
        />
        <Button type="submit" disabled={saving || tabs === null || !!error}>
          {S.builtinBrowser.newTab}
        </Button>
      </form>
      {error && (
        <div role="alert">
          {error}{" "}
          <Button size="sm" onClick={() => setRevision((current) => current + 1)}>
            {S.builtinBrowser.reload}
          </Button>
        </div>
      )}
      {actionError && <p role="alert">{actionError}</p>}
      {tabs === null && !error && <p role="status">{S.common.loading}</p>}
      <ul aria-label={S.builtinBrowser.panelTitle} className="flex flex-col gap-1">
        {tabs?.map((tab) => (
          <li key={tab.id} className="flex min-w-0 items-center justify-between gap-2">
            <span className="min-w-0 break-all" title={tab.url}>
              {tab.title || tab.url}
            </span>
            <Button
              size="sm"
              disabled={saving}
              aria-label={`${S.builtinBrowser.closeTab} · ${tab.title || tab.url}`}
              onClick={() => void change(tab)}
            >
              {S.builtinBrowser.closeTab}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

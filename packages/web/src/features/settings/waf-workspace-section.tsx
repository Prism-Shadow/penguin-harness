/**
 * WAF workspace (admin only, server-global): the checkouts activities are authored, played
 * and deployed from — framework, navbar, media and activity data — which Penguin clones and
 * keeps under its data folder, or an existing checkout it only reads. Prepare clones what is
 * missing on the server and takes minutes, so the page asks again every couple of seconds
 * while it runs. Below, the remotes and branches it clones from; nothing is written until Save.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { WafWorkspaceSettings, WafWorkspaceStatus } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { toneInk } from "../../lib/tone";
import { Button } from "../../components/ui/button";
import { FieldError, FieldHint, FieldLabel } from "../../components/ui/field";
import { Input } from "../../components/ui/input";
import { toastError, toastInfo, toastSuccess } from "../../components/ui/toast";
import { useProject } from "../../state/project";
import { WorkspaceSelect } from "../chat/workspace-select";
import { SectionShell } from "./section-shell";
import {
  WAF_REPO_ORDER,
  WAF_WORKSPACE_POLL_MS,
  shouldPollWafWorkspace,
  wafFormFromSettings,
  wafWorkspaceUpdate,
  wafWorkspaceView,
  type WafWorkspaceForm,
} from "./waf-workspace";

export function WafWorkspaceSection() {
  const words = S.settings.wafWorkspace;
  // Browsing the server's folders is authorised through a project; any open one will do.
  const projectId = useProject().currentProject?.projectId ?? null;
  const [status, setStatus] = useState<WafWorkspaceStatus | null>(null);
  const [settings, setSettings] = useState<WafWorkspaceSettings | null>(null);
  const [form, setForm] = useState<WafWorkspaceForm>({});
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Whether this page started or watched a preparation, so its end is announced once. */
  const watching = useRef(false);
  const failures = useRef(0);
  const [retry, setRetry] = useState(0);

  const load = useCallback(async () => {
    try {
      const next = (await api.adminGetWafWorkspace()).status;
      if (watching.current && !next.preparing) {
        watching.current = false;
        if (next.ready && next.lastError === null) toastSuccess(words.prepared);
      }
      failures.current = 0;
      setStatus(next);
    } catch (e) {
      if (failures.current === 0) toastError(apiErrorText(e));
      failures.current += 1;
      setRetry((n) => n + 1);
    }
  }, [words]);

  const adopt = (next: WafWorkspaceSettings) => {
    setSettings(next);
    setForm(wafFormFromSettings(next));
  };

  useEffect(() => {
    void load();
    let cancelled = false;
    void api
      .adminGetWafWorkspaceSettings()
      .then((res) => {
        if (!cancelled) adopt(res.settings);
      })
      .catch((e: unknown) => {
        if (!cancelled) toastError(apiErrorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  useEffect(() => {
    if (!shouldPollWafWorkspace(status)) return;
    watching.current = true;
    const timer = window.setTimeout(() => void load(), WAF_WORKSPACE_POLL_MS);
    return () => window.clearTimeout(timer);
  }, [status, retry, load]);

  const prepare = async () => {
    setBusy(true);
    try {
      setStatus((await api.adminPrepareWafWorkspace()).status);
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (settings === null || busy) return;
    const update = wafWorkspaceUpdate(form, settings);
    if (update === null) {
      toastInfo(S.common.noChangesToSave);
      return;
    }
    setBusy(true);
    setFieldError(null);
    try {
      adopt((await api.adminPutWafWorkspaceSettings(update)).settings);
      toastSuccess(S.common.saved);
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.code === "waf_workspace_invalid" && e.detail?.field)
        setFieldError(e.detail.field);
      else toastError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  const view = status === null ? null : wafWorkspaceView(status);
  const hydrated = settings !== null;
  const field = (path: string, label: string, hint?: string) => (
    <Input
      key={path}
      label={label}
      size="sm"
      value={form[path] ?? ""}
      disabled={!hydrated || busy}
      onChange={(event) => setForm((current) => ({ ...current, [path]: event.target.value }))}
      {...(hint ? { hint } : {})}
      {...(fieldError === path ? { error: words.invalid } : {})}
    />
  );
  return (
    <SectionShell
      actions={
        <>
          <Button
            size="sm"
            disabled={view === null || !view.canPrepare || busy}
            onClick={() => void prepare()}
          >
            {words.prepare}
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={!hydrated || busy}
            onClick={() => void save()}
          >
            {S.common.save}
          </Button>
        </>
      }
    >
      <div aria-live="polite">
        {view !== null && (
          <p
            className={`text-sm font-medium ${toneInk[view.tone]}`}
            data-testid="waf-workspace-status"
          >
            {view.line}
          </p>
        )}
        {view?.failure && (
          <p className={`mt-3 text-sm ${toneInk.danger}`}>{words.failed(view.failure)}</p>
        )}
      </div>
      {view !== null && view.repos.length > 0 && (
        <ul className="space-y-2">
          {view.repos.map((repo) => (
            <li key={repo.id}>
              <p className="text-sm">
                <span className="font-medium">{words.repos[repo.id]}</span>
                {": "}
                <span className={toneInk[repo.tone]}>{repo.line}</span>
              </p>
              <p className="break-all text-xs text-gray-500 dark:text-gray-400">{repo.path}</p>
            </li>
          ))}
        </ul>
      )}
      {view?.log && (
        <div>
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{words.logLabel}</p>
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md border border-gray-200 bg-gray-50 p-2 font-mono text-xs dark:border-gray-800 dark:bg-gray-900/60">
            {view.log}
          </pre>
        </div>
      )}
      <fieldset className="space-y-3">
        <legend className="mb-2 text-sm font-semibold">{words.sources}</legend>
        {WAF_REPO_ORDER.map((id) => (
          <div key={id} className="grid gap-3 sm:grid-cols-[1fr_10rem]">
            {field(`repos.${id}.remote`, words.remote(words.repos[id]))}
            {field(`repos.${id}.branch`, words.branch)}
          </div>
        ))}
        {field("moduleRemote", words.moduleRemote, words.moduleRemoteHint)}
      </fieldset>
      <fieldset className="space-y-3">
        <legend className="mb-2 text-sm font-semibold">{words.existing}</legend>
        {projectId === null ? (
          field("externalRoot", words.externalRoot, words.externalRootHint)
        ) : (
          <div>
            <FieldLabel>{words.externalRoot}</FieldLabel>
            <WorkspaceSelect
              projectId={projectId}
              workspace={form.externalRoot ?? ""}
              onChange={(path) => setForm((current) => ({ ...current, externalRoot: path }))}
              variant="form"
              fieldLabel={words.externalRoot}
              emptyLabel={words.externalRootPick}
              menuHint={words.externalRootMenuHint}
              clearLabel={words.externalRootClear}
            />
            {fieldError === "externalRoot" ? (
              <FieldError>{words.invalid}</FieldError>
            ) : (
              <FieldHint>{words.externalRootHint}</FieldHint>
            )}
          </div>
        )}
      </fieldset>
    </SectionShell>
  );
}

/**
 * Import from a system browser: pick one profile (grouped under its browser), what to copy —
 * cookies and sign-ins, history — and optionally which sites' cookies; then the counts and
 * any warnings the import came back with. The browser imported from is only read.
 */
import { useEffect, useState } from "react";
import type {
  BuiltinBrowserImportResult,
  BuiltinBrowserImportSource,
} from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import { Button } from "../../components/ui/button";
import { FieldLabel } from "../../components/ui/field";
import { Input } from "../../components/ui/input";
import { Modal } from "../../components/ui/modal";
import {
  groupSources,
  importRequest,
  keychainPromptLikely,
  sourceImportable,
} from "./import-options";

const optionClass = "flex items-center gap-1.5 text-xs text-gray-700 dark:text-gray-300";

export function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [sources, setSources] = useState<BuiltinBrowserImportSource[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [cookies, setCookies] = useState(true);
  const [history, setHistory] = useState(true);
  const [domains, setDomains] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BuiltinBrowserImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Every opening starts over and re-reads the list: a browser installed or signed into since
  // the last look should show up.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setSources(null);
    setLoadError(null);
    setResult(null);
    setError(null);
    api
      .getBuiltinBrowserImportSources()
      .then((res) => {
        if (cancelled) return;
        setSources(res.sources);
        setSourceId(res.sources.find(sourceImportable)?.id ?? null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(apiErrorText(err));
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const source = sources?.find((s) => s.id === sourceId) ?? null;
  const request = importRequest(source, { cookies, history, domains });

  const run = async () => {
    if (request === null) return;
    setRunning(true);
    setError(null);
    try {
      setResult(await api.importIntoBuiltinBrowser(request));
    } catch (err) {
      setError(S.builtinBrowser.importFailed(apiErrorText(err)));
    } finally {
      setRunning(false);
    }
  };

  const footer =
    result !== null ? (
      <Button size="sm" variant="primary" onClick={onClose}>
        {S.builtinBrowser.importDone}
      </Button>
    ) : (
      <>
        <Button size="sm" onClick={onClose} disabled={running}>
          {S.common.cancel}
        </Button>
        <Button
          size="sm"
          variant="primary"
          onClick={() => void run()}
          disabled={running || request === null}
        >
          {running ? S.builtinBrowser.importRunning : S.builtinBrowser.importRun}
        </Button>
      </>
    );

  return (
    <Modal open={open} title={S.builtinBrowser.importTitle} onClose={onClose} footer={footer}>
      {result !== null ? (
        <ImportOutcome result={result} />
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-xs text-gray-500 dark:text-gray-400">{S.builtinBrowser.importIntro}</p>
          {loadError !== null ? (
            <p className={`text-xs ${toneInk.danger}`}>
              {S.builtinBrowser.importSourcesFailed(loadError)}
            </p>
          ) : sources === null ? (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {S.builtinBrowser.importLoading}
            </p>
          ) : sources.length === 0 ? (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {S.builtinBrowser.importNone}
            </p>
          ) : (
            <>
              <div role="radiogroup" aria-label={S.builtinBrowser.importSource}>
                <FieldLabel>{S.builtinBrowser.importSource}</FieldLabel>
                <div className="flex flex-col gap-2">
                  {groupSources(sources).map((group) => (
                    <div key={group.browser} className="flex flex-col gap-1">
                      <span className="text-xs font-medium text-gray-800 dark:text-gray-200">
                        {group.browserName}
                      </span>
                      {group.sources.map((s) => (
                        <label key={s.id} className={`${optionClass} pl-3`}>
                          <input
                            type="radio"
                            name="builtin-browser-import-source"
                            checked={s.id === sourceId}
                            disabled={!sourceImportable(s) || running}
                            onChange={() => setSourceId(s.id)}
                          />
                          <span className="min-w-0 truncate">{s.profileName}</span>
                          {s.profileName !== s.profile && (
                            <span className="shrink-0 text-gray-400 dark:text-gray-500">
                              {s.profile}
                            </span>
                          )}
                        </label>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
              <div role="group" aria-label={S.builtinBrowser.importWhat}>
                <FieldLabel>{S.builtinBrowser.importWhat}</FieldLabel>
                <div className="flex flex-col gap-1.5">
                  <label className={optionClass}>
                    <input
                      type="checkbox"
                      checked={cookies && source?.hasCookies === true}
                      disabled={source?.hasCookies !== true || running}
                      onChange={(e) => setCookies(e.target.checked)}
                    />
                    {S.builtinBrowser.importCookies}
                  </label>
                  <label className={optionClass}>
                    <input
                      type="checkbox"
                      checked={history && source?.hasHistory === true}
                      disabled={source?.hasHistory !== true || running}
                      onChange={(e) => setHistory(e.target.checked)}
                    />
                    {S.builtinBrowser.importHistory}
                  </label>
                </div>
              </div>
              {/* Filters cookies only: history is small and not a credential. */}
              <Input
                size="sm"
                label={S.builtinBrowser.importDomains}
                hint={S.builtinBrowser.importDomainsHint}
                placeholder={S.builtinBrowser.importDomainsPlaceholder}
                value={domains}
                disabled={!(cookies && source?.hasCookies === true) || running}
                onChange={(e) => setDomains(e.target.value)}
              />
              {source !== null &&
                cookies &&
                source.hasCookies &&
                keychainPromptLikely(navigator.userAgent, source.browser) && (
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {S.builtinBrowser.importKeychainNote}
                  </p>
                )}
              {error !== null && <p className={`text-xs ${toneInk.danger}`}>{error}</p>}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

/** What the import did: one line per kind of data, then the warnings it came back with. */
function ImportOutcome({ result }: { result: BuiltinBrowserImportResult }) {
  return (
    <div className="flex flex-col gap-2 text-xs">
      {result.cookies !== undefined && (
        <p className="font-medium text-gray-800 dark:text-gray-200">
          {S.builtinBrowser.importCookiesResult(result.cookies)}
        </p>
      )}
      {result.history !== undefined && (
        <p className="font-medium text-gray-800 dark:text-gray-200">
          {S.builtinBrowser.importHistoryResult(result.history)}
        </p>
      )}
      {result.warnings.length > 0 && (
        <ul className="flex list-disc flex-col gap-1 pl-4 text-gray-500 dark:text-gray-400">
          {result.warnings.map((warning, index) => (
            // Warnings are a fixed list that may repeat a line, so the position is the identity.
            <li key={index}>{warning}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

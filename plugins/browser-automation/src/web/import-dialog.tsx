/**
 * Import from a system browser: pick one profile (grouped under its browser) — or the user's
 * connected Chrome extension, which hands over its Chrome's cookies once the user allows it in
 * Chrome — what to copy — cookies and sign-ins, history — and optionally which sites' cookies;
 * then the counts, why each skipped cookie stayed behind, and anything else the import reported,
 * all worded here from the server's codes. The browser imported from is only read.
 */
import { browserState } from "./browser-store";
import { useEffect, useState, type ReactNode } from "react";
import type {
  BuiltinBrowserImportResult,
  BuiltinBrowserImportSource,
} from "@prismshadow/penguin-server/api";
import { Button, Checkbox, FieldLabel, Input, Modal, Radio } from "@prismshadow/penguin-ui";
import * as api from "./api";
import { apiErrorText, failureNode, toneInk } from "@prismshadow/penguin-web-plugin";
import { S } from "./strings";
import {
  appBoundLikely,
  appBoundSkips,
  extensionRoute,
  groupSources,
  importRequest,
  keychainPromptLikely,
  sourceImportable,
  type ImportExtensionRoute,
} from "./import-options";

/** The option rows' ink. */
const optionInk = "text-gray-700 dark:text-gray-300";
/** Secondary lines: the intro, the notes under the fields. */
const noteInk = "text-xs text-gray-500 dark:text-gray-400";

export function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [sources, setSources] = useState<BuiltinBrowserImportSource[] | null>(null);
  const [route, setRoute] = useState<ImportExtensionRoute>("off");
  const [loadError, setLoadError] = useState<ReactNode>(null);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [cookies, setCookies] = useState(true);
  const [history, setHistory] = useState(true);
  const [domains, setDomains] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BuiltinBrowserImportResult | null>(null);
  const [error, setError] = useState<ReactNode>(null);

  // Every opening starts over and re-reads the list: a browser installed or signed into since
  // the last look should show up, and the extension may have connected meanwhile.
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
        setRoute(extensionRoute(res));
        setSourceId(res.sources.find(sourceImportable)?.id ?? null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(
          failureNode(err, {
            text: S.builtinBrowser.importSourcesFailed(apiErrorText(err)),
            what: "the browsers to import from could not be listed",
          }),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const source = sources?.find((s) => s.id === sourceId) ?? null;
  const extensionSource = sources?.find((s) => s.via === "extension") ?? null;
  const request = importRequest(source, { cookies, history, domains });
  const cookiesChosen = source !== null && cookies && source.hasCookies;

  const run = async () => {
    const { scope, projectId } = browserState();
    if (request === null) return;
    setRunning(true);
    setError(null);
    try {
      setResult(
        await api.importIntoBuiltinBrowser({
          ...request,
          sessionId: scope,
          ...(projectId === null ? {} : { projectId }),
        }),
      );
    } catch (err) {
      setError(
        failureNode(err, {
          text: S.builtinBrowser.importFailed(apiErrorText(err)),
          what: "browser data could not be imported",
        }),
      );
    } finally {
      setRunning(false);
    }
  };

  /** Back to the form with the extension chosen, for the cookies Chrome alone could read. */
  const retryThroughExtension =
    result !== null && extensionSource !== null && appBoundSkips(result) > 0
      ? () => {
          setResult(null);
          setError(null);
          setSourceId(extensionSource.id);
          setCookies(true);
        }
      : null;

  const footer =
    result !== null ? (
      <>
        {retryThroughExtension !== null && (
          <Button size="sm" onClick={retryThroughExtension}>
            {S.builtinBrowser.importUseExtension}
          </Button>
        )}
        <Button size="sm" variant="primary" onClick={onClose}>
          {S.builtinBrowser.importDone}
        </Button>
      </>
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
          {!running
            ? S.builtinBrowser.importRun
            : source?.via === "extension"
              ? S.builtinBrowser.importWaitingChrome
              : S.builtinBrowser.importRunning}
        </Button>
      </>
    );

  return (
    <Modal open={open} title={S.builtinBrowser.importTitle} onClose={onClose} footer={footer}>
      {result !== null ? (
        <ImportOutcome result={result} route={route} />
      ) : (
        <div className="flex flex-col gap-4">
          <p className={noteInk}>{S.builtinBrowser.importIntro}</p>
          {loadError !== null ? (
            <p className={`text-xs ${toneInk.danger}`}>{loadError}</p>
          ) : sources === null ? (
            <p className={noteInk}>{S.builtinBrowser.importLoading}</p>
          ) : sources.length === 0 ? (
            <p className={noteInk}>{S.builtinBrowser.importNone}</p>
          ) : (
            <>
              <div role="radiogroup" aria-label={S.builtinBrowser.importSource}>
                <FieldLabel>{S.builtinBrowser.importSource}</FieldLabel>
                <div className="flex flex-col gap-2">
                  {groupSources(sources).map((group) => (
                    <div key={group.key} className="flex flex-col gap-1">
                      <span className="text-xs font-medium text-gray-800 dark:text-gray-200">
                        {group.key === "extension"
                          ? S.builtinBrowser.importExtensionGroup
                          : group.browserName}
                      </span>
                      {group.sources.map((s) => (
                        <Radio
                          key={s.id}
                          name="builtin-browser-import-source"
                          checked={s.id === sourceId}
                          disabled={!sourceImportable(s) || running}
                          onChange={() => setSourceId(s.id)}
                          className={`${optionInk} pl-3`}
                          {...(s.via === "extension"
                            ? { hint: S.builtinBrowser.importExtensionHint }
                            : {})}
                          label={
                            <span className="flex min-w-0 items-center gap-1.5">
                              <span className="min-w-0 truncate">{s.profileName}</span>
                              {s.profileName !== s.profile && (
                                <span className="shrink-0 text-gray-400 dark:text-gray-500">
                                  {s.profile}
                                </span>
                              )}
                            </span>
                          }
                        />
                      ))}
                    </div>
                  ))}
                </div>
              </div>
              <div role="group" aria-label={S.builtinBrowser.importWhat}>
                <FieldLabel>{S.builtinBrowser.importWhat}</FieldLabel>
                <div className="flex flex-col gap-1.5">
                  <Checkbox
                    checked={cookies && source?.hasCookies === true}
                    disabled={source?.hasCookies !== true || running}
                    onChange={setCookies}
                    label={S.builtinBrowser.importCookies}
                    className={optionInk}
                  />
                  <Checkbox
                    checked={history && source?.hasHistory === true}
                    disabled={source?.hasHistory !== true || running}
                    onChange={setHistory}
                    label={S.builtinBrowser.importHistory}
                    className={optionInk}
                  />
                </div>
              </div>
              {/* Filters cookies only: history is small and not a credential. */}
              <Input
                size="sm"
                label={S.builtinBrowser.importDomains}
                hint={S.builtinBrowser.importDomainsHint}
                placeholder={S.builtinBrowser.importDomainsPlaceholder}
                value={domains}
                disabled={!cookiesChosen || running}
                onChange={(e) => setDomains(e.target.value)}
              />
              {source !== null &&
                cookiesChosen &&
                keychainPromptLikely(navigator.userAgent, source.browser) && (
                  <p className={noteInk}>{S.builtinBrowser.importKeychainNote}</p>
                )}
              {source !== null && cookiesChosen && appBoundLikely(navigator.userAgent, source) && (
                <p className={noteInk}>{S.builtinBrowser.importAppBoundHint(route)}</p>
              )}
              {error !== null && <p className={`text-xs ${toneInk.danger}`}>{error}</p>}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

/**
 * What the import did: one line per kind of data, then why each skipped cookie stayed behind
 * and anything else the import reported — and, when Chrome's app-bound encryption kept cookies
 * back, how to get them given the extension's state (`route`).
 */
export function ImportOutcome({
  result,
  route,
}: {
  result: BuiltinBrowserImportResult;
  route: ImportExtensionRoute;
}) {
  const skips = (result.cookies?.skips ?? []).map((skip) =>
    S.builtinBrowser.importSkip(skip, result.browserName),
  );
  const notes = result.notes.map((note) => S.builtinBrowser.importNote(note, result.browserName));
  return (
    <div className="flex flex-col gap-2 text-xs">
      {result.cookies !== undefined && (
        <p className="font-medium text-gray-800 dark:text-gray-200">
          {S.builtinBrowser.importCookiesResult(result.cookies)}
        </p>
      )}
      {/* Why the cookies were skipped sits under their count, with the way round app-bound ones. */}
      <OutcomeLines lines={skips} />
      {appBoundSkips(result) > 0 && (
        <p className="text-gray-500 dark:text-gray-400">
          {S.builtinBrowser.importAppBoundAdvice(route)}
        </p>
      )}
      {result.history !== undefined && (
        <p className="font-medium text-gray-800 dark:text-gray-200">
          {S.builtinBrowser.importHistoryResult(result.history)}
        </p>
      )}
      <OutcomeLines lines={notes} />
    </div>
  );
}

function OutcomeLines({ lines }: { lines: string[] }) {
  if (lines.length === 0) return null;
  return (
    <ul className="flex list-disc flex-col gap-1 pl-4 text-gray-500 dark:text-gray-400">
      {lines.map((line, index) => (
        // A fixed list that may repeat a line, so the position is the identity.
        <li key={index}>{line}</li>
      ))}
    </ul>
  );
}

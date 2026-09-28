/**
 * Module builds: every succeeded assembly, newest first, with its file count and which one
 * the preview plays. Select two to compare their files; Play this build keeps the preview on
 * an older one until it is unpinned.
 */
import { useEffect, useRef, useState } from "react";
import type {
  ActivityDraft,
  ModuleBuildDiff,
  ModuleBuildList,
} from "@prismshadow/penguin-server/api";
import { apiFetch } from "../../api/client";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { InfoPopover } from "../../components/ui/info-popover";
import { Select } from "../../components/ui/select";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";
import { toneInk, toneStrip } from "../../lib/tone";
import {
  buildFileRows,
  buildLabel,
  buildRows,
  compareOrder,
  olderBuildPlaying,
  pinGone,
  textFiles,
  toggleBuild,
} from "./module-builds-model";
import type { Announcement } from "./run-toasts";
import { SpecDiffView } from "./spec-diff-view";
import { localTime } from "./versions-model";

const HEAD =
  "border-b border-gray-100 bg-gray-50 text-left text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-900/60 dark:text-gray-400";
const TH = "whitespace-nowrap px-3 py-2 font-medium";
const TD = "px-3 py-2 align-top";

interface Comparison {
  from: string;
  to: string;
  diff: ModuleBuildDiff | null;
  error: string;
  file: string | null;
}

export function ModuleBuildsView({
  endpoint,
  editable,
  draftRevision,
  buildsKey,
  onAnnounce,
  onDraft,
}: {
  /** The activity's API path. */
  endpoint: string;
  /** Whether this user may pin a build (the project owner). */
  editable: boolean;
  /** The draft's revision, which a pin or unpin sends; a pin leaves it as it was. */
  draftRevision: string;
  /** Changes when a build is added, so the list is read again. */
  buildsKey: string;
  onAnnounce: (announcement: Announcement) => void;
  /** The draft a pin or unpin made. */
  onDraft: (draft: ActivityDraft) => void;
}) {
  const words = S.activities.moduleBuilds;
  const [list, setList] = useState<ModuleBuildList | null>(null);
  const [loadError, setLoadError] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [pinning, setPinning] = useState(false);
  const [pinError, setPinError] = useState("");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Only the latest read may land.
  const reads = useRef(0);
  async function load() {
    const read = ++reads.current;
    setLoadError("");
    try {
      const answer = await apiFetch<Partial<ModuleBuildList>>(`${endpoint}/module-builds`);
      if (!alive.current || read !== reads.current) return;
      const result: ModuleBuildList = {
        builds: Array.isArray(answer.builds) ? answer.builds : [],
        pinnedRunId: answer.pinnedRunId ?? null,
        playingRunId: answer.playingRunId ?? null,
      };
      setList(result);
      const ids = new Set(result.builds.map((build) => build.runId));
      setSelected((current) => current.filter((id) => ids.has(id)));
    } catch (error) {
      if (alive.current && read === reads.current) setLoadError(apiErrorText(error));
    }
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint, buildsKey, draftRevision]);

  const compares = useRef(0);
  async function compare(from: string, to: string) {
    const read = ++compares.current;
    setComparison({ from, to, diff: null, error: "", file: null });
    try {
      const diff = await apiFetch<ModuleBuildDiff>(
        `${endpoint}/module-builds/diff?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      );
      if (!alive.current || read !== compares.current) return;
      setComparison({ from, to, diff, error: "", file: textFiles(diff)[0]?.path ?? null });
    } catch (error) {
      if (alive.current && read === compares.current)
        setComparison({ from, to, diff: null, error: apiErrorText(error), file: null });
    }
  }

  async function pin(runId: string | null) {
    setPinning(true);
    setPinError("");
    try {
      const draft = await apiFetch<ActivityDraft>(
        runId === null
          ? `${endpoint}/module-builds/unpin`
          : `${endpoint}/module-builds/${encodeURIComponent(runId)}/pin`,
        { method: "POST", body: { expectedRevision: draftRevision } },
      );
      if (!alive.current) return;
      onAnnounce({
        kind: "success",
        text: runId === null ? words.unpinned : words.pinned(buildLabel(runId)),
      });
      onDraft(draft);
      void load();
    } catch (error) {
      if (alive.current) setPinError(apiErrorText(error));
    } finally {
      if (alive.current) setPinning(false);
    }
  }

  const rows = list ? buildRows(list) : [];
  const order = list ? compareOrder(list.builds, selected) : null;
  const older = list ? olderBuildPlaying(list) : null;
  const gone = list ? pinGone(list) : null;
  const locked = pinning;
  return (
    <section className="space-y-3" aria-labelledby="activity-builds-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="activity-builds-title" className="flex items-center gap-2 text-sm font-semibold">
          {words.title}
          <InfoPopover label={words.title}>
            <p>{words.about}</p>
            <p>{words.aboutPin}</p>
          </InfoPopover>
        </h3>
        {rows.length > 1 && (
          <Button
            size="sm"
            disabled={!order}
            onClick={() => order && void compare(order.from, order.to)}
          >
            {words.compare}
          </Button>
        )}
      </div>
      {older && (
        <div
          role="status"
          className={`flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-xs ${toneStrip.attention}`}
        >
          <p>
            <span className="font-semibold">{words.pinnedNotice}</span>{" "}
            {words.pinnedDetail(buildLabel(older))}
          </p>
          {editable && (
            <Button size="sm" disabled={locked} onClick={() => void pin(null)}>
              {words.unpin}
            </Button>
          )}
        </div>
      )}
      {gone && (
        <div
          role="status"
          className={`flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-xs ${toneStrip.attention}`}
        >
          <p>{words.pinGone}</p>
          {editable && (
            <Button size="sm" disabled={locked} onClick={() => void pin(null)}>
              {words.unpin}
            </Button>
          )}
        </div>
      )}
      {pinError && (
        <p role="alert" className={`text-xs ${toneInk.danger}`}>
          {pinError}
        </p>
      )}
      {loadError ? (
        <div className="space-y-2">
          <p role="alert" className={`text-xs ${toneInk.danger}`}>
            {words.loadFailed} {loadError}
          </p>
          <Button size="sm" onClick={() => void load()}>
            {S.common.retry}
          </Button>
        </div>
      ) : list === null ? (
        <p role="status" className="text-xs text-gray-500">
          {words.loading}
        </p>
      ) : !rows.length ? (
        <p className="text-xs text-gray-500">{words.empty}</p>
      ) : (
        <>
          {rows.length > 1 && <p className="text-xs text-gray-500">{words.selectHint}</p>}
          <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
            <table className="w-full text-sm">
              <thead>
                <tr className={HEAD}>
                  <th className={TH}>
                    <span className="sr-only">{words.columns.select}</span>
                  </th>
                  <th className={TH}>{words.columns.build}</th>
                  <th className={TH}>{words.columns.built}</th>
                  <th className={TH}>{words.columns.files}</th>
                  <th className={TH}>{words.columns.preview}</th>
                  <th className={TH}>
                    <span className="sr-only">{words.columns.actions}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800/60">
                {rows.map((row) => (
                  <tr key={row.runId}>
                    <td className={TD}>
                      <input
                        type="checkbox"
                        aria-label={words.select(row.label)}
                        checked={selected.includes(row.runId)}
                        onChange={() => setSelected((current) => toggleBuild(current, row.runId))}
                        className="h-4 w-4 accent-brand-600"
                      />
                    </td>
                    <td className={`${TD} whitespace-nowrap font-medium`}>{row.label}</td>
                    <td className={`${TD} whitespace-nowrap text-xs text-gray-500`}>
                      <time dateTime={row.createdAt}>{localTime(row.createdAt)}</time>
                    </td>
                    <td className={`${TD} whitespace-nowrap text-xs`}>{row.files}</td>
                    <td className={`${TD} whitespace-nowrap`}>
                      <div className="flex flex-wrap gap-1">
                        {row.newest && <Badge tone="gray">{words.newest}</Badge>}
                        {row.playing && <Badge tone="brand">{words.playing}</Badge>}
                      </div>
                    </td>
                    <td className={`${TD} whitespace-nowrap`}>
                      <div className="flex justify-end gap-2">
                        {editable && !row.playing && (
                          <Button
                            size="sm"
                            aria-label={words.playBuild(row.label)}
                            disabled={locked}
                            onClick={() => void pin(row.newest ? null : row.runId)}
                          >
                            {words.play}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {comparison && (
        <BuildCompare
          comparison={comparison}
          onFile={(file) => setComparison({ ...comparison, file })}
          onRetry={() => void compare(comparison.from, comparison.to)}
          onClose={() => {
            compares.current++;
            setComparison(null);
          }}
        />
      )}
    </section>
  );
}

/** Two builds compared: the files that differ, and the line diff of one text file at a time. */
function BuildCompare({
  comparison,
  onFile,
  onRetry,
  onClose,
}: {
  comparison: Comparison;
  onFile: (file: string) => void;
  onRetry: () => void;
  onClose: () => void;
}) {
  const words = S.activities.moduleBuilds;
  const { diff } = comparison;
  const from = buildLabel(comparison.from);
  const to = buildLabel(comparison.to);
  const texts = diff ? textFiles(diff) : [];
  const shown = texts.find((file) => file.path === comparison.file) ?? texts[0];
  const rows = diff ? buildFileRows(diff) : [];
  return (
    <section
      className="space-y-3 rounded-lg border border-gray-200 p-3 dark:border-gray-800"
      aria-labelledby="activity-build-compare-title"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4
          id="activity-build-compare-title"
          className="flex items-center gap-2 text-sm font-semibold"
        >
          {words.compareTitle(from, to)}
          <InfoPopover label={words.compareTitle(from, to)}>
            <p>{words.compareAbout(from, to)}</p>
          </InfoPopover>
        </h4>
        <Button size="sm" variant="ghost" onClick={onClose}>
          {words.closeCompare}
        </Button>
      </div>
      {comparison.error ? (
        <div className="space-y-2">
          <p role="alert" className={`text-xs ${toneInk.danger}`}>
            {words.compareFailed} {comparison.error}
          </p>
          <Button size="sm" onClick={onRetry}>
            {S.common.retry}
          </Button>
        </div>
      ) : !diff ? (
        <p role="status" className="text-xs text-gray-500">
          {words.comparing}
        </p>
      ) : !diff.files.length ? (
        <p className="text-xs text-gray-500">{words.noChanges}</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
            <table className="w-full text-sm">
              <thead>
                <tr className={HEAD}>
                  <th className={TH}>{words.fileColumns.file}</th>
                  <th className={TH}>{words.fileColumns.change}</th>
                  <th className={TH}>{words.fileColumns.before}</th>
                  <th className={TH}>{words.fileColumns.after}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800/60">
                {rows.map((row) => (
                  <tr key={row.path}>
                    <td className={`${TD} break-all font-mono text-xs`}>
                      {row.path}
                      {row.note && (
                        <span className="block font-sans text-gray-500">{row.note}</span>
                      )}
                    </td>
                    <td className={`${TD} whitespace-nowrap text-xs`}>{row.change}</td>
                    <td className={`${TD} whitespace-nowrap text-xs`}>{row.before}</td>
                    <td className={`${TD} whitespace-nowrap text-xs`}>{row.after}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {diff.unchanged > 0 && (
            <p className="text-xs text-gray-500">{words.unchanged(diff.unchanged)}</p>
          )}
          {shown && (
            <div className="space-y-2">
              <Select
                size="sm"
                label={words.textFile}
                value={shown.path}
                onChange={(event) => onFile(event.target.value)}
              >
                {texts.map((file) => (
                  <option key={file.path} value={file.path}>
                    {file.path}
                  </option>
                ))}
              </Select>
              <SpecDiffView
                key={shown.path}
                compact
                label={words.diffLabel(shown.path)}
                saved={shown.before}
                edited={shown.after}
              />
            </div>
          )}
        </>
      )}
    </section>
  );
}

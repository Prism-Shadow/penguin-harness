/**
 * The activity's saved versions: Save version (with an optional name), the table of every
 * version, newest first, naming the one the draft holds now and the ones that went to QA or
 * PROD, Compare (a version against the current draft, part by part and media file by media
 * file) and Restore. Under the heading, whether QA and PROD hold what the draft holds now.
 */
import { useEffect, useRef, useState } from "react";
import type {
  ActivityDraft,
  VersionDiff,
  VersionFileName,
  VersionSaveResult,
  VersionStatus,
  VersionSummary,
} from "@prismshadow/penguin-server/api";
import { ApiError, apiFetch } from "../../api/client";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { InfoPopover } from "../../components/ui/info-popover";
import { Input } from "../../components/ui/input";
import { Modal } from "../../components/ui/modal";
import { Tabs } from "../../components/ui/tabs";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import type { Announcement } from "./run-toasts";
import { SpecDiffView } from "./spec-diff-view";
import {
  VERSION_NAME_MAX,
  compareTabs,
  isSame,
  mediaChangeRows,
  restoreProblem,
  saveAnnouncement,
  isVersionStatus,
  statusLines,
  versionName,
  versionRows,
} from "./versions-model";

const HEAD =
  "border-b border-gray-100 bg-gray-50 text-left text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-900/60 dark:text-gray-400";
const TH = "whitespace-nowrap px-3 py-2 font-medium";
const TD = "px-3 py-2 align-top";

/** A version being compared with the current draft, and what the compare found. */
interface Comparison {
  versionId: string;
  seq: number;
  diff: VersionDiff | null;
  error: string;
  tab: VersionFileName | null;
}

export function VersionsView({
  endpoint,
  editable,
  draftRevision,
  unsaved = false,
  onAnnounce,
  onRestored,
}: {
  /** The activity's API path. */
  endpoint: string;
  /** Whether this user may save and restore versions (the project owner). */
  editable: boolean;
  /** The draft's revision; a new one can change which version is current. */
  draftRevision: string;
  /** Whether the editor holds edits not saved yet, which a restore replaces. */
  unsaved?: boolean;
  onAnnounce: (announcement: Announcement) => void;
  /** The draft a restore made; the page shows it in place of the one it had. */
  onRestored?: (draft: ActivityDraft) => void;
}) {
  const words = S.activities.versions;
  const [versions, setVersions] = useState<VersionSummary[] | null>(null);
  const [status, setStatus] = useState<VersionStatus | null>(null);
  const [loadError, setLoadError] = useState("");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [restoring, setRestoring] = useState<{ versionId: string; seq: number } | null>(null);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [restoreError, setRestoreError] = useState("");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Only the latest read may land: an older answer can say another version is current.
  const reads = useRef(0);
  async function load() {
    const read = ++reads.current;
    setLoadError("");
    // The deploy status is a line beside the list: when it cannot be read it is left out.
    void apiFetch<unknown>(`${endpoint}/versions/status`)
      .then((result) => {
        if (alive.current && read === reads.current)
          setStatus(isVersionStatus(result) ? result : null);
      })
      .catch(() => {
        if (alive.current && read === reads.current) setStatus(null);
      });
    try {
      const result = await apiFetch<{ versions?: VersionSummary[] }>(`${endpoint}/versions`);
      if (alive.current && read === reads.current)
        setVersions(Array.isArray(result.versions) ? result.versions : []);
    } catch (error) {
      if (alive.current && read === reads.current) setLoadError(apiErrorText(error));
    }
  }
  useEffect(() => {
    void load();
    // A new draft revision changes the current side of an open compare, too.
    if (comparison) void compare(comparison.versionId, comparison.seq, comparison.tab);
    // A new draft revision can change which version is current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint, draftRevision]);

  // Only the latest compare may land, as with the list.
  const compares = useRef(0);
  async function compare(versionId: string, seq: number, tab: VersionFileName | null = null) {
    const read = ++compares.current;
    setComparison({ versionId, seq, diff: null, error: "", tab });
    try {
      const diff = await apiFetch<VersionDiff>(
        `${endpoint}/versions/${encodeURIComponent(versionId)}/diff?against=current`,
      );
      if (!alive.current || read !== compares.current) return;
      const tabs = compareTabs(diff);
      setComparison({
        versionId,
        seq,
        diff,
        error: "",
        tab: tabs.some((item) => item.key === tab) ? tab : (tabs[0]?.key ?? null),
      });
    } catch (error) {
      if (alive.current && read === compares.current)
        setComparison({ versionId, seq, diff: null, error: apiErrorText(error), tab });
    }
  }

  async function restore() {
    if (!restoring) return;
    setRestoreBusy(true);
    setRestoreError("");
    try {
      const draft = await apiFetch<ActivityDraft>(
        `${endpoint}/versions/${encodeURIComponent(restoring.versionId)}/restore`,
        { method: "POST", body: { expectedRevision: draftRevision } },
      );
      if (!alive.current) return;
      onAnnounce({ kind: "success", text: words.restored(restoring.seq) });
      setRestoring(null);
      onRestored?.(draft);
    } catch (error) {
      if (!alive.current) return;
      setRestoreError(
        (error instanceof ApiError && restoreProblem(error.code, error.detail)) ||
          apiErrorText(error),
      );
    } finally {
      if (alive.current) setRestoreBusy(false);
    }
  }

  async function save() {
    const { name: label, problem } = versionName(name);
    if (problem) {
      setNameError(problem);
      return;
    }
    setSaving(true);
    try {
      const result = await apiFetch<VersionSaveResult>(`${endpoint}/versions`, {
        method: "POST",
        body: { label },
      });
      if (!alive.current) return;
      onAnnounce(saveAnnouncement(result));
      setOpen(false);
      setName("");
      await load();
    } catch (error) {
      if (alive.current) setNameError(apiErrorText(error));
    } finally {
      if (alive.current) setSaving(false);
    }
  }

  const rows = versionRows(versions ?? []);
  return (
    <section className="space-y-3" aria-labelledby="activity-versions-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="activity-versions-title" className="flex items-center gap-2 text-sm font-semibold">
          {words.title}
          <InfoPopover label={words.title}>
            <p>{words.about}</p>
            <p>{words.aboutMedia}</p>
          </InfoPopover>
        </h3>
        {editable && (
          <Button
            size="sm"
            onClick={() => {
              setNameError(null);
              setOpen(true);
            }}
          >
            {words.save}
          </Button>
        )}
      </div>
      {status && (
        <ul aria-label={words.status.label} className="space-y-0.5 text-xs">
          {statusLines(status).map((line) => (
            <li key={line.target}>
              <span
                className={`font-medium ${line.tone === "muted" ? "text-gray-500" : toneInk[line.tone]}`}
              >
                {line.text}
              </span>
              {line.detail && <span className="text-gray-500"> · {line.detail}</span>}
            </li>
          ))}
        </ul>
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
      ) : versions === null ? (
        <p role="status" className="text-xs text-gray-500">
          {words.loading}
        </p>
      ) : !rows.length ? (
        <p className="text-xs text-gray-500">{words.empty}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
          <table className="w-full text-sm">
            <thead>
              <tr className={HEAD}>
                <th className={TH}>{words.columns.version}</th>
                <th className={TH}>{words.columns.name}</th>
                <th className={TH}>{words.columns.kind}</th>
                <th className={TH}>{words.columns.created}</th>
                <th className={TH}>{words.columns.author}</th>
                <th className={TH}>{words.columns.media}</th>
                <th className={TH}>{words.columns.current}</th>
                <th className={TH}>
                  <span className="sr-only">{words.columns.actions}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800/60">
              {rows.map((row) => (
                <tr key={row.versionId}>
                  <td className={`${TD} whitespace-nowrap font-medium`}>
                    <span className="flex items-center gap-1">
                      {row.number}
                      {row.deployed.map((badge) => (
                        <span
                          key={badge.target}
                          role="img"
                          aria-label={badge.name}
                          title={badge.name}
                        >
                          <Badge tone="brand">{badge.label}</Badge>
                        </span>
                      ))}
                    </span>
                  </td>
                  <td className={`${TD} break-words`}>
                    {row.name ?? <span className="text-gray-500">{words.unnamed}</span>}
                  </td>
                  <td className={`${TD} whitespace-nowrap`}>
                    <Badge tone="gray">{row.kind}</Badge>
                  </td>
                  <td className={`${TD} whitespace-nowrap text-xs text-gray-500`}>
                    <time dateTime={row.createdAt}>{new Date(row.createdAt).toLocaleString()}</time>
                  </td>
                  <td className={`${TD} whitespace-nowrap text-xs`}>{row.author}</td>
                  <td className={`${TD} whitespace-nowrap text-xs`}>{row.size}</td>
                  <td className={`${TD} whitespace-nowrap text-xs font-medium`}>
                    {row.current ? words.current : ""}
                  </td>
                  <td className={`${TD} whitespace-nowrap`}>
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        aria-label={words.compareVersion(row.seq)}
                        aria-pressed={comparison?.versionId === row.versionId}
                        onClick={() => void compare(row.versionId, row.seq)}
                      >
                        {words.compare}
                      </Button>
                      {editable && !row.current && (
                        <Button
                          size="sm"
                          aria-label={words.restoreVersion(row.seq)}
                          onClick={() => {
                            setRestoreError("");
                            setRestoring({ versionId: row.versionId, seq: row.seq });
                          }}
                        >
                          {words.restore}
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {comparison && (
        <CompareView
          comparison={comparison}
          onTab={(tab) => setComparison({ ...comparison, tab })}
          onRetry={() => void compare(comparison.versionId, comparison.seq, comparison.tab)}
          onClose={() => {
            compares.current++;
            setComparison(null);
          }}
        />
      )}
      {restoring && (
        <ConfirmModal
          open
          tone="primary"
          title={words.restoreVersion(restoring.seq)}
          confirmLabel={restoreBusy ? words.restoring : words.restore}
          busy={restoreBusy}
          onClose={() => !restoreBusy && setRestoring(null)}
          onConfirm={() => void restore()}
        >
          <p>{words.restoreConfirm(restoring.seq)}</p>
          {unsaved && <p className={toneInk.attention}>{words.restoreUnsaved}</p>}
          {restoreError && (
            <p role="alert" className={toneInk.danger}>
              {restoreError}
            </p>
          )}
        </ConfirmModal>
      )}
      <Modal
        open={open}
        title={words.saveTitle}
        onClose={() => !saving && setOpen(false)}
        footer={
          <>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
              {S.common.cancel}
            </Button>
            <Button size="sm" variant="primary" onClick={() => void save()} disabled={saving}>
              {saving ? words.saving : S.common.save}
            </Button>
          </>
        }
      >
        <Input
          size="sm"
          label={words.name}
          hint={words.nameHint}
          value={name}
          maxLength={VERSION_NAME_MAX}
          disabled={saving}
          error={nameError ?? undefined}
          onChange={(event) => {
            setName(event.target.value);
            setNameError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void save();
            }
          }}
        />
      </Modal>
    </section>
  );
}

/** The compare panel: a tab per changed part, each a line diff, then the media files that differ. */
function CompareView({
  comparison,
  onTab,
  onRetry,
  onClose,
}: {
  comparison: Comparison;
  onTab: (tab: VersionFileName) => void;
  onRetry: () => void;
  onClose: () => void;
}) {
  const words = S.activities.versions;
  const { diff, seq } = comparison;
  const tabs = diff ? compareTabs(diff) : [];
  const shown = tabs.find((tab) => tab.key === comparison.tab) ?? tabs[0];
  const media = diff ? mediaChangeRows(diff) : [];
  return (
    <section
      className="space-y-3 rounded-lg border border-gray-200 p-3 dark:border-gray-800"
      aria-labelledby="activity-compare-title"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 id="activity-compare-title" className="flex items-center gap-2 text-sm font-semibold">
          {words.compareTitle(seq)}
          <InfoPopover label={words.compareTitle(seq)}>
            <p>{words.compareAbout(seq)}</p>
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
      ) : isSame(diff) ? (
        <p className="text-xs text-gray-500">{words.noChanges}</p>
      ) : (
        <>
          {shown && (
            <div className="space-y-2">
              <Tabs items={tabs} active={shown.key} onChange={onTab} />
              <SpecDiffView
                key={shown.key}
                compact
                label={words.diffLabel(shown.label)}
                saved={shown.before}
                edited={shown.after}
              />
            </div>
          )}
          {media.length > 0 && (
            <div className="space-y-2">
              <h5 className="text-sm font-semibold">{words.mediaTitle}</h5>
              <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
                <table className="w-full text-sm">
                  <thead>
                    <tr className={HEAD}>
                      <th className={TH}>{words.mediaColumns.file}</th>
                      <th className={TH}>{words.mediaColumns.change}</th>
                      <th className={TH}>{words.mediaColumns.before}</th>
                      <th className={TH}>{words.mediaColumns.after}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800/60">
                    {media.map((row) => (
                      <tr key={row.path}>
                        <td className={`${TD} break-all font-mono text-xs`}>{row.path}</td>
                        <td className={`${TD} whitespace-nowrap text-xs`}>{row.change}</td>
                        <td className={`${TD} whitespace-nowrap text-xs`}>{row.before}</td>
                        <td className={`${TD} whitespace-nowrap text-xs`}>{row.after}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/**
 * The activity's saved versions: Save version (with an optional name) and the table of every
 * version, newest first, naming the one the draft holds now.
 */
import { useEffect, useRef, useState } from "react";
import type { VersionSaveResult, VersionSummary } from "@prismshadow/penguin-server/api";
import { apiFetch } from "../../api/client";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { InfoPopover } from "../../components/ui/info-popover";
import { Input } from "../../components/ui/input";
import { Modal } from "../../components/ui/modal";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import type { Announcement } from "./run-toasts";
import { VERSION_NAME_MAX, saveAnnouncement, versionName, versionRows } from "./versions-model";

const HEAD =
  "border-b border-gray-100 bg-gray-50 text-left text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-900/60 dark:text-gray-400";
const TH = "whitespace-nowrap px-3 py-2 font-medium";
const TD = "px-3 py-2 align-top";

export function VersionsView({
  endpoint,
  editable,
  draftRevision,
  onAnnounce,
}: {
  /** The activity's API path. */
  endpoint: string;
  /** Whether this user may save versions (the project owner). */
  editable: boolean;
  /** The draft's revision; a new one can change which version is current. */
  draftRevision: string;
  onAnnounce: (announcement: Announcement) => void;
}) {
  const words = S.activities.versions;
  const [versions, setVersions] = useState<VersionSummary[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
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
    // A new draft revision can change which version is current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint, draftRevision]);

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
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800/60">
              {rows.map((row) => (
                <tr key={row.versionId}>
                  <td className={`${TD} whitespace-nowrap font-medium`}>{row.number}</td>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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

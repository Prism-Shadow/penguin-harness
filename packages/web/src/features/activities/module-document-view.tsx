/**
 * Configuration Data and Assessment Data: the module's own configuration and assessment
 * files for this ref, edited in place. An edit is kept in the draft and replaces the
 * generated document in the preview and in every assembly until it is discarded; the
 * assessment is shared by every ref, so only the canonical ref edits it.
 */
import { useEffect, useRef, useState } from "react";
import type { ActivityDraft, ModuleDocuments } from "@prismshadow/penguin-server/api";
import { apiFetch } from "../../api/client";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";
import { toneInk, toneStrip } from "../../lib/tone";
import { Button } from "../../components/ui/button";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { InfoPopover } from "../../components/ui/info-popover";
import { Textarea } from "../../components/ui/input";
import {
  assessmentItemCount,
  documentChanged,
  documentOrigin,
  documentText,
  parseDocument,
  type ModuleDocumentKind,
} from "./module-document";

export function ModuleDocumentView({
  endpoint,
  kind,
  revision,
  editable,
  onSaved,
}: {
  endpoint: string;
  kind: ModuleDocumentKind;
  /** The draft revision: a save sends it, and a new one can mean a new assembly, so read again. */
  revision: string;
  /** Whether this viewer may change the activity at all (a project owner, with it open). */
  editable: boolean;
  /** A save or a discard changed the draft; `text` is what to announce. */
  onSaved: (draft: ActivityDraft, text: string) => void;
}) {
  const words = S.activities.moduleDocuments;
  const [documents, setDocuments] = useState<ModuleDocuments | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  // The text the editor last loaded; while the author has not changed it, a fresh read
  // replaces it, and once they have, their words stay.
  const loaded = useRef<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    apiFetch<ModuleDocuments>(`${endpoint}/module-documents`)
      .then((value) => {
        if (cancelled) return;
        setDocuments(value);
        setError(null);
        const next = value[kind] ? documentText(value[kind]!.value) : "";
        const previous = loaded.current;
        setText((current) => (previous === null || current === previous ? next : current));
        loaded.current = next;
      })
      .catch((cause) => {
        if (!cancelled) setError(apiErrorText(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [endpoint, revision, kind]);

  if (error) return <p className={`text-sm ${toneInk.danger}`}>{words.unreadable(error)}</p>;
  if (!documents) return <p className="text-sm text-gray-500">{words.loading}</p>;
  if (!documents.source) return <p className="text-sm text-gray-500">{words.none}</p>;
  const document = documents[kind];
  if (!document) return <p className="text-sm text-gray-500">{words.missing[kind]}</p>;
  const items = kind === "assessment" ? assessmentItemCount(document.value) : null;
  const canEdit = editable && document.editable;
  const changed = documentChanged(text, document.value);
  const canonicalRefNum = documents.canonicalRefNum;

  async function save() {
    const parsed = parseDocument(text);
    if ("error" in parsed) {
      setProblem(parsed.error);
      return;
    }
    setProblem(null);
    setBusy(true);
    try {
      const draft = await apiFetch<ActivityDraft>(`${endpoint}/module-documents/${kind}`, {
        method: "PUT",
        body: { value: parsed.value, expectedRevision: revision },
      });
      // The next read shows the document as saved.
      loaded.current = null;
      onSaved(draft, words.saved);
    } catch (cause) {
      setProblem(apiErrorText(cause));
    } finally {
      setBusy(false);
    }
  }

  async function discard() {
    setProblem(null);
    setBusy(true);
    try {
      const draft = await apiFetch<ActivityDraft>(`${endpoint}/module-documents/${kind}/discard`, {
        method: "POST",
        body: { expectedRevision: revision },
      });
      // The module's own document comes back on the next read; show it, not the edit.
      loaded.current = null;
      onSaved(draft, words.discarded);
    } catch (cause) {
      setProblem(apiErrorText(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        {S.activities.sectionNames[kind]}
        <InfoPopover label={S.activities.sectionNames[kind]}>
          <p>{words.about[kind]}</p>
        </InfoPopover>
      </h3>
      <p className="text-xs text-gray-500">
        {documentOrigin(documents.source, document)}
        {items !== null && ` ${words.items(items)}.`}
      </p>
      {document.edited && (
        <p className="text-xs text-gray-700 dark:text-gray-300">{words.edited}</p>
      )}
      {document.stale && (
        <p role="status" className={`rounded-md border p-3 text-xs ${toneStrip.attention}`}>
          {words.stale[kind]}
        </p>
      )}
      {editable && !document.editable && kind === "assessment" && canonicalRefNum !== null && (
        <p className="text-xs text-gray-500">{words.sharedOnCanonical(canonicalRefNum)}</p>
      )}
      <Textarea
        size="sm"
        label={words.field}
        rows={20}
        className="font-mono"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setProblem(null);
        }}
        readOnly={!canEdit}
        disabled={canEdit && busy}
        spellCheck={false}
        error={problem ?? undefined}
      />
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="primary"
            disabled={busy || !changed}
            onClick={() => void save()}
          >
            {busy ? words.saving : words.save}
          </Button>
          {document.edited && (
            <Button size="sm" disabled={busy} onClick={() => setDiscarding(true)}>
              {words.discard}
            </Button>
          )}
        </div>
      )}
      {discarding && (
        <ConfirmModal
          open
          title={words.discard}
          confirmLabel={words.discard}
          onClose={() => setDiscarding(false)}
          onConfirm={() => {
            setDiscarding(false);
            void discard();
          }}
        >
          <p>{words.discardConfirm}</p>
        </ConfirmModal>
      )}
    </section>
  );
}

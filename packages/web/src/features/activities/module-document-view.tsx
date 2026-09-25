/**
 * Configuration Data and Assessment Data: the module's own configuration and assessment
 * files for this ref, edited in place. An edit is kept in the draft and replaces the
 * generated document in the preview and in every assembly until it is discarded; the
 * assessment is shared by every ref, so only the canonical ref edits it.
 *
 * The assessment is also generated here, and its items are edited without JSON; the JSON
 * stays one fold away for what the items editor does not show.
 */
import { useEffect, useRef, useState } from "react";
import type {
  ActivityDraft,
  ActivityRunSummary,
  ModuleDocuments,
} from "@prismshadow/penguin-server/api";
import { apiFetch } from "../../api/client";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";
import { toneInk, toneStrip } from "../../lib/tone";
import { Button } from "../../components/ui/button";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { InfoPopover } from "../../components/ui/info-popover";
import { Textarea } from "../../components/ui/input";
import { AssessmentItemsEditor } from "./assessment-items-editor";
import { assessmentRunState, readItems } from "./assessment-items";
import {
  assessmentItemCount,
  documentChanged,
  documentOrigin,
  documentText,
  parseDocument,
  type ModuleDocumentKind,
} from "./module-document";
import { SpecDiffView } from "./spec-diff-view";

/** What the Assessment Data section needs to generate an assessment and offer the result. */
export interface AssessmentGenerationProps {
  /** This ref's number: the canonical ref is the one that may generate. */
  refNum: number;
  /** The saved specification says the activity asks an assessment. */
  usesAssessment: boolean;
  /** The activity's runs, newest first. */
  runs: readonly ActivityRunSummary[];
  /** Why a run cannot start now, or null when it can. */
  blocked: string | null;
  onGenerate: () => void;
  onAccept: (runId: string) => void;
}

export function ModuleDocumentView({
  endpoint,
  kind,
  revision,
  editable,
  onSaved,
  generation,
}: {
  endpoint: string;
  kind: ModuleDocumentKind;
  /** The draft revision: a save sends it, and a new one can mean a new assembly, so read again. */
  revision: string;
  /** Whether this viewer may change the activity at all (a project owner, with it open). */
  editable: boolean;
  /** A save or a discard changed the draft; `text` is what to announce. */
  onSaved: (draft: ActivityDraft, text: string) => void;
  /** For the assessment: generating it, and the result waiting to be used. */
  generation?: AssessmentGenerationProps;
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
  const document = documents.source ? documents[kind] : null;
  const canonical =
    documents.canonicalRefNum === null ||
    (generation !== undefined && documents.canonicalRefNum === generation.refNum);
  const generate =
    kind === "assessment" && generation && editable && canonical ? (
      <AssessmentGeneration
        endpoint={endpoint}
        revision={revision}
        current={document?.value ?? null}
        {...generation}
      />
    ) : null;
  if (!document)
    return (
      <div className="space-y-3">
        <p className="text-sm text-gray-500">
          {!documents.source ? words.none : words.missing[kind]}
        </p>
        {generate}
      </div>
    );
  const items = kind === "assessment" ? assessmentItemCount(document.value) : null;
  const canEdit = editable && document.editable;
  const changed = documentChanged(text, document.value);
  const canonicalRefNum = documents.canonicalRefNum;

  async function put(value: Record<string, unknown>): Promise<boolean> {
    setProblem(null);
    setBusy(true);
    try {
      const draft = await apiFetch<ActivityDraft>(`${endpoint}/module-documents/${kind}`, {
        method: "PUT",
        body: { value, expectedRevision: revision },
      });
      // The next read shows the document as saved.
      loaded.current = null;
      onSaved(draft, words.saved);
      return true;
    } catch (cause) {
      setProblem(apiErrorText(cause));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const parsed = parseDocument(text);
    if ("error" in parsed) {
      setProblem(parsed.error);
      return;
    }
    await put(parsed.value);
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

  const discardButton = document.edited && (
    <Button size="sm" disabled={busy} onClick={() => setDiscarding(true)}>
      {words.discard}
    </Button>
  );
  const jsonEditor = (
    <>
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
          {/* The assessment offers its discard beside the items, outside the JSON fold. */}
          {kind !== "assessment" && discardButton}
        </div>
      )}
    </>
  );

  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        {S.activities.sectionNames[kind]}
        <InfoPopover label={S.activities.sectionNames[kind]}>
          <p>{words.about[kind]}</p>
          {kind === "assessment" && <p>{S.activities.assessment.generateAbout}</p>}
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
      {generate}
      {kind === "assessment" ? (
        <>
          <AssessmentItemsEditor
            // A saved or generated document starts the items over; unsaved item edits of
            // the same document survive a re-read.
            key={documentText(document.value)}
            value={document.value}
            editable={canEdit}
            busy={busy}
            onSave={(value) => void put(value)}
          />
          {problem && <p className={`text-xs ${toneInk.danger}`}>{problem}</p>}
          {canEdit && discardButton && <div>{discardButton}</div>}
          {/* A document the items editor cannot show whole is edited as JSON, so it opens. */}
          <details className="space-y-2" open={readItems(document.value) === null || undefined}>
            <summary className="cursor-pointer text-xs font-medium">
              {S.activities.assessment.editAsJson}
            </summary>
            {jsonEditor}
          </details>
        </>
      ) : (
        jsonEditor
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

/**
 * Generate assessment, and what the last run left: still running, a result to use or keep,
 * or why it failed. Nothing changes until "Use it" is pressed.
 */
function AssessmentGeneration({
  endpoint,
  revision,
  current,
  usesAssessment,
  runs,
  blocked,
  onGenerate,
  onAccept,
}: AssessmentGenerationProps & { endpoint: string; revision: string; current: unknown }) {
  const words = S.activities.assessment;
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const latest = assessmentRunState(runs, revision, dismissed);
  const candidateRunId = latest?.state === "candidate" ? latest.run.runId : null;
  const [candidate, setCandidate] = useState<{ runId: string; value: unknown | null } | null>(null);
  useEffect(() => {
    if (!candidateRunId) return;
    let cancelled = false;
    apiFetch<{ candidate: string | null }>(
      `${endpoint}/runs/${encodeURIComponent(candidateRunId)}/candidate`,
    )
      .then((read) => {
        let value: unknown = null;
        try {
          value = read.candidate ? JSON.parse(read.candidate) : null;
        } catch {
          value = null;
        }
        if (!cancelled) setCandidate({ runId: candidateRunId, value });
      })
      .catch(() => {
        if (!cancelled) setCandidate({ runId: candidateRunId, value: null });
      });
    return () => {
      cancelled = true;
    };
  }, [endpoint, candidateRunId]);

  if (!usesAssessment) return <p className="text-xs text-gray-500">{words.unused}</p>;
  const running = latest?.state === "running";
  const shown = candidate && candidate.runId === candidateRunId ? candidate : null;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={running || blocked !== null} onClick={onGenerate}>
          {running ? words.generating : words.generate}
        </Button>
        {!running && blocked && <span className="text-xs text-gray-500">{blocked}</span>}
      </div>
      {running && (
        <p role="status" className="text-xs text-gray-500">
          {words.generating}
        </p>
      )}
      {latest?.state === "failed" && (
        <p className={`text-xs ${toneInk.danger}`}>
          {words.failed(latest.run.error ?? S.activities.status.failed)}
        </p>
      )}
      {candidateRunId && shown && (
        <section
          aria-label={words.candidateTitle}
          className="space-y-2 rounded-lg border border-gray-200 p-3 dark:border-gray-800"
        >
          <h4 className="text-xs font-semibold">{words.candidateTitle}</h4>
          {shown.value === null ? (
            <p className={`text-xs ${toneInk.danger}`}>{words.candidateUnreadable}</p>
          ) : (
            <>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                {words.current(current === null ? null : assessmentItemCount(current))} ·{" "}
                {words.candidate(assessmentItemCount(shown.value) ?? 0)}
              </p>
              <SpecDiffView
                compact
                saved={current === null ? "" : documentText(current)}
                edited={documentText(shown.value)}
              />
            </>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="primary"
              disabled={shown.value === null}
              onClick={() => onAccept(candidateRunId)}
            >
              {words.useIt}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setDismissed((set) => new Set([...set, candidateRunId]))}
            >
              {words.keepCurrent}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}

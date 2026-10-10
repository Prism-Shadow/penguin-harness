/**
 * The manual New Benchmark form: title, id, description, runs per case and a list of cases, each
 * a statement and a rubric. No Agent is chosen here — a Benchmark belongs to the Project and
 * records the Agent it tested on each evaluation instead. The server writes the on-disk layout;
 * the form keeps a first-timer on the rails — format hints stay visible while typing, and the
 * semantics (what a rubric is, why it never reaches the tested agent, what makes one
 * discriminating) sit behind the "?" marks. Mounted fresh on every open.
 *
 * Create is live once every required field of the form and of each case is filled and nothing
 * is malformed — a malformed id or run count is said under its field as it is typed. Closing
 * the form with anything typed (cases included) asks first; nothing closes it while the write
 * is in flight.
 */
import { useRef, useState } from "react";
import type { BenchmarkSummary } from "@prismshadow/penguin-server/api";
import {
  Button,
  FieldLabel,
  GlyphIcon,
  ICONS,
  ICON_SIZE,
  InfoPopover,
  Input,
  Modal,
  PlusIcon,
  Textarea,
  toastSuccess,
  useFormDraft,
  useGuardedClose,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { closeUnlessBusy } from "../../lib/busy-close";
import { toneInk } from "../../lib/tone";
import { SemanticIdField } from "../semantic-id/semantic-id-field";
import { ID_PATTERN, caseId, isValidRuns } from "./benchmark-prompts";

interface CaseDraft {
  /** Stable React key, independent of position, so removing a case keeps the others' state. */
  key: number;
  slug: string;
  title: string;
  statement: string;
  rubric: string;
}

type CaseErrors = Partial<Record<"slug" | "title" | "statement" | "rubric", string>>;

interface FormErrors {
  id?: string;
  title?: string;
  runs?: string;
  /** Keyed by CaseDraft.key, not by position: removing a case must not move another one's errors onto it. */
  cases: Record<number, CaseErrors>;
}

export interface CreateBenchmarkModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  onCreated: (benchmark: BenchmarkSummary) => void;
}

export function CreateBenchmarkModal(props: CreateBenchmarkModalProps) {
  return props.open ? <CreateBenchmarkDialog {...props} /> : null;
}

const digits = (v: string) => v.replace(/[^\d]/g, "");
/** Spreads an error message into a field only when there is one (an explicit undefined is not an absent prop). */
const errorProp = (message: string | undefined) =>
  message !== undefined ? { error: message } : {};

/** The form as typed: the Benchmark's own fields and its cases. */
interface BenchmarkDraft {
  title: string;
  id: string;
  description: string;
  runs: string;
  cases: CaseDraft[];
}

/** A draft as a create compares it: text trimmed, the cases without their React keys. */
const normalizedDraft = (d: BenchmarkDraft) => ({
  title: d.title.trim(),
  id: d.id.trim(),
  description: d.description.trim(),
  runs: d.runs,
  cases: d.cases.map((c) => ({
    slug: c.slug.trim(),
    title: c.title.trim(),
    statement: c.statement.trim(),
    rubric: c.rubric.trim(),
  })),
});

/** What is wrong with the draft, per field and per case; required-and-empty included. */
function validateDraft(d: BenchmarkDraft): FormErrors {
  const next: FormErrors = { cases: {} };
  if (d.title.trim() === "") next.title = S.common.requiredField;
  if (d.id.trim() === "") next.id = S.common.requiredField;
  else if (!ID_PATTERN.test(d.id.trim())) next.id = S.benchmark.invalidId;
  if (!isValidRuns(d.runs)) next.runs = S.benchmark.invalidRuns;
  for (const c of d.cases) {
    const e: CaseErrors = {};
    if (c.slug.trim() === "") e.slug = S.common.requiredField;
    else if (!ID_PATTERN.test(c.slug.trim())) e.slug = S.benchmark.invalidId;
    if (c.title.trim() === "") e.title = S.common.requiredField;
    if (c.statement.trim() === "") e.statement = S.common.requiredField;
    if (c.rubric.trim() === "") e.rubric = S.common.requiredField;
    next.cases[c.key] = e;
  }
  return next;
}

/** An error as a field shows it: a malformed value; an empty required field has its asterisk. */
const shownError = (message: string | undefined) =>
  message === S.common.requiredField ? undefined : message;

function CreateBenchmarkDialog({ onClose, projectId, onCreated }: CreateBenchmarkModalProps) {
  const keyRef = useRef(0);
  const newCase = (): CaseDraft => ({
    key: keyRef.current++,
    slug: "",
    title: "",
    statement: "",
    rubric: "",
  });
  // The blank form, built once: a new case takes the next stable key.
  const [opening] = useState<BenchmarkDraft>(() => ({
    title: "",
    id: "",
    description: "",
    runs: "1",
    cases: [newCase()],
  }));
  const form = useFormDraft(opening, { normalize: normalizedDraft });
  const { title, id, description, runs, cases } = form.draft;
  /** The id the server refused as taken; cleared by the next edit of the id. */
  const [idTaken, setIdTaken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const requestClose = useGuardedClose(...closeUnlessBusy(busy, onClose, form.scope));

  const updateCase = (key: number, patch: Partial<CaseDraft>) =>
    form.setDraft((prev) => ({
      ...prev,
      cases: prev.cases.map((c) => (c.key === key ? { ...c, ...patch } : c)),
    }));
  const setCases = (next: (prev: CaseDraft[]) => CaseDraft[]) =>
    form.setDraft((prev) => ({ ...prev, cases: next(prev.cases) }));

  const errors = validateDraft(form.draft);
  const valid =
    errors.id === undefined &&
    errors.title === undefined &&
    errors.runs === undefined &&
    Object.values(errors.cases).every((c) => Object.keys(c).length === 0);

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setSubmitError(null);
    try {
      const trimmedDescription = description.trim();
      const res = await api.createBenchmark(projectId, {
        id: id.trim(),
        title: title.trim(),
        ...(trimmedDescription !== "" ? { description: trimmedDescription } : {}),
        runs: Number.parseInt(runs, 10),
        cases: cases.map((c, i) => ({
          id: caseId(i + 1, c.slug.trim()),
          title: c.title.trim(),
          statement: c.statement,
          rubric: c.rubric,
        })),
      });
      toastSuccess(S.benchmark.created);
      onCreated(res.benchmark);
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setIdTaken(true);
      } else {
        setSubmitError(apiErrorText(e));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title={S.benchmark.manualCreateTitle}
      onClose={requestClose}
      widthClass="sm:max-w-2xl"
      footer={
        <>
          <Button size="sm" onClick={requestClose} disabled={busy}>
            {S.common.cancel}
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={busy || !valid}
            onClick={() => void submit()}
          >
            {busy ? S.common.saving : S.benchmark.createSubmit}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-300">{S.benchmark.manualCreateIntro}</p>
        {/* The title comes first and the id is derived from it on request — by the model, so
            a Chinese title gets English words — never rewritten while the title is typed. */}
        <Input
          label={S.benchmark.titleField}
          required
          value={title}
          onChange={(e) => form.patch({ title: e.target.value })}
          {...errorProp(shownError(errors.title))}
        />
        <SemanticIdField
          projectId={projectId}
          kind="benchmark"
          label={S.benchmark.idField}
          hint={S.benchmark.idHint}
          generateHint={S.benchmark.idGenerateHint}
          value={id}
          source={title.trim() || description}
          error={idTaken ? S.benchmark.idExists : shownError(errors.id)}
          disabled={busy}
          onChange={(next) => {
            form.patch({ id: next });
            setIdTaken(false);
          }}
        />
        <Textarea
          label={S.benchmark.descriptionField}
          hint={S.benchmark.descriptionHint}
          rows={2}
          value={description}
          onChange={(e) => form.patch({ description: e.target.value })}
        />
        <Input
          label={S.benchmark.runsField}
          hint={S.benchmark.runsHint}
          info={S.benchmark.runsInfo}
          infoLabel={S.benchmark.runsField}
          inputMode="numeric"
          value={runs}
          onChange={(e) => form.patch({ runs: digits(e.target.value) })}
          {...errorProp(shownError(errors.runs))}
        />

        <div>
          <div className="mb-2 flex items-center gap-1">
            <FieldLabel block={false}>{S.benchmark.casesTitle}</FieldLabel>
            <InfoPopover label={S.benchmark.casesTitle}>{S.benchmark.casesInfo}</InfoPopover>
          </div>
          <div className="space-y-3">
            {cases.map((c, i) => {
              const e = errors.cases[c.key] ?? {};
              const dirName = caseId(i + 1, c.slug.trim() || "<slug>");
              return (
                <div
                  key={c.key}
                  className="rounded-md border border-gray-200 p-3 dark:border-gray-800"
                >
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">
                      {S.benchmark.caseHeading(i + 1)}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-gray-400">
                      {dirName}
                    </span>
                    {cases.length > 1 && (
                      <Button
                        size="icon"
                        variant="ghost"
                        title={S.benchmark.removeCase}
                        aria-label={S.benchmark.removeCase}
                        onClick={() => setCases((prev) => prev.filter((x) => x.key !== c.key))}
                      >
                        <GlyphIcon d={ICONS.trash} size={ICON_SIZE.iconButton} />
                      </Button>
                    )}
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Input
                      size="sm"
                      label={S.benchmark.caseSlugField}
                      required
                      hint={S.benchmark.caseSlugHint(dirName)}
                      value={c.slug}
                      className="font-mono"
                      onChange={(event) => updateCase(c.key, { slug: event.target.value })}
                      {...errorProp(shownError(e.slug))}
                    />
                    <Input
                      size="sm"
                      label={S.benchmark.caseTitleField}
                      required
                      value={c.title}
                      onChange={(event) => updateCase(c.key, { title: event.target.value })}
                      {...errorProp(shownError(e.title))}
                    />
                  </div>
                  <div className="mt-3">
                    <Textarea
                      size="sm"
                      label={S.benchmark.caseStatementField}
                      required
                      hint={S.benchmark.caseStatementHint}
                      rows={4}
                      value={c.statement}
                      onChange={(event) => updateCase(c.key, { statement: event.target.value })}
                      {...errorProp(shownError(e.statement))}
                    />
                  </div>
                  <div className="mt-3">
                    <Textarea
                      size="sm"
                      label={S.benchmark.caseRubricField}
                      required
                      hint={S.benchmark.caseRubricHint}
                      info={S.benchmark.rubricInfo}
                      infoLabel={S.benchmark.caseRubricField}
                      rows={4}
                      value={c.rubric}
                      onChange={(event) => updateCase(c.key, { rubric: event.target.value })}
                      {...errorProp(shownError(e.rubric))}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <Button
            size="sm"
            className="mt-2"
            onClick={() => setCases((prev) => [...prev, newCase()])}
          >
            <PlusIcon />
            {S.benchmark.addCase}
          </Button>
        </div>
        {submitError !== null && <p className={`text-xs ${toneInk.danger}`}>{submitError}</p>}
      </div>
    </Modal>
  );
}

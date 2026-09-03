/**
 * The manual New Benchmark form: the Agent it tests, title, id, description, runs per case and
 * a list of cases, each a statement and a rubric. The server writes the on-disk layout; the
 * form keeps a first-timer on the rails — format hints stay visible while typing, and the
 * semantics (what a rubric is, why it never reaches the Test Agent, what makes one
 * discriminating) sit behind the "?" marks. Mounted fresh on every open.
 */
import { useRef, useState } from "react";
import type { AgentSummary, BenchmarkSummary } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { ICON_SIZE } from "../../lib/icon-scale";
import { toneInk } from "../../lib/tone";
import { agentDisplayName } from "../../state/project";
import { Button } from "../../components/ui/button";
import { FieldLabel } from "../../components/ui/field";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { PlusIcon } from "../../components/ui/icons";
import { InfoPopover } from "../../components/ui/info-popover";
import { Input, Textarea } from "../../components/ui/input";
import { Modal } from "../../components/ui/modal";
import { Select } from "../../components/ui/select";
import { TRASH_ICON } from "../../components/ui/session-row-menu";
import { toastSuccess } from "../../components/ui/toast";
import { pickDefaultAgent } from "../ai-create";
import { ID_PATTERN, caseId, isValidRuns, slugFromTitle } from "./benchmark-prompts";

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
  agentId?: string;
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
  agents: readonly AgentSummary[];
  /** The Agent preselected as the Benchmark's owner; null falls back to the Project's default agent. */
  initialAgentId: string | null;
  onCreated: (agentId: string, benchmark: BenchmarkSummary) => void;
}

export function CreateBenchmarkModal(props: CreateBenchmarkModalProps) {
  return props.open ? <CreateBenchmarkDialog {...props} /> : null;
}

const digits = (v: string) => v.replace(/[^\d]/g, "");
/** Spreads an error message into a field only when there is one (an explicit undefined is not an absent prop). */
const errorProp = (message: string | undefined) =>
  message !== undefined ? { error: message } : {};

function CreateBenchmarkDialog({
  onClose,
  projectId,
  agents,
  initialAgentId,
  onCreated,
}: CreateBenchmarkModalProps) {
  const keyRef = useRef(0);
  const newCase = (): CaseDraft => ({
    key: keyRef.current++,
    slug: "",
    title: "",
    statement: "",
    rubric: "",
  });
  const [agentId, setAgentId] = useState(initialAgentId ?? pickDefaultAgent(agents)?.agentId ?? "");
  const [title, setTitle] = useState("");
  const [id, setId] = useState("");
  // The id follows the title until it is edited by hand.
  const [idTouched, setIdTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [runs, setRuns] = useState("1");
  const [cases, setCases] = useState<CaseDraft[]>(() => [newCase()]);
  const [errors, setErrors] = useState<FormErrors>({ cases: {} });
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const updateCase = (key: number, patch: Partial<CaseDraft>) =>
    setCases((prev) => prev.map((c) => (c.key === key ? { ...c, ...patch } : c)));

  const validate = (): FormErrors => {
    const next: FormErrors = { cases: {} };
    if (agentId === "") next.agentId = S.common.requiredField;
    if (title.trim() === "") next.title = S.common.requiredField;
    if (id.trim() === "") next.id = S.common.requiredField;
    else if (!ID_PATTERN.test(id.trim())) next.id = S.benchmark.invalidId;
    if (!isValidRuns(runs)) next.runs = S.benchmark.invalidRuns;
    for (const c of cases) {
      const e: CaseErrors = {};
      if (c.slug.trim() === "") e.slug = S.common.requiredField;
      else if (!ID_PATTERN.test(c.slug.trim())) e.slug = S.benchmark.invalidId;
      if (c.title.trim() === "") e.title = S.common.requiredField;
      if (c.statement.trim() === "") e.statement = S.common.requiredField;
      if (c.rubric.trim() === "") e.rubric = S.common.requiredField;
      next.cases[c.key] = e;
    }
    return next;
  };
  const hasErrors = (e: FormErrors) =>
    e.agentId !== undefined ||
    e.id !== undefined ||
    e.title !== undefined ||
    e.runs !== undefined ||
    Object.values(e.cases).some((c) => Object.keys(c).length > 0);

  const submit = async () => {
    const next = validate();
    setErrors(next);
    if (hasErrors(next)) return;
    setBusy(true);
    setSubmitError(null);
    try {
      const trimmedDescription = description.trim();
      const res = await api.createBenchmark(projectId, agentId, {
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
      onCreated(agentId, res.benchmark);
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setErrors((prev) => ({ ...prev, id: S.benchmark.idExists }));
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
      onClose={onClose}
      widthClass="sm:max-w-2xl"
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {S.common.cancel}
          </Button>
          <Button variant="primary" disabled={busy} onClick={() => void submit()}>
            {busy ? S.common.saving : S.benchmark.createSubmit}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-300">{S.benchmark.manualCreateIntro}</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select
            label={S.benchmark.agentField}
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            {...errorProp(errors.agentId)}
          >
            {agents.map((a) => (
              <option key={a.agentId} value={a.agentId}>
                {agentDisplayName(a)}
              </option>
            ))}
          </Select>
          <Input
            label={S.benchmark.runsField}
            hint={S.benchmark.runsHint}
            info={S.benchmark.runsInfo}
            infoLabel={S.benchmark.runsField}
            inputMode="numeric"
            value={runs}
            onChange={(e) => setRuns(digits(e.target.value))}
            {...errorProp(errors.runs)}
          />
        </div>
        <Input
          label={S.benchmark.titleField}
          required
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            if (!idTouched) setId(slugFromTitle(e.target.value));
          }}
          {...errorProp(errors.title)}
        />
        <Input
          label={S.benchmark.idField}
          hint={S.benchmark.idHint}
          required
          value={id}
          className="font-mono"
          onChange={(e) => {
            setIdTouched(true);
            setId(e.target.value);
          }}
          {...errorProp(errors.id)}
        />
        <Textarea
          label={S.benchmark.descriptionField}
          hint={S.benchmark.descriptionHint}
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
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
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-gray-400">
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
                        <GlyphIcon d={TRASH_ICON} size={ICON_SIZE.iconButton} />
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
                      {...errorProp(e.slug)}
                    />
                    <Input
                      size="sm"
                      label={S.benchmark.caseTitleField}
                      required
                      value={c.title}
                      onChange={(event) => updateCase(c.key, { title: event.target.value })}
                      {...errorProp(e.title)}
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
                      {...errorProp(e.statement)}
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
                      {...errorProp(e.rubric)}
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

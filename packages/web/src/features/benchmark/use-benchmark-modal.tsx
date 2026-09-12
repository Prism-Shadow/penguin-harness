/**
 * Use one Benchmark: the single dialog behind the "Use" button on a card and on the Benchmark's
 * own page. A segmented control at the top picks what to use it for — Evaluate, which puts an
 * agent on the frozen cases and appends one labelled evaluation to the scoreboard, or Optimize,
 * which improves an agent against those scores. Both tabs are forms over a fixed parameter tail
 * for their Skill, both preview the assembled prompt, and both leave the same way: the prompt is
 * prefilled into a new conversation with the agent that will carry the work out, and pressing
 * Send stays the user's move. A Benchmark can score several agents, so which one is under test
 * is a choice here; the baseline and the default target follow that choice. The evaluation
 * runtime is never picked in this dialog — Evaluate takes the tested agent's own configured
 * model and thinking level, and Optimize reuses what that agent's baseline recorded, so scores
 * stay comparable. Mounted fresh per Benchmark.
 */
import { useEffect, useState } from "react";
import type {
  AgentSummary,
  BenchmarkSummary,
  ModelRefDto,
  ModelsResponse,
} from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { formatScore } from "../../lib/format";
import { toneStrip } from "../../lib/tone";
import { agentDisplayName, useProject } from "../../state/project";
import { Button } from "../../components/ui/button";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { MAGIC_WAND_ICON } from "../../components/ui/icons";
import { Input, Textarea } from "../../components/ui/input";
import { Modal } from "../../components/ui/modal";
import { Segmented } from "../../components/ui/segmented";
import { Select } from "../../components/ui/select";
import { PromptFold, composeAiPrompt, pickDefaultAgent, useAiBridge } from "../ai-create";
import { defaultTargetScore, latestScoreOfAgent } from "./benchmark-metrics";
import { MAX_RUNS, evaluateTail, optimizeTail } from "./benchmark-prompts";
import type { EvaluateParams, OptimizeParams } from "./benchmark-prompts";

/** The Skill the evaluator agent must carry; the dialog warns when the chosen agent lacks it. */
const EVALUATION_SKILL = "agent-evaluation";
/** The Skill the optimizer agent must carry; the dialog warns when the chosen agent lacks it. */
const OPTIMIZATION_SKILL = "agent-optimization";

/** Which half of the dialog is on screen. */
export type UseTab = "evaluate" | "optimize";

/** In-dialog key of a paired model reference; never persisted. */
const modelKey = (m: ModelRefDto) => `${m.provider} ${m.modelId}`;
const digits = (v: string) => v.replace(/[^\d]/g, "");
const errorProp = (message: string | undefined) =>
  message !== undefined ? { error: message } : {};

/** A digits-only field as an integer within [min, max], or null when it is empty or out of range. */
function intIn(raw: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : null;
}

export function UseBenchmarkModal({
  open,
  onClose,
  projectId,
  benchmark,
  agents,
  models,
  initialTab = "evaluate",
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  benchmark: BenchmarkSummary;
  agents: readonly AgentSummary[];
  /** The Project's models, for each tab's conversation-model picker; null while unknown. */
  models: ModelsResponse | null;
  /** Which tab opens first; the other is one click away. */
  initialTab?: UseTab;
}) {
  const { openAiChat } = useAiBridge();
  const { currentAgent } = useProject();
  const [tab, setTab] = useState<UseTab>(initialTab);
  // Who was tested last here is the likeliest subject of the next round; with no evaluation at
  // all, the Agent the user came from, and failing that the Project's default. Both tabs act on
  // the same tested agent, so the pick survives a tab switch.
  const lastTested =
    [...benchmark.evaluations].reverse().find((e) => (e.agentId ?? "") !== "")?.agentId ?? null;
  const [testAgentId, setTestAgentId] = useState(
    lastTested ?? currentAgent?.agentId ?? pickDefaultAgent(agents)?.agentId ?? "",
  );
  const baseline = latestScoreOfAgent(benchmark.evaluations, testAgentId);
  const defaultTarget = defaultTargetScore(baseline?.score ?? null);
  const [evaluatorId, setEvaluatorId] = useState<string | null>(
    pickDefaultAgent(agents)?.agentId ?? null,
  );
  const [optimizerId, setOptimizerId] = useState<string | null>(
    pickDefaultAgent(agents)?.agentId ?? null,
  );
  // "" is the Project default model; otherwise a modelKey of one of the Project's models.
  const [model, setModel] = useState("");
  // Clamped: benchmark_config.toml is hand-editable, and a larger count there would open the
  // dialog on a field its own bound rejects, with Send disabled until the number is retyped.
  const [runs, setRuns] = useState(String(Math.min(benchmark.runs ?? 1, MAX_RUNS)));
  const [note, setNote] = useState("");
  const [roundLimit, setRoundLimit] = useState("3");
  const [targetScore, setTargetScore] = useState(String(defaultTarget));
  /** The target follows the tested agent's baseline until the field is edited by hand. */
  const [targetTouched, setTargetTouched] = useState(false);
  const [focus, setFocus] = useState("");
  const [skillsByAgent, setSkillsByAgent] = useState<Record<string, string[]>>({});

  // The installed Skills of the agents that could carry the work out, fetched once per agent,
  // for the missing-skill hint. A failed fetch leaves the hint off: the send still goes through.
  // Each result is stored under the agent it was fetched for, so it stays wanted even when the
  // pick moved on meanwhile — dropping it would only make switching away and back refetch.
  useEffect(() => {
    for (const id of [evaluatorId, optimizerId]) {
      if (id === null || skillsByAgent[id] !== undefined) continue;
      api
        .getAgentSkills(projectId, id)
        .then((res) =>
          setSkillsByAgent((prev) => ({ ...prev, [id]: res.skills.map((s) => s.name) })),
        )
        .catch(() => {});
    }
  }, [projectId, evaluatorId, optimizerId, skillsByAgent]);

  useEffect(() => {
    if (!targetTouched) setTargetScore(String(defaultTarget));
  }, [defaultTarget, targetTouched]);

  const lacksSkill = (agentId: string | null, skill: string): boolean => {
    const installed = agentId === null ? undefined : skillsByAgent[agentId];
    return installed !== undefined && !installed.includes(skill);
  };
  const evaluatorMissingSkill = lacksSkill(evaluatorId, EVALUATION_SKILL);
  const optimizerMissingSkill = lacksSkill(optimizerId, OPTIMIZATION_SKILL);

  const runsValue = intIn(runs, 1, MAX_RUNS);
  const roundsValue = intIn(roundLimit, 1, MAX_RUNS);
  const targetValue = intIn(targetScore, 1, 100);
  const evaluateParams: EvaluateParams = {
    targetAgentId: testAgentId,
    benchmarkId: benchmark.id,
    runs: runsValue ?? benchmark.runs ?? 1,
  };
  const optimizeParams: OptimizeParams = {
    ...evaluateParams,
    roundLimit: roundsValue ?? 3,
    targetScore: targetValue ?? defaultTarget,
  };
  const text =
    tab === "evaluate"
      ? composeAiPrompt(note, evaluateTail(evaluateParams))
      : composeAiPrompt(focus, optimizeTail(optimizeParams));
  const runnerId = tab === "evaluate" ? evaluatorId : optimizerId;
  const ready =
    runnerId !== null &&
    testAgentId !== "" &&
    runsValue !== null &&
    (tab === "evaluate" || (roundsValue !== null && targetValue !== null));

  const pickedModel = (): ModelRefDto | undefined => {
    if (model === "") return models?.defaultModel;
    const found = models?.models.find((m) => modelKey(m) === model);
    return found ? { provider: found.provider, modelId: found.modelId } : undefined;
  };
  const go = () => {
    if (runnerId === null) return;
    const ref = pickedModel();
    openAiChat({
      agentId: runnerId,
      text,
      ...(ref !== undefined ? { modelRef: ref } : {}),
    });
    onClose();
  };

  const defaultModel = models?.defaultModel;
  const defaultModelName =
    defaultModel === undefined
      ? null
      : (models?.models.find((m) => modelKey(m) === modelKey(defaultModel))?.displayName ??
        defaultModel.modelId);
  const agentOptions = agents.map((a) => (
    <option key={a.agentId} value={a.agentId}>
      {agentDisplayName(a)}
    </option>
  ));
  const modelOptions = (
    <>
      <option value="">
        {defaultModelName !== null
          ? S.benchmark.projectDefaultModel(defaultModelName)
          : S.benchmark.projectDefaultModelUnset}
      </option>
      {models?.models.map((m) => (
        <option key={modelKey(m)} value={modelKey(m)}>
          {m.displayName ?? m.modelId}
        </option>
      ))}
    </>
  );
  const missingSkillStrip = (missing: boolean, message: string) =>
    missing ? (
      <div className={`rounded-md border px-3 py-2 text-xs ${toneStrip.attention}`}>{message}</div>
    ) : null;
  const testedAgentSelect = (hint: string) => (
    <Select
      label={S.benchmark.testedAgent}
      hint={hint}
      value={testAgentId}
      onChange={(e) => setTestAgentId(e.target.value)}
    >
      {agentOptions}
    </Select>
  );
  const runsInput = (hint: string) => (
    <Input
      label={S.benchmark.runsField}
      hint={hint}
      inputMode="numeric"
      value={runs}
      onChange={(e) => setRuns(digits(e.target.value))}
      {...errorProp(runsValue === null ? S.benchmark.invalidRuns : undefined)}
    />
  );

  return (
    <Modal
      open={open}
      title={S.benchmark.useTitle(benchmark.title)}
      onClose={onClose}
      widthClass="sm:max-w-2xl"
      footer={
        <>
          <Button size="sm" onClick={onClose}>
            {S.common.cancel}
          </Button>
          {/*
            One exit for both tabs, and it hands the assembled prompt to a new conversation
            instead of sending it: the work starts only when the user presses Send there, on
            text they have read. Disabled until there is an agent to carry it out and every
            parameter of the open tab is in range.
          */}
          <Button size="sm" variant="primary" disabled={!ready} onClick={go}>
            <GlyphIcon d={MAGIC_WAND_ICON} />
            {S.aiCreate.editInChat}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Segmented
          cols={2}
          value={tab}
          onChange={setTab}
          options={[
            { value: "evaluate" as UseTab, label: S.benchmark.evaluate },
            { value: "optimize" as UseTab, label: S.benchmark.optimize },
          ]}
        />
        {tab === "evaluate" ? (
          <>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              {S.benchmark.evaluateDescription}
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {testedAgentSelect(S.benchmark.evaluateTestedAgentHint)}
              <Select
                label={S.benchmark.evaluatorAgent}
                hint={S.benchmark.evaluatorAgentHint}
                value={evaluatorId ?? ""}
                onChange={(e) => setEvaluatorId(e.target.value)}
              >
                {agentOptions}
              </Select>
              <Select
                label={S.benchmark.evaluateSessionModel}
                hint={S.benchmark.evaluateSessionModelHint}
                value={model}
                onChange={(e) => setModel(e.target.value)}
              >
                {modelOptions}
              </Select>
              {runsInput(S.benchmark.evaluateRunsHint)}
            </div>
            {missingSkillStrip(evaluatorMissingSkill, S.benchmark.evaluatorMissingSkill)}
            <Textarea
              label={S.benchmark.evaluateNoteField}
              placeholder={S.benchmark.evaluateNotePlaceholder}
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <PromptFold text={text} />
          </>
        ) : (
          <>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              {S.benchmark.optimizeDescription}
            </p>
            {baseline === null ? (
              <div className={`rounded-md border px-3 py-2 text-xs ${toneStrip.attention}`}>
                {S.benchmark.noBaseline}
              </div>
            ) : (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {S.benchmark.baselineLine(formatScore(baseline.score), optimizeParams.targetScore)}
              </p>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {testedAgentSelect(S.benchmark.testedAgentHint)}
              <Select
                label={S.benchmark.optimizerAgent}
                hint={S.benchmark.optimizerAgentHint}
                value={optimizerId ?? ""}
                onChange={(e) => setOptimizerId(e.target.value)}
              >
                {agentOptions}
              </Select>
              <Select
                label={S.benchmark.sessionModel}
                hint={S.benchmark.sessionModelHint}
                value={model}
                onChange={(e) => setModel(e.target.value)}
              >
                {modelOptions}
              </Select>
            </div>
            {missingSkillStrip(optimizerMissingSkill, S.benchmark.optimizerMissingSkill)}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {runsInput(S.benchmark.optimizeRunsHint)}
              <Input
                label={S.benchmark.roundLimitField}
                hint={S.benchmark.roundLimitHint}
                inputMode="numeric"
                value={roundLimit}
                onChange={(e) => setRoundLimit(digits(e.target.value))}
                {...errorProp(roundsValue === null ? S.benchmark.invalidRuns : undefined)}
              />
              <Input
                label={S.benchmark.targetScoreField}
                hint={S.benchmark.targetScoreHint}
                inputMode="numeric"
                value={targetScore}
                onChange={(e) => {
                  setTargetTouched(true);
                  setTargetScore(digits(e.target.value));
                }}
                {...errorProp(targetValue === null ? S.benchmark.invalidScore : undefined)}
              />
            </div>
            <Textarea
              label={S.benchmark.focusField}
              placeholder={S.benchmark.focusPlaceholder}
              rows={3}
              value={focus}
              onChange={(e) => setFocus(e.target.value)}
            />
            <PromptFold text={text} />
          </>
        )}
      </div>
    </Modal>
  );
}

/**
 * Optimize one Benchmark: the dialog that hands the `agent-optimization` Skill its inputs.
 * Two ways to fill them — a form (the optimizer agent, its conversation's model, runs per case,
 * round limit, target score, an optional focus) or a free prompt over the same parameter tail —
 * and one way out: the kit's send / edit-in-chat footer, which opens a new conversation with
 * the optimizer agent. The evaluation runtime is not chosen here: the Skill reuses the
 * provider, model and thinking level the baseline recorded, so scores stay comparable. Mounted
 * fresh per Benchmark by the page.
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
import { toneInk, toneStrip } from "../../lib/tone";
import { agentDisplayName } from "../../state/project";
import { Button } from "../../components/ui/button";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { MAGIC_WAND_ICON } from "../../components/ui/icons";
import { Input, Textarea } from "../../components/ui/input";
import { Modal } from "../../components/ui/modal";
import { Segmented } from "../../components/ui/segmented";
import { Select } from "../../components/ui/select";
import {
  AiCreatePanel,
  PromptFold,
  composeAiPrompt,
  pickDefaultAgent,
  useAiBridge,
} from "../ai-create";
import { defaultTargetScore, latestScore } from "./benchmark-metrics";
import { MAX_RUNS, optimizeExamples, optimizeTail } from "./benchmark-prompts";
import type { OptimizeParams } from "./benchmark-prompts";

/** The Skill the optimizer agent must carry; the dialog warns when the chosen agent lacks it. */
const OPTIMIZATION_SKILL = "agent-optimization";

type Mode = "manual" | "prompt";

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

export function OptimizeModal({
  open,
  onClose,
  projectId,
  agentId,
  benchmark,
  agents,
  models,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  /** The Test Agent: the one the Benchmark belongs to and the one the optimizer edits. */
  agentId: string;
  benchmark: BenchmarkSummary;
  agents: readonly AgentSummary[];
  /** The Project's models, for the optimizer conversation's model picker; null while unknown. */
  models: ModelsResponse | null;
}) {
  const { openAiChat } = useAiBridge();
  const target = agents.find((a) => a.agentId === agentId) ?? null;
  const baseline = latestScore(benchmark.evaluations);
  const defaultTarget = defaultTargetScore(baseline?.score ?? null);
  const [mode, setMode] = useState<Mode>("manual");
  const [optimizerId, setOptimizerId] = useState<string | null>(
    pickDefaultAgent(agents)?.agentId ?? null,
  );
  // "" is the Project default model; otherwise a modelKey of one of the Project's models.
  const [model, setModel] = useState("");
  // Clamped: benchmark_config.toml is hand-editable, and a larger count there would open the
  // dialog on a field its own bound rejects, with Send disabled until the number is retyped.
  const [runs, setRuns] = useState(String(Math.min(benchmark.runs ?? 1, MAX_RUNS)));
  const [roundLimit, setRoundLimit] = useState("3");
  const [targetScore, setTargetScore] = useState(String(defaultTarget));
  const [focus, setFocus] = useState("");
  const [draft, setDraft] = useState("");
  const [skillsByAgent, setSkillsByAgent] = useState<Record<string, string[]>>({});

  // The optimizer's installed Skills, fetched once per agent, for the missing-skill hint. A
  // failed fetch leaves the hint off: the send still goes through. The result is stored under
  // the agent it was fetched for, so it stays wanted even when the pick moved on meanwhile —
  // dropping it would only make switching away and back refetch.
  useEffect(() => {
    if (optimizerId === null || skillsByAgent[optimizerId] !== undefined) return;
    const id = optimizerId;
    api
      .getAgentSkills(projectId, id)
      .then((res) => setSkillsByAgent((prev) => ({ ...prev, [id]: res.skills.map((s) => s.name) })))
      .catch(() => {});
  }, [projectId, optimizerId, skillsByAgent]);

  const installed = optimizerId === null ? undefined : skillsByAgent[optimizerId];
  const missingSkill = installed !== undefined && !installed.includes(OPTIMIZATION_SKILL);

  const runsValue = intIn(runs, 1, MAX_RUNS);
  const roundsValue = intIn(roundLimit, 1, MAX_RUNS);
  const targetValue = intIn(targetScore, 1, 100);
  const valid = runsValue !== null && roundsValue !== null && targetValue !== null;
  const params: OptimizeParams = {
    targetAgentId: agentId,
    benchmarkId: benchmark.id,
    runs: runsValue ?? benchmark.runs ?? 1,
    roundLimit: roundsValue ?? 3,
    targetScore: targetValue ?? defaultTarget,
  };
  const tail = optimizeTail(params);
  const text = composeAiPrompt(mode === "manual" ? focus : draft, tail);
  const ready = optimizerId !== null && valid && (mode === "manual" || draft.trim() !== "");

  const pickedModel = (): ModelRefDto | undefined => {
    if (model === "") return models?.defaultModel;
    const found = models?.models.find((m) => modelKey(m) === model);
    return found ? { provider: found.provider, modelId: found.modelId } : undefined;
  };
  const go = (autoSend: boolean) => {
    if (optimizerId === null) return;
    const ref = pickedModel();
    openAiChat({
      agentId: optimizerId,
      text,
      ...(ref !== undefined ? { modelRef: ref } : {}),
      autoSend,
    });
    onClose();
  };

  const defaultModel = models?.defaultModel;
  const defaultModelName =
    defaultModel === undefined
      ? null
      : (models?.models.find((m) => modelKey(m) === modelKey(defaultModel))?.displayName ??
        defaultModel.modelId);
  const missingSkillStrip = missingSkill ? (
    <div className={`rounded-md border px-3 py-2 text-xs ${toneStrip.attention}`}>
      {S.benchmark.optimizerMissingSkill}
    </div>
  ) : null;

  return (
    <Modal
      open={open}
      title={S.benchmark.optimizeTitle(benchmark.title)}
      onClose={onClose}
      widthClass="sm:max-w-2xl"
      footer={
        <>
          <Button onClick={onClose}>{S.common.cancel}</Button>
          <Button disabled={!ready} onClick={() => go(false)}>
            {S.aiCreate.editInChat}
          </Button>
          <Button variant="primary" disabled={!ready} onClick={() => go(true)}>
            <GlyphIcon d={MAGIC_WAND_ICON} />
            {S.aiCreate.send}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {S.benchmark.optimizeDescription}
        </p>
        {baseline === null ? (
          <div className={`rounded-md border px-3 py-2 text-xs ${toneStrip.attention}`}>
            {S.benchmark.noBaseline}
          </div>
        ) : (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {S.benchmark.baselineLine(formatScore(baseline.score), params.targetScore)}
          </p>
        )}
        <div className="w-64">
          <Segmented
            cols={2}
            options={[
              { value: "manual", label: S.benchmark.modeManual },
              { value: "prompt", label: S.benchmark.modePrompt },
            ]}
            value={mode}
            onChange={setMode}
          />
        </div>

        {mode === "manual" ? (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Select
                label={S.benchmark.optimizerAgent}
                hint={S.benchmark.optimizerAgentHint}
                value={optimizerId ?? ""}
                onChange={(e) => setOptimizerId(e.target.value)}
              >
                {agents.map((a) => (
                  <option key={a.agentId} value={a.agentId}>
                    {agentDisplayName(a)}
                  </option>
                ))}
              </Select>
              <Select
                label={S.benchmark.sessionModel}
                hint={S.benchmark.sessionModelHint}
                value={model}
                onChange={(e) => setModel(e.target.value)}
              >
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
              </Select>
            </div>
            {missingSkillStrip}
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {S.benchmark.targetAgentFixed(target ? agentDisplayName(target) : agentId)}
              <span className="ml-1.5 font-mono text-gray-400 dark:text-gray-500">{agentId}</span>
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Input
                label={S.benchmark.runsField}
                hint={S.benchmark.optimizeRunsHint}
                inputMode="numeric"
                value={runs}
                onChange={(e) => setRuns(digits(e.target.value))}
                {...errorProp(runsValue === null ? S.benchmark.invalidRuns : undefined)}
              />
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
                onChange={(e) => setTargetScore(digits(e.target.value))}
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
        ) : (
          <AiCreatePanel
            value={draft}
            onChange={setDraft}
            placeholder={S.benchmark.focusPlaceholder}
            examples={optimizeExamples()}
            tail={tail}
            agents={agents}
            agentId={optimizerId}
            onAgentChange={setOptimizerId}
            allowAgentChoice
            intro={
              missingSkill ? (
                <span className={toneInk.attention}>{S.benchmark.optimizerMissingSkill}</span>
              ) : undefined
            }
          />
        )}
      </div>
    </Modal>
  );
}

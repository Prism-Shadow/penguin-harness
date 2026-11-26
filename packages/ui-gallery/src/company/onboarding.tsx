/**
 * Setting a company up, as a conversation with its lead: there is no form wizard. The lead, who
 * knows the product, opens with what it found on the reader's machines and a few starter cards;
 * a template exported from another company skips straight to the plan.
 *
 * The reader picks a starter or says what they want, and the lead asks three questions in an
 * A2UI form, the same block a reply in a conversation draws. From the answers it drafts a plan:
 * the team at its fewest hands, the state machine and who holds each status, the hard gates the
 * server keeps, how outward actions are approved, what wakes it, the workbench each kind of work
 * is accepted in, and the first tickets, with the boundaries worth knowing before it starts.
 * Anything in the plan can still be changed; nothing exists until "Confirm and create".
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { parseFormFill } from "@prismshadow/a2ui";
import type { A2uiForm } from "@prismshadow/a2ui";
import {
  A2uiActionsProvider,
  A2uiBlock,
  Button,
  Card,
  Checkbox,
  GlyphIcon,
  ICONS,
  MessageBubble,
  NAV_FILL,
  Pill,
  Segmented,
  Select,
  Switch,
  Textarea,
} from "@prismshadow/penguin-ui";
import type { A2uiActions } from "@prismshadow/penguin-ui";
import { useLocale } from "../../../web/src/state/locale";
import {
  DETECTED,
  MEMBERS,
  MODEL_NAME,
  MODELS,
  SCENARIO_WORK,
  SCENARIOS,
  STARTERS,
} from "./fixtures";
import type { ExecutorId, MemberId, ModelId, Scenario } from "./fixtures";
import { hiresFor } from "./model";
import type { Setup, TourItem } from "./model";
import { PersonAvatar, PersonName } from "./people";
import {
  DEFAULT_GRADES,
  DELEGATION_DEPTH,
  MAIN_LINE,
  HOLDER,
  OUTWARD_ACTIONS,
  WORKBENCHES,
} from "./spec";
import type { Workbench } from "./spec";
import { useWords } from "./use-words";

type Phase = "welcome" | "questions" | "plan" | "created";

const BUDGETS = [2, 5, 10] as const;
const ROUNDS = [1, 2, 3] as const;

function LeadSays({ children }: { children: ReactNode }) {
  const W = useWords();
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 shrink-0">
        <PersonAvatar id="lead" size={24} />
      </span>
      <div className="min-w-0 flex-1 space-y-3 text-sm leading-relaxed text-fg">
        <p className="text-xs text-fg-muted">
          {W.species.emperor} · {W.roles.lead.title}
        </p>
        {children}
      </div>
    </div>
  );
}

function PersonSays({ children }: { children: ReactNode }) {
  return (
    <div className="flex justify-end">
      <MessageBubble variant="user">{children}</MessageBubble>
    </div>
  );
}

/** Guesses the scenario a request in the reader's own words is closest to. */
function scenarioOf(text: string): Scenario {
  if (/合同|账|发票|客户|contract|invoice|account|customer/i.test(text)) return "business";
  if (/实验|评测|论文|模型|experiment|evaluat|paper|model/i.test(text)) return "research";
  if (/仓库|代码|issue|bug|PR|repo|code/i.test(text)) return "software";
  return "solo";
}

function Environment() {
  const W = useWords();
  return (
    <Card padding="sm" className="space-y-2">
      <p className="text-xs font-medium text-fg-muted">{W.onboarding.machines}</p>
      <ul className="space-y-1">
        {DETECTED.machines.map((machine) => (
          <li key={machine} className="flex flex-wrap items-center gap-2">
            <span className="text-fg">{W.machines[machine].name}</span>
            <Pill tone={machine === "cloud" ? "neutral" : "success"}>
              {W.machines[machine].state}
            </Pill>
          </li>
        ))}
      </ul>
      <p className="text-fg">{W.onboarding.models(DETECTED.models)}</p>
      <p className="text-fg-muted">{W.onboarding.clis(DETECTED.clis.join(" / "))}</p>
    </Card>
  );
}

function questionsForm(scenario: Scenario, W: ReturnType<typeof useWords>): A2uiForm {
  const F = W.onboarding.form;
  return {
    type: "form",
    id: "setup",
    title: F.title,
    fields: [
      {
        id: "work",
        label: F.work,
        kind: "multiple",
        hint: F.workHint,
        required: true,
        options: WORKBENCHES.map((kind) => ({ label: W.work[kind] })),
        default: SCENARIO_WORK[scenario].map((kind) => W.work[kind]),
      },
      {
        id: "budget",
        label: F.budget,
        kind: "single",
        options: BUDGETS.map((usd) => ({
          label: `$${usd}`,
          ...(usd === 5 ? { recommended: true } : {}),
        })),
        default: "$5",
      },
      {
        id: "rounds",
        label: F.rounds,
        kind: "single",
        options: ROUNDS.map((n) => ({
          label: String(n),
          ...(n === 2 ? { recommended: true } : {}),
        })),
        default: "2",
      },
      { id: "events", label: F.events, kind: "switch", default: true },
    ],
    submitLabel: F.submit,
  };
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section
      aria-label={title}
      className="space-y-1.5 border-t border-line pt-3 first:border-t-0 first:pt-0"
    >
      <h3 className="text-xs font-medium text-fg-muted">{title}</h3>
      {children}
    </section>
  );
}

function Plan({
  setup,
  onChange,
  onConfirm,
}: {
  setup: Setup;
  onChange: (setup: Setup) => void;
  onConfirm: () => void;
}) {
  const W = useWords();
  const P = W.onboarding.preview;
  const hired = hiresFor(setup.work);
  const team: MemberId[] = ["lead", ...hired, "verifier"];
  const toggle = (kind: Workbench, on: boolean) => {
    const work = on ? [...setup.work, kind] : setup.work.filter((candidate) => candidate !== kind);
    if (work.length === 0) return;
    onChange({ ...setup, work: WORKBENCHES.filter((candidate) => work.includes(candidate)) });
  };
  return (
    <Card as="section" padding="md" aria-label={P.title} className="space-y-3">
      <h2 className="text-sm font-semibold text-fg">{P.title}</h2>
      <Section title={P.work}>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {WORKBENCHES.map((kind) => (
            <Checkbox
              key={kind}
              size="sm"
              checked={setup.work.includes(kind)}
              onChange={(on) => toggle(kind, on)}
              label={W.work[kind]}
            />
          ))}
        </div>
      </Section>
      <Section title={P.team}>
        <ul className="space-y-2">
          {team.map((id) => {
            const member = MEMBERS[id];
            const editable = id !== "lead" && id !== "verifier";
            const model = editable
              ? (setup.models[id as ExecutorId] ?? member.model)
              : member.model;
            return (
              <li key={id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <PersonAvatar id={id} size={20} />
                <PersonName id={id} />
                <span className="text-xs text-fg-muted">{W.machines[member.machine].name}</span>
                {editable ? (
                  <span className="w-44">
                    <Select
                      size="sm"
                      aria-label={`${P.model} · ${W.species[member.species]}`}
                      value={model}
                      onChange={(event) =>
                        onChange({
                          ...setup,
                          models: { ...setup.models, [id]: event.target.value as ModelId },
                        })
                      }
                    >
                      {MODELS.map((candidate) => (
                        <option key={candidate} value={candidate}>
                          {MODEL_NAME[candidate]}
                        </option>
                      ))}
                    </Select>
                  </span>
                ) : (
                  <span className="text-xs text-fg">{MODEL_NAME[model]}</span>
                )}
                <span className="flex flex-wrap gap-1">
                  {member.perms.map((perm) => (
                    <Pill key={perm}>{W.perms[perm]}</Pill>
                  ))}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="text-xs text-fg-muted">{P.teamNote}</p>
      </Section>
      <Section title={P.flow}>
        <p className="text-fg">
          {MAIN_LINE.map((status) => {
            const holder = HOLDER[status];
            return holder === null
              ? W.statuses[status]
              : `${W.statuses[status]} · ${W.holders[holder]}`;
          }).join(" → ")}
        </p>
        <p className="text-xs text-fg-muted">{P.flowNote}</p>
      </Section>
      <Section title={P.limits}>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <p className="text-xs text-fg-muted">{P.budget}</p>
            <Segmented
              value={String(setup.budget)}
              onChange={(value) => onChange({ ...setup, budget: Number(value) })}
              options={BUDGETS.map((usd) => ({ value: String(usd), label: `$${usd}` }))}
            />
          </div>
          <div className="space-y-1">
            <p className="text-xs text-fg-muted">{P.rounds}</p>
            <Segmented
              value={String(setup.rounds)}
              onChange={(value) => onChange({ ...setup, rounds: Number(value) })}
              options={ROUNDS.map((n) => ({ value: String(n), label: String(n) }))}
            />
          </div>
        </div>
        <ul className="list-disc pl-5 text-fg">
          <li>{P.verified}</li>
          <li>{P.depth(DELEGATION_DEPTH)}</li>
        </ul>
      </Section>
      <Section title={P.outward}>
        <ul className="space-y-0.5">
          {OUTWARD_ACTIONS.map((action) => (
            <li key={action} className="flex flex-wrap gap-x-2">
              <span className="text-fg">{W.outward.actions[action]}</span>
              <span className="text-fg-muted">{W.outward.grades[DEFAULT_GRADES[action]]}</span>
            </li>
          ))}
        </ul>
      </Section>
      <Section title={P.triggers}>
        <label className="flex items-center gap-2">
          <Switch
            checked={setup.events}
            onChange={(on) => onChange({ ...setup, events: on })}
            aria-label={W.onboarding.form.events}
          />
          <span className="text-fg">{setup.events ? P.eventsOn : P.eventsOff}</span>
        </label>
        <p className="text-xs text-fg-muted">
          {[W.triggers.github, W.triggers.message, W.triggers.callback].join(" · ")}
        </p>
        <p className="text-xs text-fg-muted">
          {[W.triggers.patrol, W.triggers.review].join(" · ")}
        </p>
      </Section>
      <Section title={P.workbenches}>
        <p className="text-fg">
          {setup.work.map((kind) => `${W.work[kind]} → ${W.workbenches[kind]}`).join(" · ")}
        </p>
      </Section>
      <Section title={P.first}>
        <ul className="list-disc pl-5 text-fg">
          {setup.work.map((kind) => (
            <li key={kind}>{W.tickets[STARTERS[kind]].title}</li>
          ))}
        </ul>
      </Section>
      <Section title={P.warnings}>
        <ul className="space-y-1">
          {[P.warnToken, P.warnOutward].map((line) => (
            <li key={line} className="flex items-start gap-2 text-fg">
              <GlyphIcon
                d={ICONS.triangleAlert}
                size={13}
                className="mt-1 shrink-0 text-tone-attention-fg"
              />
              {line}
            </li>
          ))}
        </ul>
      </Section>
      <div className="flex justify-end border-t border-line pt-3">
        <Button size="sm" variant="primary" onClick={onConfirm}>
          {P.confirm}
        </Button>
      </div>
    </Card>
  );
}

export function Onboarding({
  onDid,
  onStep,
  onStart,
}: {
  onDid: (item: TourItem) => void;
  /** The step of setting up the reader is on, for the column's list. */
  onStep: (step: number) => void;
  onStart: (setup: Setup) => void;
}) {
  const W = useWords();
  const lang = useLocale().locale === "zh" ? "zh" : "en";
  const [phase, setPhase] = useState<Phase>("welcome");
  const [said, setSaid] = useState<string | null>(null);
  const [answered, setAnswered] = useState<string | null>(null);
  const [imported, setImported] = useState(false);
  const [draft, setDraft] = useState("");
  const [setup, setSetup] = useState<Setup | null>(null);
  /** Where the newest exchange starts: the page scrolls it to the top, not to its end. */
  const latest = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    onStep(phase === "welcome" ? 1 : phase === "questions" ? 2 : 3);
    if (phase === "welcome") return;
    if (phase === "created") end.current?.scrollIntoView?.({ block: "end", behavior: "smooth" });
    else latest.current?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  }, [phase, onStep]);

  const form = useMemo(
    () => (setup === null ? null : questionsForm(setup.scenario, W)),
    [setup, W],
  );

  const pick = (scenario: Scenario, text: string) => {
    setSaid(text);
    setSetup({
      scenario,
      work: SCENARIO_WORK[scenario],
      budget: 5,
      rounds: 2,
      events: true,
      models: {},
    });
    setPhase("questions");
    onDid("pick");
  };

  const actions = useMemo<A2uiActions>(
    () => ({
      interactive: phase === "questions",
      lang,
      ...(answered !== null ? { answeredWith: answered } : {}),
      fill: (text) => {
        if (form === null || setup === null) return;
        const answers = parseFormFill(form, text) ?? {};
        const picked = Array.isArray(answers.work) ? answers.work : [];
        const work = WORKBENCHES.filter((kind) => picked.includes(W.work[kind]));
        const budget = Number(String(answers.budget ?? "$5").replace("$", ""));
        const rounds = Number(answers.rounds ?? 2);
        setSetup({
          ...setup,
          work: work.length > 0 ? work : setup.work,
          budget: BUDGETS.includes(budget as 2) ? budget : 5,
          rounds: ROUNDS.includes(rounds as 1) ? rounds : 2,
          events: answers.events !== false,
        });
        setAnswered(text);
        setPhase("plan");
        onDid("answer");
      },
    }),
    [answered, form, lang, onDid, phase, setup, W],
  );

  const send = () => {
    const text = draft.trim();
    if (text === "") return;
    setDraft("");
    pick(scenarioOf(text), text);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6">
          <LeadSays>
            <p>{W.onboarding.hello}</p>
            <p>{W.onboarding.found}</p>
            <Environment />
            <p>{W.onboarding.ask}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {SCENARIOS.map((scenario) => (
                <button
                  key={scenario}
                  type="button"
                  disabled={phase !== "welcome"}
                  onClick={() => pick(scenario, W.scenarios[scenario].prompt)}
                  className={`ui-edge rounded-lg border border-line px-3 py-2 text-left transition-colors disabled:opacity-60 ${NAV_FILL.hover}`}
                >
                  <span className="block text-sm font-medium text-fg">
                    {W.scenarios[scenario].label}
                  </span>
                  <span className="block text-xs text-fg-muted">{W.scenarios[scenario].line}</span>
                </button>
              ))}
            </div>
            <div>
              <Button
                size="sm"
                variant="ghost"
                disabled={phase !== "welcome"}
                onClick={() => {
                  setImported(true);
                  setSetup({
                    scenario: "solo",
                    work: SCENARIO_WORK.solo,
                    budget: 5,
                    rounds: 2,
                    events: true,
                    models: {},
                  });
                  setPhase("plan");
                  onDid("pick");
                }}
              >
                {W.onboarding.import}
              </Button>
            </div>
          </LeadSays>

          {phase === "questions" && <div ref={latest} className="-mb-6 scroll-mt-4" />}
          {said !== null && <PersonSays>{said}</PersonSays>}
          {said !== null && form !== null && (
            <LeadSays>
              <p>{W.onboarding.questions}</p>
              <A2uiActionsProvider value={actions}>
                <A2uiBlock source={JSON.stringify(form)} />
              </A2uiActionsProvider>
            </LeadSays>
          )}
          {phase === "plan" && <div ref={latest} className="-mb-6 scroll-mt-4" />}
          {answered !== null && <PersonSays>{answered}</PersonSays>}

          {(phase === "plan" || phase === "created") && setup !== null && (
            <LeadSays>
              <p>{imported ? W.onboarding.imported : W.onboarding.previewIntro}</p>
              {phase === "plan" ? (
                <Plan
                  setup={setup}
                  onChange={(next) => {
                    setSetup(next);
                    onDid("edit");
                  }}
                  onConfirm={() => setPhase("created")}
                />
              ) : (
                <>
                  <ul className="space-y-1">
                    {W.onboarding.creating.map((line) => (
                      <li key={line} className="flex items-center gap-2 text-fg">
                        <GlyphIcon d={ICONS.check} size={13} className="text-tone-success-fg" />
                        {line}
                      </li>
                    ))}
                  </ul>
                  <p>{W.onboarding.created}</p>
                  <Button size="sm" variant="primary" onClick={() => onStart(setup)}>
                    {W.onboarding.enter}
                  </Button>
                </>
              )}
            </LeadSays>
          )}
          <div ref={end} />
        </div>
      </div>
      {phase === "welcome" && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            send();
          }}
          className="mx-auto flex w-full max-w-3xl shrink-0 items-end gap-2 px-4 pb-4"
        >
          <div className="min-w-0 flex-1">
            <Textarea
              size="sm"
              rows={2}
              aria-label={W.onboarding.placeholder}
              placeholder={W.onboarding.placeholder}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  send();
                }
              }}
            />
          </div>
          <Button size="sm" variant="primary" type="submit" disabled={draft.trim() === ""}>
            {W.onboarding.send}
          </Button>
        </form>
      )}
    </div>
  );
}

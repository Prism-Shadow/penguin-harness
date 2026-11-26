/**
 * Setting a company up, one question per screen, every choice already made so the reader can go
 * straight through, and every choice on screen so nothing about the company runs unseen.
 *
 * 1. Mission: a broad direction first, as the shipped company mode offers its example companies
 *    (code upkeep, content and community, a research lab, or the reader's own), which fills in
 *    a whole mission the reader rewrites as they need.
 * 2. Team: the lead drafts the roles the mission needs, as few as it can, each named after a
 *    penguin species, with its title, its duties and its sources; the reader renames them,
 *    rewrites their duties, drops them or adds their own. The lead is always on; the verifier is
 *    set in the next step, where it sits on a ticket's way.
 * 3. How a ticket goes: its four stops, with the one stop the reader can switch (verification)
 *    where it sits, the rule of when the company reaches them, and the two limits the server
 *    holds every ticket to (its budget, and how often its verifier hands work back on its own).
 * 4. Where work comes from: events filed as they arrive; what the daily patrol does with what it
 *    finds in the parts' sources; the weekly retrospective.
 * 5. How the agents write to the reader, beside a sample ticket written that way.
 *
 * Steps 3 to 5 go into the handbook's how-we-work.md, which every employee reads. Each step keeps
 * its choices when the reader goes back, and the company starts only from the last.
 */
import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  Button,
  ChoiceGroup,
  CloseIcon,
  Heading,
  IconButton,
  InfoPopover,
  Input,
  PageFrame,
  RadioDisc,
  Segmented,
  Switch,
  Textarea,
} from "@prismshadow/penguin-ui";
import {
  draftsFor,
  ROLE_SPECIES,
  staffFrom,
  TEMPLATE_DRAFTS,
  TEMPLATES,
  WORKSPACE,
} from "./fixtures";
import type { Role, TemplateId } from "./fixtures";
import { DEFAULT_SETTINGS } from "./model";
import type { CompanySettings, PatrolMode } from "./model";
import { SpeciesAvatar } from "./people";
import { roleWords, sourcesOf } from "./text";
import { useWords } from "./use-words";

const QUIET = "text-fg-muted";
const LABEL = "text-xs font-semibold text-fg-muted";

/** The option that stands for the reader's own words, beside the broad directions. */
const OWN = "own";
type Choice = TemplateId | typeof OWN;

const STEPS = ["mission", "team", "flow", "schedules", "style"] as const;
type Step = (typeof STEPS)[number];

function Steps({ step }: { step: Step }) {
  const W = useWords();
  return (
    <ol className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs">
      {STEPS.map((id, i) => {
        const current = id === step;
        return (
          <li
            key={id}
            aria-current={current ? "step" : undefined}
            className={`flex items-center gap-1.5 ${current ? "font-semibold text-fg" : QUIET}`}
          >
            {i > 0 && <span aria-hidden="true" className="mr-1.5 h-px w-4 bg-line sm:w-6" />}
            <span className="tabular-nums">{i + 1}</span>
            {/* On a phone only the step on screen is named; the others keep their number. */}
            <span className={current ? "" : "sr-only sm:not-sr-only"}>{W.setup.steps[id]}</span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * A step's head: where the reader is, the step's question, and a line on it. A step the reader
 * moved to takes the focus, so the screen reads from its top and a screen reader starts there.
 */
function Intro({
  step,
  title,
  body,
  focus,
}: {
  step: Step;
  title: string;
  body: string;
  focus: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focus) ref.current?.focus();
  }, [focus]);
  return (
    <div ref={ref} tabIndex={-1} className="text-center outline-none">
      <Steps step={step} />
      <Heading level={1} display className="mt-5">
        {title}
      </Heading>
      <p className="mx-auto mt-2 max-w-xl text-sm text-fg-muted">{body}</p>
    </div>
  );
}

/** A step's foot: back, a note, and the way on. */
function Foot({
  onBack,
  note,
  next,
  disabled = false,
}: {
  onBack?: () => void;
  note?: string;
  next: string;
  disabled?: boolean;
}) {
  const W = useWords();
  return (
    <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-4">
      {onBack !== undefined && (
        <Button size="sm" variant="ghost" onClick={onBack}>
          {W.setup.back}
        </Button>
      )}
      {note !== undefined && <p className={`min-w-0 flex-1 basis-56 text-xs ${QUIET}`}>{note}</p>}
      <Button size="sm" variant="primary" type="submit" disabled={disabled} className="ml-auto">
        {next}
      </Button>
    </div>
  );
}

/** One step's screen: a form whose submit moves on. */
function StepForm({
  wide = false,
  onSubmit,
  children,
}: {
  wide?: boolean;
  onSubmit: () => void;
  children: ReactNode;
}) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };
  return (
    <form onSubmit={submit} className={`mx-auto w-full py-6 ${wide ? "max-w-3xl" : "max-w-xl"}`}>
      {children}
    </form>
  );
}

function MissionStep({
  choice,
  onChoice,
  mission,
  onMission,
  focus,
  onNext,
}: {
  choice: Choice;
  onChoice: (choice: Choice) => void;
  mission: string;
  onMission: (mission: string) => void;
  focus: boolean;
  onNext: () => void;
}) {
  const W = useWords();
  const missionRef = useRef<HTMLTextAreaElement>(null);
  return (
    <StepForm onSubmit={onNext}>
      <Intro step="mission" title={W.setup.title} body={W.setup.body} focus={focus} />
      <ChoiceGroup
        shape="card"
        aria-label={W.setup.title}
        className="mt-8"
        value={choice}
        onChange={(chosen) => {
          onChoice(chosen as Choice);
          // Writing one's own starts in the mission, which is empty for it.
          if (chosen === OWN) missionRef.current?.focus();
        }}
        options={[
          ...TEMPLATES.map((id) => ({
            value: id,
            label: W.setup.templates[id].name,
            description: W.setup.templates[id].summary,
          })),
          { value: OWN, label: W.setup.own, description: W.setup.ownSummary, muted: true },
        ]}
      />
      <div className="mt-5">
        <Textarea
          ref={missionRef}
          label={W.setup.mission}
          info={W.setup.missionInfo}
          required
          size="sm"
          rows={3}
          placeholder={W.setup.missionPlaceholder}
          value={mission}
          onChange={(event) => onMission(event.target.value)}
        />
      </div>
      <Foot next={W.setup.next} disabled={mission.trim() === ""} />
    </StepForm>
  );
}

/** A team the company can start with: at least one role, and every role with a title. */
const staffed = (staff: readonly Role[], W: ReturnType<typeof useWords>): boolean =>
  staff.length > 0 && staff.every((role) => roleWords(role, W).title.trim() !== "");

function TeamStep({
  staff,
  onStaff,
  onBack,
  onNext,
}: {
  staff: readonly Role[];
  onStaff: (staff: Role[]) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const W = useWords();
  const T = W.setup.team;
  const lead = W.people.lead;
  const change = (id: string, patch: Partial<Role>) =>
    onStaff(staff.map((role) => (role.id === id ? { ...role, ...patch } : role)));
  // A role the reader adds takes the next penguin no one on the team is.
  const free = ROLE_SPECIES.find((species) => !staff.some((role) => role.species === species));
  const add = () => {
    if (free === undefined) return;
    const n = staff.filter((role) => role.draft === null).length + 1;
    onStaff([
      ...staff,
      { id: `own-${n}`, species: free, draft: null, part: null, title: "", duties: "" },
    ]);
  };
  const ready = staffed(staff, W);
  let note: string | undefined;
  if (staff.length === 0) note = T.none;
  else if (!ready) note = T.untitled;
  return (
    <StepForm wide onSubmit={onNext}>
      <Intro step="team" title={T.title} body={T.body(WORKSPACE)} focus />
      <ul className="mt-8 divide-y divide-line border-y border-line">
        <li className="flex items-start gap-3 py-3">
          <span className="mt-0.5 shrink-0">
            <SpeciesAvatar species="emperor" size={20} />
          </span>
          <span className="min-w-0">
            <span className="block text-sm text-fg">
              {W.species.emperor}
              <span className={`ml-2 ${QUIET}`}>{lead.title}</span>
            </span>
            <span className={`block text-sm ${QUIET}`}>{T.lead}</span>
          </span>
        </li>
        {staff.map((role) => {
          const words = roleWords(role, W);
          const name = W.species[role.species];
          return (
            <li key={role.id} className="flex items-start gap-3 py-3">
              <span className="mt-1.5 shrink-0">
                <SpeciesAvatar species={role.species} size={20} />
              </span>
              <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[10rem_minmax(0,1fr)]">
                <div className="min-w-0">
                  <span className="block text-xs text-fg-muted">{name}</span>
                  <Input
                    size="sm"
                    aria-label={`${name} · ${T.roleTitle}`}
                    placeholder={T.addPlaceholder}
                    value={words.title}
                    onChange={(event) => change(role.id, { title: event.target.value })}
                  />
                </div>
                <div className="min-w-0">
                  <span className="block text-xs text-fg-muted">{T.roleDuties}</span>
                  <Textarea
                    size="sm"
                    rows={2}
                    aria-label={`${name} · ${T.roleDuties}`}
                    placeholder={T.dutiesPlaceholder}
                    value={words.duties}
                    onChange={(event) => change(role.id, { duties: event.target.value })}
                  />
                  {words.sources !== "" && (
                    <span className="mt-1 block text-xs text-fg-muted">
                      {T.sources(words.sources)}
                    </span>
                  )}
                </div>
              </div>
              <span className="mt-5 shrink-0">
                <IconButton
                  size="sm"
                  variant="ghost"
                  label={T.remove(name)}
                  onClick={() => onStaff(staff.filter((other) => other.id !== role.id))}
                >
                  <CloseIcon />
                </IconButton>
              </span>
            </li>
          );
        })}
      </ul>
      {free !== undefined && (
        <Button size="sm" variant="ghost" className="mt-2" onClick={add}>
          {T.add}
        </Button>
      )}
      <Foot
        onBack={onBack}
        next={W.setup.next}
        disabled={!ready}
        {...(note !== undefined ? { note } : {})}
      />
    </StepForm>
  );
}

/** One stop on a ticket's way, numbered on the line that joins the stops. */
function Stop({
  n,
  title,
  last = false,
  aside,
  children,
}: {
  n: number;
  title: string;
  last?: boolean;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <li className="relative flex gap-3 pb-4 last:pb-0">
      {!last && (
        <span aria-hidden="true" className="absolute top-6 bottom-0 left-2.5 w-px bg-line" />
      )}
      <span className="w-5 shrink-0 text-center text-sm tabular-nums text-fg-muted">{n}</span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <span className="text-sm font-medium text-fg">{title}</span>
          {aside}
        </span>
        <span className={`mt-0.5 block text-sm ${QUIET}`}>{children}</span>
      </span>
    </li>
  );
}

/**
 * A setting: its name in a column of its own, so the controls line up. A wide row gives longer
 * names (the limits') room on one line.
 */
function StyleRow({
  label,
  wide = false,
  children,
}: {
  label: string;
  wide?: boolean;
  children: ReactNode;
}) {
  const columns = wide
    ? "sm:grid-cols-[10rem_minmax(0,1fr)]"
    : "sm:grid-cols-[6.5rem_minmax(0,1fr)]";
  return (
    <div className={`grid items-center gap-x-3 gap-y-1.5 ${columns}`}>
      <span className="text-sm text-fg">{label}</span>
      {children}
    </div>
  );
}

/** A sample ticket, written the way the chosen settings say the agents will write. */
function Preview({ settings }: { settings: CompanySettings }) {
  const W = useWords();
  const P = W.setup.preview;
  const steps = settings.progress === "every" ? P.steps : [P.steps[P.milestone] ?? ""];
  return (
    <figure className="rounded-md border border-line bg-surface p-4 text-sm">
      <figcaption className={LABEL}>{P.title}</figcaption>
      <p className="mt-2 font-medium text-fg">{W.tickets.release.title}</p>
      <p className={`mt-3 ${LABEL}`}>{P.progress}</p>
      <ul className="mt-1 space-y-1 text-fg">
        {steps.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p className={`mt-3 ${LABEL}`}>{P.question}</p>
      <p className="mt-1 text-fg">{settings.ask === "options" ? P.ask.options : P.ask.open}</p>
      {settings.ask === "options" && (
        <ul className="mt-1.5 space-y-1">
          {P.ask.choices.map((choice, i) => (
            <li key={choice} className="flex items-center gap-2 text-fg">
              <RadioDisc on={false} />
              {choice}
              {i === 0 && <span className={`text-xs ${QUIET}`}>{P.ask.recommended}</span>}
            </li>
          ))}
        </ul>
      )}
      <p className={`mt-3 ${LABEL}`}>{P.result}</p>
      {settings.record === "points" ? (
        <ul className="mt-1 list-disc space-y-1 pl-5 text-fg">
          {P.points.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 leading-relaxed text-fg">{P.prose}</p>
      )}
    </figure>
  );
}

/** What every step after the first takes: the settings, and the ways back and on. */
interface SettingsStep {
  settings: CompanySettings;
  /** The company's roles, whose sources the patrol reads. */
  staff: readonly Role[];
  set: (patch: Partial<CompanySettings>) => void;
  onBack: () => void;
  onNext: () => void;
}

/** The budgets and hand-back counts a company can start its tickets with. */
const BUDGETS = [2, 5, 10] as const;
const ROUNDS = [1, 2, 3] as const;

function FlowStep({ settings, set, onBack, onNext }: SettingsStep) {
  const W = useWords();
  const F = W.setup.flow;
  const L = F.limits;
  return (
    <StepForm onSubmit={onNext}>
      <Intro step="flow" title={F.title} body={F.body} focus />
      <ol className="mt-8">
        <Stop n={1} title={F.propose.title}>
          {F.propose.body}
        </Stop>
        <Stop n={2} title={F.work.title}>
          {F.work.body}
        </Stop>
        <Stop
          n={3}
          title={F.verify.title}
          aside={
            <label className={`flex items-center gap-2 text-xs ${QUIET}`}>
              {F.verify.label}
              <Switch checked={settings.verify} onChange={(verify) => set({ verify })} />
            </label>
          }
        >
          {settings.verify ? F.verify.on(W.species.chinstrap) : F.verify.off}
        </Stop>
        <Stop n={4} title={F.review.title} last>
          {F.review.body}
          <span className="mt-1 block">{F.outward}</span>
        </Stop>
      </ol>
      <p className="mt-5 border-l-2 border-line pl-3 text-sm text-fg">{F.note}</p>
      <section aria-label={L.title} className="mt-6 space-y-3">
        <h2 className={LABEL}>{L.title}</h2>
        <p className={`text-sm ${QUIET}`}>{L.body}</p>
        <StyleRow label={L.budget} wide>
          <Segmented<string>
            cols={3}
            value={String(settings.budget)}
            onChange={(budget) => set({ budget: Number(budget) })}
            options={BUDGETS.map((usd) => ({ value: String(usd), label: `$${usd}` }))}
          />
        </StyleRow>
        <StyleRow label={L.rounds} wide>
          {settings.verify ? (
            <Segmented<string>
              cols={3}
              value={String(settings.rounds)}
              onChange={(rounds) => set({ rounds: Number(rounds) })}
              options={ROUNDS.map((n) => ({ value: String(n), label: L.times(n) }))}
            />
          ) : (
            <span className={`text-sm ${QUIET}`}>{L.roundsOff}</span>
          )}
        </StyleRow>
      </section>
      <Foot onBack={onBack} next={W.setup.next} />
    </StepForm>
  );
}

function SchedulesStep({ settings, staff, set, onBack, onNext }: SettingsStep) {
  const W = useWords();
  const S = W.setup.schedules;
  const patrolId = useId();
  return (
    <StepForm onSubmit={onNext}>
      <Intro step="schedules" title={S.title} body={S.body} focus />
      <div className="mt-8 space-y-6">
        <section aria-label={S.events}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 className={LABEL}>
              {S.events}
              <span className="ml-2 font-normal">{S.eventsWhen}</span>
            </h2>
            <label className={`flex items-center gap-2 text-xs ${QUIET}`}>
              {S.eventsLabel}
              <Switch checked={settings.events} onChange={(events) => set({ events })} />
            </label>
          </div>
          <p className={`mt-1 text-sm ${QUIET}`}>{S.eventsHint[settings.events ? "on" : "off"]}</p>
        </section>
        <section>
          <h2 id={patrolId} className={LABEL}>
            {S.patrol}
            <span className="ml-2 font-normal">{S.patrolWhen(sourcesOf(staff, W))}</span>
          </h2>
          <ChoiceGroup
            shape="card"
            aria-labelledby={patrolId}
            className="mt-2"
            value={settings.patrol}
            onChange={(patrol) => set({ patrol: patrol as PatrolMode })}
            options={(["off", "propose", "auto"] as const).map((mode) => ({
              value: mode,
              label: W.schedule.modes[mode],
              description: S.patrolHint[mode],
            }))}
          />
        </section>
        <section aria-label={S.retro}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 className={LABEL}>
              {S.retro}
              <span className="ml-2 font-normal">{S.retroWhen}</span>
            </h2>
            <span className={`text-xs ${QUIET}`}>{W.schedule.autoOff}</span>
          </div>
          <p className={`mt-1 text-sm ${QUIET}`}>{S.retroHint}</p>
        </section>
      </div>
      <Foot onBack={onBack} next={W.setup.next} />
    </StepForm>
  );
}

function StyleStep({ settings, set, onBack, onNext }: SettingsStep) {
  const W = useWords();
  const T = W.setup.style;
  return (
    <StepForm wide onSubmit={onNext}>
      <Intro step="style" title={T.title} body={T.body} focus />
      <div className="mt-8 grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-3">
          <StyleRow label={T.record.label}>
            <Segmented<CompanySettings["record"]>
              cols={2}
              value={settings.record}
              onChange={(record) => set({ record })}
              options={[
                { value: "points", label: T.record.points },
                { value: "prose", label: T.record.prose },
              ]}
            />
          </StyleRow>
          <StyleRow label={T.ask.label}>
            <Segmented<CompanySettings["ask"]>
              cols={2}
              value={settings.ask}
              onChange={(ask) => set({ ask })}
              options={[
                { value: "options", label: T.ask.options },
                { value: "open", label: T.ask.open },
              ]}
            />
          </StyleRow>
          <StyleRow label={T.progress.label}>
            <Segmented<CompanySettings["progress"]>
              cols={2}
              value={settings.progress}
              onChange={(progress) => set({ progress })}
              options={[
                { value: "milestones", label: T.progress.milestones },
                { value: "every", label: T.progress.every },
              ]}
            />
          </StyleRow>
        </div>
        <Preview settings={settings} />
      </div>
      <Foot onBack={onBack} note={W.setup.defaults} next={W.setup.start} />
    </StepForm>
  );
}

export function SetupPage({
  onStart,
}: {
  onStart: (
    name: string,
    mission: string,
    staff: readonly Role[],
    settings: CompanySettings,
  ) => void;
}) {
  const W = useWords();
  const [step, setStep] = useState<Step>("mission");
  // The first screen takes no focus when the page opens; coming back to it, it does.
  const [moved, setMoved] = useState(false);
  const [choice, setChoice] = useState<Choice>(TEMPLATES[0]);
  const [mission, setMission] = useState(W.setup.templates[TEMPLATES[0]].mission);
  const [staff, setStaff] = useState<Role[]>(() => staffFrom(TEMPLATE_DRAFTS[TEMPLATES[0]]));
  /** The mission the team was last proposed for, so going back without changing it keeps the team. */
  const [proposedFor, setProposedFor] = useState(mission);
  const [settings, setSettings] = useState<CompanySettings>(DEFAULT_SETTINGS);
  const name = choice === OWN ? W.setup.ownName : W.setup.templates[choice].name;
  const go = (to: Step) => {
    setMoved(true);
    setStep(to);
  };
  const at = STEPS.indexOf(step);
  const back = () => go(STEPS[at - 1] ?? "mission");
  const next = () => {
    const to = STEPS[at + 1];
    if (to === undefined) onStart(name, mission.trim(), staff, settings);
    else go(to);
  };
  // Leaving the mission, the lead drafts the team for it: a direction's own roles, or, for a
  // mission of the reader's own, the roles its words call for. An unchanged mission keeps the
  // team the reader may have changed.
  const fromMission = () => {
    if (mission !== proposedFor) {
      setStaff(
        staffFrom(choice === OWN ? draftsFor(mission, W.setup.keywords) : TEMPLATE_DRAFTS[choice]),
      );
      setProposedFor(mission);
    }
    next();
  };
  const settingsStep: SettingsStep = {
    settings,
    staff,
    set: (patch) => setSettings((current) => ({ ...current, ...patch })),
    onBack: back,
    onNext: next,
  };
  let screen: ReactNode;
  if (step === "mission") {
    screen = (
      <MissionStep
        choice={choice}
        onChoice={(chosen) => {
          setChoice(chosen);
          // A direction fills in its whole mission, to be rewritten as the reader needs; their
          // own starts empty.
          setMission(chosen === OWN ? "" : W.setup.templates[chosen].mission);
        }}
        mission={mission}
        onMission={setMission}
        focus={moved}
        onNext={fromMission}
      />
    );
  } else if (step === "team") {
    screen = <TeamStep staff={staff} onStaff={setStaff} onBack={back} onNext={next} />;
  } else if (step === "flow") {
    screen = <FlowStep {...settingsStep} />;
  } else if (step === "schedules") {
    screen = <SchedulesStep {...settingsStep} />;
  } else {
    screen = <StyleStep {...settingsStep} />;
  }
  return (
    // Top-aligned, so the step bar stays where it is from one screen to the next.
    <PageFrame width="full">{screen}</PageFrame>
  );
}

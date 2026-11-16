/**
 * Setting a company up, in two steps, every choice already made so the reader can go straight
 * through, and every choice on screen so nothing about the company runs unseen.
 *
 * 1. What it does: the Project's workspace, what the lead read in it, and the mission it suggests
 *    from that. Changing the workspace changes what was read and what is suggested.
 * 2. How it works: the way a ticket goes, drawn as its four stops, with the one stop the reader
 *    can switch (verification) where it sits and the rule of when the company reaches them; the
 *    schedules; and how the agents write to the reader, beside a sample ticket written that way.
 *    All of it goes into the handbook's how-we-work.md, which every employee reads.
 */
import { useId, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  Button,
  ChoiceGroup,
  Heading,
  InfoPopover,
  PageFrame,
  RadioDisc,
  Segmented,
  Select,
  Switch,
  Textarea,
} from "@prismshadow/penguin-ui";
import { WORKSPACE_PATH, WORKSPACES } from "./fixtures";
import type { WorkspaceId } from "./fixtures";
import { DEFAULT_SETTINGS } from "./model";
import type { CompanySettings, PatrolMode } from "./model";
import { useWords } from "./use-words";

const QUIET = "text-fg-muted";
const LABEL = "text-xs font-semibold text-fg-muted";

/** The option that stands for the reader's own words, among the lead's suggestions. */
const OWN = "own";

type Step = "what" | "how";

function Steps({ step }: { step: Step }) {
  const W = useWords();
  return (
    <ol className="flex items-center justify-center gap-3 text-xs">
      {(["what", "how"] as const).map((id, i) => (
        <li
          key={id}
          aria-current={id === step ? "step" : undefined}
          className={`flex items-center gap-1.5 ${id === step ? "font-semibold text-fg" : QUIET}`}
        >
          {i > 0 && <span aria-hidden="true" className="mr-1.5 h-px w-6 bg-line" />}
          <span className="tabular-nums">{i + 1}</span>
          {W.setup.steps[id]}
        </li>
      ))}
    </ol>
  );
}

function Intro({ step, title, body }: { step: Step; title: string; body: string }) {
  return (
    <div className="text-center">
      <Steps step={step} />
      <Heading level={1} display className="mt-5">
        {title}
      </Heading>
      <p className="mx-auto mt-2 max-w-xl text-sm text-fg-muted">{body}</p>
    </div>
  );
}

function WhatStep({
  workspace,
  onWorkspace,
  choice,
  onChoice,
  own,
  onOwn,
  mission,
  onNext,
}: {
  workspace: WorkspaceId;
  onWorkspace: (workspace: WorkspaceId) => void;
  choice: string;
  onChoice: (choice: string) => void;
  own: string;
  onOwn: (own: string) => void;
  mission: string;
  onNext: () => void;
}) {
  const W = useWords();
  const words = W.workspaces[workspace];
  const missionId = useId();
  const next = (event: FormEvent) => {
    event.preventDefault();
    onNext();
  };
  return (
    <form onSubmit={next} className="mx-auto w-full max-w-xl py-6">
      <Intro step="what" title={W.setup.title} body={W.setup.body} />
      <div className="mt-6 space-y-5">
        <Select
          label={W.setup.workspace}
          info={W.setup.workspaceInfo}
          value={workspace}
          onChange={(event) => onWorkspace(event.target.value as WorkspaceId)}
        >
          {WORKSPACES.map((id) => (
            <option key={id} value={id}>
              {WORKSPACE_PATH[id]}
            </option>
          ))}
        </Select>
        <section aria-label={W.setup.read}>
          <h2 className={`flex items-center gap-1 ${LABEL}`}>
            {W.setup.read}
            <InfoPopover label={W.setup.read}>{W.setup.readInfo}</InfoPopover>
          </h2>
          <ul className="mt-2 space-y-1 text-sm text-fg">
            {words.read.map((line) => (
              <li key={line} className="flex gap-2">
                <span aria-hidden="true" className="text-fg-subtle">
                  ·
                </span>
                {line}
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h2 id={missionId} className={LABEL}>
            {W.setup.mission}
          </h2>
          <ChoiceGroup
            shape="card"
            aria-labelledby={missionId}
            className="mt-2"
            value={choice}
            onChange={onChoice}
            options={[
              ...words.missions.map((option, i) => ({
                value: String(i),
                label: option.label,
                description: option.why,
              })),
              { value: OWN, label: W.setup.own, muted: true },
            ]}
          />
          {choice === OWN && (
            <div className="mt-2">
              <Textarea
                size="sm"
                rows={2}
                autoFocus
                aria-label={W.setup.own}
                placeholder={W.setup.ownPlaceholder}
                value={own}
                onChange={(event) => onOwn(event.target.value)}
              />
            </div>
          )}
        </section>
      </div>
      <div className="mt-5 flex justify-end border-t border-line pt-4">
        <Button size="sm" variant="primary" type="submit" disabled={mission.trim() === ""}>
          {W.setup.next}
        </Button>
      </div>
    </form>
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

/** A setting's row: its name, and the control that sets it. */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
      <span className="text-sm text-fg">{label}</span>
      <div className="w-full sm:w-64">{children}</div>
    </div>
  );
}

/** A writing setting: its name in a column of its own, so the three controls line up. */
function StyleRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid items-center gap-x-3 gap-y-1.5 sm:grid-cols-[6.5rem_minmax(0,1fr)]">
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
      <p className="mt-2 font-medium text-fg">{W.tickets.flaky.title}</p>
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

function HowStep({
  settings,
  onSettings,
  onBack,
  onStart,
}: {
  settings: CompanySettings;
  onSettings: (settings: CompanySettings) => void;
  onBack: () => void;
  onStart: () => void;
}) {
  const W = useWords();
  const F = W.setup.flow;
  const S = W.setup.schedules;
  const T = W.setup.style;
  const set = (patch: Partial<CompanySettings>) => onSettings({ ...settings, ...patch });
  const start = (event: FormEvent) => {
    event.preventDefault();
    onStart();
  };
  return (
    <form onSubmit={start} className="mx-auto w-full max-w-3xl py-6">
      <Intro step="how" title={W.setup.howTitle} body={W.setup.howBody} />
      <div className="mt-8 space-y-8">
        <section aria-label={F.title}>
          <h2 className={LABEL}>{F.title}</h2>
          <ol className="mt-3">
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
              {settings.verify ? F.verify.on(W.people.verifier.name) : F.verify.off}
            </Stop>
            <Stop n={4} title={F.review.title} last>
              {F.review.body}
            </Stop>
          </ol>
          <p className="mt-3 border-l-2 border-line pl-3 text-sm text-fg">{F.note}</p>
        </section>

        <section aria-label={S.title} className="space-y-4">
          <h2 className={LABEL}>{S.title}</h2>
          <div>
            <Row label={`${S.patrol} · ${S.patrolWhen}`}>
              <Segmented<PatrolMode>
                cols={3}
                value={settings.patrol}
                onChange={(patrol) => set({ patrol })}
                options={(["off", "propose", "auto"] as const).map((mode) => ({
                  value: mode,
                  label: W.schedule.modes[mode],
                }))}
              />
            </Row>
            <p className={`mt-1 text-xs ${QUIET}`}>{S.patrolHint[settings.patrol]}</p>
          </div>
          <div>
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
              <span className="text-sm text-fg">{`${S.retro} · ${S.retroWhen}`}</span>
              <span className={`text-xs ${QUIET}`}>{W.schedule.autoOff}</span>
            </div>
            <p className={`mt-1 text-xs ${QUIET}`}>{S.retroHint}</p>
          </div>
        </section>

        <section aria-label={T.title}>
          <h2 className={LABEL}>{T.title}</h2>
          <div className="mt-3 grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
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
        </section>
      </div>
      <div className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-4">
        <Button size="sm" variant="ghost" onClick={onBack}>
          {W.setup.back}
        </Button>
        <p className={`min-w-0 flex-1 basis-56 text-xs ${QUIET}`}>{W.setup.defaults}</p>
        <Button size="sm" variant="primary" type="submit">
          {W.setup.start}
        </Button>
      </div>
    </form>
  );
}

export function SetupPage({
  onStart,
}: {
  onStart: (mission: string, workspace: WorkspaceId, settings: CompanySettings) => void;
}) {
  const W = useWords();
  const [step, setStep] = useState<Step>("what");
  const [workspace, setWorkspace] = useState<WorkspaceId>(WORKSPACES[0]);
  const [choice, setChoice] = useState("0");
  const [own, setOwn] = useState("");
  const [settings, setSettings] = useState<CompanySettings>(DEFAULT_SETTINGS);
  const mission =
    choice === OWN ? own : (W.workspaces[workspace].missions[Number(choice)]?.label ?? "");
  return (
    <PageFrame width="full" contentClassName="flex min-h-full flex-col justify-center">
      {step === "what" ? (
        <WhatStep
          workspace={workspace}
          onWorkspace={(next) => {
            setWorkspace(next);
            // What was suggested belongs to the old workspace; the reader's own words stay.
            if (choice !== OWN) setChoice("0");
          }}
          choice={choice}
          onChoice={setChoice}
          own={own}
          onOwn={setOwn}
          mission={mission}
          onNext={() => setStep("how")}
        />
      ) : (
        <HowStep
          settings={settings}
          onSettings={setSettings}
          onBack={() => setStep("what")}
          onStart={() => onStart(mission, workspace, settings)}
        />
      )}
    </PageFrame>
  );
}

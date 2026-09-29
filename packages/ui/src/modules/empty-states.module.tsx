/**
 * Empty states & onboarding: the surfaces that have nothing on them yet, and still have to say
 * what to do next.
 *
 * - First session: a Session before its first message — the question it opens with and three
 *   prompts to start from; the reader picks one and its prompt fills the composer;
 * - Empty list: the Agents page of a Project that has none, with the two create paths as its
 *   action;
 * - No results: a search that missed, the table frame kept so the page does not jump when a row
 *   comes back;
 * - First run: the checklist, what is already done and what is next.
 *
 * Static stand-ins for W1's `Skeleton` and `EmptyState`, W4's `ProgressBar` and W6's `Composer`.
 */
import { useState } from "react";
import { fixturesFor } from "../fixtures";
import type { ExamplePromptFixture, Fixtures } from "../fixtures";
import { APP_COLUMN_WIDTH, defineModule } from "../module";
import { AgentTile } from "../screens/parts";
import {
  AgentCard,
  AgentsHeader,
  Button,
  Card,
  CreateButtons,
  EmptyState,
  GlyphIcon,
  Heading,
  IconButton,
  PageHeader,
  ProgressBar,
  SearchInput,
  Text,
} from "./parts";

const STAGE = "relative h-[32rem] overflow-hidden rounded-lg border border-line bg-canvas";

/**
 * The composer of a Session with nothing in it yet; the picked example arrives as its draft, and
 * the reader can go on writing it.
 */
function ComposerCard({
  f,
  draft,
  onDraft,
}: {
  f: Fixtures;
  draft: string;
  onDraft: (draft: string) => void;
}) {
  return (
    <div className="shrink-0 px-4 pb-4">
      <div className="mx-auto max-w-2xl rounded-lg border border-line-emphasis bg-surface px-3 py-2 transition-[border-color,box-shadow] duration-150 focus-within:border-accent focus-within:[box-shadow:var(--ui-focus-ring-input)]">
        {/*
          The field grows with its draft: an invisible copy of the text sits in the same grid cell
          and sets the height, so a long example shows whole, as the still prints it.
        */}
        <div className="grid">
          <span
            aria-hidden
            className="invisible col-start-1 row-start-1 min-h-6 whitespace-pre-wrap break-words font-sans text-base leading-6"
          >
            {`${draft} `}
          </span>
          <textarea
            value={draft}
            onChange={(event) => onDraft(event.target.value)}
            placeholder={f.copy.chat.inputPlaceholder}
            aria-label={f.copy.chat.inputPlaceholder}
            rows={1}
            className="col-start-1 row-start-1 min-h-6 w-full resize-none overflow-hidden bg-transparent font-sans text-base leading-6 text-fg outline-none placeholder:text-fg-subtle"
          />
        </div>
        <div className="mt-1 flex items-center gap-2">
          <GlyphIcon name="plus" size={16} className="text-fg-subtle" />
          <span className="min-w-0 flex-1" />
          <Button variant="primary" size="sm" state={draft ? "rest" : "disabled"}>
            {f.copy.chat.send}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * One prompt an empty Session offers (W6: the chat's empty state). Its mark tells the three cards
 * apart at a glance and says nothing the title does not, so it takes `ui-icon-decor` with the
 * empty state's role and a theme may tint it or drop it.
 */
function ExampleCard({
  example,
  picked,
  onPick,
}: {
  example: ExamplePromptFixture;
  picked: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={picked}
      onClick={onPick}
      className={`grid grid-cols-[minmax(0,1fr)] content-start gap-1 rounded-md border px-3 py-3 text-left transition-colors duration-150 ${
        picked ? "border-accent bg-accent-muted" : "border-line hover:bg-surface-muted"
      }`}
    >
      <GlyphIcon name={example.icon} size={15} decor="empty" className="text-fg-subtle" />
      <span className="text-sm font-(--ui-weight-medium) text-fg">{example.title}</span>
      <span className="font-sans text-xs leading-5 text-fg-muted">{example.prompt}</span>
    </button>
  );
}

/**
 * First session, for the reader to start from: the question and its three prompts, with the
 * middle one picked and its whole prompt in the composer, as the still shows it. Clicking another
 * prompt puts that one in the composer instead, and the draft can be written on from there; send
 * lights up while there is something to send. An empty Session is the first thing a new reader
 * sees, so it says what this thing does by offering work rather than by explaining itself.
 */
function FirstSession({ f }: { f: Fixtures }) {
  const e = f.emptyStates.firstSession;
  // The middle prompt: the one a reader picks is the one they did not have to scroll to.
  const [chosen, setChosen] = useState<ExamplePromptFixture | undefined>(e.examples[1]);
  const [draft, setDraft] = useState(chosen?.prompt ?? "");
  return (
    <div className={STAGE}>
      <div className="flex h-full flex-col">
        <header className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-2">
          <AgentTile id={f.agents[0]!.id} name={f.agents[0]!.name} size={16} />
          <h1 className="min-w-0 flex-1 truncate text-sm font-(--ui-weight-strong) text-fg">
            {f.copy.nav.newChat}
          </h1>
          <IconButton label={f.copy.common.more} icon="more" size="sm" />
        </header>
        <div className="flex min-h-0 flex-1 items-center justify-center px-6">
          <div className="grid w-full max-w-2xl grid-cols-[minmax(0,1fr)] justify-items-center gap-4">
            <div className="grid grid-cols-[minmax(0,1fr)] justify-items-center gap-2 text-center">
              <Heading level={2}>{e.title}</Heading>
              <p className="max-w-md text-sm text-fg-muted">{e.body}</p>
            </div>
            <Text variant="eyebrow">{e.examplesLabel}</Text>
            <div className="grid w-full grid-cols-3 gap-2">
              {e.examples.map((example) => (
                <ExampleCard
                  key={example.title}
                  example={example}
                  picked={example === chosen}
                  onPick={() => {
                    setChosen(example);
                    setDraft(example.prompt);
                  }}
                />
              ))}
            </div>
          </div>
        </div>
        <ComposerCard
          f={f}
          draft={draft}
          onDraft={(next) => {
            setDraft(next);
            // A prompt written away from the example is the reader's own: the card lets go.
            if (chosen !== undefined && next !== chosen.prompt) setChosen(undefined);
          }}
        />
      </div>
    </div>
  );
}

/**
 * Empty list: the Agents page of a Project with no Agent of its own — the built-in Agent's card,
 * then one quiet line and the two ways to make one.
 */
function EmptyList({ f }: { f: Fixtures }) {
  const a = f.copy.agents;
  return (
    <div className={STAGE}>
      <div className="mx-auto grid max-w-5xl grid-cols-[minmax(0,1fr)] gap-4 p-6">
        <AgentsHeader f={f} />
        {f.agents
          .filter((agent) => agent.builtin)
          .map((agent) => (
            <AgentCard key={agent.id} f={f} agent={agent} />
          ))}
        <EmptyState
          variant="list"
          title={a.empty.title}
          description={a.empty.body}
          action={<CreateButtons f={f} />}
        />
      </div>
    </div>
  );
}

/**
 * No results: the search kept, the column head kept, and one line saying what to do — a page that
 * throws its frame away makes the reader find their place again when a row comes back.
 */
function NoResults({ f }: { f: Fixtures }) {
  const n = f.emptyStates.noResults;
  const m = f.copy.models;
  return (
    <div className={STAGE}>
      <div className="mx-auto grid max-w-2xl grid-cols-[minmax(0,1fr)] gap-4 px-6 py-6">
        <PageHeader title={m.title} info={m.pageInfo} />
        <SearchInput value={n.query} placeholder={m.search} />
        <div className="overflow-hidden rounded-lg border border-line">
          <div className="grid grid-cols-4 gap-4 border-b border-line bg-surface-muted px-3 py-2 text-xs text-fg-muted">
            <span>{m.model}</span>
            <span>{m.provider}</span>
            <span>{m.context}</span>
            <span>{m.output}</span>
          </div>
          <EmptyState
            title={n.title}
            description={n.body}
            action={
              <Button variant="secondary" leading={<GlyphIcon name="cross" size={13} />}>
                {n.clear}
              </Button>
            }
          />
        </div>
      </div>
    </div>
  );
}

/** First run: four steps, the finished ones ticked, the next one holding the only filled button. */
function FirstRun({ f }: { f: Fixtures }) {
  const r = f.emptyStates.firstRun;
  const done = r.steps.filter((step) => step.done).length;
  const current = r.steps.findIndex((step) => !step.done);
  return (
    <div className={STAGE}>
      <div className="mx-auto grid max-w-xl grid-cols-[minmax(0,1fr)] gap-4 px-6 py-6">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
          <Heading level={2}>{r.title}</Heading>
          <p className="text-sm text-fg-muted">{r.body}</p>
          <div className="flex items-center gap-3 pt-1">
            <ProgressBar value={done / r.steps.length} tone="success" label={r.title} />
            <span className="shrink-0 text-xs tabular-nums text-fg-muted">
              {r.progress(done, r.steps.length)}
            </span>
          </div>
        </div>
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-2">
          {r.steps.map((step, i) => (
            <li key={step.title}>
              <Card className="flex items-start gap-3 px-4 py-3">
                {step.done ? (
                  <span className="pt-0.5 text-tone-success-fg">
                    <GlyphIcon name="circleCheck" size={16} />
                  </span>
                ) : (
                  <span
                    className={`flex size-5 shrink-0 items-center justify-center rounded-full border text-xs tabular-nums ${
                      i === current ? "border-accent text-fg" : "border-line text-fg-subtle"
                    }`}
                  >
                    {i + 1}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p
                    className={`text-sm font-(--ui-weight-medium) ${step.done ? "text-fg-muted" : "text-fg"}`}
                  >
                    {step.title}
                  </p>
                  <p className="mt-0.5 text-sm text-fg-muted">{step.body}</p>
                </div>
                {!step.done && (
                  <Button variant={i === current ? "primary" : "secondary"} size="sm">
                    {step.action}
                  </Button>
                )}
              </Card>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

const VARIANTS = {
  "first-session": FirstSession,
  "empty-list": EmptyList,
  "no-results": NoResults,
  "first-run": FirstRun,
} as const;

export const module = defineModule({
  id: "empty-states",
  title: "Empty states & onboarding",
  description:
    "What a surface with nothing on it says instead: a Session's first prompts, a list with no rows, a search that missed, and the first-run checklist.",
  width: "wide",
  viewport: APP_COLUMN_WIDTH,
  variants: [
    { key: "first-session", title: "First session", kind: "interactive" },
    { key: "empty-list", title: "Empty list", kind: "static" },
    { key: "no-results", title: "No results", kind: "static" },
    { key: "first-run", title: "First run", kind: "static" },
  ],
  parts: [
    "feedback-empty-state",
    "feedback-skeleton",
    "feedback-progress-bar",
    "actions-create-buttons",
    "actions-button",
    "forms-search-input",
    "chat-composer",
    "layout-page-frame",
    "layout-card",
  ],
  render: (variant, { lang }) => {
    const View = VARIANTS[variant as keyof typeof VARIANTS] ?? FirstSession;
    return <View f={fixturesFor(lang)} />;
  },
});

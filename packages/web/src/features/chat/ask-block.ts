/**
 * The question card an assistant reply can carry (pure logic, node-testable — the card
 * component in ask-card.tsx and the notification hook drive it).
 *
 * **Why a fenced block and not a parsed convention.** A reply that asks the user to choose
 * needs a machine-readable shape; reading options out of ordinary prose would mean guessing
 * where one option ends and the next begins, and a guess that fails silently renders a
 * broken card rather than a readable message. A fence is already valid Markdown (an
 * unrecognized info string degrades to a code block, so a client that predates this feature
 * shows the text instead of losing it), it survives every renderer this app uses, and its
 * body is line-oriented — which is what keeps the authoring instruction short enough for a
 * model to follow reliably. JSON was the alternative; it buys nesting this format has no use
 * for and costs every description its escaping.
 *
 * **The shape of the body.** `title:` is required and is the question itself. `select:`
 * picks single (the default) or multi. Numbered lines are the options, in the order they
 * declare. `recommend:` names the option numbers the author suggests — advisory only: the
 * card renders them as a hint and never pre-selects, because a pre-selected option turns a
 * double-click on Submit into an answer the user never gave. Unknown lines are ignored, so a
 * later version can add keys without breaking this one.
 *
 * **The trailing "Other" row is not authored.** Every card gets one, so the instruction to
 * write it can never be forgotten and can never be written twice.
 */
/**
 * The localized words a composed answer needs. Passed in rather than read from `S` here:
 * the active dictionary is module state that only components may read (see lib/strings.ts),
 * and these words are user-facing copy like any other.
 */
export interface AskAnswerLabels {
  /**
   * Label of the free-text row *including its separator* ("其他：" / "Other: ") — the two
   * languages disagree about both the colon and the space after it, and a separator invented
   * here would be wrong in one of them.
   */
  other: string;
  /** What a skipped question says in the composed message. */
  skipped: string;
}

/** One selectable option: its declared number (1-based) and its text. */
export interface AskOption {
  /** The number the author wrote — kept as the option's identity in the composed answer. */
  index: number;
  text: string;
}

/** One parsed question. */
export interface AskCard {
  /** The question itself. */
  title: string;
  /** Whether more than one option may be chosen. */
  multi: boolean;
  /** Declared options, ascending by `index`; at least two (a one-option question is prose). */
  options: AskOption[];
  /** Option indices the author recommends, ascending; empty when the author named none. */
  recommended: number[];
}

/** A run of assistant text, split around every card it carries. */
export type AssistantSegment = { kind: "text"; text: string } | { kind: "ask"; card: AskCard };

/** Minimum options a body needs before it is a question rather than a list. */
const MIN_OPTIONS = 2;

/** `1.` / `1、` / `1)` — the three numberings a model reaches for. */
const OPTION_RE = /^(\d+)\s*[.、)．]\s*(.+)$/;

/** The fence that opens a card: an info string of exactly `ask`. */
const OPEN_RE = /^```+\s*ask\s*$/i;
/** Any closing fence. */
const CLOSE_RE = /^```+\s*$/;
/** The same opening fence searched for from anywhere (multiline), for a cheap "might hold a card" probe. */
const MAYBE_ASK_RE = /^```+\s*ask\s*$/im;

/**
 * Parse one card body (the lines between the fences). Returns null when the body is not a
 * well-formed question — the caller then leaves the text alone rather than rendering an
 * empty card.
 */
export function parseAskBlock(body: string): AskCard | null {
  let title: string | null = null;
  let multi = false;
  const options: AskOption[] = [];
  const recommended: number[] = [];
  const seen = new Set<number>();

  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "") continue;

    const option = OPTION_RE.exec(line);
    if (option !== null) {
      const index = Number(option[1]);
      // A repeated number is a malformed body, not a second option: two options the card
      // cannot tell apart would make the composed answer ambiguous.
      if (!Number.isInteger(index) || index < 1 || seen.has(index)) return null;
      seen.add(index);
      options.push({ index, text: option[2]!.trim() });
      continue;
    }

    const sep = line.indexOf(":");
    if (sep <= 0) continue; // Not a key/value line: ignore rather than fail (forward compatible).
    const key = line.slice(0, sep).trim().toLowerCase();
    const value = line.slice(sep + 1).trim();
    if (key === "title") title = value === "" ? null : value;
    else if (key === "select" || key === "mode") multi = value.toLowerCase().startsWith("multi");
    else if (key === "recommend") recommended.push(...parseNumbers(value));
  }

  if (title === null || options.length < MIN_OPTIONS) return null;
  options.sort((a, b) => a.index - b.index);
  const known = new Set(options.map((o) => o.index));
  const recommendedKept = [...new Set(recommended)]
    .filter((n) => known.has(n))
    .sort((a, b) => a - b);
  // A multi-select card never recommends: "all of them" is not a recommendation, and the
  // hint would either mark every row or mark an arbitrary subset.
  return { title, multi, options, recommended: multi ? [] : recommendedKept };
}

function parseNumbers(value: string): number[] {
  return value
    .split(/[^\d]+/)
    .filter((part) => part !== "")
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
}

/**
 * Split an assistant message into its plain-text runs and the cards it carries, in order.
 * Text is returned verbatim (fences included) when no card parses, so a client that cannot
 * read a body still shows what the model wrote.
 */
export function splitAskBlocks(text: string): AssistantSegment[] {
  const lines = text.split(/\r?\n/);
  const segments: AssistantSegment[] = [];
  let textBuf: string[] = [];
  const flushText = () => {
    const joined = textBuf.join("\n");
    textBuf = [];
    // Blank runs carry no content once the cards around them are real elements with their own
    // spacing, and an empty text segment would render as an empty Markdown block.
    if (joined.trim() !== "") segments.push({ kind: "text", text: joined });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!OPEN_RE.test(line.trim())) {
      textBuf.push(line);
      continue;
    }
    let end = i + 1;
    while (end < lines.length && !CLOSE_RE.test(lines[end]!.trim())) end++;
    const body = lines.slice(i + 1, end).join("\n");
    const card = end < lines.length ? parseAskBlock(body) : null;
    if (card === null) {
      textBuf.push(line); // Unparsed (or unterminated): leave the fence in the text.
      continue;
    }
    flushText();
    segments.push({ kind: "ask", card });
    i = end;
  }
  flushText();
  return segments;
}

/**
 * How many cards a message carries, for callers that only need the count (the notification
 * hook asks this of every rendered message, so the fence probe short-circuits the line walk
 * for the overwhelming majority that carry no fence at all).
 */
export function countAskCards(text: string): number {
  if (!MAYBE_ASK_RE.test(text)) return 0;
  let count = 0;
  for (const segment of splitAskBlocks(text)) if (segment.kind === "ask") count++;
  return count;
}

/** One card's answer, as the user left it when they pressed Submit. */
export interface AskAnswer {
  title: string;
  /** Chosen option texts, in card order. */
  choices: string[];
  /** The free-text row's content; empty when untouched. */
  other: string;
  /** The user skipped the question outright. */
  skipped: boolean;
}

/**
 * Compose the user message that Submit sends: one question per block, its answer as a bullet
 * list. The title leads every block because a batch submit merges several cards into ONE
 * message, where the answers would otherwise arrive as unlabeled lists. A skipped question
 * says so rather than being dropped: the model needs to tell "the user passed on this" from
 * "the user never saw this", or it will ask again.
 */
export function composeAskAnswers(answers: readonly AskAnswer[], labels: AskAnswerLabels): string {
  const blocks = answers.map((answer) => {
    const lines = [answer.title];
    if (answer.skipped) {
      lines.push(`- ${labels.skipped}`);
    } else {
      for (const choice of answer.choices) lines.push(`- ${choice}`);
      if (answer.other.trim() !== "") lines.push(`- ${labels.other}${answer.other.trim()}`);
    }
    return lines.join("\n");
  });
  return blocks.join("\n\n");
}

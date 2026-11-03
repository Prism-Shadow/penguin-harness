/**
 * How a leaderboard's numbers are computed, said in sentences drawn from its entries: what one
 * entry is, how its score combines its experiments, what the ± is, and what cost, time and tokens
 * count. Wording follows the data, so a board that mixes ops or std methods says so.
 */
import type { LeaderboardEntry } from "../../../lib/hub/types";
import { S } from "../../../lib/strings";
import { InlineText } from "../inline-text";

const distinct = <T,>(values: readonly T[]): T[] => [...new Set(values)];

export function MethodNote({ entries }: { entries: readonly LeaderboardEntry[] }) {
  const t = S.hub.leaderboards.method;
  const ops = distinct(entries.map((entry) => entry.op));
  const counts = distinct(entries.map((entry) => entry.parts.length));
  const phases = distinct(entries.flatMap((entry) => entry.parts.map((part) => part.phase)));
  const metrics = distinct(entries.flatMap((entry) => entry.parts.map((part) => part.metric)));
  const stdFrom = distinct(entries.map((entry) => entry.stdFrom));
  const attempts = distinct(
    entries.filter((entry) => entry.stdFrom === "attempts").map((entry) => entry.attempts),
  );

  const sentences = [t.entry];
  if (ops.length === 1 && counts.length === 1 && phases.length === 1 && metrics.length === 1) {
    const [op, count, phase, metric] = [ops[0]!, counts[0]!, phases[0]!, metrics[0]!];
    sentences.push(op === null ? t.scoreSingle(metric, phase) : t.score(op, count, metric, phase));
  } else {
    sentences.push(t.scoreMixed);
  }
  if (stdFrom.includes("attempts")) {
    sentences.push(t.stdAttempts(attempts.length === 1 ? attempts[0]! : null));
  }
  if (stdFrom.includes("experiments")) {
    sentences.push(stdFrom.includes("attempts") ? t.stdExperimentsSome : t.stdExperiments);
  }
  sentences.push(t.resources, t.waffle);

  return (
    <div className="flex flex-col gap-2 text-sm leading-7 text-gray-700 dark:text-gray-300">
      {sentences.map((sentence) => (
        <p key={sentence}>
          <InlineText>{sentence}</InlineText>
        </p>
      ))}
    </div>
  );
}

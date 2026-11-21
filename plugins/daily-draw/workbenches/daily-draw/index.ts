import { date, requireValue, text, workbench } from "./desk-kit.js";
import { SLIPS } from "./prompts.js";
interface Draw {
  day: string;
  index: number;
  slip: readonly string[];
  note: string;
}
export default workbench<{ draws: Draw[] }>({ draws: [] }, (journal, a) => {
  const day = date(a.day);
  const existing = journal.draws.find((d) => d.day === day);
  if (a.type === "draw") {
    if (existing) return;
    requireValue(journal.draws.length < 3650, "full");
    const recent = new Set(journal.draws.slice(0, 12).map((d) => d.index));
    const pool = SLIPS.map((_, i) => i).filter((i) => !recent.has(i));
    const index = pool[Math.floor(Math.random() * pool.length)]!;
    journal.draws.push({ day, index, slip: SLIPS[index], note: "" });
    journal.draws.sort((a, b) => b.day.localeCompare(a.day));
  } else if (a.type === "note") {
    requireValue(existing);
    existing.note = text(a.note, 600, true);
  } else requireValue(false);
});

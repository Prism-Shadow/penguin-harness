// What the page shows of a reply while it is still arriving: the words, with the stage's
// directives taken out the moment they can be told from words, and the mood as soon as its
// line is complete. The handler reads the finished reply itself; this is only the draft.

const OPENERS = ["<stage", "<remember>", "<choices>"];
const MOODS = new Set([
  "neutral",
  "happy",
  "laugh",
  "shy",
  "sad",
  "pout",
  "surprised",
  "thinking",
  "sleepy",
  "wink",
]);

/** `{ text, mood }` of a reply so far; `mood` is null until the stage line has arrived whole. */
export function draftOf(raw) {
  let mood = null;
  let text = String(raw ?? "").replace(/<stage\b([^>]*?)\/?>/gi, (_tag, attrs) => {
    const found = /mood\s*=\s*"?([a-z]+)"?/i.exec(attrs);
    if (found && MOODS.has(found[1].toLowerCase())) mood = found[1].toLowerCase();
    return "";
  });
  text = text
    .replace(/<remember>[\s\S]*?<\/remember>/gi, "")
    .replace(/<choices>[\s\S]*?<\/choices>/gi, "");
  // A directive that has opened and not closed yet hides everything after its opening.
  const lower = text.toLowerCase();
  let cut = text.length;
  for (const opener of OPENERS) {
    const at = lower.lastIndexOf(opener);
    if (at >= 0) cut = Math.min(cut, at);
  }
  // So does a tail that may still become one ("<", "<st", "<rem").
  const tail = lower.lastIndexOf("<");
  if (tail >= 0 && tail < cut) {
    const rest = lower.slice(tail);
    if (OPENERS.some((opener) => opener.startsWith(rest))) cut = tail;
  }
  return {
    text: text
      .slice(0, cut)
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
    mood,
  };
}

#!/usr/bin/env node
/**
 * A stand-in for `claude`, for the integration test: the shape of a TUI without the TUI.
 *
 * Prints a banner with its arguments, "works" for a moment, then waits at a prompt; each line
 * typed makes it work again and answer, `exit` ends it.
 *
 * What matters for the surface's state is the SPINNER LINE, not the rhythm: the real program
 * draws `<glyph> <Word>…` while a turn is in flight and a past tense with no ellipsis once it
 * ends, and that shape is what the surface reads. So this draws the same two lines in the
 * same place — with a different gerund each time, because the real one does that too and
 * nothing may depend on the word.
 */
import { createInterface } from "node:readline";

const WORK_MS = 800;
const TICK_MS = 100;

/** The frames and the words the real one animates through; neither may be depended on. */
const FRAMES = ["✻", "✽", "✶", "·"];
const WORDS = ["Working", "Herding", "Wrangling", "Zigzagging"];
let turn = 0;

/** The line drawn while a turn is in flight, and the one left behind when it ends. */
const workingLine = (tick) =>
  `${FRAMES[tick % FRAMES.length]} ${WORDS[turn % WORDS.length]}… (${tick}s · esc to interrupt)`;
const doneLine = () => "✻ Worked for 1s · done";

function write(text) {
  process.stdout.write(text);
}

/** Redraws the last line in place, the way a status bar does. */
function bar(text) {
  write(`\r\u001b[2K${text}`);
}

async function work() {
  const until = Date.now() + WORK_MS;
  let tick = 0;
  while (Date.now() < until) {
    bar(workingLine(tick++));
    await new Promise((resolve) => setTimeout(resolve, TICK_MS));
  }
  turn++;
  bar(doneLine());
  write("\r\n");
}

const args = process.argv.slice(2);
write(`fake claude ${args.join(" ")}\r\n`);
await work();
write("> ");

const rl = createInterface({ input: process.stdin, terminal: false });
for await (const line of rl) {
  const text = line.trim();
  if (text === "exit") {
    write("bye\r\n");
    process.exit(0);
  }
  await work();
  write(`done: ${text}\r\n> `);
}
process.exit(0);

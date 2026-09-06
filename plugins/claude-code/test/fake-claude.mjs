#!/usr/bin/env node
/**
 * A stand-in for `claude`, for the integration test: the shape of a TUI without the TUI.
 *
 * Prints a banner with its arguments, "works" for a moment (a burst of output, the way the
 * real program's spinner redraws), then waits at a prompt; each line typed makes it work
 * again and answer, `exit` ends it. What the test needs from it is exactly that rhythm:
 * output → silence → output on input → exit.
 */
import { createInterface } from "node:readline";

const WORK_MS = 800;
const TICK_MS = 100;

function write(text) {
  process.stdout.write(text);
}

async function work() {
  const until = Date.now() + WORK_MS;
  while (Date.now() < until) {
    write(".");
    await new Promise((resolve) => setTimeout(resolve, TICK_MS));
  }
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

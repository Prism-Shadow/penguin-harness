/**
 * The rule an install on an Agent applies to a plugin's server module (PRFC-0031): each row is a
 * situation and what the platform does in it.
 *
 * - Already listed for this Project: nothing, whoever asks and whatever else holds.
 * - Stopped by the administrator: blocked for an install and for a member's ask; the
 *   administrator's explicit ask goes through.
 * - Built in, or asked by the administrator: listed, re-assembled only when no Project lists it.
 * - Neither, and already running: nothing to approve.
 * - Neither, and not running: a request — never from the system.
 */
import { describe, expect, it } from "vitest";
import { moduleStep } from "../src/plugin/module-rule.js";
import type { ModuleFacts, ModuleStep } from "../src/plugin/module-rule.js";

const NONE: ModuleFacts = {
  listed: false,
  inClosure: false,
  running: false,
  builtin: false,
  declined: false,
  admin: false,
  explicit: false,
  system: false,
};

const cases: Array<[string, Partial<ModuleFacts>, ModuleStep]> = [
  ["listed already, even when stopped", { listed: true, declined: true, admin: true }, "none"],
  ["stopped, a member installs a built-in", { declined: true, builtin: true }, "blocked"],
  ["stopped, a member asks by hand", { declined: true, explicit: true }, "blocked"],
  ["stopped, the administrator installs", { declined: true, admin: true }, "blocked"],
  [
    "stopped, the administrator asks by hand",
    { declined: true, admin: true, explicit: true },
    "load",
  ],
  ["built in, nobody lists it", { builtin: true }, "load"],
  ["built in, another Project lists it", { builtin: true, inClosure: true, running: true }, "list"],
  ["built in, the system's pass", { builtin: true, system: true }, "load"],
  ["not built in, the administrator installs", { admin: true }, "load"],
  ["not built in, running, a member installs", { running: true, inClosure: true }, "none"],
  ["not built in, off, a member installs", {}, "request"],
  ["not built in, off, a member asks by hand", { explicit: true }, "request"],
  ["not built in, off, the system's pass", { system: true }, "none"],
];

describe("moduleStep", () => {
  it.each(cases)("%s", (_situation, facts, step) => {
    expect(moduleStep({ ...NONE, ...facts })).toBe(step);
  });
});

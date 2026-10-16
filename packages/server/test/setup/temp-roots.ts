/**
 * Runs before every test file: when the file ends, the temp roots helpers.ts handed it and its
 * own hooks did not remove go too — a scenario that never cleaned up, an app whose boot it
 * expected to fail. Registered here, before the file's own hooks, so it runs after them.
 */
import { afterAll } from "vitest";
import { removeTempRoots } from "../helpers.js";

afterAll(removeTempRoots);

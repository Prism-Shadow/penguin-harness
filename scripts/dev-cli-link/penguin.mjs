#!/usr/bin/env node
/** `penguin` as `pnpm link:cli` puts it on PATH; see launch.mjs. */
import { launch } from "./launch.mjs";

await launch("penguin.js");

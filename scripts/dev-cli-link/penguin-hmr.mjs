#!/usr/bin/env node
/** `penguin-hmr` as `pnpm link:cli` puts it on PATH; see launch.mjs. */
import { launch } from "./launch.mjs";

await launch("penguin-hmr.js");

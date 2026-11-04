#!/usr/bin/env node
// The interface generator ships with core as the `penguin-gen-ifaces` bin; this path keeps
// the repository's build lines (`node ../../scripts/gen-ifaces.mjs …`) working.
import "../packages/core/bin/gen-ifaces.mjs";

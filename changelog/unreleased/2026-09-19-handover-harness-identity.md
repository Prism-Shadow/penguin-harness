# A web-only or CLI-only push reaches the machines

Date: 2026-09-19
Type: fix
Scope: server
PR: https://github.com/Prism-Shadow/penguin-harness/pull/799

A server that was hot-pushed hands its build over to the machines it holds, and decides which of them are behind by comparing versions (`<release>+hmr.<sha>`). The sha was read off the platform bundle alone, so a push that changed only the web app or only the CLI left the version as it was: every machine counted as up to date, the Machines page agreed, and the push was never handed over.

The suffix now identifies the harness — the platform bundle, the CLI bundle and the web artifact folded into one sha. Assets are deliberately no part of it: they are what a harness loads (plugins, the native modules it pins), not the harness.

Versions recorded for machines before this change carry the old suffix, so each held machine is handed the current build once more after the upgrade. Nothing has to be done by hand.

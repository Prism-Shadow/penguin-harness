---
title: Walk the Web App as a new user, along a fixed path and then freely
starts_from: install/from-ref
inputs:
  handover: <RUN>/install/from-ref/handover.md
cost: 45
platforms: [linux, macos, windows]
---

## Goal

Use the freshly installed product the way a new user would. First walk a fixed path, so that runs
on different refs and platforms can be compared step by step; then explore freely and look for
what a new user would trip over.

## Steps

Read `handover.md` first and sign in to the server it names. Drive the browser yourself
(Playwright or the platform's own) and keep `oplog.md` from the first click: one line per action,
with the time, what was clicked or typed, and what the screen showed.

The fixed path. On every page, list the page's title, switches and buttons, each present or
absent, and take one screenshot per step (`s<nn>-01-<what>.png`):

1. **First page after sign-in.** Notices shown, the sidebar, the Project switcher.
2. **Project switcher.** Open it; list the entries and actions.
3. **New Session.** Start one and look at the composer. Sending needs a model credential; when
   none is configured, record the message the product gives, then set one under Models (any key
   the run was given; an invalid key is enough to get a Session created) and record what happens.
   When choosing a working directory, confirm the typed path (Enter) before using it, and record
   whether the chosen directory is the one the Session got.
4. **System settings.** Open every page, in both groups, and record each page's controls.
5. **Files.** Open the Files panel of the Session from step 3; create a folder and a text file,
   and check they show up.
6. **Models.** The providers listed and the actions offered for each.
7. **Sandbox.** Where sandboxing is offered (settings, or a Session's permissions); which backends
   are listed for this platform; whether one that does not apply to this platform reads as "not
   applicable" rather than as missing.

Then explore freely for the rest of the budget: menus not on the path, the company mode switch,
resizing the window to a phone width, switching the interface language. Every finding gets its
own screenshot.

For every step, the counter-example is: a page that is blank, answers 404, shows raw JSON or an
untranslated key, or loses an element at some window size. Each is a finding; screenshot it as it
is.

## Record

In `<RUN>/first-run/walkthrough/`: `report.html` (the fixed path first, step by step, then the free
exploration), `shots/`, `oplog.md`, `issues.md`.

## Done when

Every step of the fixed path has a screenshot and a present/absent list, the free exploration has
used its share of the budget, and every finding is in `issues.md`.

## Never

- Change the server's sign-in, users or permissions beyond what a step asks for.
- Enter real credentials of anyone into the product; use only keys the run was given.
- Stop the server or edit the data root by hand; leave the environment as `handover.md` describes
  it, plus what the steps created through the UI.
- Report "looks fine" for a step without a screenshot that shows it.

/**
 * OmniMessage — PenguinHarness's primary message protocol: the envelope, every payload, and the
 * guards over them.
 *
 * The definitions live in `@prismshadow/amsp` (`packages/amsp/src/omnimessage/types.ts`): the
 * records a Trace holds are the records AMSP streams, and that package has no dependency and runs
 * in browsers. This module re-exports them, so every path that imported them from core — the
 * package root, `@prismshadow/penguin-core/omnimessage` and this file — keeps working.
 *
 * The rule for changing them (a closed vocabulary) is stated at the head of that file.
 */
export * from "@prismshadow/amsp/omnimessage";

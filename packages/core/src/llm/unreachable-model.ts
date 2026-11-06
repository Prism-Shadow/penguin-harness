/**
 * The LLM of a model context whose model cannot be reached: removed from the Project config,
 * or configured with a client that cannot be built (a deleted key). Only a resume that was
 * allowed such a model builds one (see ResumeSessionOptions.allowUnreachableModel), and only so
 * that a model switch can hand the history over by Trace path — the switch sends this object
 * nothing. A Session that is run on it instead sends nothing either: every request ends `fatal`
 * with the reason the resume would otherwise have thrown, so the transcript says why.
 */
import type { AmspRecord } from "@prismshadow/amsp/records";
import type { LLMInterface, LLMOutcome } from "../interfaces/index.js";

export function unreachableModel(reason: string): LLMInterface {
  return {
    async *streamGenerate(): AsyncGenerator<AmspRecord, LLMOutcome> {
      return { status: "fatal", errorCode: "unsupported", errorMessage: reason };
    },
  };
}

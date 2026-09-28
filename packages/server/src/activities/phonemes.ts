/**
 * A word's sounds (phonemes), from espeak-ng.
 *
 * espeak-ng is GPL-3.0 and Penguin is Apache-2.0, so it is never bundled: Penguin runs it as
 * a host program when it is there, `espeak-ng` on PATH or the program an admin named, and
 * says it is unavailable when it is not. It is started without a shell, one word at a time,
 * with a time limit, and nothing it prints is trusted beyond sounds that pass the word
 * asset's own check. A word it cannot sound out is left for a model run the author accepts.
 */
import { execFile } from "node:child_process";
import { Component, Interface, Use } from "@prismshadow/penguin-core/kernel";
import type { Settings } from "../mechanisms/settings.js";
import { HttpError } from "../http/errors.js";
import { cleanPhonemes } from "./book-words.js";
import type { EspeakStatus } from "./book-word-types.js";

/** The admin setting naming the espeak-ng program; unset runs `espeak-ng` from PATH. */
export const ESPEAK_PATH_SETTING = "activityPhonemes.espeakPath";
export const ESPEAK_DEFAULT_PROGRAM = "espeak-ng";
/** How long one call may take before it is stopped. */
export const ESPEAK_TIMEOUT_MS = 5_000;
/** The longest program path an admin may name. */
export const ESPEAK_PATH_MAX = 1024;
/** How many words are sounded out at once. */
const CONCURRENCY = 4;

/**
 * The espeak-ng voice for a language code: English is American unless the code says British;
 * any other language is its primary subtag ("es-US" is "es").
 */
export function espeakLanguage(code: string): string {
  const normalized = code.trim().toLowerCase().replace(/_/g, "-");
  const primary = normalized.split("-", 1)[0] ?? "";
  if (primary === "en") return normalized.endsWith("-gb") ? "en-gb" : "en-us";
  return primary;
}

/**
 * The sounds in espeak-ng's `--ipa --sep=" "` output for one word, stress marks removed, or
 * null when what it printed is not a word's sounds.
 */
export function parseEspeakOutput(stdout: string): string[] | null {
  const sounds = stdout.replace(/[ˈˌ]/g, "").split(/\s+/).filter(Boolean);
  return cleanPhonemes(sounds);
}

/** The version in `espeak-ng --version`'s answer ("eSpeak NG text-to-speech: 1.51 ..."). */
export function parseEspeakVersion(stdout: string): string | null {
  return /\d+\.\d+(?:\.\d+)?/.exec(stdout)?.[0] ?? null;
}

/** One finished call: whether the program ran and exited cleanly, and what it printed. */
export interface EspeakCall {
  ok: boolean;
  stdout: string;
}

/** Runs a program with arguments, no shell, stopped after `timeoutMs`. Never throws. */
export type EspeakRunner = (
  program: string,
  args: readonly string[],
  timeoutMs: number,
) => Promise<EspeakCall>;

/** The real runner: `execFile`, so arguments reach the program as they are. */
export const runEspeak: EspeakRunner = (program, args, timeoutMs) =>
  new Promise((resolve) => {
    try {
      execFile(
        program,
        [...args],
        {
          shell: false,
          timeout: timeoutMs,
          windowsHide: true,
          encoding: "utf8",
          maxBuffer: 64 * 1024,
        },
        (error, stdout) => resolve({ ok: !error, stdout: String(stdout ?? "") }),
      );
    } catch {
      resolve({ ok: false, stdout: "" });
    }
  });

/**
 * What the phonemes service runs. Absent, the real runner; a test stands in a fake so no
 * program is started.
 */
export abstract class EspeakPorts extends Interface<{
  run?: EspeakRunner;
}>() {}

@Component()
export class DefaultEspeakPorts implements EspeakPorts {}

export abstract class ActivityPhonemes extends Interface<{
  /** Whether espeak-ng answers, asked once per program and remembered. */
  status(): Promise<EspeakStatus>;
  /**
   * Sounds for each normalized word of a language, null for a word espeak-ng could not sound
   * out; every word null when espeak-ng is not available.
   */
  phonemesFor(words: readonly string[], language: string): Promise<Record<string, string[] | null>>;
  /** The program an admin named, or null. */
  espeakPath(): string | null;
  /** Name the program (null runs `espeak-ng` from PATH); the next status asks it afresh. */
  setEspeakPath(value: unknown): string | null;
}>() {}

@Component()
export class ActivityPhonemesService implements ActivityPhonemes {
  @Use() private readonly settings!: Settings;
  @Use() private readonly ports!: EspeakPorts;
  private probed: { program: string; status: Promise<EspeakStatus> } | null = null;

  private get runner(): EspeakRunner {
    return this.ports.run ?? runEspeak;
  }

  private program(): string {
    return this.espeakPath() ?? ESPEAK_DEFAULT_PROGRAM;
  }

  espeakPath(): string | null {
    const stored = this.settings.get(ESPEAK_PATH_SETTING)?.trim();
    return stored ? stored : null;
  }

  setEspeakPath(value: unknown): string | null {
    if (value !== null && typeof value !== "string")
      throw new HttpError(400, "invalid_espeak_path", "espeakPath must be a path or null.");
    const path = (value ?? "").trim();
    if (path.length > ESPEAK_PATH_MAX || /[\0\r\n]/.test(path))
      throw new HttpError(
        400,
        "invalid_espeak_path",
        `espeakPath must be one line of at most ${ESPEAK_PATH_MAX} characters.`,
      );
    this.settings.set(ESPEAK_PATH_SETTING, path);
    this.probed = null;
    return path || null;
  }

  status(): Promise<EspeakStatus> {
    const program = this.program();
    if (this.probed?.program !== program) {
      const status = this.runner(program, ["--version"], ESPEAK_TIMEOUT_MS).then((call) =>
        call.ok
          ? { available: true, version: parseEspeakVersion(call.stdout) }
          : { available: false, version: null },
      );
      this.probed = { program, status };
    }
    return this.probed.status;
  }

  async phonemesFor(
    words: readonly string[],
    language: string,
  ): Promise<Record<string, string[] | null>> {
    const found: Record<string, string[] | null> = Object.fromEntries(
      words.map((word) => [word, null]),
    );
    if (!words.length || !(await this.status()).available) return found;
    const program = this.program();
    const voice = espeakLanguage(language);
    const queue = [...new Set(words)];
    const worker = async () => {
      for (let word = queue.shift(); word !== undefined; word = queue.shift()) {
        const call = await this.runner(
          program,
          ["-q", "--ipa", "-v", voice, "--sep= ", word],
          ESPEAK_TIMEOUT_MS,
        );
        found[word] = call.ok ? parseEspeakOutput(call.stdout) : null;
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    return found;
  }
}

/**
 * Desktop download page. The buttons resolve to one of two sources: GitHub's static
 * `releases/latest/download/<name>` links — always valid because installer names are
 * version-less — or the OSS mirror's immutable per-tag URLs.
 *
 * Two passes decide, for the reason spelled out in lib/download-source.ts: whether a
 * source answers is a round trip, while how fast it is cannot be judged in under a
 * second at any probe size. So the buttons wait only on the first — one second at the
 * outside — and go live knowing nobody has been handed a link that will never start.
 * The throughput comparison then runs behind the live page and upgrades the links to the
 * mirror if it turns out to be worth switching to, which can cost a slower download but
 * never a broken one. Nothing is cached: conditions change between visits, so every load
 * measures again. Whatever the passes decide, the visitor can still switch by hand.
 *
 * Plain-anchor downloads are never CORS-gated; only the lookups and the probes are.
 * Below the cards, a first-launch FAQ covers the unsigned builds — one collapsible item
 * per platform (macOS quarantine removal, SmartScreen, AppImage execute bit), with the
 * visitor's own platform pre-expanded.
 */ import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { ReactNode } from "react";
import { S } from "../lib/strings";
import {
  DESKTOP_INSTALLERS,
  DESKTOP_SHA256SUMS,
  GITHUB_LATEST_DOWNLOAD,
  LINUX_APPIMAGE_CHMOD_CMD,
  MAC_UNQUARANTINE_CMD,
  RELEASES_URL,
} from "../lib/links";
import { detectPlatform } from "../lib/platform";
import type { Platform } from "../lib/platform";
import {
  GATE_BUDGET_MS,
  MIRROR_POINTER_MS,
  THROUGHPUT_BUDGET_MS,
  createDeadline,
  fetchMirror,
  gateDownloadSource,
  refineDownloadSource,
  worthRefining,
} from "../lib/download-source";
import type { DownloadSource, Mirror } from "../lib/download-source";
import { Section } from "../components/section";
import { CodeCard } from "../components/code-card";
import { ChevronDownIcon, DownloadIcon, ExternalLinkIcon, SpinnerIcon } from "../components/icons";

const PLATFORMS: Platform[] = ["mac", "windows", "linux"];

/**
 * One collapsible item of the first-launch FAQ. `defaultOpen` pre-expands the visitor's
 * own platform on mount; after that the element owns its open state (React only writes
 * the `open` property again if the rendered value changes, which it never does here).
 */
function FaqItem({
  question,
  defaultOpen,
  children,
}: {
  question: string;
  defaultOpen: boolean;
  children: ReactNode;
}) {
  return (
    <details
      open={defaultOpen}
      className="group rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium tracking-tight [&::-webkit-details-marker]:hidden">
        {question}
        <ChevronDownIcon className="h-4 w-4 shrink-0 text-gray-400 transition-transform group-open:rotate-180 dark:text-gray-500" />
      </summary>
      <div className="border-t border-gray-200 px-4 py-3 text-sm leading-6 text-gray-600 dark:border-gray-800 dark:text-gray-400">
        {children}
      </div>
    </details>
  );
}

export function DownloadPage() {
  const [mirror, setMirror] = useState<Mirror | null>(null);
  /** null until the reachability pass ends — the only thing the buttons wait on. */
  const [source, setSource] = useState<DownloadSource | null>(null);
  /** True while the throughput pass is still running behind the live buttons. */
  const [refining, setRefining] = useState(false);
  /** The visitor's own choice, which outranks both passes for the rest of the visit. */
  const [override, setOverride] = useState<DownloadSource | null>(null);
  useEffect(() => {
    let cancelled = false;
    // The pointer starts now and is handed to the gate still in flight: the gate only needs it on
    // the path where GitHub stayed silent, and the buttons should not wait on it otherwise.
    const mirrorPromise = fetchMirror(createDeadline(MIRROR_POINTER_MS));
    void mirrorPromise.then((resolved) => {
      if (!cancelled) setMirror(resolved);
    });
    void (async () => {
      const gated = await gateDownloadSource(mirrorPromise, createDeadline(GATE_BUDGET_MS));
      if (cancelled) return;
      setSource(gated);
      const resolved = await mirrorPromise;
      if (cancelled || !worthRefining(resolved) || !resolved) return;
      setRefining(true);
      const refined = await refineDownloadSource(resolved, createDeadline(THROUGHPUT_BUDGET_MS));
      if (cancelled) return;
      setSource(refined);
      setRefining(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const detected = detectPlatform();
  const probing = source === null;
  const selected: DownloadSource = override ?? source ?? "github";
  const viaMirror = mirror !== null && selected === "oss";
  const hrefFor = (file: string) =>
    viaMirror ? `${mirror.base}/${file}` : `${GITHUB_LATEST_DOWNLOAD}/${file}`;

  const textLink =
    "inline-flex items-center gap-1 text-brand-700 underline decoration-brand-300 underline-offset-2 transition-colors hover:text-brand-600 dark:text-brand-300 dark:decoration-brand-700";

  return (
    <Section eyebrow={S.download.eyebrow} title={S.download.title} subtitle={S.download.subtitle}>
      <div className="mx-auto grid max-w-4xl gap-4 sm:grid-cols-3">
        {PLATFORMS.map((platform) => (
          <div
            key={platform}
            className={`flex flex-col rounded-xl border bg-white p-5 dark:bg-gray-900 ${
              detected === platform
                ? "border-brand-500 ring-1 ring-brand-500"
                : "border-gray-200 dark:border-gray-800"
            }`}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold tracking-tight">
                {S.download.platforms[platform].name}
              </h3>
              {detected === platform && (
                <span className="rounded-full bg-brand-600/10 px-2 py-0.5 text-xs font-medium text-brand-700 dark:text-brand-300">
                  {S.download.recommended}
                </span>
              )}
            </div>
            <p className="mt-1 mb-4 text-xs leading-5 text-gray-500 dark:text-gray-400">
              {S.download.platforms[platform].require}
            </p>
            <div className="mt-auto flex flex-col gap-2">
              {DESKTOP_INSTALLERS[platform].map(({ file, variant }) => (
                <a
                  key={file}
                  // No href while probing: an anchor without one is not a link, which is exactly
                  // the state this is in — the source is not decided yet. The label and the box
                  // keep their size, so nothing shifts under the pointer when it resolves.
                  href={probing ? undefined : hrefFor(file)}
                  aria-disabled={probing || undefined}
                  className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3.5 py-2 text-sm font-medium transition-colors ${
                    probing
                      ? "cursor-progress bg-gray-200 text-gray-500 dark:bg-gray-800 dark:text-gray-500"
                      : "bg-gray-900 text-white hover:bg-gray-700 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-300"
                  }`}
                >
                  {probing ? (
                    <SpinnerIcon className="h-4 w-4 animate-spin" />
                  ) : (
                    <DownloadIcon className="h-4 w-4" />
                  )}
                  {variant}
                </a>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mx-auto mt-8 max-w-4xl text-center text-sm text-gray-600 dark:text-gray-400">
        <p aria-live="polite">
          {probing ? (
            <span className="inline-flex items-center gap-1.5">
              <SpinnerIcon className="h-3.5 w-3.5 animate-spin" />
              {S.download.statusProbing}
            </span>
          ) : (
            <>
              {viaMirror ? S.download.statusOss(mirror.tag) : S.download.statusGithub}{" "}
              {refining && (
                <>
                  <span className="inline-flex items-center gap-1.5 text-gray-500 dark:text-gray-500">
                    <SpinnerIcon className="h-3.5 w-3.5 animate-spin" />
                    {S.download.statusRefining}
                  </span>{" "}
                </>
              )}
              {mirror !== null && (
                <button
                  type="button"
                  className={textLink}
                  onClick={() => setOverride(viaMirror ? "github" : "oss")}
                >
                  {viaMirror ? S.download.altGithub : S.download.altOss}
                </button>
              )}
            </>
          )}
        </p>
        <p className="mt-2">
          <a href={hrefFor(DESKTOP_SHA256SUMS)} className={textLink}>
            {S.download.checksums}
          </a>
          <span className="mx-2 text-gray-300 dark:text-gray-700">·</span>
          <a href={RELEASES_URL} target="_blank" rel="noreferrer" className={textLink}>
            {S.download.allReleases}
            <ExternalLinkIcon className="h-3 w-3" />
          </a>
        </p>
      </div>

      <div className="mx-auto mt-12 max-w-2xl">
        <h3 className="text-center text-base font-semibold tracking-tight">
          {S.download.faq.title}
        </h3>
        <p className="mt-1 text-center text-sm leading-6 text-gray-600 dark:text-gray-400">
          {S.download.faq.intro}
        </p>
        <div className="mt-4 flex flex-col gap-3 text-left">
          <FaqItem question={S.download.faq.mac.question} defaultOpen={detected === "mac"}>
            <p>{S.download.faq.mac.why}</p>
            <ol className="mt-2 flex list-decimal flex-col gap-1.5 pl-5">
              <li>{S.download.faq.mac.stepDrag}</li>
              <li>{S.download.faq.mac.stepTerminal}</li>
              <li>
                {S.download.faq.mac.stepPaste}
                <CodeCard code={MAC_UNQUARANTINE_CMD} label="Terminal" className="mt-2 mb-1" />
              </li>
              <li>{S.download.faq.mac.stepOpen}</li>
            </ol>
          </FaqItem>
          <FaqItem question={S.download.faq.windows.question} defaultOpen={detected === "windows"}>
            <p>{S.download.faq.windows.answer}</p>
          </FaqItem>
          <FaqItem question={S.download.faq.linux.question} defaultOpen={detected === "linux"}>
            <p>{S.download.faq.linux.answer}</p>
            <CodeCard code={LINUX_APPIMAGE_CHMOD_CMD} label="shell" className="mt-2" />
          </FaqItem>
        </div>
      </div>

      <div className="mx-auto mt-10 max-w-4xl text-center">
        <p className="text-xs leading-5 text-gray-500 dark:text-gray-400">
          {S.download.cliHint}{" "}
          <Link to="/#quickstart" className={textLink}>
            {S.download.cliHintLink}
          </Link>
        </p>
      </div>
    </Section>
  );
}

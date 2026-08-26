/** Desktop downloads with platform-first choices and a visible source speed report. */
import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { ComponentType, ReactNode, SVGProps } from "react";
import { S } from "../lib/strings";
import {
  DESKTOP_INSTALLERS,
  DESKTOP_SHA256SUMS,
  GITHUB_LATEST_DOWNLOAD,
  LINUX_APPIMAGE_CHMOD_CMD,
  MAC_UNQUARANTINE_CMD,
  OSS_ORIGIN,
  RELEASES_URL,
} from "../lib/links";
import { detectPlatform } from "../lib/platform";
import type { Platform } from "../lib/platform";
import { RELEASE_VERSION } from "../lib/version";
import {
  GATE_BUDGET_MS,
  MIRROR_POINTER_MS,
  THROUGHPUT_BUDGET_MS,
  createDeadline,
  fetchMirror,
  gateDownloadSource,
  refineDownloadSourceWithReport,
  worthRefining,
} from "../lib/download-source";
import type {
  DownloadProbeReport,
  DownloadSource,
  Measurement,
  Mirror,
} from "../lib/download-source";
import { Section } from "../components/section";
import { CodeCard } from "../components/code-card";
import {
  CheckIcon,
  ChevronDownIcon,
  DownloadIcon,
  ExternalLinkIcon,
  LinuxIcon,
  MacOSIcon,
  SpinnerIcon,
  WindowsIcon,
} from "../components/icons";

const PLATFORMS: Platform[] = ["mac", "windows", "linux"];
const PLATFORM_ICONS: Record<Platform, ComponentType<SVGProps<SVGSVGElement>>> = {
  mac: MacOSIcon,
  windows: WindowsIcon,
  linux: LinuxIcon,
};
const PLATFORM_ICON_CLASSES: Record<Platform, string> = {
  mac: "bg-gray-100 text-gray-950 dark:bg-gray-800 dark:text-white",
  windows: "bg-gray-100 dark:bg-gray-800",
  linux: "bg-gray-100 dark:bg-gray-800",
};
const RELEASE_MIRROR: Mirror = {
  tag: RELEASE_VERSION,
  base: `${OSS_ORIGIN}/releases/${RELEASE_VERSION}`,
};

function installerSuffix(file: string): string {
  return file.match(/(\.AppImage|\.dmg|\.exe|\.deb)$/)?.[1] ?? "";
}

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

function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond >= 1024 * 1024) {
    return `${(bytesPerSecond / 1024 / 1024).toFixed(1)} MB/s`;
  }
  return `${Math.max(1, Math.round(bytesPerSecond / 1024))} KB/s`;
}

function speedText(measurement: Measurement | null, testing: boolean): string {
  if (testing) return S.download.speed.testing;
  if (measurement === null) return S.download.speed.skipped;
  if (!measurement.reachable) return S.download.speed.unreachable;
  if (measurement.bytesPerSecond <= 0) return S.download.speed.belowFloor;
  return formatSpeed(measurement.bytesPerSecond);
}

function filledSignalBars(
  measurement: Measurement | null,
  testing: boolean,
  selected: boolean,
): number {
  if (testing) return 2;
  if (!measurement || !measurement.reachable) return selected ? 2 : 1;
  if (measurement.bytesPerSecond <= 0) return 1;
  return Math.min(4, Math.max(1, Math.round(Math.log2(measurement.bytesPerSecond / 65536) + 1)));
}

const SIGNAL_HEIGHTS = [4, 7, 10, 13] as const;

function SourceSpeedButton({
  title,
  measurement,
  testing,
  selected,
  onSelect,
}: {
  title: string;
  measurement: Measurement | null;
  testing: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const filled = filledSignalBars(measurement, testing, selected);
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={`flex min-w-0 items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left transition-colors ${
        selected
          ? "border-brand-400 bg-brand-50/70 dark:border-brand-700 dark:bg-brand-950/50"
          : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700 dark:hover:bg-gray-800"
      }`}
    >
      <div className="min-w-0">
        <span className="flex items-center gap-1.5 truncate text-xs font-semibold tracking-tight sm:text-sm">
          {title}
          {selected && (
            <CheckIcon className="h-3 w-3 shrink-0 text-brand-600 dark:text-brand-300" />
          )}
        </span>
        <span className="mt-0.5 block font-mono text-[11px] text-gray-500 tabular-nums dark:text-gray-400">
          {speedText(measurement, testing)}
        </span>
      </div>
      <span className="flex h-4 shrink-0 items-end gap-0.5" aria-hidden="true">
        {SIGNAL_HEIGHTS.map((height, index) => (
          <span
            key={height}
            className={`w-1 rounded-[1px] ${testing ? "animate-pulse" : ""} ${
              index < filled
                ? selected
                  ? "bg-brand-500 dark:bg-brand-400"
                  : "bg-gray-500 dark:bg-gray-400"
                : "bg-gray-200 dark:bg-gray-800"
            }`}
            style={{ height: `${height}px`, animationDelay: `${index * 55}ms` }}
          />
        ))}
      </span>
    </button>
  );
}

export function DownloadPage() {
  const [mirror, setMirror] = useState<Mirror | null>(null);
  const [source, setSource] = useState<DownloadSource | null>(null);
  const [report, setReport] = useState<DownloadProbeReport | null>(null);
  const [refining, setRefining] = useState(false);
  const [override, setOverride] = useState<DownloadSource | null>(null);

  useEffect(() => {
    let cancelled = false;
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
      const refined = await refineDownloadSourceWithReport(
        resolved,
        createDeadline(THROUGHPUT_BUDGET_MS),
      );
      if (cancelled) return;
      if (refined) {
        setSource(refined.source);
        setReport(refined);
      }
      setRefining(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const detected = detectPlatform();
  const probing = source === null;
  const selected: DownloadSource = override ?? source ?? "github";
  const availableMirror = mirror ?? RELEASE_MIRROR;
  const awaitingAutomaticSource = probing && override === null;
  const viaMirror = selected === "oss";
  const hrefFor = (file: string) =>
    viaMirror ? `${availableMirror.base}/${file}` : `${GITHUB_LATEST_DOWNLOAD}/${file}`;
  const textLink =
    "inline-flex items-center gap-1 text-brand-700 underline decoration-brand-300 underline-offset-2 transition-colors hover:text-brand-600 dark:text-brand-300 dark:decoration-brand-700";

  return (
    <Section eyebrow={S.download.eyebrow} title={S.download.title} className="pt-14 sm:pt-20">
      <div className="mx-auto grid max-w-5xl gap-4 sm:grid-cols-3">
        {PLATFORMS.map((platform) => {
          const PlatformIcon = PLATFORM_ICONS[platform];
          const recommended = detected === platform;
          return (
            <article
              key={platform}
              className={`flex min-w-0 flex-col rounded-2xl border bg-white p-5 shadow-sm dark:bg-gray-900 ${
                recommended
                  ? "border-brand-500 ring-1 ring-brand-500"
                  : "border-gray-200 dark:border-gray-800"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <span
                  className={`inline-flex h-12 w-12 items-center justify-center rounded-xl ${PLATFORM_ICON_CLASSES[platform]}`}
                >
                  <PlatformIcon className="h-7 w-7" />
                </span>
                <div className="flex flex-wrap justify-end gap-1.5">
                  {recommended && (
                    <span className="rounded-full bg-brand-600/10 px-2 py-0.5 text-xs font-medium text-brand-700 dark:text-brand-300">
                      {S.download.recommended}
                    </span>
                  )}
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 tabular-nums dark:bg-gray-800 dark:text-gray-300">
                    {RELEASE_VERSION}
                  </span>
                </div>
              </div>
              <h3 className="mt-5 text-lg font-semibold tracking-tight">
                {S.download.platforms[platform].name}
              </h3>
              <p className="mt-1 mb-5 min-h-10 text-xs leading-5 text-gray-500 dark:text-gray-400">
                {S.download.platforms[platform].require}
              </p>
              <div className="mt-auto flex flex-col gap-2">
                {DESKTOP_INSTALLERS[platform].map(({ file, variant }) => (
                  <a
                    key={file}
                    href={awaitingAutomaticSource ? undefined : hrefFor(file)}
                    aria-disabled={awaitingAutomaticSource || undefined}
                    className={`inline-flex w-full items-center justify-center gap-1.5 rounded-lg px-3.5 py-2.5 text-sm font-medium transition-colors ${
                      awaitingAutomaticSource
                        ? "cursor-progress bg-gray-200 text-gray-500 dark:bg-gray-800 dark:text-gray-500"
                        : "bg-gray-900 text-white hover:bg-gray-700 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white"
                    }`}
                  >
                    {awaitingAutomaticSource ? (
                      <SpinnerIcon className="h-4 w-4 animate-spin" />
                    ) : (
                      <DownloadIcon className="h-4 w-4" />
                    )}
                    <span>{variant}</span>
                    <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold">
                      {installerSuffix(file)}
                    </span>
                  </a>
                ))}
              </div>
            </article>
          );
        })}
      </div>

      <section
        className="mx-auto mt-7 max-w-4xl rounded-xl border border-gray-200 bg-gray-50/80 p-2.5 dark:border-gray-800 dark:bg-gray-950/70"
        title={S.download.speed.subtitle}
      >
        <div className="flex items-center justify-between gap-3 px-0.5">
          <h3 className="text-sm font-semibold tracking-tight">{S.download.speed.title}</h3>
          <span className="inline-flex min-w-0 items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400">
            {(probing || refining) && <SpinnerIcon className="h-3 w-3 shrink-0 animate-spin" />}
            <span className="truncate">
              {selected === "oss" ? S.download.speed.oss : S.download.speed.github} ·{" "}
              {override ? S.download.speed.manual : S.download.speed.automatic}
            </span>
          </span>
        </div>

        <div className="mt-2 grid grid-cols-2 gap-2">
          <SourceSpeedButton
            title={S.download.speed.github}
            measurement={report?.github ?? null}
            testing={probing || refining}
            selected={selected === "github"}
            onSelect={() => setOverride("github")}
          />
          <SourceSpeedButton
            title={S.download.speed.oss}
            measurement={report?.oss ?? null}
            testing={probing || refining}
            selected={selected === "oss"}
            onSelect={() => setOverride("oss")}
          />
        </div>
      </section>

      <div className="mx-auto mt-4 max-w-5xl text-center text-sm text-gray-600 dark:text-gray-400">
        <p className="sr-only" aria-live="polite">
          {probing
            ? S.download.statusProbing
            : viaMirror
              ? S.download.statusOss(availableMirror.tag)
              : S.download.statusGithub}
        </p>
        <p>
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

      <div className="mx-auto mt-14 max-w-3xl">
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
          <Link to="/#quickstart-install" className={textLink}>
            {S.download.cliHintLink}
          </Link>
        </p>
      </div>
    </Section>
  );
}

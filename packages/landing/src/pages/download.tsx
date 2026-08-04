/**
 * Desktop download page. The buttons are static GitHub `releases/latest/download/<name>`
 * links by default — always valid because installer names are version-less — and swap to
 * the OSS mirror's immutable per-tag URLs once the bucket's `latest.json` pointer
 * resolves (validated the same way the installers validate it; any failure, e.g. CORS
 * not configured on the bucket or the mirror unreachable, silently keeps the GitHub
 * links). Plain-anchor downloads are never CORS-gated — only this version lookup is.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { S } from "../lib/strings";
import {
  DESKTOP_INSTALLERS,
  DESKTOP_SHA256SUMS,
  GITHUB_LATEST_DOWNLOAD,
  OSS_LATEST_JSON_URL,
  OSS_ORIGIN,
  RELEASES_URL,
} from "../lib/links";
import { Section } from "../components/section";
import { DownloadIcon, ExternalLinkIcon } from "../components/icons";

type Platform = "mac" | "windows" | "linux";
const PLATFORMS: Platform[] = ["mac", "windows", "linux"];

/** Coarse OS detection, used only to badge one card; absent or wrong detection changes nothing else. */
function detectPlatform(): Platform | null {
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return "windows";
  if (/Macintosh|Mac OS X/i.test(ua)) return "mac";
  if (/Linux|X11/.test(ua) && !/Android/i.test(ua)) return "linux";
  return null;
}

interface Mirror {
  tag: string;
  base: string;
}

/** latest.json validated like the installer forwarders validate it: schema 1, safe v-tag, fixed bucket base. */
function parseMirror(value: unknown): Mirror | null {
  if (typeof value !== "object" || value === null) return null;
  const manifest = value as { schemaVersion?: unknown; tag?: unknown; releaseBaseUrl?: unknown };
  if (manifest.schemaVersion !== 1 || typeof manifest.tag !== "string") return null;
  if (!/^v[0-9A-Za-z][0-9A-Za-z._-]*$/.test(manifest.tag)) return null;
  if (manifest.releaseBaseUrl !== `${OSS_ORIGIN}/releases/${manifest.tag}`) return null;
  return { tag: manifest.tag, base: manifest.releaseBaseUrl };
}

export function DownloadPage() {
  const [mirror, setMirror] = useState<Mirror | null>(null);
  const [forceGithub, setForceGithub] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    fetch(OSS_LATEST_JSON_URL, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: unknown) => {
        const parsed = parseMirror(body);
        if (parsed) setMirror(parsed);
      })
      .catch(() => {}) // The GitHub links already work; the mirror is a progressive upgrade.
      .finally(() => clearTimeout(timer));
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, []);

  const detected = detectPlatform();
  const viaMirror = mirror !== null && !forceGithub;
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
                  href={hrefFor(file)}
                  className="inline-flex items-center justify-center gap-1.5 rounded-md bg-gray-900 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-700 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-300"
                >
                  <DownloadIcon className="h-4 w-4" />
                  {variant}
                </a>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mx-auto mt-8 max-w-4xl text-center text-sm text-gray-600 dark:text-gray-400">
        <p>
          {viaMirror ? S.download.statusOss(mirror.tag) : S.download.statusGithub}{" "}
          {mirror !== null && (
            <button type="button" className={textLink} onClick={() => setForceGithub(!forceGithub)}>
              {forceGithub ? S.download.altOss : S.download.altGithub}
            </button>
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
        <p className="mt-6 text-xs leading-5 text-gray-500 dark:text-gray-400">
          {S.download.unsignedNote}
        </p>
        <p className="mt-2 text-xs leading-5 text-gray-500 dark:text-gray-400">
          {S.download.cliHint}{" "}
          <Link to="/#quickstart" className={textLink}>
            {S.download.cliHintLink}
          </Link>
        </p>
      </div>
    </Section>
  );
}

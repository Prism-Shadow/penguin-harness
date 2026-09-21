import { useLayoutEffect, useRef, useState } from "react";
import type { ActivityRunSummary } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import { toneStrip } from "../../lib/tone";
import { Button } from "../../components/ui/button";
import { InfoPopover } from "../../components/ui/info-popover";
import { Select } from "../../components/ui/select";
import { fitScale, latestModuleRun, parseResolution, previewUrl, sceneIds } from "./preview";

/** The embedded WAF module preview: the assembled module in place, with Loom-style overrides. */
export function ModulePreview({
  runs,
  spec,
  languages,
  stale,
}: {
  runs: ActivityRunSummary[];
  spec: Record<string, unknown> | null;
  languages: string[];
  stale: boolean;
}) {
  const run = latestModuleRun(runs);
  const viewport = parseResolution(
    (spec?.runtime as Record<string, unknown> | undefined)?.resolution,
  );
  const scenes = sceneIds(spec);
  const [scene, setScene] = useState("");
  const [language, setLanguage] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [boxWidth, setBoxWidth] = useState(0);
  useLayoutEffect(() => {
    const element = boxRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setBoxWidth(width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  if (!run?.sessionId) return null;
  const scale = fitScale(viewport, { width: boxWidth, height: viewport.height });
  return (
    <section className="space-y-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        {S.activities.previewTitle}
        <InfoPopover label={S.activities.previewTitle}>
          <p>{S.activities.previewHelp}</p>
        </InfoPopover>
      </h3>
      {stale && (
        <p role="status" className={`rounded-md border p-3 text-xs ${toneStrip.attention}`}>
          {S.activities.olderModule}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {scenes.length > 0 && (
          <Select
            size="sm"
            aria-label={S.activities.previewScene}
            value={scene}
            onChange={(event) => setScene(event.target.value)}
          >
            <option value="">{S.activities.previewSceneDefault}</option>
            {scenes.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </Select>
        )}
        {languages.length > 1 && (
          <Select
            size="sm"
            aria-label={S.activities.mediaLanguage}
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
          >
            <option value="">{S.activities.previewLanguageDefault}</option>
            {languages.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </Select>
        )}
        <Button size="sm" onClick={() => setReloadKey((value) => value + 1)}>
          {S.activities.previewReload}
        </Button>
        <a
          className="text-xs underline"
          target="_blank"
          rel="noopener noreferrer"
          href={previewUrl(run.sessionId)}
        >
          {S.activities.previewModule}
        </a>
        <span className="text-xs text-gray-500">
          {S.activities.previewResolution(`${viewport.width}×${viewport.height}`)}
        </span>
      </div>
      <div ref={boxRef} className="w-full">
        <div
          className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-black"
          style={{ height: Math.round(viewport.height * scale) }}
        >
          <iframe
            key={reloadKey}
            src={previewUrl(run.sessionId, {
              scene: scene || undefined,
              language: language || undefined,
            })}
            title={S.activities.previewTitle}
            className="block border-0"
            style={{
              width: viewport.width,
              height: viewport.height,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
            }}
          />
        </div>
      </div>
    </section>
  );
}

/**
 * A roadmap beside its room. A roadmap's room is a channel, and the channel page is the app's own
 * (every stream, composer, mention and phone layout it has); when the channel is a roadmap's room
 * the page gains a column on the right with the roadmap itself — the company-roadmaps plugin's
 * page in its detail view (record, body, items), in an iframe, since the plugin serves and draws
 * it. On a wide window the two stand side by side; on a narrow one the stream keeps the screen and
 * a "Roadmap" bar under the header swaps the column in, with "Back to the room" to swap back.
 */
import { useEffect, useState } from "react";
import { GlyphIcon, ICON_GAP, ICON_SIZE } from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { NAV_ICONS } from "../../lib/nav-icons";
import { useOrgPages } from "./use-org-pages";
import { roadmapDetailSrc, roadmapsPageSrc } from "./roadmaps";

/** The roadmap whose room this channel is, with the detail page to show for it; null for any other channel (or while the plugin is not there). */
export function useChannelRoadmap(
  projectId: string,
  orgId: string,
  channelId: string,
): { number: number; name: string; src: string } | null {
  const pages = useOrgPages();
  const src = roadmapsPageSrc(pages);
  const [found, setFound] = useState<{ key: string; number: number; name: string } | null>(null);
  const key = `${projectId}/${orgId}/${channelId}`;
  useEffect(() => {
    setFound(null);
    if (src === null) return;
    let live = true;
    api
      .listOrgRoadmaps(projectId, orgId, { channel: channelId })
      .then((res) => {
        const r = res.roadmaps.at(-1);
        if (live && r !== undefined) setFound({ key, number: r.number, name: r.name });
      })
      .catch(() => {
        // Not a roadmap's room as far as this page can tell: the channel shows alone.
      });
    return () => {
      live = false;
    };
  }, [src, projectId, orgId, channelId, key]);
  if (src === null || found === null || found.key !== key) return null;
  return { number: found.number, name: found.name, src: roadmapDetailSrc(src, found.number) };
}

/** The bar a narrow window shows under the channel header: it swaps the roadmap column in. */
export function RoadmapBar({ number, onOpen }: { number: number; onOpen: () => void }) {
  return (
    <div className="border-b border-gray-200 px-3 py-1.5 lg:hidden dark:border-gray-800">
      <button
        type="button"
        onClick={onOpen}
        className={`inline-flex items-center ${ICON_GAP.tight} rounded-md px-2 py-1 text-xs font-medium text-gray-700 transition-colors duration-150 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800`}
      >
        <GlyphIcon d={NAV_ICONS.orgRoadmaps} size={ICON_SIZE.inlineGlyph} />
        {S.company.roadmaps.panelTitle(number)}
      </button>
    </div>
  );
}

/** The roadmap column: beside the room on a wide window, in its place on a narrow one while `open`. */
export function RoadmapColumn({
  number,
  src,
  open,
  onClose,
}: {
  number: number;
  src: string;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <aside
      aria-label={S.company.roadmaps.panelTitle(number)}
      className={`${open ? "flex" : "hidden"} min-h-0 w-full flex-col border-gray-200 lg:flex lg:w-[42%] lg:min-w-[22rem] lg:max-w-[44rem] lg:border-l dark:border-gray-800`}
    >
      <div className="border-b border-gray-200 px-3 py-1.5 lg:hidden dark:border-gray-800">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-2 py-1 text-xs font-medium text-gray-700 transition-colors duration-150 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          ← {S.company.roadmaps.hidePanel}
        </button>
      </div>
      <iframe
        title={S.company.roadmaps.panelTitle(number)}
        src={src}
        className="min-h-0 w-full flex-1 border-0"
      />
    </aside>
  );
}

/**
 * One card alone, on a real themed root — the unit the compare frames and `scripts/shots.mjs`
 * render:
 *
 *   /embed?module=<module-id>&variant=<key>&theme=&mode=&tier=&lang=
 *   /embed?module=<module-id>&variant=<live-key>&frame=<frame-key>&play=0|1&…
 *   /embed?demo=<part-id>&variant=<key>&theme=&mode=&tier=&lang=
 *
 * A live variant holds still on its last frame unless `frame` or `play` say otherwise (see
 * lib/live.ts); in a compare frame (`sync=1`) it follows the clock of the card around it instead.
 *
 * It posts its height to a parent frame (`{ type: "gallery:height" }`) and marks
 * `<html data-gallery-ready>` once tokens are resolved and fonts have loaded, which is what the
 * screenshot script waits for. `#embed-root` carries what the script needs to walk the picks:
 * `data-kind`, `data-renderable`, `data-variants` (a module's keys), `data-frames` and
 * `data-frame` (a live variant's frame keys and the one showing), or `data-axes` and `data-matrix`
 * (a demo's).
 */
import { useEffect, useRef } from "react";
import { useFollowedClock, useScenePlayer } from "../chrome/player";
import { parseVariantKey } from "../lib/demos";
import { parseEmbedCue } from "../lib/live";
import { pickVariant } from "../lib/modules";
import { DemoView, ModuleView } from "../preview";
import { DEMOS, MODULES } from "../registry";
import { useGallery } from "../state";

export function EmbedPage() {
  const { tokens, S, state } = useGallery();
  const params = new URLSearchParams(window.location.search);
  const moduleId = params.get("module");
  const demoId = params.get("demo");
  const key = params.get("variant") ?? undefined;
  const entry = moduleId !== null ? MODULES.byId.get(moduleId) : undefined;
  const demo = moduleId === null && demoId !== null ? DEMOS.byId.get(demoId)?.demo : undefined;
  const root = useRef<HTMLDivElement>(null);

  const variant = entry ? pickVariant(entry.module, key) : undefined;
  const reduced = state.motion === "reduced";
  const sync = params.get("sync") === "1";
  const own = useScenePlayer(sync ? undefined : variant?.scene, {
    reduced,
    start: (frames) => parseEmbedCue(frames, window.location.search),
  });
  const followed = useFollowedClock(
    sync ? variant?.scene : undefined,
    entry?.module.id ?? "",
    variant?.key ?? "",
    reduced,
  );
  const clock = sync ? followed : own.clock;

  useEffect(() => {
    const el = root.current;
    if (!el || window.parent === window) return;
    const post = () =>
      window.parent.postMessage(
        { type: "gallery:height", height: el.scrollHeight },
        window.location.origin,
      );
    post();
    const observer = new ResizeObserver(post);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!tokens) return;
    let live = true;
    void document.fonts.ready.then(() =>
      requestAnimationFrame(() => {
        if (live) document.documentElement.dataset.galleryReady = "1";
      }),
    );
    return () => {
      live = false;
    };
  }, [tokens]);

  if (entry && variant) {
    return (
      <div
        ref={root}
        id="embed-root"
        className="g-preview g-embed"
        data-kind="module"
        data-module={entry.module.id}
        data-renderable="true"
        data-width={entry.module.width}
        data-variant={variant.key}
        data-variants={JSON.stringify(entry.module.variants.map((v) => v.key))}
        data-frames={
          variant.scene ? JSON.stringify(variant.scene.frames.map((f) => f.key)) : undefined
        }
        data-frame={clock?.frame}
      >
        <ModuleView module={entry.module} variant={variant} clock={clock} />
      </div>
    );
  }
  if (demo) {
    return (
      <div
        ref={root}
        id="embed-root"
        className="g-preview g-embed"
        data-kind="demo"
        data-renderable="true"
        data-axes={JSON.stringify(demo.axes ?? {})}
        data-matrix={Boolean(demo.matrix)}
      >
        <DemoView demo={demo} pick={parseVariantKey(demo.axes, demo.matrix, key)} />
      </div>
    );
  }
  return (
    <div ref={root} id="embed-root" className="g-preview g-embed" data-renderable="false">
      <p className="g-chrome g-muted">
        {moduleId !== null
          ? S.embed.unknownModule(moduleId)
          : demoId !== null
            ? S.embed.noDemo(demoId)
            : S.embed.nothing}
      </p>
    </div>
  );
}
